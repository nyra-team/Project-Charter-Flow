import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

// ─── RFx envelope crypto (AES-256-GCM + 2-of-2 XOR key split) ───────────────
//
// Vendor bids in RFx events are stored sealed: the answer JSON + any
// associated file content blobs are encrypted at submission time with an
// AES-256-GCM key, and the key itself is split into two XOR shares persisted
// separately. The two shares are conventionally held by SCM (share A) and
// PMO (share B). Recombining them requires two distinct authenticated
// employee actions in the same dual-role unlock flow — there is no single
// admin who can decrypt alone.
//
// Layering on top of this, the route layer enforces a deadline gate
// (`closes_at` must have passed) before issuing share release at all, so a
// rogue SCM and rogue PMO user colluding before the deadline still cannot
// decrypt.
//
// Why XOR rather than Shamir 2-of-2? 2-of-2 XOR is information-theoretically
// equivalent to Shamir at threshold = total and has zero library footprint
// (Node's built-in crypto only). We can swap to Shamir N-of-M later if a
// third approver (eg CFO) needs to be added.
//
// CIPHERTEXT FORMAT
//   iv         : 12 bytes (GCM-recommended nonce length)
//   ciphertext : variable
//   authTag    : 16 bytes (AES-GCM standard)
// All three stored as separate bytea columns on pmo_rfx_envelopes.
//
// SEAL invariants
//   - generateKey() returns a fresh 32-byte buffer per envelope.
//   - splitKey(key) returns [shareA, shareB] each 32 bytes; shareA XOR
//     shareB === key. Either share alone reveals nothing about the key.
//   - The raw key MUST be discarded immediately after sealing; only the
//     two shares are persisted.
//
// OPEN invariants
//   - recombineKey(shareA, shareB) === original key.
//   - openJson must be passed a payload that was sealed with the exact same
//     key, iv, and authTag, or AES-GCM throws (auth tag mismatch). This is
//     what gives us integrity — a tampered ciphertext won't decrypt.

const AES_KEY_BYTES = 32; // 256-bit
const GCM_IV_BYTES = 12;  // 96-bit nonce
const GCM_TAG_BYTES = 16;

export type EnvelopeSeal = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  // The two shares the caller MUST persist separately. The raw key is
  // intentionally not returned — the caller has no reason to ever see it.
  shareA: Buffer;
  shareB: Buffer;
};

export function generateKey(): Buffer {
  return randomBytes(AES_KEY_BYTES);
}

export function splitKey(key: Buffer): [Buffer, Buffer] {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(`envelopeCrypto.splitKey: key must be ${AES_KEY_BYTES} bytes, got ${key.length}`);
  }
  const shareA = randomBytes(AES_KEY_BYTES);
  const shareB = Buffer.alloc(AES_KEY_BYTES);
  for (let i = 0; i < AES_KEY_BYTES; i++) {
    shareB[i] = key[i]! ^ shareA[i]!;
  }
  return [shareA, shareB];
}

export function recombineKey(shareA: Buffer, shareB: Buffer): Buffer {
  if (shareA.length !== AES_KEY_BYTES || shareB.length !== AES_KEY_BYTES) {
    throw new Error("envelopeCrypto.recombineKey: each share must be 32 bytes");
  }
  const out = Buffer.alloc(AES_KEY_BYTES);
  for (let i = 0; i < AES_KEY_BYTES; i++) {
    out[i] = shareA[i]! ^ shareB[i]!;
  }
  return out;
}

/**
 * Seal a JSON-serialisable payload. Returns the ciphertext + IV + auth tag
 * (which the caller persists on pmo_rfx_envelopes) plus the two XOR shares
 * (which the caller persists on pmo_rfx_envelope_keys).
 *
 * The raw key never leaves this function — it's generated, used for
 * encryption, then released to GC.
 */
export function sealJson(payload: unknown): EnvelopeSeal {
  const key = generateKey();
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(json), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const [shareA, shareB] = splitKey(key);
  // Zero out the raw key buffer so it's not lingering on the heap. JS GC
  // doesn't guarantee timely zeroing, but a best-effort wipe is cheap.
  key.fill(0);
  return { ciphertext, iv, authTag, shareA, shareB };
}

/**
 * Open a sealed payload. The caller is responsible for having loaded both
 * key shares from pmo_rfx_envelope_keys and verified that the deadline gate
 * has passed at the route layer — this helper itself has no concept of
 * time, by design (it must remain pure to stay testable).
 */
export function openJson<T = unknown>(args: {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  shareA: Buffer;
  shareB: Buffer;
}): T {
  const { ciphertext, iv, authTag, shareA, shareB } = args;
  if (iv.length !== GCM_IV_BYTES) {
    throw new Error(`envelopeCrypto.openJson: iv must be ${GCM_IV_BYTES} bytes, got ${iv.length}`);
  }
  if (authTag.length !== GCM_TAG_BYTES) {
    throw new Error(`envelopeCrypto.openJson: authTag must be ${GCM_TAG_BYTES} bytes, got ${authTag.length}`);
  }
  const key = recombineKey(shareA, shareB);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as T;
    return parsed;
  } finally {
    key.fill(0);
  }
}

/**
 * Convenience: check that "now" is past a deadline. Centralised here so
 * every caller computes time-locked access consistently.
 */
export function isPastDeadline(closesAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!closesAt) return false;
  const d = closesAt instanceof Date ? closesAt : new Date(closesAt);
  if (Number.isNaN(d.getTime())) return false;
  return now.getTime() >= d.getTime();
}

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Documenso e-sign adapter (self-hosted instance, v1 public API).
// Env is read lazily inside functions (same convention as integrations/sap —
// module-level reads would race dotenv/import hoisting):
//   DOCUMENSO_URL        e.g. http://localhost:3030
//   DOCUMENSO_API_TOKEN  "api_..." token (Authorization header, sent verbatim)

function cfg() {
  return {
    url: (process.env.DOCUMENSO_URL || "").replace(/\/+$/, ""),
    token: process.env.DOCUMENSO_API_TOKEN || "",
  };
}

export function documensoConfigured(): boolean {
  const c = cfg();
  return Boolean(c.url && c.token);
}

// apiPath is the full path under the instance root, e.g. "/api/v1/documents/1"
// or "/api/v2/document/create". Pass a FormData body for multipart endpoints.
async function api<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
  const c = cfg();
  if (!c.url || !c.token) throw new Error("Documenso is not configured (set DOCUMENSO_URL + DOCUMENSO_API_TOKEN).");
  const isForm = body instanceof FormData;
  const res = await fetch(`${c.url}${apiPath}`, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, ...(isForm || body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Documenso ${method} ${apiPath} → ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return (await res.json()) as T;
}

// DOCX → PDF via LibreOffice (soffice is on the box; Documenso only takes PDFs).
export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "esign-"));
  try {
    const inPath = path.join(dir, "in.docx");
    await writeFile(inPath, docx);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, inPath], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("error", reject);
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`soffice exited ${code}: ${stderr.trim()}`))));
    });
    return await readFile(path.join(dir, "in.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export type EsignSigner = { name: string; email: string };

type MarkerBox = { page: number; x: number; y: number }; // page 1-based; x/y = % of page

// Find the invisible "[[SIGn]]" anchors the docx generators embed in each
// signatory cell, so signature fields land exactly on their cells. Returns a
// map keyed by signer index (1-based); missing markers fall back to the grid.
async function locateSignatureMarkers(pdf: Buffer, count: number): Promise<Map<number, MarkerBox>> {
  const dir = await mkdtemp(path.join(tmpdir(), "sigloc-"));
  const script = `
import fitz, json, sys
doc = fitz.open(sys.argv[1]); n = int(sys.argv[2]); out = {}
for pno, page in enumerate(doc):
    W, H = page.rect.width, page.rect.height
    for i in range(1, n + 1):
        if str(i) in out: continue
        rs = page.search_for(f"[[SIG{i}]]")
        if rs:
            r = rs[0]
            out[str(i)] = {"page": pno + 1, "x": round(r.x0 / W * 100, 2), "y": round(r.y0 / H * 100, 2)}
print(json.dumps(out))
`;
  try {
    const inPath = path.join(dir, "in.pdf");
    await writeFile(inPath, pdf);
    const python = process.env.PYTHON_BIN || "python3";
    const stdout = await new Promise<string>((resolve, reject) => {
      const proc = spawn(python, ["-c", script, inPath, String(count)], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      proc.stdout.on("data", (d) => { out += d.toString(); });
      proc.stderr.on("data", (d) => { err += d.toString(); });
      proc.on("error", reject);
      proc.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`marker scan exited ${code}: ${err.trim().slice(0, 300)}`))));
    });
    const parsed = JSON.parse(stdout.trim()) as Record<string, MarkerBox>;
    return new Map(Object.entries(parsed).map(([k, v]) => [Number(k), v]));
  } catch {
    return new Map(); // no PyMuPDF / no markers → caller uses the fallback grid
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export type EsignEnvelope = {
  provider: "documenso";
  documentId: number;
  sentAt: string;
  recipients: Array<{ email: string; role: string; signingOrder: number }>;
};

type CreateDocumentResponse = { id: number; envelopeId: string };

export type DocumensoRecipientState = {
  email: string;
  signingStatus: string; // NOT_SIGNED | SIGNED | REJECTED
  name?: string;
  signingOrder?: number;
  signingUrl?: string; // direct signing link, e.g. {DOCUMENSO_URL}/sign/{token}
  signedAt?: string | null;
};

export type DocumensoDocumentState = {
  id: number;
  externalId: string | null;
  status: string; // DRAFT | PENDING | COMPLETED | REJECTED
  recipients: DocumensoRecipientState[];
};

// One-shot v2 create (multipart payload + PDF; recipients carry inline fields —
// works with Documenso's default "database" storage where the v1 two-step
// presigned upload is unavailable), then distribute (emails signing links).
// Sequential signing: the DOA chain signs in order.
export async function sendForSignature(opts: {
  title: string;
  externalId: string;
  pdf: Buffer;
  signers: EsignSigner[];
  message?: string;
}): Promise<EsignEnvelope> {
  // Signature boxes: pinned to each signer's cell via the invisible "[[SIGn]]"
  // anchors the docx generators embed in the signatory table. Fallback (older
  // documents without anchors): 2-per-row grid near the bottom of the LAST
  // page. Coordinates are % of page.
  const pages = countPdfPages(opts.pdf);
  const markers = await locateSignatureMarkers(opts.pdf, opts.signers.length);
  const payload = {
    title: opts.title,
    externalId: opts.externalId,
    recipients: opts.signers.map((s, i) => {
      const m = markers.get(i + 1);
      return {
        name: s.name,
        email: s.email,
        role: "SIGNER",
        signingOrder: i + 1,
        fields: [m ? {
          type: "SIGNATURE",
          pageNumber: m.page,
          pageX: m.x,
          pageY: m.y,
          width: 18,
          height: 5,
        } : {
          type: "SIGNATURE",
          pageNumber: pages,
          pageX: 8 + (i % 2) * 48,
          pageY: 64 + Math.floor(i / 2) * 11,
          width: 36,
          height: 8,
        }],
      };
    }),
    meta: {
      subject: `Signature requested: ${opts.title}`,
      message: opts.message || "Please review and sign this document as per the Delegation of Authority.",
      timezone: "Asia/Kolkata",
      signingOrder: "SEQUENTIAL",
    },
  };

  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  form.append("file", new Blob([new Uint8Array(opts.pdf)], { type: "application/pdf" }), "document.pdf");
  const created = await api<CreateDocumentResponse>("POST", "/api/v2/document/create", form);

  await api("POST", "/api/v2/document/distribute", { documentId: created.id });

  return {
    provider: "documenso",
    documentId: created.id,
    sentAt: new Date().toISOString(),
    recipients: opts.signers.map((s, i) => ({ email: s.email.toLowerCase(), role: s.name, signingOrder: i + 1 })),
  };
}

export async function getDocumensoDocument(documentId: number): Promise<DocumensoDocumentState> {
  return api<DocumensoDocumentState>("GET", `/api/v1/documents/${documentId}`);
}

/** First recipient still to sign, in signing order — the chain's "current turn". */
export function nextPendingSigner(doc: DocumensoDocumentState): DocumensoRecipientState | null {
  const pending = (doc.recipients ?? [])
    .filter((r) => r.signingStatus === "NOT_SIGNED")
    .sort((a, b) => (a.signingOrder ?? 0) - (b.signingOrder ?? 0));
  return pending[0] ?? null;
}

// Sealed/signed PDF, once every recipient has signed. v2 /download streams the
// raw PDF bytes (the -beta variant returns a JSON downloadUrl instead).
export async function downloadSignedPdf(documentId: number): Promise<Buffer> {
  const c = cfg();
  if (!c.url || !c.token) throw new Error("Documenso is not configured (set DOCUMENSO_URL + DOCUMENSO_API_TOKEN).");
  const res = await fetch(`${c.url}/api/v2-beta/document/${documentId}/download`, {
    headers: { Authorization: `Bearer ${c.token}` },
  });
  if (!res.ok) throw new Error(`Documenso download ${documentId} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    // download-beta-style JSON body with a presigned/direct URL.
    const { downloadUrl } = (await res.json()) as { downloadUrl?: string };
    if (!downloadUrl) throw new Error("Documenso download: no downloadUrl in response");
    const file = await fetch(downloadUrl);
    if (!file.ok) throw new Error(`Documenso downloadUrl fetch → ${file.status}`);
    return Buffer.from(await file.arrayBuffer());
  }
  return stripSigningCertificatePages(Buffer.from(await res.arrayBuffer()));
}

// Drop Documenso's appended "Signing Certificate" page(s) — the business wants
// the stored charter/NFA artifact to end on the Approval & Sign-off table.
// Documenso keeps the untouched sealed original for audit. Best-effort: any
// failure returns the PDF as-is.
async function stripSigningCertificatePages(pdf: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "certstrip-"));
  const script = `
import fitz, sys
doc = fitz.open(sys.argv[1])
drop = [i for i in range(len(doc)) if doc[i].get_text().lstrip().startswith("Signing certificate provided by:")]
if drop and len(drop) < len(doc):
    for i in reversed(drop): doc.delete_page(i)
    doc.save(sys.argv[2])
    print("stripped")
`;
  try {
    const inPath = path.join(dir, "in.pdf");
    const outPath = path.join(dir, "out.pdf");
    await writeFile(inPath, pdf);
    const python = process.env.PYTHON_BIN || "python3";
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(python, ["-c", script, inPath, outPath], { stdio: ["ignore", "ignore", "ignore"] });
      proc.on("error", reject);
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`cert strip exited ${code}`))));
    });
    return await readFile(outPath); // ENOENT when nothing was stripped → catch returns original
  } catch {
    return pdf;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ponytail: page count by counting page objects — avoids loading pdf-parse for
// one integer; LibreOffice-produced PDFs always carry plain /Type /Page markers.
function countPdfPages(pdf: Buffer): number {
  const matches = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  return matches && matches.length > 0 ? matches.length : 1;
}

// Map a PMO signatory grid ({role, name(email for DOA chains), email?}) to
// Documenso signers. Returns the roles that have no resolvable email so the
// caller can 422 with a useful message.
export function signersFromSignatories(
  sigs: Array<{ role?: string; name?: string; email?: string }>,
): { signers: EsignSigner[]; missing: string[] } {
  const signers: EsignSigner[] = [];
  const missing: string[] = [];
  for (const s of sigs) {
    const email = (s.email || (s.name?.includes("@") ? s.name : "") || "").trim().toLowerCase();
    if (email) signers.push({ name: s.role?.trim() || email, email });
    else missing.push(s.role || s.name || "(unnamed)");
  }
  return { signers, missing };
}

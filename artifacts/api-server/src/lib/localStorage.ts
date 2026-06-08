/**
 * Local-filesystem fallback for environments without Replit's Object Storage
 * sidecar (i.e. running this app outside Replit — local dev workstations,
 * other cloud hosts). Files are written under LOCAL_OBJECT_STORAGE_DIR
 * (default: ./uploads relative to api-server cwd) and served back through
 * the same /api/storage/objects/* GET route as GCS-backed files.
 *
 * Object id convention: random UUID prefixed with "local-" so the GET handler
 * can recognise local-vs-GCS without ambiguity.
 */
import { promises as fs, createWriteStream, createReadStream, type ReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";

const DEFAULT_DIR = path.resolve(process.cwd(), "uploads");

function isValidId(id: string): boolean {
  return /^local-[a-zA-Z0-9_-]{1,128}$/.test(id);
}

export function getLocalUploadDir(): string {
  return process.env.LOCAL_OBJECT_STORAGE_DIR || DEFAULT_DIR;
}

export async function ensureLocalUploadDir(): Promise<string> {
  const dir = getLocalUploadDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function pathsFor(objectId: string): { file: string; meta: string } {
  if (!isValidId(objectId)) {
    throw new Error(`Invalid local object id: ${objectId}`);
  }
  const dir = getLocalUploadDir();
  return { file: path.join(dir, objectId), meta: path.join(dir, `${objectId}.meta.json`) };
}

interface LocalMeta {
  contentType: string;
  originalName: string;
  size: number;
  uploadedAt: string;
}

export async function writeLocalUpload(
  objectId: string,
  body: Readable,
  contentType: string,
  originalName: string,
): Promise<{ size: number }> {
  await ensureLocalUploadDir();
  const { file, meta } = pathsFor(objectId);
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(file);
    body.on("data", (chunk: Buffer) => { size += chunk.length; });
    body.on("error", reject);
    ws.on("error", reject);
    ws.on("finish", () => resolve());
    body.pipe(ws);
  });
  const metaPayload: LocalMeta = {
    contentType: contentType || "application/octet-stream",
    originalName: originalName || objectId,
    size,
    uploadedAt: new Date().toISOString(),
  };
  await fs.writeFile(meta, JSON.stringify(metaPayload), "utf8");
  return { size };
}

export async function readLocalMeta(objectId: string): Promise<LocalMeta | null> {
  try {
    const { meta } = pathsFor(objectId);
    const raw = await fs.readFile(meta, "utf8");
    return JSON.parse(raw) as LocalMeta;
  } catch {
    return null;
  }
}

export async function localFileExists(objectId: string): Promise<boolean> {
  try {
    const { file } = pathsFor(objectId);
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

export function openLocalFileStream(objectId: string): ReadStream {
  const { file } = pathsFor(objectId);
  return createReadStream(file);
}

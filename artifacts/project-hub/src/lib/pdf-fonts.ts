import type { jsPDF } from "jspdf";

const FONT_FAMILY = "PlusJakartaSans";

type FontVariant = { url: string; style: "normal"; weight: "normal" | "bold"; vfsName: string };

const VARIANTS: FontVariant[] = [
  { url: "/fonts/PlusJakartaSans-Regular.ttf", style: "normal", weight: "normal", vfsName: "PlusJakartaSans-Regular.ttf" },
  { url: "/fonts/PlusJakartaSans-Bold.ttf", style: "normal", weight: "bold", vfsName: "PlusJakartaSans-Bold.ttf" },
];

let cachedB64: Record<string, string> | null = null;
let loading: Promise<Record<string, string>> | null = null;

async function fetchAllAsBase64(): Promise<Record<string, string>> {
  if (cachedB64) return cachedB64;
  if (loading) return loading;
  loading = (async () => {
    const out: Record<string, string> = {};
    await Promise.all(
      VARIANTS.map(async (v) => {
        const res = await fetch(v.url);
        if (!res.ok) throw new Error(`Failed to load font ${v.url}: ${res.status}`);
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        out[v.vfsName] = btoa(binary);
      }),
    );
    cachedB64 = out;
    return out;
  })();
  return loading;
}

export async function registerLetterFont(doc: jsPDF): Promise<string> {
  try {
    const b64Map = await fetchAllAsBase64();
    for (const v of VARIANTS) {
      doc.addFileToVFS(v.vfsName, b64Map[v.vfsName]);
      doc.addFont(v.vfsName, FONT_FAMILY, v.style, v.weight);
    }
    return FONT_FAMILY;
  } catch {
    return "helvetica";
  }
}

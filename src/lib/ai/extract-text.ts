import "server-only";
import { AppError } from "@/lib/result";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // STD-01
const CHARS_PER_PAGE = 1800;

export type TeksNaskah = { text: string; pages: number };

/** Ekstraksi teks mentah dari PDF / DOCX / TXT (pipeline langkah 1). */
export async function ekstrakTeksBerkas(buf: ArrayBuffer, fileName: string): Promise<TeksNaskah> {
  if (buf.byteLength > MAX_FILE_BYTES) throw new AppError("Ukuran berkas melebihi 10 MB");
  const ext = fileName.toLowerCase().split(".").pop();
  let text = "";
  let pages: number | null = null;

  try {
    if (ext === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const r = await extractText(pdf, { mergePages: true });
      text = Array.isArray(r.text) ? r.text.join("\n") : r.text;
      pages = r.totalPages;
    } else if (ext === "docx") {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: Buffer.from(buf) })).value;
    } else if (ext === "txt") {
      text = new TextDecoder("utf-8").decode(buf);
    } else {
      throw new AppError("Format berkas harus PDF, DOCX, atau TXT");
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("Berkas rusak atau tidak dapat dibaca");
  }

  text = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (text.length < 30) throw new AppError("Teks tidak terbaca (berkas kosong atau hasil pindai/gambar)");
  return { text, pages: pages ?? Math.max(1, Math.ceil(text.length / CHARS_PER_PAGE)) };
}

export const perkiraanHalaman = (teks: string) => Math.max(1, Math.ceil(teks.length / CHARS_PER_PAGE));
export const CHARS_PER_EIGHTH = CHARS_PER_PAGE / 8;

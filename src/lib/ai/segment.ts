import { CHARS_PER_EIGHTH } from "./extract-text";

export type AdeganMentah = { scene_no: number; heading: string; body: string; page_eighths: number };

// Heading adegan baku: "12. INT. RUMAH SAKIT - MALAM", "EXT./INT. ...", "EKS. ...", "ADEGAN 5 ...", "SCENE 5 ..."
const HEADING_RE =
  /^[ \t]*(?:\d{1,3}[.)]?[ \t]+)?(?:(?:INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E|INT|EXT|EKS)(?=[.\s])[^\n]*|(?:ADEGAN|SCENE)[ \t]+\d+[^\n]*)$/gim;

const MAX_CHUNK = 3500; // untuk cadangan bila format tidak baku

export const hitungEighths = (body: string) => Math.max(1, Math.round(body.length / CHARS_PER_EIGHTH));

/** Segmentasi berbasis aturan (regex heading). Mengembalikan [] bila heading tidak ditemukan. */
export function segmentasiAturan(text: string): AdeganMentah[] {
  const marks = [...text.matchAll(HEADING_RE)].map((m) => ({ idx: m.index!, heading: m[0].trim() }));
  if (marks.length === 0) return [];

  const scenes: AdeganMentah[] = [];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].idx : text.length;
    const body = text.slice(m.idx, end).trim();
    scenes.push({ scene_no: i + 1, heading: m.heading, body, page_eighths: hitungEighths(body) });
  });
  return scenes;
}

/**
 * Cadangan untuk naskah tak baku: pecah per paragraf menjadi potongan ±3.500 karakter.
 * Heading/lokasi/waktu lalu diturunkan oleh LLM pada tahap NER.
 */
export function segmentasiCadangan(text: string): AdeganMentah[] {
  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > MAX_CHUNK) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + p;
  }
  if (cur) chunks.push(cur);
  return chunks.map((body, i) => ({ scene_no: i + 1, heading: "", body, page_eighths: hitungEighths(body) }));
}

export function segmentasiAdegan(text: string): { scenes: AdeganMentah[]; metode: "aturan" | "cadangan" } {
  const byRule = segmentasiAturan(text);
  return byRule.length >= 1 ? { scenes: byRule, metode: "aturan" } : { scenes: segmentasiCadangan(text), metode: "cadangan" };
}

/** Turunkan INT/EXT dan waktu dari heading baku (dipakai sebagai pembanding hasil LLM). */
export function parseHeading(heading: string) {
  const h = heading.toUpperCase();
  const intExt: "INT" | "EXT" | "INT/EXT" | null = /(INT\.?\/EXT|EXT\.?\/INT|I\/E)/.test(h)
    ? "INT/EXT"
    : /\bEXT\b|\bEKS\b/.test(h)
      ? "EXT"
      : /\bINT\b/.test(h)
        ? "INT"
        : null;
  const parts = h.split(/\s[-–—]\s/);
  const time = parts.length > 1 ? parts[parts.length - 1].trim() : null;
  return { intExt, time };
}

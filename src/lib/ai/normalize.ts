/** Normalisasi & deduplikasi hasil NER (pipeline langkah 4). Fungsi murni, tanpa I/O. */

const HONORIFIC = /^(pak|bapak|bu|ibu|mas|mbak|kak|bang|mr|mrs|ms|dr|dokter|prof|om|tante|ibu|haji|hj|h)\.?\s+/i;

export const normKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const nameKey = (s: string) => normKey(s.replace(HONORIFIC, "")).replace(/[^\p{L}\p{N} ]/gu, "");

/**
 * Satukan variasi nama karakter ("Pak Budi" / "Budi" / "Budi Santoso").
 * Kembalikan fungsi kanon: nama asli → nama kanonik.
 */
export function buatKanonKarakter(semuaNama: string[]): (nama: string) => string {
  const freq = new Map<string, number>();
  semuaNama.forEach((n) => freq.set(n, (freq.get(n) ?? 0) + 1));

  type Cluster = { tokens: Set<string>; variants: Map<string, number> };
  const clusters: Cluster[] = [];
  const assign = new Map<string, Cluster>();

  // Proses nama terpanjang dahulu agar "Budi Santoso" menjadi jangkar bagi "Budi"
  const uniq = [...freq.keys()].sort((a, b) => nameKey(b).length - nameKey(a).length);
  for (const n of uniq) {
    const toks = nameKey(n).split(" ").filter(Boolean);
    if (!toks.length) continue;
    const cl = clusters.find((c) => toks.every((t) => c.tokens.has(t)));
    if (cl) {
      cl.variants.set(n, freq.get(n)!);
      assign.set(n, cl);
    } else {
      const c: Cluster = { tokens: new Set(toks), variants: new Map([[n, freq.get(n)!]]) };
      clusters.push(c);
      assign.set(n, c);
    }
  }

  const canon = new Map<Cluster, string>();
  for (const c of clusters) {
    const best = [...c.variants.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
    canon.set(c, best.replace(HONORIFIC, (m) => (nameKey(best).includes(" ") ? "" : m)).trim() || best);
  }
  return (nama) => {
    const c = assign.get(nama);
    return c ? canon.get(c)! : nama;
  };
}

export type MasterProp = { id: string; name: string; category: string; aliases: string[]; procurement_default: string };

/** Cocokkan nama properti dengan katalog master (nama atau alias). */
export function cocokkanMaster(nama: string, masters: MasterProp[]): MasterProp | null {
  const k = normKey(nama);
  for (const m of masters) {
    if (normKey(m.name) === k || m.aliases.some((a) => normKey(a) === k)) return m;
  }
  for (const m of masters) {
    const terms = [m.name, ...m.aliases].map(normKey).filter((t) => t.length >= 4);
    if (terms.some((t) => new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(k))) return m;
  }
  return null;
}

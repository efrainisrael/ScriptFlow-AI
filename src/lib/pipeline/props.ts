import "server-only";
import type { DB } from "@/lib/supabase/admin";
import { must } from "@/lib/result";
import { cocokkanMaster, normKey, type MasterProp } from "@/lib/ai/normalize";
import type { PropCategory } from "@/lib/ai/schema";

const TYPE_TO_CATEGORY: Record<string, PropCategory | undefined> = {
  COSTUME: "kostum",
  VEHICLE: "kendaraan",
  ANIMAL: "hewan",
  SPECIAL_FX: "efek_khusus",
};

/**
 * Turunkan tabel `props` dari entitas adegan. Item manual (source='manual') dipertahankan;
 * item AI dibangun ulang. Dipanggil setelah analisis & setiap koreksi entitas.
 */
export async function bangunUlangProps(db: DB, versionId: string) {
  const scenes = must(await db.from("scenes").select("id").eq("version_id", versionId), "Gagal memuat adegan") as { id: string }[];
  const sceneIds = scenes.map((s) => s.id);
  if (!sceneIds.length) return 0;

  const entities = must(
    await db
      .from("entities")
      .select("scene_id, type, name, quantity, category")
      .in("scene_id", sceneIds)
      .in("type", ["PROP", "COSTUME", "VEHICLE", "ANIMAL", "SPECIAL_FX"]),
    "Gagal memuat entitas"
  ) as { scene_id: string; type: string; name: string; quantity: number; category: string | null }[];

  const masters = (must(
    await db.from("property_master").select("id, name, category, aliases, procurement_default").eq("is_active", true)
  ) ?? []) as MasterProp[];

  const manual = (must(await db.from("props").select("name, category").eq("version_id", versionId).eq("source", "manual")) ?? []) as { name: string; category: string }[];
  const manualKeys = new Set(manual.map((m) => `${m.category}|${normKey(m.name)}`));

  const agg = new Map<string, { name: string; category: PropCategory; quantity: number; scenes: Set<string>; master: MasterProp | null }>();
  for (const e of entities) {
    const category = (e.type === "PROP" ? (e.category as PropCategory) ?? "properti_tangan" : TYPE_TO_CATEGORY[e.type]) as PropCategory;
    const master = cocokkanMaster(e.name, masters);
    const name = master?.name ?? e.name;
    const key = `${category}|${normKey(name)}`;
    if (manualKeys.has(key)) continue;
    const cur = agg.get(key);
    if (cur) {
      cur.quantity = Math.max(cur.quantity, e.quantity); // barang fisik yang sama lintas adegan
      cur.scenes.add(e.scene_id);
    } else {
      agg.set(key, { name, category, quantity: e.quantity, scenes: new Set([e.scene_id]), master });
    }
  }

  must(await db.from("props").delete().eq("version_id", versionId).eq("source", "ai"));
  const rows = [...agg.values()].map((p) => ({
    version_id: versionId,
    name: p.name,
    category: p.category,
    quantity: p.quantity,
    procurement_status: p.master?.procurement_default ?? "belum",
    scene_ids: [...p.scenes],
    property_master_id: p.master?.id ?? null,
    source: "ai",
  }));
  if (rows.length) must(await db.from("props").insert(rows), "Gagal menyimpan properti");
  return rows.length;
}

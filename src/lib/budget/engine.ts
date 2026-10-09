import "server-only";
import type { DB } from "@/lib/supabase/admin";
import { must } from "@/lib/result";
import { normKey } from "@/lib/ai/normalize";

export const KATEGORI_BIAYA = [
  "kru", "pemeran", "properti_kostum", "lokasi", "peralatan",
  "transportasi", "konsumsi", "perizinan", "pascaproduksi",
] as const;

const CREW_HEADCOUNT = 15; // asumsi jumlah kru inti untuk konsumsi
const FALLBACK_PROP_RATE: Record<string, string> = {
  properti_tangan: "prop_properti_tangan", set_dressing: "prop_set_dressing", kostum: "prop_kostum",
  kendaraan: "prop_kendaraan", tata_rias: "prop_tata_rias", efek_khusus: "prop_efek_khusus", hewan: "prop_hewan",
};

type Rate = { id: string; code: string; item_name: string; unit: string; unit_price: number };
type Draft = {
  ref_key: string; category: (typeof KATEGORI_BIAYA)[number]; description: string;
  qty: number; unit: string; unit_price: number; rate_card_id: string | null;
};

export type RingkasanBiaya = {
  per_kategori: Record<string, number>;
  subtotal: number; kontingensi_pct: number; kontingensi: number;
  pajak_pct: number; pajak: number; total: number;
};

/**
 * Mesin biaya DETERMINISTIK (PRD 6.2 langkah 6): rate card × volume. LLM tidak menghitung angka.
 * Baris manual (source='manual') dipertahankan; baris auto dibangun ulang. Rate card milik pengguna
 * menimpa default global dengan kode yang sama (BYA-03).
 */
export async function hitungBiaya(db: DB, versionId: string) {
  const ver = must(
    await db
      .from("script_versions")
      .select("id, scripts(user_id, currency)")
      .eq("id", versionId)
      .single(),
    "Versi tidak ditemukan"
  ) as unknown as { id: string; scripts: { user_id: string; currency: string } };
  const ownerId = ver.scripts.user_id;

  const [scenesR, daysR, locsR, propsR, ratesR, masterR, settingsR, linesR] = await Promise.all([
    db.from("scenes").select("id, scene_no, location_id, int_ext, page_eighths, est_duration_min, entities(type, name, quantity)").eq("version_id", versionId),
    db.from("shooting_days").select("id, schedule_items(scene_id)").eq("version_id", versionId),
    db.from("locations").select("id, name, permit_required").eq("version_id", versionId),
    db.from("props").select("id, name, category, quantity, property_master_id").eq("version_id", versionId),
    db.from("rate_cards").select("id, user_id, code, item_name, unit, unit_price").or(`user_id.is.null,user_id.eq.${ownerId}`),
    db.from("property_master").select("id, default_unit, ref_price_min, ref_price_max"),
    db.from("budget_settings").select("*").eq("version_id", versionId).maybeSingle(),
    db.from("budget_lines").select("id, source, ref_key").eq("version_id", versionId),
  ]);

  const scenes = must(scenesR) as { id: string; scene_no: number; location_id: string | null; int_ext: string | null; page_eighths: number; est_duration_min: number; entities: { type: string; name: string; quantity: number }[] }[];
  const days = must(daysR) as { id: string; schedule_items: { scene_id: string }[] }[];
  const locs = must(locsR) as { id: string; name: string; permit_required: boolean }[];
  const props = must(propsR) as { id: string; name: string; category: string; quantity: number; property_master_id: string | null }[];
  const rateRows = must(ratesR) as (Rate & { user_id: string | null })[];
  const masters = new Map((must(masterR) as { id: string; default_unit: string; ref_price_min: number; ref_price_max: number }[]).map((m) => [m.id, m]));
  const existing = must(linesR) as { id: string; source: string; ref_key: string | null }[];

  // Override pengguna menang atas default global
  const rates = new Map<string, Rate>();
  rateRows.filter((r) => r.user_id === null).forEach((r) => rates.set(r.code, r));
  rateRows.filter((r) => r.user_id !== null).forEach((r) => rates.set(r.code, r));

  const peringatan: string[] = [];
  const drafts: Draft[] = [];
  const add = (ref_key: string, category: Draft["category"], description: string, qty: number, code: string, override?: { price: number; unit: string }) => {
    if (qty <= 0) return;
    const r = rates.get(code);
    if (!override && !r) {
      peringatan.push(`Rate card '${code}' tidak ditemukan; baris "${description}" dilewati`);
      return;
    }
    drafts.push({
      ref_key, category, description, qty,
      unit: override?.unit ?? r!.unit,
      unit_price: override?.price ?? Number(r!.unit_price),
      rate_card_id: r?.id ?? null,
    });
  };

  // ---- peta adegan → hari syuting ----
  const sceneDay = new Map<string, string>();
  days.forEach((d) => d.schedule_items.forEach((it) => sceneDay.set(it.scene_id, d.id)));
  const activeDays = new Set(sceneDay.values());
  const totalMinutes = scenes.reduce((a, s) => a + s.est_duration_min, 0);
  const hari = Math.max(1, activeDays.size || Math.ceil(totalMinutes / 600));

  // ---- kru, peralatan, transportasi ----
  add("kru:paket", "kru", "Paket kru inti", hari, "kru_paket_harian");
  add("alat:kamera", "peralatan", "Paket kamera & lensa", hari, "peralatan_kamera_paket");
  add("alat:lighting", "peralatan", "Paket lighting & grip", hari, "peralatan_lighting_paket");
  const stuntScenes = scenes.filter((s) => s.entities.some((e) => e.type === "STUNT"));
  stuntScenes.forEach((s) => add(`alat:stunt:${s.id}`, "peralatan", `Stunt adegan ${s.scene_no}`, 1, "peralatan_stunt"));
  add("transport:harian", "transportasi", "Transportasi kru & peralatan", hari, "transport_harian");

  // ---- pemeran ----
  const chars = new Map<string, { name: string; scenes: Set<string>; days: Set<string> }>();
  scenes.forEach((s) =>
    s.entities.filter((e) => e.type === "CHARACTER").forEach((e) => {
      const k = normKey(e.name);
      const c = chars.get(k) ?? { name: e.name, scenes: new Set<string>(), days: new Set<string>() };
      c.scenes.add(s.id);
      const d = sceneDay.get(s.id);
      if (d) c.days.add(d);
      chars.set(k, c);
    })
  );
  let castPersonDays = 0;
  chars.forEach((c, k) => {
    const d = Math.max(1, c.days.size || c.scenes.size);
    castPersonDays += d;
    const utama = c.scenes.size >= 3;
    add(`cast:${k}`, "pemeran", `${utama ? "Pemeran utama" : "Pemeran pendukung"}: ${c.name}`, d, utama ? "cast_utama" : "cast_pendukung");
  });
  const extraTotal = scenes.reduce((a, s) => a + s.entities.filter((e) => e.type === "EXTRA").reduce((x, e) => x + e.quantity, 0), 0);
  add("cast:figuran", "pemeran", "Figuran (total orang-hari)", extraTotal, "cast_figuran");

  // ---- properti & kostum ----
  props.forEach((p) => {
    const m = p.property_master_id ? masters.get(p.property_master_id) : undefined;
    if (m) {
      const price = (Number(m.ref_price_min) + Number(m.ref_price_max)) / 2;
      add(`prop:${p.id}`, "properti_kostum", `${p.name} (${p.category.replace("_", " ")})`, p.quantity, "", { price, unit: m.default_unit });
    } else {
      add(`prop:${p.id}`, "properti_kostum", `${p.name} (${p.category.replace("_", " ")})`, p.quantity, FALLBACK_PROP_RATE[p.category] ?? "prop_properti_tangan");
    }
  });

  // ---- lokasi & perizinan ----
  locs.forEach((l) => {
    const locScenes = scenes.filter((s) => s.location_id === l.id);
    const locDays = new Set(locScenes.map((s) => sceneDay.get(s.id)).filter(Boolean));
    const d = Math.max(1, locDays.size);
    const exterior = locScenes.some((s) => s.int_ext === "EXT" || s.int_ext === "INT/EXT");
    add(`loc:${l.id}`, "lokasi", `Sewa lokasi ${exterior ? "eksterior" : "interior"}: ${l.name}`, d, exterior ? "lokasi_eksterior" : "lokasi_interior");
    if (l.permit_required) add(`permit:${l.id}`, "perizinan", `Izin lokasi: ${l.name}`, 1, "perizinan_lokasi");
  });

  // ---- konsumsi & pascaproduksi ----
  add("konsumsi:total", "konsumsi", "Konsumsi kru, pemeran & figuran", CREW_HEADCOUNT * hari + castPersonDays + extraTotal, "konsumsi_per_orang");
  const menit = Math.max(1, Math.round(scenes.reduce((a, s) => a + s.page_eighths, 0) / 8));
  add("pasca:total", "pascaproduksi", "Pascaproduksi (editing, color, sound)", menit, "pascaproduksi_per_menit");

  // ---- simpan: pertahankan baris manual, bangun ulang baris auto ----
  const manualKeys = new Set(existing.filter((l) => l.source === "manual" && l.ref_key).map((l) => l.ref_key));
  must(await db.from("budget_lines").delete().eq("version_id", versionId).eq("source", "auto"));
  const fresh = drafts.filter((d) => !manualKeys.has(d.ref_key));
  if (fresh.length) {
    must(await db.from("budget_lines").insert(fresh.map((d) => ({ ...d, version_id: versionId, source: "auto" }))), "Gagal menyimpan rincian biaya");
  }

  const ringkasan = await ringkasanBiaya(db, versionId, ver.scripts.currency, settingsR.data as { contingency_pct: number; tax_pct: number } | null);
  return { ringkasan, peringatan };
}

/** Total per kategori + kontingensi + pajak; memperbarui cache total_estimate. */
export async function ringkasanBiaya(
  db: DB,
  versionId: string,
  currency = "IDR",
  settingsIn?: { contingency_pct: number; tax_pct: number } | null
): Promise<RingkasanBiaya> {
  let settings = settingsIn;
  if (!settings) {
    const { data } = await db.from("budget_settings").select("contingency_pct, tax_pct").eq("version_id", versionId).maybeSingle();
    settings = data as { contingency_pct: number; tax_pct: number } | null;
  }
  if (!settings) {
    const own = await db.from("script_versions").select("scripts(user_id)").eq("id", versionId).single();
    const uid = (own.data as unknown as { scripts: { user_id: string } } | null)?.scripts.user_id;
    const prof = uid ? await db.from("profiles").select("default_contingency_pct").eq("id", uid).maybeSingle() : null;
    const pct = Number((prof?.data as { default_contingency_pct: number } | null)?.default_contingency_pct ?? 10);
    await db.from("budget_settings").upsert({ version_id: versionId, contingency_pct: pct, tax_pct: 0, currency });
    settings = { contingency_pct: pct, tax_pct: 0 };
  }

  const lines = must(await db.from("budget_lines").select("category, subtotal").eq("version_id", versionId)) as { category: string; subtotal: number }[];
  const per_kategori: Record<string, number> = Object.fromEntries(KATEGORI_BIAYA.map((k) => [k, 0]));
  lines.forEach((l) => (per_kategori[l.category] += Number(l.subtotal)));
  const subtotal = Object.values(per_kategori).reduce((a, b) => a + b, 0);
  const kontingensi_pct = Number(settings.contingency_pct);
  const pajak_pct = Number(settings.tax_pct);
  const kontingensi = Math.round(subtotal * kontingensi_pct) / 100;
  const pajak = Math.round((subtotal + kontingensi) * pajak_pct) / 100;
  const total = subtotal + kontingensi + pajak;
  per_kategori["kontingensi"] = kontingensi;

  await db.from("script_versions").update({ total_estimate: total }).eq("id", versionId);
  return { per_kategori, subtotal, kontingensi_pct, kontingensi, pajak_pct, pajak, total };
}

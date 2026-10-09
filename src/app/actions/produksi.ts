"use server";

import { z } from "zod";
import { requireUser, requireOwnVersion } from "@/lib/auth";
import { AppError, must, safe } from "@/lib/result";
import { PROP_CATEGORIES } from "@/lib/ai/schema";
import { hitungBiaya, ringkasanBiaya, KATEGORI_BIAYA } from "@/lib/budget/engine";
import { susunJadwalVersi } from "@/lib/schedule/engine";
import { normKey } from "@/lib/ai/normalize";

type Sb = Awaited<ReturnType<typeof requireUser>>["supabase"];

// =====================================================================
// RINCIAN BIAYA (BYA-01..09)
// =====================================================================

/**
 * Hitung ulang estimasi anggaran sebuah versi naskah: rate card × volume (deterministik).
 * Mengembalikan total_estimasi + rincian_item (nama barang & harga), ringkasan per kategori, dan peringatan.
 */
export async function hitungEstimasiAnggaran(versionId: string) {
  return safe(async () => {
    const { supabase } = await requireOwnVersion(versionId);
    return await muatAnggaran(supabase, versionId, true);
  });
}

/** Ambil anggaran tersimpan tanpa menghitung ulang. */
export async function ambilAnggaran(versionId: string) {
  return safe(async () => {
    const { supabase } = await requireOwnVersion(versionId);
    return await muatAnggaran(supabase, versionId, false);
  });
}

async function muatAnggaran(supabase: Sb, versionId: string, hitung: boolean) {
  let peringatan: string[] = [];
  let ringkasan;
  if (hitung) {
    const r = await hitungBiaya(supabase, versionId);
    ringkasan = r.ringkasan;
    peringatan = r.peringatan;
  } else {
    ringkasan = await ringkasanBiaya(supabase, versionId);
  }
  const lines = must(
    await supabase.from("budget_lines").select("id, category, description, qty, unit, unit_price, subtotal, source").eq("version_id", versionId).order("category")
  ) as { id: string; category: string; description: string; qty: number; unit: string; unit_price: number; subtotal: number; source: string }[];

  return {
    total_estimasi: ringkasan.total,
    rincian_item: lines.map((l) => ({
      id: l.id,
      kategori: l.category,
      nama_item: l.description,
      jumlah: Number(l.qty),
      satuan: l.unit,
      harga_satuan: Number(l.unit_price),
      subtotal: Number(l.subtotal),
      sumber: l.source,
    })),
    ringkasan,
    peringatan,
  };
}

const lineSchema = z.object({
  category: z.enum(KATEGORI_BIAYA),
  description: z.string().trim().min(1).max(300),
  qty: z.coerce.number().min(0),
  unit: z.string().trim().min(1).max(30).default("item"),
  unit_price: z.coerce.number().min(0),
});

/** BYA-03/04 — ubah volume/harga satu baris; baris ditandai manual agar tidak ditimpa hitung ulang. */
export async function ubahBarisBiaya(lineId: string, patch: Partial<z.input<typeof lineSchema>>) {
  return safe(async () => {
    const { supabase } = await requireUser();
    const p = lineSchema.partial().parse(patch);
    const { data } = await supabase.from("budget_lines").select("version_id").eq("id", lineId).maybeSingle();
    if (!data) throw new AppError("Baris biaya tidak ditemukan", 404);
    must(await supabase.from("budget_lines").update({ ...p, source: "manual" }).eq("id", lineId));
    return { ringkasan: await ringkasanBiaya(supabase, (data as { version_id: string }).version_id) };
  });
}

export async function tambahBarisBiaya(versionId: string, input: z.input<typeof lineSchema>) {
  return safe(async () => {
    const { supabase } = await requireOwnVersion(versionId);
    const l = lineSchema.parse(input);
    must(await supabase.from("budget_lines").insert({ ...l, version_id: versionId, source: "manual", ref_key: `manual:${crypto.randomUUID()}` }));
    return { ringkasan: await ringkasanBiaya(supabase, versionId) };
  });
}

export async function hapusBarisBiaya(lineId: string) {
  return safe(async () => {
    const { supabase } = await requireUser();
    const { data } = await supabase.from("budget_lines").select("version_id").eq("id", lineId).maybeSingle();
    if (!data) throw new AppError("Baris biaya tidak ditemukan", 404);
    must(await supabase.from("budget_lines").delete().eq("id", lineId));
    return { ringkasan: await ringkasanBiaya(supabase, (data as { version_id: string }).version_id) };
  });
}

/** BYA-05 — persentase kontingensi & pajak. */
export async function ubahPengaturanBiaya(versionId: string, input: { contingency_pct?: number; tax_pct?: number }) {
  return safe(async () => {
    const { supabase } = await requireOwnVersion(versionId);
    const p = z.object({ contingency_pct: z.number().min(0).max(100).optional(), tax_pct: z.number().min(0).max(100).optional() }).parse(input);
    await ringkasanBiaya(supabase, versionId); // pastikan baris pengaturan ada
    must(await supabase.from("budget_settings").update(p).eq("version_id", versionId));
    return { ringkasan: await ringkasanBiaya(supabase, versionId) };
  });
}

/** BYA-03 — sesuaikan harga satuan rate card milik pengguna (menimpa default global), lalu hitung ulang. */
export async function ubahRateCardSaya(versionId: string, code: string, unit_price: number) {
  return safe(async () => {
    const { supabase, user } = await requireOwnVersion(versionId);
    const price = z.number().min(0).parse(unit_price);
    const { data: base } = await supabase.from("rate_cards").select("category, item_name, unit, currency").eq("code", code).is("user_id", null).maybeSingle();
    if (!base) throw new AppError("Rate card tidak ditemukan", 404);
    must(await supabase.from("rate_cards").upsert({ ...base, user_id: user.id, code, unit_price: price }, { onConflict: "user_id,code" }));
    return await muatAnggaran(supabase, versionId, true);
  });
}

export async function daftarRateCard() {
  return safe(async () => {
    const { supabase, user } = await requireUser();
    const rows = must(await supabase.from("rate_cards").select("id, user_id, code, category, item_name, unit, unit_price, currency").or(`user_id.is.null,user_id.eq.${user.id}`).order("category")) as { user_id: string | null; code: string }[];
    const mine = new Set(rows.filter((r) => r.user_id).map((r) => r.code));
    return rows.filter((r) => r.user_id || !mine.has(r.code)); // override pengguna menggantikan default
  });
}

/** BYA-07 / HIS-05 — bandingkan dua versi: adegan, properti, dan biaya. */
export async function bandingkanVersi(versiLama: string, versiBaru: string) {
  return safe(async () => {
    const { supabase } = await requireUser();
    const load = async (id: string) => {
      const [scenes, props, lines, ver] = await Promise.all([
        supabase.from("scenes").select("scene_no, heading").eq("version_id", id),
        supabase.from("props").select("name, category, quantity").eq("version_id", id),
        supabase.from("budget_lines").select("category, subtotal").eq("version_id", id),
        supabase.from("script_versions").select("total_estimate").eq("id", id).maybeSingle(),
      ]);
      if (!ver.data) throw new AppError("Versi tidak ditemukan", 404);
      const kat: Record<string, number> = {};
      ((lines.data ?? []) as { category: string; subtotal: number }[]).forEach((l) => (kat[l.category] = (kat[l.category] ?? 0) + Number(l.subtotal)));
      return {
        scenes: (scenes.data ?? []) as { scene_no: number; heading: string }[],
        props: (props.data ?? []) as { name: string; category: string; quantity: number }[],
        kat,
        total: Number((ver.data as { total_estimate: number }).total_estimate),
      };
    };
    const [a, b] = await Promise.all([load(versiLama), load(versiBaru)]);

    const propKey = (p: { name: string; category: string }) => `${p.category}|${normKey(p.name)}`;
    const aProps = new Map(a.props.map((p) => [propKey(p), p]));
    const bProps = new Map(b.props.map((p) => [propKey(p), p]));
    return {
      adegan: { lama: a.scenes.length, baru: b.scenes.length, selisih: b.scenes.length - a.scenes.length },
      properti: {
        ditambah: [...bProps.entries()].filter(([k]) => !aProps.has(k)).map(([, p]) => p.name),
        dihapus: [...aProps.entries()].filter(([k]) => !bProps.has(k)).map(([, p]) => p.name),
        berubah_jumlah: [...bProps.entries()].filter(([k, p]) => aProps.has(k) && aProps.get(k)!.quantity !== p.quantity).map(([k, p]) => ({ name: p.name, dari: aProps.get(k)!.quantity, ke: p.quantity })),
      },
      biaya: {
        total_lama: a.total,
        total_baru: b.total,
        selisih: b.total - a.total,
        per_kategori: KATEGORI_BIAYA.map((k) => ({ kategori: k, lama: a.kat[k] ?? 0, baru: b.kat[k] ?? 0, selisih: (b.kat[k] ?? 0) - (a.kat[k] ?? 0) })),
      },
    };
  });
}

// =====================================================================
// KEBUTUHAN PROPERTI (PROP-01..05)
// =====================================================================
const propSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(200),
  category: z.enum(PROP_CATEGORIES),
  quantity: z.coerce.number().int().min(1).default(1),
  procurement_status: z.enum(["belum", "sewa", "beli", "buat", "tersedia"]).default("belum"),
  scene_ids: z.array(z.string().uuid()).default([]),
});

/** PROP-01/02/05 — daftar properti dengan filter kategori/adegan + pencarian; mode agregat atau per adegan. */
export async function daftarProperti(versionId: string, f: { kategori?: string; adegan?: string; q?: string; status?: string; karakter?: string; mode?: "agregat" | "per_adegan" } = {}) {
  return safe(async () => {
    const { supabase } = await requireOwnVersion(versionId);
    let q = supabase.from("props").select("id, name, category, quantity, procurement_status, scene_ids, source, property_master_id").eq("version_id", versionId).order("category").order("name");
    if (f.kategori) q = q.eq("category", f.kategori);
    if (f.status) q = q.eq("procurement_status", f.status);
    if (f.q) q = q.ilike("name", `%${f.q.replace(/[%_]/g, "")}%`);
    if (f.adegan) q = q.contains("scene_ids", [f.adegan]);
    let rows = must(await q) as unknown as { id: string; name: string; scene_ids: string[] }[];

    if (f.karakter) {
      // filter berdasarkan karakter: adegan tempat karakter muncul
      const { data: ch } = await supabase.from("entities").select("scene_id, scenes!inner(version_id)").eq("type", "CHARACTER").ilike("name", f.karakter).eq("scenes.version_id", versionId);
      const sceneSet = new Set(((ch ?? []) as { scene_id: string }[]).map((c) => c.scene_id));
      rows = rows.filter((r) => r.scene_ids.some((s) => sceneSet.has(s)));
    }
    if (f.mode !== "per_adegan") return rows;

    const scenes = must(await supabase.from("scenes").select("id, scene_no, heading").eq("version_id", versionId).order("scene_no")) as { id: string; scene_no: number; heading: string }[];
    return scenes.map((s) => ({ ...s, properti: rows.filter((r) => r.scene_ids.includes(s.id)) }));
  });
}

/** PROP-03 + BYA-04 — tambah/ubah/hapus manual; total biaya langsung dihitung ulang. */
export async function tambahProperti(versionId: string, input: z.input<typeof propSchema>) {
  return safe(async () => {
    const { supabase } = await requireOwnVersion(versionId);
    const p = propSchema.parse(input);
    must(await supabase.from("props").insert({ ...p, version_id: versionId, source: "manual" }));
    return { ringkasan: (await hitungBiaya(supabase, versionId)).ringkasan };
  });
}

export async function ubahProperti(propId: string, patch: Partial<z.input<typeof propSchema>>) {
  return safe(async () => {
    const { supabase } = await requireUser();
    const p = propSchema.partial().parse(patch);
    const { data } = await supabase.from("props").select("version_id").eq("id", propId).maybeSingle();
    if (!data) throw new AppError("Properti tidak ditemukan", 404);
    must(await supabase.from("props").update({ ...p, source: "manual" }).eq("id", propId)); // manual = tidak ditimpa analisis ulang
    return { ringkasan: (await hitungBiaya(supabase, (data as { version_id: string }).version_id)).ringkasan };
  });
}

export async function hapusProperti(propId: string) {
  return safe(async () => {
    const { supabase } = await requireUser();
    const { data } = await supabase.from("props").select("version_id").eq("id", propId).maybeSingle();
    if (!data) throw new AppError("Properti tidak ditemukan", 404);
    must(await supabase.from("props").delete().eq("id", propId));
    return { ringkasan: (await hitungBiaya(supabase, (data as { version_id: string }).version_id)).ringkasan };
  });
}

// =====================================================================
// JADWAL SYUTING (JDW-01..06)
// =====================================================================
export async function ambilJadwal(versionId: string) {
  return safe(async () => {
    const { supabase, version } = await requireOwnVersion(versionId);
    const days = must(
      await supabase
        .from("shooting_days")
        .select("id, day_no, shoot_date, call_time, wrap_time, locations(id, name), schedule_items(id, order_no, est_duration_min, scenes(id, scene_no, heading, int_ext, time_of_day))")
        .eq("version_id", versionId)
        .order("day_no")
    );
    return { konfigurasi: version.schedule_config, hari: days };
  });
}

/** JDW-01/03 — susun ulang stripboard otomatis dengan tanggal mulai, jam kerja, dan hari libur. */
export async function susunJadwal(versionId: string, cfg: { start_date?: string; hours_per_day?: number; holidays?: string[] }) {
  return safe(async () => {
    const { supabase } = await requireOwnVersion(versionId);
    const c = z
      .object({
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal YYYY-MM-DD").optional(),
        hours_per_day: z.number().int().min(1).max(24).optional(),
        holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
      })
      .parse(cfg);
    const r = await susunJadwalVersi(supabase, versionId, c);
    return { hari_syuting: r.days, ringkasan: (await hitungBiaya(supabase, versionId)).ringkasan };
  });
}

/** JDW-06 — pindahkan adegan antar hari (drag & drop); total biaya diperbarui otomatis. */
export async function pindahAdegan(sceneId: string, hariTujuanId: string, urutan: number) {
  return safe(async () => {
    const { supabase } = await requireUser();
    const { data: item } = await supabase.from("schedule_items").select("id, shooting_day_id").eq("scene_id", sceneId).maybeSingle();
    const { data: day } = await supabase.from("shooting_days").select("id, version_id").eq("id", hariTujuanId).maybeSingle();
    if (!item || !day) throw new AppError("Adegan atau hari tidak ditemukan", 404);

    const dari = (item as { shooting_day_id: string }).shooting_day_id;
    must(await supabase.from("schedule_items").update({ shooting_day_id: hariTujuanId, order_no: urutan }).eq("id", (item as { id: string }).id));

    // Rapikan nomor urut di hari asal & tujuan
    for (const dayId of new Set([dari, hariTujuanId])) {
      const items = must(await supabase.from("schedule_items").select("id, order_no").eq("shooting_day_id", dayId).order("order_no")) as { id: string; order_no: number }[];
      for (let i = 0; i < items.length; i++) {
        if (items[i].order_no !== i + 1) await supabase.from("schedule_items").update({ order_no: i + 1 }).eq("id", items[i].id);
      }
    }
    return { ringkasan: (await hitungBiaya(supabase, (day as { version_id: string }).version_id)).ringkasan };
  });
}

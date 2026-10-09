import "server-only";
import { createAdminClient, type DB } from "@/lib/supabase/admin";
import { must, pMap } from "@/lib/result";
import { ekstrakTeksBerkas, perkiraanHalaman } from "@/lib/ai/extract-text";
import { segmentasiAdegan, parseHeading, type AdeganMentah } from "@/lib/ai/segment";
import { ekstrakNaskah } from "@/lib/ai/llm";
import { buatKanonKarakter, normKey } from "@/lib/ai/normalize";
import type { SceneExtraction } from "@/lib/ai/schema";
import { estimasiDurasiMenit, susunJadwalVersi } from "@/lib/schedule/engine";
import { bangunUlangProps } from "./props";
import { hitungBiaya } from "@/lib/budget/engine";

const NER_CONCURRENCY = 4;

async function clearDerived(db: DB, versionId: string) {
  // urutan: jadwal → adegan (entitas cascade) → properti → lokasi → biaya
  for (const t of ["shooting_days", "scenes", "props", "locations", "budget_lines"]) {
    must(await db.from(t).delete().eq("version_id", versionId), `Gagal membersihkan ${t}`);
  }
}

/**
 * Pipeline pemrosesan naskah (PRD 6.2 / 8.1). Berjalan di background (after()) memakai service-role;
 * kepemilikan versi WAJIB sudah diverifikasi oleh pemanggil. Progres ditulis ke script_versions
 * sehingga klien memantau lewat Supabase Realtime.
 */
export async function prosesVersi(versionId: string) {
  const db = createAdminClient();

  const progres = async (progress: number, step: string, extra: Record<string, unknown> = {}) =>
    db.from("script_versions").update({ progress, current_step: step, ...extra }).eq("id", versionId);
  const job = async (step: string, status: "completed" | "failed", p: { tokens?: number; ms?: number; error?: string } = {}) =>
    db.from("ai_jobs").insert({ version_id: versionId, step, status, tokens_used: p.tokens ?? null, latency_ms: p.ms ?? null, error: p.error ?? null });

  let currentStep = "mulai";
  try {
    const ver = must(
      await db.from("script_versions").select("id, file_path, file_name, raw_text, script_id, scripts(id, user_id, main_location)").eq("id", versionId).single(),
      "Versi tidak ditemukan"
    ) as unknown as { id: string; file_path: string | null; file_name: string | null; raw_text: string | null; script_id: string; scripts: { id: string; user_id: string } };

    await progres(5, "Memulai analisis", { status: "processing", error_message: null });
    await db.from("scripts").update({ status: "processing" }).eq("id", ver.script_id);

    // 1. Ekstraksi teks
    currentStep = "ekstraksi_teks";
    let text = ver.raw_text;
    if (!text) {
      if (!ver.file_path) throw new Error("Tidak ada teks atau berkas naskah");
      const t0 = Date.now();
      const dl = await db.storage.from("naskah").download(ver.file_path);
      if (dl.error || !dl.data) throw new Error("Berkas naskah tidak dapat diunduh");
      const out = await ekstrakTeksBerkas(await dl.data.arrayBuffer(), ver.file_name ?? ver.file_path);
      text = out.text;
      await db.from("script_versions").update({ raw_text: text, page_count: out.pages }).eq("id", versionId);
      await job(currentStep, "completed", { ms: Date.now() - t0 });
    } else {
      await db.from("script_versions").update({ page_count: perkiraanHalaman(text) }).eq("id", versionId);
    }
    await progres(15, "Segmentasi adegan");

    // 2. Segmentasi
    currentStep = "segmentasi";
    const { scenes: raw, metode } = segmentasiAdegan(text);
    await job(`${currentStep}:${metode}`, "completed");
    await progres(20, `Menganalisis ${raw.length} adegan dengan AI`);

    // 3. LLM NER per adegan (paralel, konkurensi terbatas)
    currentStep = "ner";
    let selesai = 0;
    const t0 = Date.now();
    let tokens = 0;
    const hasil = await pMap(raw, NER_CONCURRENCY, async (s) => {
      const r = await ekstrakNaskah(s.body);
      tokens += r.tokens;
      selesai++;
      await progres(20 + Math.round((selesai / raw.length) * 55), `Analisis AI ${selesai}/${raw.length} adegan`);
      return r.data;
    });
    await job(currentStep, "completed", { tokens, ms: Date.now() - t0 });

    // 4. Normalisasi & penyimpanan
    currentStep = "simpan";
    await progres(78, "Normalisasi & menyimpan hasil");
    await simpanHasil(db, versionId, raw, hasil);

    // 5. Properti, jadwal, biaya (deterministik)
    currentStep = "turunan";
    await progres(88, "Menyusun properti, jadwal & biaya");
    await bangunUlangProps(db, versionId);
    await susunJadwalVersi(db, versionId);
    await hitungBiaya(db, versionId);

    await progres(100, "Selesai", { status: "completed" });
    await db.from("scripts").update({ status: "completed", active_version_id: versionId }).eq("id", ver.script_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Kegagalan tidak diketahui";
    console.error(`[pipeline] versi ${versionId} gagal pada ${currentStep}:`, msg);
    await job(currentStep, "failed", { error: msg.slice(0, 500) });
    await db.from("script_versions").update({ status: "failed", error_message: msg.slice(0, 500), current_step: "Gagal" }).eq("id", versionId);
    const { data } = await db.from("script_versions").select("script_id").eq("id", versionId).single();
    if (data) await db.from("scripts").update({ status: "failed" }).eq("id", (data as { script_id: string }).script_id);
  }
}

async function simpanHasil(db: DB, versionId: string, raw: AdeganMentah[], hasil: SceneExtraction[]) {
  await clearDerived(db, versionId);

  const canon = buatKanonKarakter(hasil.flatMap((h) => h.characters));

  // Lokasi unik (nama dinormalisasi)
  const locByKey = new Map<string, { name: string; ext: boolean }>();
  hasil.forEach((h, i) => {
    const intExt = parseHeading(raw[i].heading).intExt ?? h.int_ext;
    const k = normKey(h.location);
    const cur = locByKey.get(k);
    const ext = intExt !== "INT";
    locByKey.set(k, { name: cur?.name ?? h.location, ext: (cur?.ext ?? false) || ext });
  });
  const locRows = must(
    await db
      .from("locations")
      .insert([...locByKey.values()].map((l) => ({ version_id: versionId, name: l.name, permit_required: l.ext })))
      .select("id, name"),
    "Gagal menyimpan lokasi"
  ) as { id: string; name: string }[];
  const locId = new Map(locRows.map((l) => [normKey(l.name), l.id]));

  // Adegan
  const sceneRows = raw.map((r, i) => {
    const h = hasil[i];
    const hd = parseHeading(r.heading || h.heading);
    const int_ext = hd.intExt ?? h.int_ext;
    const time_of_day = (hd.time ?? h.time_of_day ?? "SIANG").toUpperCase();
    return {
      version_id: versionId,
      scene_no: r.scene_no,
      heading: r.heading || h.heading,
      int_ext,
      time_of_day,
      location_id: locId.get(normKey(h.location)) ?? null,
      summary: h.summary,
      body: r.body,
      page_eighths: r.page_eighths,
      complexity: h.complexity,
      est_duration_min: estimasiDurasiMenit({
        page_eighths: r.page_eighths,
        complexity: h.complexity,
        extras: h.extras.reduce((a, e) => a + e.count, 0),
        stunts: h.stunts.length,
        fx: h.special_fx.length,
      }),
    };
  });
  const inserted = must(await db.from("scenes").insert(sceneRows).select("id, scene_no"), "Gagal menyimpan adegan") as { id: string; scene_no: number }[];
  const sceneId = new Map(inserted.map((s) => [s.scene_no, s.id]));

  // Entitas
  type Ent = { scene_id: string; type: string; name: string; quantity?: number; category?: string };
  const ents: Ent[] = [];
  hasil.forEach((h, i) => {
    const scene_id = sceneId.get(raw[i].scene_no)!;
    const push = (type: string, name: string, quantity = 1, category?: string) => ents.push({ scene_id, type, name, quantity, category });
    push("SCENE_HEADING", sceneRows[i].heading || h.heading);
    push("LOCATION", h.location);
    push("TIME_OF_DAY", sceneRows[i].time_of_day);
    [...new Set(h.characters.map(canon))].forEach((n) => push("CHARACTER", n));
    h.extras.forEach((e) => push("EXTRA", e.description, e.count));
    h.props.forEach((p) => push("PROP", p.name, p.qty, p.category));
    h.costumes.forEach((n) => push("COSTUME", n));
    h.vehicles.forEach((n) => push("VEHICLE", n));
    h.animals.forEach((n) => push("ANIMAL", n));
    h.special_fx.forEach((n) => push("SPECIAL_FX", n));
    h.stunts.forEach((n) => push("STUNT", n));
    h.sound_music.forEach((n) => push("SOUND_MUSIC", n));
  });
  // Insert bertahap agar payload tidak terlalu besar
  for (let i = 0; i < ents.length; i += 500) {
    must(await db.from("entities").insert(ents.slice(i, i + 500).map((e) => ({ ...e, source: "ai" }))), "Gagal menyimpan entitas");
  }
}

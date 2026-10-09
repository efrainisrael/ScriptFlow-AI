"use server";

import { after } from "next/server";
import { z } from "zod";
import { requireUser, requireOwnVersion } from "@/lib/auth";
import { AppError, must, safe, type Result } from "@/lib/result";
import { MAX_FILE_BYTES } from "@/lib/ai/extract-text";
import { prosesVersi } from "@/lib/pipeline/process";
import { bangunUlangProps } from "@/lib/pipeline/props";
import { susunJadwalVersi } from "@/lib/schedule/engine";
import { hitungBiaya } from "@/lib/budget/engine";
import { ENTITY_TYPES } from "@/lib/ai/schema";

const ALLOWED_EXT = ["pdf", "docx", "txt"];

const metaSchema = z.object({
  judul: z.string().trim().min(1, "Judul wajib diisi").max(200),
  jenis_produksi: z.enum(["film", "serial", "iklan", "konten"]),
  genre: z.string().trim().max(80).optional(),
  kota_utama: z.string().trim().max(120).optional(),
  mata_uang: z.string().trim().length(3).default("IDR"),
  script_id: z.string().uuid().optional(), // diisi saat mengunggah revisi (STD-08)
  teks: z.string().optional(), // STD-02: tempel teks langsung
});

const field = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
};

/**
 * STD-01..05, STD-08 — Unggah berkas / tempel teks, buat script + versi (status queued),
 * lalu jalankan analisis AI di background. Klien memantau progres via Supabase Realtime.
 * FormData: file?, teks?, judul, jenis_produksi, genre?, kota_utama?, mata_uang?, script_id?
 */
export async function unggahDanAnalisisNaskah(fd: FormData): Promise<Result<{ scriptId: string; versionId: string }>> {
  return safe(async () => {
    const { supabase, user } = await requireUser();
    const meta = metaSchema.parse({
      judul: field(fd, "judul"),
      jenis_produksi: field(fd, "jenis_produksi") ?? "film",
      genre: field(fd, "genre"),
      kota_utama: field(fd, "kota_utama"),
      mata_uang: field(fd, "mata_uang") ?? "IDR",
      script_id: field(fd, "script_id"),
      teks: field(fd, "teks"),
    });

    const file = fd.get("file");
    const hasFile = file instanceof File && file.size > 0;
    if (!hasFile && !meta.teks?.trim()) throw new AppError("Unggah berkas atau tempel teks naskah");
    if (hasFile) {
      const ext = file.name.toLowerCase().split(".").pop() ?? "";
      if (!ALLOWED_EXT.includes(ext)) throw new AppError("Format berkas harus PDF, DOCX, atau TXT");
      if (file.size > MAX_FILE_BYTES) throw new AppError("Ukuran berkas maksimal 10 MB");
    }
    if (meta.teks && meta.teks.length > 2_000_000) throw new AppError("Teks terlalu panjang");

    // Naskah baru atau versi baru dari naskah yang sama
    let scriptId = meta.script_id;
    let versionNo = 1;
    if (scriptId) {
      const { data: s } = await supabase.from("scripts").select("id").eq("id", scriptId).maybeSingle();
      if (!s) throw new AppError("Naskah tidak ditemukan", 404);
      const { data: last } = await supabase.from("script_versions").select("version_no").eq("script_id", scriptId).order("version_no", { ascending: false }).limit(1).maybeSingle();
      versionNo = ((last as { version_no: number } | null)?.version_no ?? 0) + 1;
    } else {
      const created = must(
        await supabase
          .from("scripts")
          .insert({ user_id: user.id, title: meta.judul, production_type: meta.jenis_produksi, genre: meta.genre ?? null, main_location: meta.kota_utama ?? null, currency: meta.mata_uang, status: "queued" })
          .select("id")
          .single(),
        "Gagal membuat naskah"
      ) as { id: string };
      scriptId = created.id;
    }

    let file_path: string | null = null;
    let file_name: string | null = null;
    if (hasFile) {
      file_name = file.name;
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      file_path = `${user.id}/${scriptId}/${versionNo}-${safeName}`;
      const up = await supabase.storage.from("naskah").upload(file_path, file, { contentType: file.type || undefined, upsert: false });
      if (up.error) throw new AppError(`Gagal mengunggah berkas: ${up.error.message}`, 500);
    }

    const version = must(
      await supabase
        .from("script_versions")
        .insert({ script_id: scriptId, version_no: versionNo, file_path, file_name, raw_text: hasFile ? null : meta.teks!.trim(), status: "queued", current_step: "Dalam antrean", progress: 0 })
        .select("id")
        .single(),
      "Gagal membuat versi naskah"
    ) as { id: string };

    after(() => prosesVersi(version.id)); // asinkron: respons segera kembali ke klien
    return { scriptId: scriptId!, versionId: version.id };
  });
}

/** STD-09 — coba ulang analisis yang gagal. */
export async function cobaLagiAnalisis(versionId: string) {
  return safe(async () => {
    const { supabase, version } = await requireOwnVersion(versionId);
    if (version.status === "processing") throw new AppError("Analisis sedang berjalan");
    must(await supabase.from("script_versions").update({ status: "queued", progress: 0, current_step: "Dalam antrean", error_message: null }).eq("id", versionId));
    after(() => prosesVersi(versionId));
    return { versionId };
  });
}

/** STD-06/07 — hasil ekstraksi lengkap (adegan + entitas) untuk pratinjau & koreksi. */
export async function ambilHasilAnalisis(versionId: string) {
  return safe(async () => {
    const { supabase, version } = await requireOwnVersion(versionId);
    const scenes = must(
      await supabase
        .from("scenes")
        .select("id, scene_no, heading, int_ext, time_of_day, summary, body, page_eighths, complexity, est_duration_min, locations(id, name), entities(id, type, name, quantity, category, source)")
        .eq("version_id", versionId)
        .order("scene_no")
    );
    const { data: v } = await supabase.from("script_versions").select("status, progress, current_step, error_message, confirmed, page_count, total_estimate").eq("id", versionId).single();
    return { versi: { id: version.id, ...(v as object) }, adegan: scenes };
  });
}

// ---------- Koreksi entitas (STD-07) ----------
const entitySchema = z.object({
  type: z.enum(ENTITY_TYPES),
  name: z.string().trim().min(1, "Nama wajib diisi").max(200),
  quantity: z.coerce.number().int().min(1).default(1),
  category: z.string().optional(),
});

/** Sinkronkan properti & biaya setelah entitas berubah (real-time, BYA-04). */
async function sinkron(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], versionId: string) {
  await bangunUlangProps(supabase, versionId);
  return (await hitungBiaya(supabase, versionId)).ringkasan;
}

async function versionOfScene(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], sceneId: string) {
  const { data } = await supabase.from("scenes").select("version_id").eq("id", sceneId).maybeSingle();
  if (!data) throw new AppError("Adegan tidak ditemukan", 404);
  return (data as { version_id: string }).version_id;
}

export async function tambahEntitas(sceneId: string, input: z.input<typeof entitySchema>) {
  return safe(async () => {
    const { supabase } = await requireUser();
    const e = entitySchema.parse(input);
    const versionId = await versionOfScene(supabase, sceneId);
    must(await supabase.from("entities").insert({ scene_id: sceneId, ...e, source: "manual" }));
    return { ringkasan: await sinkron(supabase, versionId) };
  });
}

export async function ubahEntitas(entityId: string, input: Partial<z.input<typeof entitySchema>>) {
  return safe(async () => {
    const { supabase } = await requireUser();
    const e = entitySchema.partial().parse(input);
    const { data } = await supabase.from("entities").select("scene_id").eq("id", entityId).maybeSingle();
    if (!data) throw new AppError("Entitas tidak ditemukan", 404);
    const versionId = await versionOfScene(supabase, (data as { scene_id: string }).scene_id);
    must(await supabase.from("entities").update({ ...e, source: "manual" }).eq("id", entityId));
    return { ringkasan: await sinkron(supabase, versionId) };
  });
}

export async function hapusEntitas(entityId: string) {
  return safe(async () => {
    const { supabase } = await requireUser();
    const { data } = await supabase.from("entities").select("scene_id").eq("id", entityId).maybeSingle();
    if (!data) throw new AppError("Entitas tidak ditemukan", 404);
    const versionId = await versionOfScene(supabase, (data as { scene_id: string }).scene_id);
    must(await supabase.from("entities").delete().eq("id", entityId));
    return { ringkasan: await sinkron(supabase, versionId) };
  });
}

/** Konfirmasi hasil: bangun ulang properti, jadwal, dan biaya dari entitas yang sudah dikoreksi. */
export async function konfirmasiHasil(versionId: string) {
  return safe(async () => {
    const { supabase, version } = await requireOwnVersion(versionId);
    if (version.status !== "completed") throw new AppError("Analisis belum selesai");
    await bangunUlangProps(supabase, versionId);
    const jadwal = await susunJadwalVersi(supabase, versionId);
    const biaya = await hitungBiaya(supabase, versionId);
    must(await supabase.from("script_versions").update({ confirmed: true }).eq("id", versionId));
    return { hari_syuting: jadwal.days, ...biaya };
  });
}

// ---------- Riwayat (HIS-01..06) ----------
export async function daftarRiwayat(f: { q?: string; jenis?: string; status?: string; dari?: string; sampai?: string; urut?: "terbaru" | "terlama" | "judul" } = {}) {
  return safe(async () => {
    const { supabase } = await requireUser();
    let q = supabase
      .from("scripts")
      .select("id, title, production_type, status, created_at, active_version_id, script_versions(id, version_no, status, total_estimate, created_at)");
    if (f.q) q = q.ilike("title", `%${f.q.replace(/[%_]/g, "")}%`);
    if (f.jenis) q = q.eq("production_type", f.jenis);
    q = f.status ? q.eq("status", f.status) : q.neq("status", "archived");
    if (f.dari) q = q.gte("created_at", f.dari);
    if (f.sampai) q = q.lte("created_at", f.sampai);
    q = f.urut === "judul" ? q.order("title") : q.order("created_at", { ascending: f.urut === "terlama" });
    const rows = must(await q) as unknown as { id: string; active_version_id: string | null; script_versions: { id: string; version_no: number; total_estimate: number }[] }[];
    return rows.map((s) => {
      const aktif = s.script_versions.find((v) => v.id === s.active_version_id) ?? [...s.script_versions].sort((a, b) => b.version_no - a.version_no)[0];
      return { ...s, jumlah_versi: s.script_versions.length, total_estimasi_terakhir: Number(aktif?.total_estimate ?? 0) };
    });
  });
}

export async function jadikanVersiAktif(scriptId: string, versionId: string) {
  return safe(async () => {
    const { supabase } = await requireUser();
    const { data } = await supabase.from("script_versions").select("id, status").eq("id", versionId).eq("script_id", scriptId).maybeSingle();
    if (!data) throw new AppError("Versi tidak ditemukan", 404);
    if ((data as { status: string }).status !== "completed") throw new AppError("Hanya versi yang selesai dianalisis yang dapat diaktifkan");
    must(await supabase.from("scripts").update({ active_version_id: versionId }).eq("id", scriptId));
    return { scriptId, versionId };
  });
}

export async function arsipkanNaskah(scriptId: string, arsip = true) {
  return safe(async () => {
    const { supabase } = await requireUser();
    must(await supabase.from("scripts").update({ status: arsip ? "archived" : "completed" }).eq("id", scriptId));
    return { scriptId };
  });
}

/** HIS-06 — hapus permanen; konfirmasi dua langkah: pengguna harus mengetik judul naskah. */
export async function hapusNaskah(scriptId: string, judulKonfirmasi: string) {
  return safe(async () => {
    const { supabase, user } = await requireUser();
    const { data } = await supabase.from("scripts").select("title").eq("id", scriptId).maybeSingle();
    if (!data) throw new AppError("Naskah tidak ditemukan", 404);
    if ((data as { title: string }).title.trim() !== judulKonfirmasi.trim()) throw new AppError("Judul konfirmasi tidak cocok");

    // Hapus berkas di Storage lalu baris (cascade ke seluruh data turunan)
    const files = (await supabase.from("script_versions").select("file_path").eq("script_id", scriptId)).data as { file_path: string | null }[] | null;
    const paths = (files ?? []).map((f) => f.file_path).filter((p): p is string => !!p && p.startsWith(`${user.id}/`));
    if (paths.length) await supabase.storage.from("naskah").remove(paths);
    must(await supabase.from("scripts").delete().eq("id", scriptId));
    return { scriptId };
  });
}

/** Kumpulan versi + status untuk polling cadangan bila Realtime tidak tersedia. */
export async function statusVersi(versionId: string) {
  return safe(async () => {
    const { supabase } = await requireOwnVersion(versionId);
    return must(await supabase.from("script_versions").select("id, status, progress, current_step, error_message, total_estimate").eq("id", versionId).single());
  });
}

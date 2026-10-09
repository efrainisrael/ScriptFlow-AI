"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { AppError, must, safe } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

/** HOME-01..05 — data Beranda pengguna. */
export async function ambilBeranda() {
  return safe(async () => {
    const { supabase, profile } = await requireUser();
    const scripts = must(
      await supabase
        .from("scripts")
        .select("id, title, status, created_at, active_version_id, script_versions(id, status, progress, total_estimate)")
        .neq("status", "archived")
        .order("created_at", { ascending: false })
    ) as unknown as { id: string; title: string; status: string; created_at: string; active_version_id: string | null; script_versions: { id: string; status: string; progress: number; total_estimate: number }[] }[];

    const terbaru = scripts[0];
    const aktifId = terbaru?.active_version_id ?? terbaru?.script_versions.at(-1)?.id ?? null;
    let hari_syuting = 0, jumlah_properti = 0;
    let distribusi: { kategori: string; total: number }[] = [];
    if (aktifId) {
      const [d, p, l] = await Promise.all([
        supabase.from("shooting_days").select("*", { count: "exact", head: true }).eq("version_id", aktifId),
        supabase.from("props").select("*", { count: "exact", head: true }).eq("version_id", aktifId),
        supabase.from("budget_lines").select("category, subtotal").eq("version_id", aktifId),
      ]);
      hari_syuting = d.count ?? 0;
      jumlah_properti = p.count ?? 0;
      const agg = new Map<string, number>();
      ((l.data ?? []) as { category: string; subtotal: number }[]).forEach((x) => agg.set(x.category, (agg.get(x.category) ?? 0) + Number(x.subtotal)));
      distribusi = [...agg.entries()].map(([kategori, total]) => ({ kategori, total }));
    }
    return {
      nama: profile.full_name,
      statistik: {
        total_naskah: scripts.length,
        total_estimasi_terbaru: Number(terbaru?.script_versions.find((v) => v.id === aktifId)?.total_estimate ?? 0),
        hari_syuting,
        jumlah_properti,
      },
      naskah_terbaru: scripts.slice(0, 5).map((s) => ({ id: s.id, title: s.title, status: s.status, created_at: s.created_at, active_version_id: s.active_version_id })),
      distribusi_biaya: distribusi,
    };
  });
}

const profileSchema = z.object({
  full_name: z.string().trim().min(2).max(120).optional(),
  avatar_url: z.string().url().nullable().optional(),
  role_title: z.string().trim().max(120).nullable().optional(),
  company_name: z.string().trim().max(160).nullable().optional(),
  default_currency: z.string().length(3).optional(),
  default_city: z.string().trim().max(120).nullable().optional(),
  default_work_hours: z.number().int().min(1).max(24).optional(),
  default_contingency_pct: z.number().min(0).max(100).optional(),
});

export async function ambilProfil() {
  return safe(async () => {
    const { supabase, user } = await requireUser();
    const p = must(await supabase.from("profiles").select("*").eq("id", user.id).single()) as object;
    return { ...p, email: user.email };
  });
}

/** PRF-01/03 — ubah profil & preferensi default. Kolom role/is_active tidak dapat diubah dari sini. */
export async function ubahProfil(input: z.input<typeof profileSchema>) {
  return safe(async () => {
    const { supabase, user } = await requireUser();
    const v = profileSchema.parse(input);
    must(await supabase.from("profiles").update(v).eq("id", user.id));
    return v;
  });
}

/** PRF-02 — ubah kata sandi (verifikasi kata sandi lama). */
export async function ubahKataSandi(input: { lama: string; baru: string }) {
  return safe(async () => {
    const { supabase, user } = await requireUser();
    const v = z.object({ lama: z.string().min(1), baru: z.string().min(8, "Kata sandi minimal 8 karakter") }).parse(input);
    const check = await supabase.auth.signInWithPassword({ email: user.email!, password: v.lama });
    if (check.error) throw new AppError("Kata sandi lama salah");
    const { error } = await supabase.auth.updateUser({ password: v.baru });
    if (error) throw new AppError(error.message);
    return { ok: true };
  });
}

/** PRF-04 — hapus akun beserta seluruh data (cascade DB + berkas Storage). */
export async function hapusAkun(konfirmasiEmail: string) {
  const r = await safe(async () => {
    const { supabase, user } = await requireUser();
    if (konfirmasiEmail.trim().toLowerCase() !== user.email?.toLowerCase()) throw new AppError("Email konfirmasi tidak cocok");

    const db = createAdminClient();
    const { data: files } = await db.storage.from("naskah").list(user.id, { limit: 1000 });
    for (const folder of files ?? []) {
      const { data: inner } = await db.storage.from("naskah").list(`${user.id}/${folder.name}`, { limit: 1000 });
      const paths = (inner ?? []).map((f) => `${user.id}/${folder.name}/${f.name}`);
      if (paths.length) await db.storage.from("naskah").remove(paths);
    }
    const { error } = await db.auth.admin.deleteUser(user.id); // cascade ke profiles → semua tabel
    if (error) throw new AppError(error.message, 500);
    await supabase.auth.signOut();
    return true;
  });
  if (!r.ok) return r;
  redirect("/login");
}

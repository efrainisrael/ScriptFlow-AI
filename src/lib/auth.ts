import "server-only";
import { createClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/result";

export type Profile = {
  id: string;
  full_name: string | null;
  role: "user" | "admin";
  is_active: boolean;
  default_currency: string;
  default_contingency_pct: number;
  default_work_hours: number;
};

/** Pastikan pengguna login & aktif. Dipakai di setiap server action pengguna. */
export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new AppError("Silakan login terlebih dahulu", 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active, default_currency, default_contingency_pct, default_work_hours")
    .eq("id", user.id)
    .single();
  if (!profile || !profile.is_active) throw new AppError("Akun tidak aktif", 403);
  return { supabase, user, profile: profile as Profile };
}

/** Role admin diverifikasi di server dari tabel profiles (bukan dari klien). */
export async function requireAdmin() {
  const ctx = await requireUser();
  if (ctx.profile.role !== "admin") throw new AppError("Akses ditolak (khusus admin)", 403);
  return ctx;
}

/** Pastikan versi naskah milik pengguna (RLS juga menjaga; ini memberi error yang jelas). */
export async function requireOwnVersion(versionId: string) {
  const ctx = await requireUser();
  const { data } = await ctx.supabase
    .from("script_versions")
    .select("id, script_id, version_no, status, raw_text, schedule_config, scripts(id, user_id, title, main_location, currency)")
    .eq("id", versionId)
    .maybeSingle();
  if (!data) throw new AppError("Naskah/versi tidak ditemukan", 404);
  return { ...ctx, version: data };
}

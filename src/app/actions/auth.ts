"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const email = z.string().trim().toLowerCase().email("Format email tidak valid");
const password = z.string().min(8, "Kata sandi minimal 8 karakter");

async function origin() {
  const h = await headers();
  return process.env.NEXT_PUBLIC_SITE_URL ?? h.get("origin") ?? "http://localhost:3000";
}

export type AuthResult = { error?: string; info?: string };

/** AUTH-01/04/07 — registrasi publik selalu menjadi role 'user' (dijamin trigger DB). */
export async function daftar(input: { full_name: string; email: string; password: string }): Promise<AuthResult> {
  const p = z
    .object({ full_name: z.string().trim().min(2, "Nama lengkap minimal 2 karakter"), email, password })
    .safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: p.data.email,
    password: p.data.password,
    options: { data: { full_name: p.data.full_name }, emailRedirectTo: `${await origin()}/auth/callback` },
  });
  if (error) return { error: error.message };
  // Supabase mengembalikan user dengan identities kosong bila email sudah terdaftar
  if (data.user && data.user.identities?.length === 0) return { error: "Email sudah terdaftar" };
  if (data.session) redirect("/beranda");
  return { info: "Pendaftaran berhasil. Periksa email Anda untuk verifikasi." };
}

/** AUTH-02/09 — login lalu arahkan berdasarkan role. */
export async function masuk(input: { email: string; password: string }): Promise<AuthResult> {
  const p = z.object({ email, password: z.string().min(1, "Kata sandi wajib diisi") }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(p.data);
  if (error || !data.user) return { error: "Email atau kata sandi salah" };

  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", data.user.id).single();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: "Akun Anda dinonaktifkan. Hubungi admin." };
  }
  await createAdminClient().from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", data.user.id);
  redirect(profile.role === "admin" ? "/admin" : "/beranda");
}

/** AUTH-03 — Google OAuth. */
export async function masukDenganGoogle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await origin()}/auth/callback` },
  });
  if (error || !data.url) return { error: error?.message ?? "Gagal memulai login Google" } as AuthResult;
  redirect(data.url);
}

/** AUTH-05 — kirim email reset kata sandi (respons netral agar email tidak dapat dienumerasi). */
export async function lupaKataSandi(input: { email: string }): Promise<AuthResult> {
  const p = z.object({ email }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(p.data.email, {
    redirectTo: `${await origin()}/auth/callback?next=/reset-password`,
  });
  return { info: "Jika email terdaftar, tautan reset telah dikirim." };
}

/** AUTH-05 — setel kata sandi baru (sesi dari tautan email). */
export async function resetKataSandi(input: { password: string }): Promise<AuthResult> {
  const p = z.object({ password }).safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: p.data.password });
  if (error) return { error: error.message };
  redirect("/login");
}

/** OUT-02 — hapus sesi lalu arahkan ke halaman login. */
export async function keluar() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

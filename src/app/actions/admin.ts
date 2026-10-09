"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { AppError, must, safe } from "@/lib/result";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROP_CATEGORIES } from "@/lib/ai/schema";
import { KATEGORI_BIAYA } from "@/lib/budget/engine";

type Ctx = Awaited<ReturnType<typeof requireAdmin>>;

async function audit(ctx: Ctx, action: string, target_type: string, target_id: string, detail: unknown) {
  await ctx.supabase.from("admin_audit_logs").insert({ admin_id: ctx.user.id, action, target_type, target_id, detail_json: detail as object });
}

/** Beranda Admin — statistik penggunaan (hanya agregat; isi naskah pengguna tidak diakses). */
export async function statistikAdmin() {
  return safe(async () => {
    await requireAdmin();
    const db = createAdminClient();
    const count = async (t: string, f?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const q = db.from(t).select("*", { count: "exact", head: true });
      return (await (f ? f(q) : q)).count ?? 0;
    };
    const [users, aktif, admins, naskah, versi, properti] = await Promise.all([
      count("profiles"),
      count("profiles", (q) => q.eq("is_active", true)),
      count("profiles", (q) => q.eq("role", "admin")),
      count("scripts"),
      count("script_versions"),
      count("property_master", (q) => q.eq("is_active", true)),
    ]);
    const { data: jobs } = await db.from("ai_jobs").select("tokens_used, latency_ms, status").eq("step", "ner");
    const j = (jobs ?? []) as { tokens_used: number | null; latency_ms: number | null; status: string }[];
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { count: baru } = await db.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", since);
    return {
      total_user: users, user_aktif: aktif, total_admin: admins, user_baru_7_hari: baru ?? 0,
      total_naskah: naskah, total_versi: versi, properti_master_aktif: properti,
      ai: {
        total_token: j.reduce((a, x) => a + (x.tokens_used ?? 0), 0),
        rata_latensi_ms: j.length ? Math.round(j.reduce((a, x) => a + (x.latency_ms ?? 0), 0) / j.length) : 0,
        job_gagal: j.filter((x) => x.status === "failed").length,
      },
    };
  });
}

/** Data User — daftar akun (profil + email) dengan pencarian. */
export async function daftarUser(f: { q?: string; role?: "user" | "admin"; aktif?: boolean } = {}) {
  return safe(async () => {
    await requireAdmin();
    const db = createAdminClient();
    let q = db.from("profiles").select("id, full_name, company_name, role, is_active, last_login_at, created_at").order("created_at", { ascending: false }).limit(500);
    if (f.role) q = q.eq("role", f.role);
    if (f.aktif !== undefined) q = q.eq("is_active", f.aktif);
    const profiles = must(await q) as { id: string; full_name: string | null }[];

    const { data: authUsers } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const emails = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? ""]));
    const rows = profiles.map((p) => ({ ...p, email: emails.get(p.id) ?? "" }));
    const needle = f.q?.trim().toLowerCase();
    return needle ? rows.filter((r) => r.email.toLowerCase().includes(needle) || (r.full_name ?? "").toLowerCase().includes(needle)) : rows;
  });
}

/** AUTH-10 — admin berikutnya hanya dapat ditambahkan oleh admin lain (promosi/demosi role). */
export async function ubahRoleUser(userId: string, role: "user" | "admin") {
  return safe(async () => {
    const ctx = await requireAdmin();
    const r = z.enum(["user", "admin"]).parse(role);
    if (userId === ctx.user.id) throw new AppError("Tidak dapat mengubah role akun sendiri");
    must(await ctx.supabase.from("profiles").update({ role: r }).eq("id", userId));
    await audit(ctx, "ubah_role", "profile", userId, { role: r });
    return { userId, role: r };
  });
}

export async function setStatusUser(userId: string, aktif: boolean) {
  return safe(async () => {
    const ctx = await requireAdmin();
    if (userId === ctx.user.id) throw new AppError("Tidak dapat menonaktifkan akun sendiri");
    must(await ctx.supabase.from("profiles").update({ is_active: aktif }).eq("id", userId));
    if (!aktif) await createAdminClient().auth.admin.signOut(userId).catch(() => null); // cabut sesi aktif
    await audit(ctx, aktif ? "aktifkan_user" : "nonaktifkan_user", "profile", userId, { aktif });
    return { userId, aktif };
  });
}

// ---------- Data Properti (property_master) ----------
const masterSchema = z
  .object({
    name: z.string().trim().min(1, "Nama wajib diisi").max(200),
    category: z.enum(PROP_CATEGORIES),
    aliases: z.array(z.string().trim().min(1)).default([]),
    default_unit: z.string().trim().min(1).default("item"),
    ref_price_min: z.coerce.number().min(0),
    ref_price_max: z.coerce.number().min(0),
    procurement_default: z.enum(["belum", "sewa", "beli", "buat", "tersedia"]).default("belum"),
    is_active: z.boolean().default(true),
  })
  .refine((v) => v.ref_price_max >= v.ref_price_min, { message: "Harga maks harus ≥ harga min" });

export async function daftarPropertyMaster(f: { q?: string; kategori?: string; termasukNonaktif?: boolean } = {}) {
  return safe(async () => {
    const ctx = await requireAdmin();
    let q = ctx.supabase.from("property_master").select("*").order("category").order("name");
    if (f.q) q = q.ilike("name", `%${f.q.replace(/[%_]/g, "")}%`);
    if (f.kategori) q = q.eq("category", f.kategori);
    if (!f.termasukNonaktif) q = q.eq("is_active", true);
    return must(await q);
  });
}

export async function simpanPropertyMaster(input: z.input<typeof masterSchema>, id?: string) {
  return safe(async () => {
    const ctx = await requireAdmin();
    const v = masterSchema.parse(input);
    const res = id
      ? await ctx.supabase.from("property_master").update(v).eq("id", id).select().single()
      : await ctx.supabase.from("property_master").insert({ ...v, created_by: ctx.user.id }).select().single();
    if (res.error?.code === "23505") throw new AppError("Nama properti sudah ada di katalog");
    const row = must(res) as { id: string };
    await audit(ctx, id ? "ubah_katalog" : "tambah_katalog", "property_master", row.id, v);
    return row;
  });
}

/** Nonaktifkan (soft delete) agar referensi di naskah lama tetap utuh. */
export async function nonaktifkanPropertyMaster(id: string, aktif = false) {
  return safe(async () => {
    const ctx = await requireAdmin();
    must(await ctx.supabase.from("property_master").update({ is_active: aktif }).eq("id", id));
    await audit(ctx, aktif ? "aktifkan_katalog" : "nonaktifkan_katalog", "property_master", id, { aktif });
    return { id, aktif };
  });
}

// ---------- Rate card default global ----------
const rateSchema = z.object({
  code: z.string().trim().min(1).regex(/^[a-z0-9_]+$/, "Kode: huruf kecil, angka, underscore"),
  category: z.enum(KATEGORI_BIAYA),
  item_name: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  unit_price: z.coerce.number().min(0),
  currency: z.string().length(3).default("IDR"),
});

export async function daftarRateCardGlobal() {
  return safe(async () => {
    const ctx = await requireAdmin();
    return must(await ctx.supabase.from("rate_cards").select("*").is("user_id", null).order("category").order("code"));
  });
}

export async function simpanRateCardGlobal(input: z.input<typeof rateSchema>) {
  return safe(async () => {
    const ctx = await requireAdmin();
    const v = rateSchema.parse(input);
    const { data: ex } = await ctx.supabase.from("rate_cards").select("id").is("user_id", null).eq("code", v.code).maybeSingle();
    const res = ex
      ? await ctx.supabase.from("rate_cards").update(v).eq("id", (ex as { id: string }).id).select().single()
      : await ctx.supabase.from("rate_cards").insert({ ...v, user_id: null }).select().single();
    const row = must(res) as { id: string };
    await audit(ctx, "ubah_katalog", "rate_card", row.id, v);
    return row;
  });
}

export async function lihatAuditLog(limit = 100) {
  return safe(async () => {
    const ctx = await requireAdmin();
    return must(await ctx.supabase.from("admin_audit_logs").select("*").order("created_at", { ascending: false }).limit(Math.min(limit, 500)));
  });
}

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type DB = SupabaseClient;

/**
 * Klien service-role: MELEWATI RLS. Hanya untuk pipeline AI di background dan panel admin.
 * Selalu verifikasi kepemilikan/role di server SEBELUM memakai klien ini.
 */
export function createAdminClient(): DB {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY belum diset");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

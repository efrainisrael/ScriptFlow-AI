import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Penukar kode untuk sesi: verifikasi email, OAuth Google, dan tautan reset kata sandi. */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  if (!code) return NextResponse.redirect(`${origin}/login?error=tautan-tidak-valid`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=tautan-kedaluwarsa`);

  if (next?.startsWith("/") && !next.startsWith("//")) return NextResponse.redirect(`${origin}${next}`);
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  return NextResponse.redirect(`${origin}${profile?.role === "admin" ? "/admin" : "/beranda"}`);
}

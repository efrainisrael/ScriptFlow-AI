import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// Rute publik; halaman lain wajib login (AUTH-06).
const PUBLIC = ["/login", "/register", "/lupa-password"];
const SHARED = ["/reset-password", "/auth"]; // boleh diakses semua role/sesi
const match = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(p + "/"));

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll(list: { name: string; value: string; options: CookieOptions }[]) {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const redirectTo = (path: string, search = "") => {
    const url = req.nextUrl.clone();
    url.pathname = path;
    url.search = search;
    const r = NextResponse.redirect(url);
    res.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api");
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    if (match(path, PUBLIC) || match(path, SHARED) || path === "/") return res;
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return redirectTo("/login", `?next=${encodeURIComponent(path)}`);
  }

  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).single();
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return redirectTo("/login", "?error=akun-nonaktif");
  }

  const isAdmin = profile.role === "admin";
  const home = isAdmin ? "/admin" : "/beranda";

  if (match(path, SHARED)) return res;
  if (path === "/" || match(path, PUBLIC)) return redirectTo(home); // sudah login

  // AUTH-09: akses lintas role ditolak (403)
  const adminArea = path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin");
  const forbidden = (adminArea && !isAdmin) || (!adminArea && isAdmin && !isApi);
  if (forbidden) {
    return isApi
      ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
      : new NextResponse("403 — Akses ditolak untuk role Anda.", { status: 403 });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

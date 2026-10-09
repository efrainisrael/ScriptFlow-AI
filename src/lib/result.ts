import { ZodError } from "zod";

export class AppError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

/** Bungkus server action agar selalu mengembalikan {ok,data|error} (tidak melempar ke klien). */
export async function safe<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, status: e.status };
    if (e instanceof ZodError) {
      return { ok: false, error: e.issues.map((i) => i.message).join("; "), status: 400 };
    }
    console.error("[server-action]", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan", status: 500 };
  }
}

/** Lempar AppError bila query Supabase gagal, kembalikan data bila sukses. */
export function must<T>(
  r: { data: T | null; error: { message: string } | null },
  msg = "Query gagal"
): T {
  if (r.error) throw new AppError(`${msg}: ${r.error.message}`, 500);
  return r.data as T;
}

/** Jalankan fn untuk setiap item dengan batas konkurensi. */
export async function pMap<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import "server-only";
import type { DB } from "@/lib/supabase/admin";
import { must, pMap } from "@/lib/result";

export type ScheduleConfig = { start_date?: string; hours_per_day?: number; holidays?: string[] };

const COMPLEXITY_MULT = { rendah: 0.8, sedang: 1, tinggi: 1.5 } as const;

/** JDW-02: durasi syuting adegan (menit) dari panjang halaman & kompleksitas. 1 halaman ≈ 60 menit syuting. */
export function estimasiDurasiMenit(p: {
  page_eighths: number;
  complexity: keyof typeof COMPLEXITY_MULT;
  extras: number;
  stunts: number;
  fx: number;
}) {
  const base = (p.page_eighths / 8) * 60 * COMPLEXITY_MULT[p.complexity];
  const add = p.stunts * 60 + p.fx * 20 + (p.extras >= 20 ? 30 : 0);
  return Math.max(15, Math.round((base + add) / 5) * 5);
}

type SceneRow = {
  id: string;
  scene_no: number;
  int_ext: string | null;
  time_of_day: string | null;
  location_id: string | null;
  est_duration_min: number;
  locations: { name: string } | null;
};

const timeRank = (t: string | null) => {
  const s = (t ?? "").toUpperCase();
  if (s.includes("SUBUH")) return 0;
  if (s.includes("PAGI")) return 1;
  if (s.includes("SORE")) return 3;
  if (s.includes("MALAM")) return 4;
  return 2;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const minToTime = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;

/** Susun hari syuting (pure). Urutan: lokasi → INT/EXT → siang/malam (JDW-01). */
export function susunHari(scenes: SceneRow[], cfg: Required<ScheduleConfig>) {
  const sorted = [...scenes].sort(
    (a, b) =>
      (a.locations?.name ?? "").localeCompare(b.locations?.name ?? "") ||
      (a.int_ext ?? "").localeCompare(b.int_ext ?? "") ||
      timeRank(a.time_of_day) - timeRank(b.time_of_day) ||
      a.scene_no - b.scene_no
  );

  const capacity = cfg.hours_per_day * 60;
  const days: { items: SceneRow[]; used: number }[] = [];
  for (const s of sorted) {
    const cur = days[days.length - 1];
    if (cur && cur.used + s.est_duration_min <= capacity) {
      cur.items.push(s);
      cur.used += s.est_duration_min;
    } else {
      days.push({ items: [s], used: s.est_duration_min });
    }
  }

  const holidays = new Set(cfg.holidays);
  let cursor = new Date(`${cfg.start_date}T00:00:00Z`);
  return days.map((d, i) => {
    while (holidays.has(iso(cursor))) cursor = addDays(cursor, 1);
    const date = iso(cursor);
    cursor = addDays(cursor, 1);
    const counts = new Map<string, number>();
    d.items.forEach((s) => s.location_id && counts.set(s.location_id, (counts.get(s.location_id) ?? 0) + 1));
    const location_id = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      day_no: i + 1,
      shoot_date: date,
      call_time: "07:00:00",
      wrap_time: minToTime(7 * 60 + d.used),
      location_id,
      items: d.items.map((s, k) => ({ scene_id: s.id, order_no: k + 1, est_duration_min: s.est_duration_min })),
    };
  });
}

/** Hitung ulang durasi adegan dari entitas, lalu susun & simpan stripboard otomatis. */
export async function susunJadwalVersi(db: DB, versionId: string, override?: ScheduleConfig) {
  const ver = must(
    await db.from("script_versions").select("schedule_config").eq("id", versionId).single(),
    "Versi tidak ditemukan"
  ) as { schedule_config: ScheduleConfig };

  const scenes = must(
    await db
      .from("scenes")
      .select("id, scene_no, int_ext, time_of_day, location_id, est_duration_min, page_eighths, complexity, locations(name), entities(type)")
      .eq("version_id", versionId),
    "Gagal memuat adegan"
  ) as unknown as (SceneRow & { page_eighths: number; complexity: keyof typeof COMPLEXITY_MULT; entities: { type: string }[] })[];
  if (!scenes.length) return { days: 0 };

  // Perbarui estimasi durasi per adegan (entitas mungkin dikoreksi pengguna)
  await pMap(scenes, 8, async (s) => {
    const n = (t: string) => s.entities.filter((e) => e.type === t).length;
    s.est_duration_min = estimasiDurasiMenit({
      page_eighths: s.page_eighths,
      complexity: s.complexity,
      extras: n("EXTRA"),
      stunts: n("STUNT"),
      fx: n("SPECIAL_FX"),
    });
    await db.from("scenes").update({ est_duration_min: s.est_duration_min }).eq("id", s.id);
  });

  const stored = { ...ver.schedule_config, ...override };
  const cfg: Required<ScheduleConfig> = {
    start_date: stored.start_date ?? iso(addDays(new Date(), 7)),
    hours_per_day: stored.hours_per_day ?? 10,
    holidays: stored.holidays ?? [],
  };
  await db.from("script_versions").update({ schedule_config: cfg }).eq("id", versionId);

  const plan = susunHari(scenes, cfg);

  // Ganti jadwal lama (schedule_items ikut terhapus via cascade)
  must(await db.from("shooting_days").delete().eq("version_id", versionId));
  const insertedDays = must(
    await db
      .from("shooting_days")
      .insert(
        plan.map((d) => ({
          version_id: versionId,
          day_no: d.day_no,
          shoot_date: d.shoot_date,
          call_time: d.call_time,
          wrap_time: d.wrap_time,
          location_id: d.location_id,
        }))
      )
      .select("id, day_no"),
    "Gagal menyimpan hari syuting"
  ) as { id: string; day_no: number }[];

  const dayId = new Map(insertedDays.map((d) => [d.day_no, d.id]));
  const items = plan.flatMap((d) =>
    d.items.map((it) => ({ shooting_day_id: dayId.get(d.day_no)!, ...it }))
  );
  must(await db.from("schedule_items").insert(items), "Gagal menyimpan jadwal");
  return { days: plan.length };
}

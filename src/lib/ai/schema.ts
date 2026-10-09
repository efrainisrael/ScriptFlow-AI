import { z } from "zod";

export const ENTITY_TYPES = [
  "SCENE_HEADING", "LOCATION", "CHARACTER", "EXTRA", "PROP", "COSTUME",
  "VEHICLE", "ANIMAL", "SPECIAL_FX", "STUNT", "TIME_OF_DAY", "SOUND_MUSIC",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const PROP_CATEGORIES = [
  "properti_tangan", "set_dressing", "kostum", "kendaraan", "tata_rias", "efek_khusus", "hewan",
] as const;
export type PropCategory = (typeof PROP_CATEGORIES)[number];

const qty = z.coerce.number().int().min(1).catch(1);
const strList = z.array(z.string().trim().min(1)).catch([]);

/** Skema keluaran LLM per adegan (PRD 6.4, diperluas: vehicles, animals, sound_music). */
export const sceneSchema = z.object({
  heading: z.string().trim().catch(""),
  int_ext: z.enum(["INT", "EXT", "INT/EXT"]).catch("INT"),
  time_of_day: z.string().trim().catch("SIANG"),
  location: z.string().trim().min(1, "lokasi adegan kosong"),
  summary: z.string().trim().catch(""),
  characters: strList,
  extras: z.array(z.object({ description: z.string().trim().min(1), count: qty })).catch([]),
  props: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        qty,
        category: z.enum(["properti_tangan", "set_dressing", "tata_rias"]).catch("properti_tangan"),
      })
    )
    .catch([]),
  costumes: strList,
  vehicles: strList,
  animals: strList,
  special_fx: strList,
  stunts: strList,
  sound_music: strList,
  complexity: z.enum(["rendah", "sedang", "tinggi"]).catch("sedang"),
});
export type SceneExtraction = z.infer<typeof sceneSchema>;

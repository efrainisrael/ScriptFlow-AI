import "server-only";
import OpenAI from "openai";
import { sceneSchema, type SceneExtraction } from "./schema";
import { SYSTEM_PROMPT } from "./prompt";
import { AppError, sleep } from "@/lib/result";

export type HasilEkstraksi = { data: SceneExtraction; tokens: number; latencyMs: number };

const MAX_ATTEMPTS = 3; // 1 percobaan + maksimal 2 pengulangan (PRD 6.5)

/**
 * Client LLM standar OpenAI-Compatible (Ollama, vLLM, HuggingFace TGI, LM Studio, LocalAI, dll).
 * Memungkinkan pemanggilan model custom hasil fine-tuning Anda sendiri.
 */
function getClient() {
  const baseURL = process.env.LLM_API_BASE_URL || "http://localhost:11434/v1";
  const apiKey = process.env.LLM_API_KEY || "not-needed";
  return new OpenAI({ baseURL, apiKey });
}

function getModelName() {
  return process.env.LLM_MODEL_NAME || "scriptflow-custom-llm";
}

const stripFence = (s: string) => s.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

/**
 * LLM-based NER untuk SATU adegan menggunakan Custom LLM Endpoint (OpenAI format).
 * Hasil divalidasi Zod; bila gagal diulang (maks 2x) dengan backoff eksponensial.
 */
export async function ekstrakNaskah(teksAdegan: string): Promise<HasilEkstraksi> {
  const client = getClient();
  const model = getModelName();
  const t0 = Date.now();
  let tokens = 0;
  let lastError = "tidak diketahui";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `ADEGAN:\n"""\n${teksAdegan}\n"""` },
        ],
      });

      tokens += response.usage?.total_tokens ?? 0;
      const rawText = response.choices[0]?.message?.content ?? "";
      if (!rawText.trim()) throw new Error("Respons LLM kosong");

      const json = JSON.parse(stripFence(rawText));
      const data = sceneSchema.parse(Array.isArray(json) ? json[0] : json);
      return { data, tokens, latencyMs: Date.now() - t0 };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      const transient = /429|503|quota|overloaded|rate|fetch failed|ECONN/i.test(lastError);
      if (attempt < MAX_ATTEMPTS - 1) await sleep((transient ? 2000 : 300) * 2 ** attempt);
    }
  }
  throw new AppError(`Gagal mengekstrak adegan via LLM (${model}) setelah ${MAX_ATTEMPTS} percobaan: ${lastError.slice(0, 200)}`, 502);
}

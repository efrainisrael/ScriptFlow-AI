# =====================================================================
# KODE PENGUJI MODEL LLM SCRIPTFLOW AI (4 TAHAP PENGUJIAN) - GOOGLE COLAB
# =====================================================================

import json
import os
from unsloth import FastLanguageModel

# ---------------------------------------------------------------------
# TAHAP 1: LOAD MODEL & TOKENIZER HASIL FINE-TUNING
# ---------------------------------------------------------------------
print("🔹 TAHAP 1: Memuat Model Hasil Fine-Tuning...")

# Opsi 1: Pakai model dari memori aktif Colab (jika di notebook yang sama)
try:
    FastLanguageModel.for_inference(model)
    print("✅ Menggunakan model dari memori aktif Colab!")
except NameError:
    # Opsi 2: Load folder model dari disk (otomatis mendeteksi folder drama / general)
    folder_target = "model_scriptflow_drama_gguf" if os.path.exists("model_scriptflow_drama_gguf") else "model_scriptflow_gguf"
    print(f"📂 Memuat folder model: {folder_target}")
    
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name = folder_target,
        max_seq_length = 2048,
        dtype = None,
        load_in_4bit = True,
    )
    FastLanguageModel.for_inference(model)
    print(f"✅ Model berhasil dimuat dari folder '{folder_target}'!")


# ---------------------------------------------------------------------
# TAHAP 2: INPUT NASKAH UJI (TEST SCRIPT PROMPT)
# ---------------------------------------------------------------------
print("\n🔹 TAHAP 2: Menyiapkan Teks Naskah Uji Baru...")

# Teks adegan baru untuk menguji performa ekstraksi AI
naskah_uji = """
5. INT. DOKTER UTAMA - PAGI
Dokter Hendra berdiri memegang kertas hasil rontgen di depan jendela kaca. Kirana duduk cemas di kursi kayu, kedua tangannya meremas sapu tangan putih. Di atas meja kerja terdapat stetoskop dan cangkir kopi dingin.
"""
print(f"📄 Naskah Uji:\n{naskah_uji.strip()}")


# ---------------------------------------------------------------------
# TAHAP 3: EKSEKUSI LLM INFERENCE & GENERATION
# ---------------------------------------------------------------------
print("\n🔹 TAHAP 3: Mengeksekusi Inference LLM...")

system_prompt = """Kamu adalah mesin ekstraksi script breakdown untuk produksi film/serial/iklan (LLM-based NER).
Input: TEKS SATU ADEGAN dari naskah (Bahasa Indonesia, Inggris, atau campuran).
Output: HANYA satu objek JSON valid. Tanpa markdown, tanpa komentar, tanpa teks lain.

SKEMA WAJIB:
{
  "heading": string,
  "int_ext": "INT" | "EXT" | "INT/EXT",
  "time_of_day": string,
  "location": string,
  "summary": string,
  "characters": string[],
  "extras": [{ "description": string, "count": number }],
  "props": [{ "name": string, "qty": number, "category": "properti_tangan" | "set_dressing" | "tata_rias" }],
  "costumes": string[],
  "vehicles": string[],
  "animals": string[],
  "special_fx": string[],
  "stunts": string[],
  "sound_music": string[],
  "complexity": "rendah" | "sedang" | "tinggi"
}"""

messages = [
    {"role": "system", "content": system_prompt},
    {"role": "user", "content": f"ADEGAN:\n\"\"\"\n{naskah_uji.strip()}\n\"\"\""}
]

prompt_formatted = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
inputs = tokenizer([prompt_formatted], return_tensors="pt").to("cuda")

# Generate keluaran
outputs = model.generate(**inputs, max_new_tokens=512, temperature=0.1, use_cache=True)
raw_response = tokenizer.batch_decode(outputs[:, inputs.input_ids.shape[1]:], skip_special_tokens=True)[0]


# ---------------------------------------------------------------------
# TAHAP 4: PARSING JSON & EVALUASI EKSTRAKSI ENTITAS
# ---------------------------------------------------------------------
print("\n🔹 TAHAP 4: Hasil Parsing JSON & Evaluasi Entitas:")
print("=" * 60)

# Cleaning string JSON
clean_json_str = raw_response.replace("```json", "").replace("```", "").strip()

try:
    data_json = json.loads(clean_json_str)
    print("✅ STATUS PARSING: BERHASIL (JSON Valid 100%)\n")
    print(json.dumps(data_json, indent=2, ensure_ascii=False))
    
    print("\n📊 RINGKASAN ENTITAS HASIL EKSTRAKSI AI:")
    print(f"- Scene Heading : {data_json.get('heading')}")
    print(f"- Lokasi & Waktu : {data_json.get('location')} ({data_json.get('time_of_day')})")
    print(f"- Karakter       : {', '.join(data_json.get('characters', []))}")
    print(f"- Properti Tangan: {[p['name'] for p in data_json.get('props', []) if p.get('category') == 'properti_tangan']}")
    print(f"- Set Dressing   : {[p['name'] for p in data_json.get('props', []) if p.get('category') == 'set_dressing']}")
    print(f"- Kompleksitas   : {data_json.get('complexity')}")

except json.JSONDecodeError as e:
    print("❌ STATUS PARSING: GAGAL (Respons bukan JSON valid)")
    print(f"Error: {e}")
    print("Teks mentah keluaran LLM:")
    print(raw_response)

print("=" * 60)

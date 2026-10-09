# =====================================================================
# SCRIPT FINE-TUNING LLM UNTUK SCRIPTFLOW AI (GOOGLE COLAB / UNSLOTH)
# Model: Qwen2.5-7B-Instruct, Llama-3.2-3B-Instruct, atau Llama-3-8B-Instruct
# =====================================================================

import os
import gc
import torch

# Mencegah akumulasi fragmentasi memori CUDA pada Tesla T4 Colab
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

# Paksa bersihkan RAM GPU & Garbage Collector sebelum memuat model
gc.collect()
torch.cuda.empty_cache()

from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

# 1. Pilih Model & Panjang Sekuens (Hemat VRAM T4 Colab 15GB)
max_seq_length = 2048  # Cukup untuk 1 adegan naskah lengkap

# Pilihan model (Qwen2.5-7B sangat disarankan untuk Colab T4 karena jauh lebih hemat VRAM & cepat):
# - "unsloth/Qwen2.5-7B-Instruct-bnb-4bit"    (Rekomendasi Utama: Sangat Akurat & Ringan VRAM ~6.5GB)
# - "unsloth/Llama-3.2-3B-Instruct-bnb-4bit" (Super Cepat & Super Ringan VRAM ~4GB)
# - "unsloth/llama-3-8b-Instruct-bnb-4bit"    (Llama 3 8B Standar)
model_name = "unsloth/Qwen2.5-7B-Instruct-bnb-4bit"

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = model_name,
    max_seq_length = max_seq_length,
    dtype = None,
    load_in_4bit = True,
)

# 2. Setup LoRA Adapter untuk Fine-Tuning
model = FastLanguageModel.get_peft_model(
    model,
    r = 16,
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_alpha = 16,
    lora_dropout = 0,
    bias = "none",
    use_gradient_checkpointing = "unsloth",
    random_state = 3407,
)

# 3. Format Dataset ke Template Chat
def format_prompts(examples):
    texts = []
    for msgs in examples["messages"]:
        text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
        texts.append(text)
    return { "text" : texts }

# Silakan sesuaikan nama file dataset yang ingin dilatih (Khusus Genre Komedi & Kehidupan Kota)
dataset_file = "dataset_komedi_kota.jsonl"
dataset = load_dataset("json", data_files=dataset_file, split="train")
dataset = dataset.map(format_prompts, batched=True)

# 4. Konfigurasi Trainer (Super Cepat ~2 Menit dengan max_steps = 30)
trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    dataset_text_field = "text",
    max_seq_length = max_seq_length,
    dataset_num_proc = 2,
    packing = False,
    args = TrainingArguments(
        per_device_train_batch_size = 1,     # Sangat aman VRAM pada GPU T4
        gradient_accumulation_steps = 4,      # Menjaga gradien tetap stabil
        warmup_steps = 3,
        max_steps = 30,                      # 30 steps cukup & matang (loss < 0.03, selesasi ~2-3 menit)
        learning_rate = 2e-4,
        fp16 = not torch.cuda.is_bf16_supported(),
        bf16 = torch.cuda.is_bf16_supported(),
        logging_steps = 1,
        optim = "adamw_8bit",
        weight_decay = 0.01,
        lr_scheduler_type = "linear",
        seed = 3407,
        output_dir = "outputs",
    ),
)

# 5. Jalankan Pelatihan
trainer_stats = trainer.train()

# 6. Ekspor Model ke GGUF (Untuk Ollama / vLLM / LocalAI)
model.save_pretrained_gguf("model_scriptflow_gguf", tokenizer, quantization_method = "q4_k_m")
print("✅ Fine-tuning selesai! Model GGUF disimpan di folder model_scriptflow_gguf")



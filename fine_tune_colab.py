# =====================================================================
# SCRIPT FINE-TUNING LLM UNTUK SCRIPTFLOW AI (GOOGLE COLAB / UN-SLOTH)
# Model: Llama-3-8B-Instruct atau Qwen2.5-7B-Instruct (Sangat Cepat & Akurat)
# =====================================================================

# 1. Install Unsloth & Dependencies (Jalankan di cell pertama Colab)
"""
!pip install unsloth unsloth_zoo
!pip install --no-deps trl peft accelerate bitsandbytes
"""

import torch
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

# 2. Muat Base Model 4-bit (Hemat VRAM T4 Colab)
max_seq_length = 2048
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/llama-3-8b-Instruct-bnb-4bit", # atau "unsloth/Qwen2.5-7B-Instruct-bnb-4bit"
    max_seq_length = max_seq_length,
    dtype = None,
    load_in_4bit = True,
)

# 3. Setup LoRA Adapter untuk Fine-Tuning
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

# 4. Format Dataset ke Template Chat
def format_prompts(examples):
    texts = []
    for msgs in examples["messages"]:
        text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
        texts.append(text)
    return { "text" : texts }

dataset = load_dataset("json", data_files="dataset_scriptflow_ner.jsonl", split="train")
dataset = dataset.map(format_prompts, batched=True)

# 5. Konfigurasi Trainer & Jalankan Fine-Tuning
trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    dataset_text_field = "text",
    max_seq_length = max_seq_length,
    dataset_num_proc = 2,
    packing = False,
    args = TrainingArguments(
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4,
        warmup_steps = 5,
        max_steps = 60, # Ganti jumlah steps sesuai ukuran dataset
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

trainer_stats = trainer.train()

# 6. Ekspor Model ke GGUF (Bisa Di-load oleh Ollama / vLLM / LocalAI)
model.save_pretrained_gguf("model_scriptflow_gguf", tokenizer, quantization_method = "q4_k_m")
print("Fine-tuning selesai! Model GGUF disimpan di folder model_scriptflow_gguf")

# Panduan Acuan & Rulebase Pembuatan Naskah Sintetis (Standar Produksi Film Menengah)

Dokumen ini disusun sebagai acuan standar dalam membuat dataset naskah sintetis untuk melatih model LLM pada sistem **ScriptFlow AI**.

---

## 1. Batasan Skala Produksi Film Menengah (Production Boundary)

Untuk skala **produksi menengah** (Estimasi Anggaran RAB ± Rp 1 Miliar s.d. Rp 5 Miliar / OTT Series / Indie Komersial):

| Parameter | Batasan Produksi Menengah (Medium Scale) | Yang Harus Dihindari (Skala Hollywood / Blockbuster) |
| :--- | :--- | :--- |
| **Jumlah Figuran** | 5 s.d. 30 orang per adegan (pasar kecil, ruang tunggu, kafe). | Ribuan massa perang atau stadion penuh. |
| **Kendaraan** | 1 s.d. 3 kendaraan sewa harian (sedan, motor, ambulans, pick-up). | Konvoi tank militer, pesawat tempur, helikopter. |
| **Stunt / Aksi** | Perkelahian 2–4 orang, jatuh dari tangga/motor, kejar-kejaran lari/motor. | Atraksi mobil melompati gedung, terjun payung. |
| **Efek Khusus (SFX)** | Asap buatan, hujan buatan (*rain machine*), ledakan kecil (*squib/pyro*), rias luka. | Penghancuran gedung berantai, CGI alien/monster rumit. |
| **Lokasi** | 1–3 lokasi per adegan (interior kafe, lorong RS, jalan kompleks, pos ronda). | 10+ lokasi eksotis luar negeri. |

---

## 2. Rulebase Penulisan Syntax Naskah (Formatting Rules)

Setiap contoh adegan sintetis wajib mengikuti struktur naskah baku perfilman Indonesia:

### A. Scene Heading (Slugline)
- Format wajib: `[NOMOR]. [INT/EXT/INT./EXT.] [NAMA LOKASI] - [WAKTU]`
- **Aturan:**
  - `INT.` = Dalam ruangan (Rumah Sakit, Kantor Polisi, Kamar, Kafe).
  - `EXT.` = Luar ruangan (Pasar, Jalan Raya, Lapangan, Taman).
  - `INT./EXT.` = Kendaraan bergerak (Sepeda Motor, Mobil, Ambulans).
  - Waktu baku: `PAGI`, `SIANG`, `SORE`, `MALAM`, `SUBUH`.

### B. Action Line (Deskripsi Visual)
- Bahasa Indonesia lugas, aktif, dan present-tense.
- Menyebutkan entitas fisik secara eksplisit (misal: *"Rani memegang ponsel"* bukan *"Rani berkomunikasi"*).
- Jumlah figuran disebutkan dengan angka/perkiraan eksplisit (misal: *"Sepuluh pasien terbaring"*).

### C. Dialog & Parenthetical
- Nama Karakter kapital tebal sebelum dialog (`RANI`, `DOKTER ANDI`).
- Parenthetical untuk ekspresi singkat (misal: `(berbisik)`, `(sambil menangis)`).

---

## 3. Rulebase Kategori Entitas (NER Annotation Schema)

Saat membuat pasangan input-output JSON, patuhi aturan pemetaan 12 entitas berikut:

```json
{
  "heading": "INT. RUMAH SAKIT - MALAM",
  "int_ext": "INT",
  "time_of_day": "MALAM",
  "location": "Rumah sakit",
  "summary": "Ringkasan 1 kalimat aktif mengenai kejadian utama.",
  "characters": ["Nama Karakter Utama / Pendukung Berdialog"],
  "extras": [{"description": "Deskripsi Figuran", "count": 10}],
  "props": [
    {"name": "Barang yang dipegang/dipakai", "qty": 1, "category": "properti_tangan"},
    {"name": "Furnitur dekorasi ruangan", "qty": 1, "category": "set_dressing"},
    {"name": "Darah buatan/luka garuk", "qty": 1, "category": "tata_rias"}
  ],
  "costumes": ["Seragam Polisi", "Kebaya", "Snelli Dokter"],
  "vehicles": ["Mobil Sedan Hitam", "Sepeda Motor Matic"],
  "animals": ["Anjing", "Kucing"],
  "special_fx": ["asap buatan", "hujan buatan", "ledakan kecil"],
  "stunts": ["kejar-kejaran", "perkelahian 2 orang", "jatuh dari motor"],
  "sound_music": ["sirene ambulans", "lagu daerah"],
  "complexity": "rendah | sedang | tinggi"
}
```

---

## 4. Rekomendasi 5 Genre Utama untuk Komposisi Dataset Sempurna

Agar model LLM Anda terlatih menguji seluruh 12 entitas NER dan mesin biaya RAB secara seimbang, gunakan komposisi **5 Genre Utama** berikut dalam dataset Anda:

### 1. Drama / Romantis & Keluarga (30% Dataset)
- **Tujuan Uji AI:** Mengekstrak dialog emosional, properti tangan harian, dan set dressing interior.
- **Elemen Entitas:** Properti tangan (HP, surat, cincin, cangkir), lokasi interior (kamar tidur, kafe, meja makan), kostum sehari-hari.
- **Kompleksitas:** Rendah.

### 2. Aksi / Action Ringan & Kejar-Kejaran (25% Dataset)
- **Tujuan Uji AI:** Melatih AI mengenali `stunts`, `vehicles`, `special_fx`, dan `tata_rias` (luka).
- **Elemen Entitas:** Kejar-kejaran lari/motor, perkelahian 2–3 orang, mobil sedan, motor matic, ledakan kecil, asap, darah buatan.
- **Kompleksitas:** Tinggi.

### 3. Horor / Thriller & Misteri (20% Dataset)
- **Tujuan Uji AI:** Melatih AI mengenali `special_fx` (rias mistik/darah), `sound_music` (suara pintu/sirene/musik mencekam), dan `animals`.
- **Elemen Entitas:** Lampu minyak, senter, keris, kemenyan, rias luka/pucat, hujan buatan, petir, peternakan/anjing, lorong tua.
- **Kompleksitas:** Sedang - Tinggi.

### 4. Komedi / Kehidupan Kota & Sosial (15% Dataset)
- **Tujuan Uji AI:** Melatih AI mengestimasi `extras` (figuran massa) dan variasi `costumes` tradisional/profesi.
- **Elemen Entitas:** 10–30 figuran di pasar/taman/pos ronda, baju hansip, kebaya, kostum badut, sepeda, pedagang buah.
- **Kompleksitas:** Sedang.

### 5. Kriminal / Polisi & Investigasi (10% Dataset)
- **Tujuan Uji AI:** Melatih AI mengidentifikasi perizinan lokasi khusus, senjata replika, dan kostum instansi.
- **Elemen Entitas:** Seragam Polisi, jas dokter, pistol replika, borgol, berkas perkara, ruang interogasi, ambulans.
- **Kompleksitas:** Sedang.

---

## 5. Landasan Ilmiah & Referensi Jurnal (Academic & Industry Citation)

Acuan dan rulebase di atas disusun berdasarkan literatur ilmiah dan standar industri perfilman berikut:

### A. Standar Penulisan & Ekstraksi Skenario (Screenplay Structure)
1. **Field, S. (2005).** *Screenplay: The Foundations of Screenwriting*. Delta / Random House.
2. **Baskoro, G. (2018).** *Panduan Penulisan Skenario Film Indonesia*. FFTV Institut Kesenian Jakarta (IKJ).

### B. Natural Language Processing (NLP) & Film Named Entity Recognition
3. **Weng, C. Y., Chu, W. T., & Wu, J. L. (2010).** "Movie Analysis From Script to Screen: A Survey". *IEEE Transactions on Multimedia*, 12(6), 540-549.
4. **Tapaswi, M., Bäuml, M., & Stiefelhagen, R. (2014).** "Storygraphs: Visualizing Character Interactions in Screenplays". *IEEE Transactions on Visualization and Computer Graphics*, 20(12), 2418-2427.

### C. Pembuatan Data Sintetis & Instruct Fine-Tuning LLM
5. **Wang, Y., Kordi, Y., Mishra, S., Liu, A., Smith, N. A., Khashabi, D., & Hajishirzi, H. (2022).** "Self-Instruct: Aligning Language Models with Self-Generated Instructions". *arXiv preprint arXiv:2212.10560*.

### D. Manajemen Produksi & Estimasi Anggaran Film (Line Producing)
6. **Honthaner, E. L. (2010).** *The Complete Film Production Handbook (4th ed.)*. Focal Press / Elsevier.
7. **Riyanto, A., & Triyono, B. (2021).** "Manajemen Produksi Film Independen Skala Menengah di Indonesia". *Jurnal Seni Peran & Sinematografi*, 5(2), 112-125.

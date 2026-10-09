# Product Requirements Document (PRD)

**Sistem Otomatisasi Script Breakdown dan Estimasi Anggaran Produksi Real-Time Berbasis Generative NLP**

Versi 1.0 | Oktober 2026 | Status: Draft

## 1. Ringkasan Produk

### 1.1 Latar Belakang

Dalam produksi film, serial, iklan, atau konten video, tahap *script breakdown* (menguraikan naskah menjadi daftar adegan, karakter, properti, lokasi, dan kebutuhan produksi lainnya) dilakukan secara manual oleh Asisten Sutradara atau Line Producer. Proses ini memakan waktu berhari-hari, rawan terlewat detail, dan menjadi dasar penyusunan jadwal syuting serta anggaran. Perubahan naskah (revisi) memaksa seluruh proses diulang.

### 1.2 Ringkasan Solusi

Platform web yang menerima naskah, lalu secara otomatis mengekstrak entitas produksi menggunakan **Generative NLP (Gemini Flash) dengan teknik LLM-based Named Entity Recognition (NER)**. Hasil ekstraksi diubah menjadi tiga keluaran utama: **daftar kebutuhan properti**, **jadwal syuting**, dan **estimasi biaya** yang diperbarui secara real-time ketika pengguna mengubah asumsi atau mengunggah revisi naskah.

### 1.3 Tujuan Produk

1. Memangkas waktu script breakdown dari hitungan hari menjadi hitungan menit.
2. Menghasilkan estimasi anggaran awal yang transparan dan dapat disesuaikan.
3. Menyediakan jadwal syuting yang efisien (pengelompokan berdasarkan lokasi, waktu, dan ketersediaan pemeran).
4. Menyimpan riwayat naskah dan versi revisinya agar dapat dilacak dan dibandingkan.

### 1.4 Metrik Keberhasilan

| Metrik | Target |
| --- | --- |
| Waktu pemrosesan naskah 100 halaman | di bawah 3 menit |
| Akurasi ekstraksi entitas (F1-score) pada dataset uji | minimal 85% |
| Pengurangan waktu breakdown dibanding manual | minimal 80% |
| Kepuasan pengguna uji (skala 1-5) | minimal 4,0 |
| Ketersediaan sistem | minimal 99% |

## 2. Target Pengguna

| Persona | Kebutuhan Utama |
| --- | --- |
| **Line Producer / Produser** | Estimasi anggaran cepat, perbandingan antar revisi naskah |
| **Asisten Sutradara (AD)** | Breakdown adegan dan jadwal syuting efisien |
| **Penulis Naskah / Sutradara** | Melihat dampak biaya dari perubahan naskah |
| **Production Manager / Art Department** | Daftar properti, kostum, dan lokasi per adegan |
| Admin Sistem | Mengelola akun pengguna, memantau penggunaan sistem, dan memelihara data master properti serta harga referensi |

## 3. Ruang Lingkup

### 3.1 Dalam Lingkup (MVP)

- Autentikasi (registrasi dan login)
- Beranda (dashboard ringkasan)
- Menu **Studio Naskah** (pengunggahan dan analisis naskah)
- Menu **Kebutuhan Produksi** dengan tiga submenu: Kebutuhan Properti, Jadwal Syuting, Rincian Biaya
- Menu **Riwayat** (history naskah dan versi)
- Menu **Profil** dan tombol **Keluar (Logout)**
- Panel **Admin** (role terpisah): Beranda Admin, Data User, dan Data Properti
- Ekspor hasil ke PDF dan Excel

### 3.2 Di Luar Lingkup (Fase Berikutnya)

- Kolaborasi multi-pengguna real-time dalam satu proyek
- Integrasi dengan aplikasi penjadwalan pihak ketiga (misal Movie Magic, StudioBinder)
- Basis data harga vendor otomatis dari marketplace
- Aplikasi mobile native
- Pembayaran dan langganan berbayar

## 4. Penamaan Menu (Navigasi)

Menu "upload naskah" diganti dengan istilah yang lebih profesional dan elegan. Rekomendasi utama dan alternatifnya:

| Opsi | Nama Menu | Catatan |
| --- | --- | --- |
| **Rekomendasi** | **Studio Naskah** | Terkesan kreatif dan profesional, mencakup unggah sekaligus analisis |
| Alternatif 1 | Pengajuan Naskah | Formal, cocok untuk konteks akademik/institusi |
| Alternatif 2 | Analisis Naskah | Menekankan fungsi utama sistem |
| Alternatif 3 | Impor Naskah | Netral dan teknis |

Tombol aksi di dalam halaman: ~~Upload~~ menjadi **"Unggah & Analisis Naskah"**.

Struktur navigasi akhir (sidebar):

1. Beranda
2. Studio Naskah
3. Kebutuhan Produksi
   - Kebutuhan Properti
   - Jadwal Syuting
   - Rincian Biaya
4. Riwayat
5. Profil
6. Keluar

Struktur navigasi **Admin** (sidebar terpisah pada rute `/admin`):

1. Beranda Admin
2. Data User
3. Data Properti
4. Profil
5. Keluar

## 5. Kebutuhan Fungsional

### 5.1 Autentikasi (Login dan Registrasi)

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| AUTH-01 | Pengguna dapat mendaftar dengan nama lengkap, email, dan kata sandi | Tinggi |
| AUTH-02 | Pengguna dapat login dengan email dan kata sandi | Tinggi |
| AUTH-03 | Login/registrasi dengan Google (OAuth) | Sedang |
| AUTH-04 | Verifikasi email setelah registrasi | Sedang |
| AUTH-05 | Fitur lupa dan reset kata sandi | Sedang |
| AUTH-06 | Sesi dikelola aman; halaman internal tidak dapat diakses tanpa login | Tinggi |
| AUTH-07 | Validasi input (format email, kekuatan kata sandi minimal 8 karakter) | Tinggi |
| AUTH-08 | Sistem memiliki dua role: user dan admin; registrasi publik selalu menghasilkan role user | Tinggi |
| AUTH-09 | Setelah login, admin diarahkan ke /admin dan user ke /beranda; akses lintas role ditolak (403) | Tinggi |
| AUTH-10 | Akun admin pertama dibuat lewat seeding database; admin berikutnya hanya dapat ditambahkan oleh admin lain | Tinggi |

Implementasi: **Supabase Auth** dengan middleware Next.js untuk proteksi rute.

### 5.2 Beranda (Dashboard)

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| HOME-01 | Sapaan personal dan ringkasan akun | Rendah |
| HOME-02 | Kartu statistik: total naskah, total estimasi anggaran terbaru, jumlah hari syuting, jumlah properti | Tinggi |
| HOME-03 | Daftar naskah terbaru (maksimal 5) dengan status pemrosesan | Tinggi |
| HOME-04 | Tombol pintasan "Unggah & Analisis Naskah" | Tinggi |
| HOME-05 | Grafik ringkas distribusi biaya per kategori untuk naskah aktif | Sedang |

### 5.3 Studio Naskah (Pengunggahan dan Analisis)

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| STD-01 | Unggah berkas naskah berformat PDF, DOCX, atau TXT (maksimal 10 MB) | Tinggi |
| STD-02 | Opsi tempel teks naskah langsung ke editor | Sedang |
| STD-03 | Form metadata: judul, jenis produksi (film, serial, iklan, konten), genre, kota/lokasi utama, mata uang (default IDR) | Tinggi |
| STD-04 | Ekstraksi teks dari berkas dan pemecahan naskah menjadi adegan (deteksi heading adegan seperti INT./EXT., nama lokasi, waktu) | Tinggi |
| STD-05 | Analisis AI dijalankan otomatis setelah unggah, dengan indikator progres per tahap | Tinggi |
| STD-06 | Pratinjau hasil: naskah dengan sorotan warna per jenis entitas | Sedang |
| STD-07 | Pengguna dapat mengoreksi hasil ekstraksi (tambah, ubah, hapus entitas) sebelum dikonfirmasi | Tinggi |
| STD-08 | Unggah revisi naskah sebagai versi baru dari naskah yang sama, dengan ringkasan perbedaan | Sedang |
| STD-09 | Penanganan galat: berkas rusak, teks tidak terbaca, kegagalan AI, dengan opsi coba ulang | Tinggi |

### 5.4 Kebutuhan Produksi

Halaman ini bergantung pada naskah aktif yang dipilih (selektor naskah di bagian atas).

#### 5.4.1 Kebutuhan Properti

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| PROP-01 | Tabel properti hasil ekstraksi: nama, kategori (properti tangan, set dressing, kostum, kendaraan, tata rias, efek khusus, hewan), jumlah, adegan terkait | Tinggi |
| PROP-02 | Filter berdasarkan kategori, adegan, dan karakter; pencarian teks | Tinggi |
| PROP-03 | Tambah, ubah, dan hapus item secara manual | Tinggi |
| PROP-04 | Status pengadaan per item (belum, sewa, beli, buat, tersedia) | Sedang |
| PROP-05 | Tampilan agregat (gabungan seluruh adegan) dan per adegan | Sedang |
| PROP-06 | Ekspor ke PDF/Excel | Sedang |

#### 5.4.2 Jadwal Syuting

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| JDW-01 | Sistem menyusun *stripboard* otomatis: pengelompokan adegan berdasarkan lokasi, INT/EXT, dan siang/malam | Tinggi |
| JDW-02 | Estimasi durasi syuting per adegan (berdasarkan panjang halaman dan kompleksitas) | Tinggi |
| JDW-03 | Pengguna menentukan tanggal mulai, jam kerja per hari, dan hari libur | Tinggi |
| JDW-04 | Tampilan kalender dan tampilan daftar per hari syuting | Tinggi |
| JDW-05 | Pertimbangan ketersediaan pemeran (opsional input) saat menyusun jadwal | Sedang |
| JDW-06 | Pengguna dapat memindahkan adegan antar hari (drag and drop); total biaya diperbarui otomatis | Sedang |
| JDW-07 | Ekspor *call sheet* sederhana ke PDF | Rendah |

#### 5.4.3 Rincian Biaya (Estimasi Anggaran)

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| BYA-01 | Estimasi biaya per kategori: kru, pemeran, properti dan kostum, lokasi, peralatan, transportasi, konsumsi, perizinan, pascaproduksi, kontingensi | Tinggi |
| BYA-02 | Setiap baris biaya menampilkan volume, satuan, harga satuan, dan subtotal | Tinggi |
| BYA-03 | Harga satuan awal dari tabel referensi (rate card) yang dapat disesuaikan pengguna | Tinggi |
| BYA-04 | **Real-time**: setiap perubahan properti, jadwal, atau asumsi harga langsung menghitung ulang total tanpa memuat ulang halaman | Tinggi |
| BYA-05 | Pengaturan persentase kontingensi dan pajak | Sedang |
| BYA-06 | Grafik distribusi anggaran (pie/bar) dan ringkasan total | Sedang |
| BYA-07 | Perbandingan estimasi antar versi naskah | Sedang |
| BYA-08 | Ekspor ke Excel dan PDF | Tinggi |
| BYA-09 | Penjelasan singkat dari AI untuk asumsi utama ("mengapa estimasi ini") | Rendah |

### 5.5 Riwayat (History)

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| HIS-01 | Daftar seluruh naskah: judul, jenis, tanggal unggah, jumlah versi, status, total estimasi terakhir | Tinggi |
| HIS-02 | Pencarian, filter (jenis produksi, status, rentang tanggal), dan pengurutan | Sedang |
| HIS-03 | Buka detail naskah dan seluruh riwayat versinya | Tinggi |
| HIS-04 | Jadikan versi lama sebagai versi aktif | Sedang |
| HIS-05 | Bandingkan dua versi (selisih adegan, properti, dan biaya) | Rendah |
| HIS-06 | Hapus naskah (konfirmasi dua langkah) dan arsipkan | Sedang |

### 5.6 Profil

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| PRF-01 | Lihat dan ubah nama, foto profil, peran/jabatan, dan nama rumah produksi | Sedang |
| PRF-02 | Ubah kata sandi | Sedang |
| PRF-03 | Preferensi default: mata uang, kota produksi, jam kerja standar, persentase kontingensi | Sedang |
| PRF-04 | Hapus akun beserta seluruh data | Rendah |

### 5.7 Logout

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| OUT-01 | Tombol **Keluar** pada sidebar/menu pengguna; dialog konfirmasi singkat | Tinggi |
| OUT-02 | Sesi dihapus dan pengguna diarahkan ke halaman login | Tinggi |

### 5.8 Panel Admin

Admin adalah role terpisah yang mengelola sistem, bukan memproduksi naskah. Panel admin berada di rute `/admin` dengan sidebar sendiri: Beranda Admin, Data User, Data Properti, Profil, dan Keluar (fungsi Profil dan Keluar sama seperti pada pengguna biasa). Secara default admin **tidak dapat membaca isi naskah** pengguna; admin hanya melihat metadata dan data agregat demi menjaga kerahasiaan naskah.

#### 5.8.1 Beranda Admin

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| ADM-HOME-01 | Kartu statistik: total user, user aktif 30 hari terakhir, total naskah, total properti terekstraksi | Tinggi |
| ADM-HOME-02 | Kartu status pemrosesan: naskah berhasil, sedang diproses, dan gagal (dengan tautan ke daftar gagal) | Tinggi |
| ADM-HOME-03 | Grafik pertumbuhan user baru per bulan dan jumlah naskah diunggah per minggu | Sedang |
| ADM-HOME-04 | Ringkasan penggunaan AI: jumlah panggilan Gemini, total token, rata-rata latensi, dan jumlah galat | Sedang |
| ADM-HOME-05 | Daftar 5 properti paling sering muncul dan 5 aktivitas admin terbaru (audit log) | Rendah |

#### 5.8.2 Data User

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| ADM-USR-01 | Tabel seluruh user: nama, email, role, status (aktif/nonaktif), tanggal daftar, login terakhir, jumlah naskah | Tinggi |
| ADM-USR-02 | Pencarian (nama/email), filter (role, status, rentang tanggal daftar), pengurutan, dan paginasi | Tinggi |
| ADM-USR-03 | Halaman detail user: profil, jumlah naskah dan versi, total penggunaan AI; tanpa akses isi naskah | Sedang |
| ADM-USR-04 | Aktifkan atau nonaktifkan akun; user nonaktif tidak dapat login | Tinggi |
| ADM-USR-05 | Ubah role user menjadi admin atau sebaliknya, dengan konfirmasi; admin tidak dapat menurunkan role dirinya sendiri | Tinggi |
| ADM-USR-06 | Kirim ulang verifikasi email atau tautan reset kata sandi ke user | Sedang |
| ADM-USR-07 | Tambah admin baru melalui undangan email | Sedang |
| ADM-USR-08 | Hapus akun user beserta datanya (konfirmasi dua langkah) | Rendah |
| ADM-USR-09 | Ekspor daftar user ke CSV/Excel | Rendah |
| ADM-USR-10 | Setiap tindakan admin dicatat pada audit log | Tinggi |

#### 5.8.3 Data Properti

Halaman ini memiliki dua tab: **Katalog Master** (data yang dikelola admin) dan **Properti Terekstraksi** (pemantauan hasil AI dari seluruh naskah).

| ID | Kebutuhan | Prioritas |
| --- | --- | --- |
| ADM-PRP-01 | Katalog Master: tabel properti baku dengan nama, kategori, satuan, rentang harga referensi (min-maks), dan status aktif | Tinggi |
| ADM-PRP-02 | Tambah, ubah, nonaktifkan, dan hapus item katalog | Tinggi |
| ADM-PRP-03 | Kolom alias (sinonim) per item, dipakai pada normalisasi hasil LLM NER (misal "hape" dan "ponsel" menjadi satu item) | Sedang |
| ADM-PRP-04 | Harga referensi katalog menjadi sumber default rate card global yang dipakai Rincian Biaya; perubahan harga berlaku untuk analisis baru, bukan untuk naskah yang sudah dikonfirmasi | Tinggi |
| ADM-PRP-05 | Impor katalog dari CSV/Excel dan ekspor katalog | Sedang |
| ADM-PRP-06 | Properti Terekstraksi: daftar agregat nama properti dari semua naskah, frekuensi kemunculan, dan kategori, tanpa menampilkan teks naskah | Sedang |
| ADM-PRP-07 | Properti yang belum ada di katalog ditandai "belum terdaftar"; admin dapat menambahkannya ke katalog atau menggabungkannya sebagai alias dengan satu klik | Sedang |
| ADM-PRP-08 | Filter berdasarkan kategori, status katalog, dan pencarian teks | Sedang |
| ADM-PRP-09 | Perubahan katalog dicatat pada audit log | Tinggi |

#### 5.8.4 Aturan Akses Admin

- Halaman `/admin` dan seluruh API admin diproteksi middleware Next.js serta pengecekan role di server; RLS Supabase menolak akses admin dari klien biasa.
- Operasi sensitif (ubah role, hapus user) hanya dijalankan lewat Route Handler dengan service role key yang tidak pernah terekspos ke klien.
- Admin tidak memiliki akses baca ke tabel `script_versions.raw_text` maupun berkas naskah pada Storage.

## 6. Rancangan Pipeline AI

### 6.1 Model

- **Gemini 2.0 Flash** (atau yang lebih baru) sebagai model utama melalui Google AI SDK.
- Catatan: Gemini 1.5 Flash sudah memasuki masa pensiun pada layanan Google; disarankan menyimpan nama model pada variabel lingkungan (`GEMINI_MODEL`) agar mudah diganti tanpa mengubah kode.
- Seluruh pemanggilan AI dilakukan **di sisi server** (Next.js Route Handler/Server Action); kunci API tidak pernah terekspos ke klien.

### 6.2 Alur Pemrosesan

1. **Ekstraksi teks**: PDF/DOCX diubah menjadi teks mentah.
2. **Segmentasi adegan**: pemisahan berbasis aturan (regex heading adegan) dengan cadangan LLM bila format tidak baku.
3. **LLM NER per adegan**: setiap adegan dikirim ke Gemini dengan *prompt* terstruktur dan *response schema* JSON untuk mengekstrak entitas.
4. **Normalisasi dan deduplikasi**: penyatuan variasi nama (misal "Pak Budi" dan "Budi"), penggabungan item serupa.
5. **Estimasi kompleksitas dan durasi**: LLM menilai kompleksitas adegan (jumlah figuran, efek, stunt, cuaca) dan memperkirakan durasi.
6. **Penghitungan biaya**: dilakukan oleh **mesin aturan deterministik** (rate card x volume), bukan oleh LLM, agar angka dapat dipertanggungjawabkan; LLM hanya memberi saran asumsi.
7. **Penyimpanan hasil** ke database dan notifikasi ke klien.

### 6.3 Skema Entitas NER

| Label Entitas | Contoh |
| --- | --- |
| SCENE\_HEADING | INT. RUMAH SAKIT - MALAM |
| LOCATION | Rumah sakit, pasar tradisional |
| CHARACTER | Rani, Pak Budi |
| EXTRA | 50 pengunjung pasar |
| PROP | Pisau dapur, ponsel, koper |
| COSTUME | Seragam polisi, kebaya |
| VEHICLE | Mobil sedan hitam |
| ANIMAL | Anjing |
| SPECIAL\_FX | Ledakan, asap, hujan buatan |
| STUNT | Kejar-kejaran, jatuh dari tangga |
| TIME\_OF\_DAY | Malam, subuh |
| SOUND\_MUSIC | Lagu daerah, sirene |

### 6.4 Contoh Format Keluaran (JSON per adegan)

```json
{
  "scene_number": 12,
  "heading": "INT. RUMAH SAKIT - MALAM",
  "int_ext": "INT",
  "time_of_day": "MALAM",
  "location": "Rumah sakit",
  "characters": ["Rani", "Dokter Andi"],
  "extras": [{"description": "pasien", "count": 10}],
  "props": [{"name": "infus", "qty": 1}],
  "costumes": ["snelli dokter"],
  "special_fx": [],
  "stunts": [],
  "page_length_eighths": 14,
  "complexity": "sedang"
}
```

### 6.5 Praktik Prompting dan Keandalan

- Menggunakan *structured output* (JSON schema) dan suhu rendah (0 sampai 0,2) untuk hasil konsisten.
- Few-shot example dengan naskah berbahasa Indonesia dan campuran Inggris.
- Validasi hasil terhadap skema (misal Zod); bila gagal, ulangi maksimal 2 kali.
- Pemrosesan adegan secara paralel dengan pembatasan konkurensi dan *retry with backoff* untuk menangani batas kuota.
- Seluruh hasil AI dapat dikoreksi pengguna (human-in-the-loop).

## 7. Kebutuhan Non-Fungsional

| Aspek | Persyaratan |
| --- | --- |
| **Performa** | Halaman utama dimuat di bawah 2 detik; perhitungan ulang biaya di bawah 500 ms |
| **Real-time** | Status pemrosesan dan total biaya diperbarui melalui Supabase Realtime |
| **Keamanan** | Row Level Security (RLS) pada semua tabel; data antar pengguna terisolasi, akses panel admin hanya untuk role admin yang diverifikasi di server; HTTPS; kunci API hanya di server |
| **Privasi** | Naskah bersifat rahasia; tidak dibagikan ke pihak lain; pengguna dapat menghapus data permanen; perlu pernyataan penggunaan data pada kebijakan privasi (termasuk penggunaan API Gemini) |
| **Skalabilitas** | Pemrosesan naskah berjalan asinkron (antrean/background job) |
| **Ketersediaan** | Mengikuti SLA platform hosting dan Supabase |
| **Aksesibilitas** | Kontras warna memadai, navigasi keyboard, label ARIA |
| **Responsif** | Optimal di desktop, dapat digunakan di tablet dan ponsel |
| **Bahasa** | Antarmuka Bahasa Indonesia; dukungan naskah Indonesia dan Inggris |

## 8. Arsitektur dan Teknologi

| Lapisan | Teknologi |
| --- | --- |
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| State dan data fetching | TanStack Query atau Server Components |
| Backend | Next.js Route Handlers / Server Actions |
| Database | Supabase PostgreSQL |
| Autentikasi | Supabase Auth |
| Penyimpanan berkas | Supabase Storage (bucket privat untuk naskah) |
| Real-time | Supabase Realtime |
| AI | Google Gemini Flash (Google AI SDK) |
| Validasi | Zod |
| Ekspor | react-pdf / pdf-lib, ExcelJS |
| Visualisasi | Recharts |
| Hosting | Vercel |

### 8.1 Alur Tingkat Tinggi

1. Pengguna mengunggah naskah, berkas masuk ke Supabase Storage dan baris `scripts` serta `script_versions` dibuat dengan status `queued`.
2. Route Handler memulai pemrosesan: ekstraksi teks, segmentasi, lalu panggilan Gemini per adegan.
3. Hasil disimpan ke tabel `scenes`, `entities`, `props`, dan `schedule_items`; status diperbarui menjadi `processing` lalu `completed`.
4. Klien berlangganan Supabase Realtime untuk memperbarui progres dan total biaya.
5. Perubahan manual oleh pengguna memicu perhitungan ulang biaya di server dan disiarkan ke klien.

### 8.2 Diagram Arsitektur Sistem

&#91;embedded content: arsitektur sistem · 3 lapisan\]

Browser hanya berbicara dengan Next.js dan Supabase Realtime; pemanggilan Gemini dan operasi berhak tinggi dijalankan eksklusif oleh Route Handlers di server.

### 8.3 Alur Autentikasi dan Akses Berbasis Role

&#91;embedded content: alur autentikasi dan role · 3 keputusan\]

Middleware Next.js memeriksa sesi pada setiap permintaan; user yang membuka rute /admin menerima respons 403, dan registrasi publik tidak pernah menghasilkan role admin.

### 8.4 Flowchart Pipeline Script Breakdown

&#91;embedded content: pipeline script breakdown · 11 langkah, 1 validasi\]

Alur dibaca zig-zag: baris atas dari kiri ke kanan, baris tengah dari kanan ke kiri, baris bawah kembali ke kanan. Keluaran LLM yang tidak lolos validasi skema diulang, sedangkan perhitungan biaya memakai rate card dan volume tanpa melibatkan LLM.

### 8.5 Workflow Pengguna End-to-End

&#91;embedded content: workflow pengguna end-to-end · 10 langkah dan 1 loop revisi\]

Alur dibaca zig-zag seperti pipeline sebelumnya; garis di sisi kiri dan atas menunjukkan revisi naskah yang diunggah dari Riwayat dan masuk lagi ke Studio Naskah sebagai versi baru.

### 8.6 Alur Pembaruan Biaya Real-Time

&#91;embedded content: diagram urutan · pembaruan biaya real-time, 7 pesan\]

Perhitungan biaya selalu dijalankan di server (langkah 3) dengan rate card dan volume terbaru; browser hanya menerima total baru lewat Supabase Realtime sehingga halaman tidak perlu dimuat ulang. Target waktu hitung ulang di bawah 500 ms, sesuai bagian kebutuhan non-fungsional.

### 8.7 Workflow Admin

&#91;embedded content: workflow admin · 2 jalur kerja menuju audit log\]

Admin bekerja di dua jalur: mengelola akun di Data User dan merawat data master di Data Properti; semua perubahan harga referensi hanya berlaku untuk analisis baru, bukan naskah yang sudah dikonfirmasi.

## 9. Rancangan Basis Data (Supabase PostgreSQL)

| Tabel | Kolom Utama |
| --- | --- |
| `profiles` | id (FK auth.users), full\_name, avatar\_url, role\_title, company\_name, default\_currency, default\_contingency\_pct, role (user/admin), is\_active, last\_login\_at, created\_at |
| `scripts` | id, user\_id, title, production\_type, genre, main\_location, active\_version\_id, status, created\_at |
| `script_versions` | id, script\_id, version\_no, file\_path, raw\_text, page\_count, status, error\_message, created\_at |
| `scenes` | id, version\_id, scene\_no, heading, int\_ext, time\_of\_day, location\_id, summary, page\_eighths, complexity, est\_duration\_min |
| `entities` | id, scene\_id, type (enum label NER), name, quantity, notes, source (ai/manual) |
| `props` | id, version\_id, name, category, quantity, procurement\_status, scene\_ids |
| `locations` | id, version\_id, name, address, permit\_required |
| `shooting_days` | id, version\_id, day\_no, shoot\_date, call\_time, wrap\_time, location\_id |
| `schedule_items` | id, shooting\_day\_id, scene\_id, order\_no, est\_duration\_min |
| `rate_cards` | id, user\_id (nullable untuk default global), category, item\_name, unit, unit\_price, currency |
| `budget_lines` | id, version\_id, category, description, qty, unit, unit\_price, subtotal, source (auto/manual) |
| `budget_settings` | version\_id, contingency\_pct, tax\_pct, currency |
| `ai_jobs` | id, version\_id, step, status, tokens\_used, latency\_ms, error |
| property\_master | id, name, category, aliases (array sinonim untuk normalisasi NER), default\_unit, ref\_price\_min, ref\_price\_max, procurement\_default, is\_active, created\_by, updated\_at |
| admin\_audit\_logs | id, admin\_id, action (ubah role, nonaktifkan user, ubah katalog, dan sebagainya), target\_type, target\_id, detail\_json, created\_at |

**Keamanan:** seluruh tabel memakai RLS dengan kebijakan `user_id = auth.uid()` (langsung atau melalui relasi). Bucket penyimpanan naskah bersifat privat.

### 9.1 Diagram Relasi Entitas (ERD)

&#91;embedded content: diagram relasi entitas · 15 tabel utama\]

Hasil analisis seperti adegan, properti, jadwal, dan biaya disimpan per versi naskah sehingga revisi tidak menimpa data lama; schedule\_items juga merujuk ke scenes lewat scene\_id.

## 10. Alur Pengguna Utama

1. **Registrasi dan login** menuju Beranda.
2. Klik **Studio Naskah**, isi metadata, lalu **Unggah & Analisis Naskah**.
3. Pantau progres analisis, lalu tinjau dan koreksi hasil ekstraksi.
4. Konfirmasi; sistem membuat daftar properti, jadwal, dan biaya.
5. Buka **Kebutuhan Produksi** untuk menyesuaikan properti, jadwal, dan harga; total biaya berubah real-time.
6. Ekspor laporan PDF/Excel.
7. Unggah revisi naskah sebagai versi baru dan bandingkan di **Riwayat**.

**Alur admin:** login, masuk Beranda Admin, memantau statistik, meninjau atau menonaktifkan akun di Data User, lalu memperbarui katalog dan harga referensi di Data Properti.

## 11. Panduan Antarmuka (UI/UX)

- Gaya visual elegan dan profesional bernuansa industri film: dominan gelap atau netral hangat dengan satu warna aksen (misal emas atau merah marun), tipografi serif untuk judul dan sans-serif untuk isi.
- Tata letak: sidebar kiri dengan menu, bilah atas dengan pemilih naskah aktif dan menu pengguna.
- Mode terang dan gelap.
- Status kosong (empty state) yang informatif dan ajakan bertindak jelas.
- Warna entitas konsisten di seluruh sistem (properti, karakter, lokasi, dan sebagainya).
- Umpan balik instan: *skeleton loading*, toast notifikasi, dan indikator progres analisis.

## 12. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Halusinasi atau kesalahan ekstraksi LLM | Data properti dan biaya keliru | Schema validation, koreksi manual, perhitungan biaya deterministik |
| Format naskah tidak baku | Segmentasi adegan gagal | Segmentasi aturan plus cadangan LLM, editor manual |
| Batas kuota dan latensi API Gemini | Pemrosesan lambat atau gagal | Antrean, retry dengan backoff, pemrosesan batch per adegan |
| Kerahasiaan naskah | Kebocoran data | RLS, bucket privat, kebijakan privasi, tanpa log isi naskah |
| Harga referensi tidak akurat | Estimasi menyimpang | Rate card dapat diubah, label "estimasi awal", rentang min-maks |
| Model Gemini dipensiunkan | Layanan terhenti | Nama model via konfigurasi, uji regresi saat migrasi |
| Naskah sangat panjang | Biaya token tinggi | Pemrosesan per adegan, cache hasil, batas halaman |

## 13. Rencana Rilis

| Fase | Cakupan | Perkiraan |
| --- | --- | --- |
| **Fase 1** | Setup proyek, desain UI, autentikasi, profil, logout | Minggu 1-2 |
| **Fase 2** | Studio Naskah: unggah, ekstraksi teks, segmentasi adegan | Minggu 3-4 |
| **Fase 3** | Integrasi Gemini dan LLM NER, koreksi hasil | Minggu 5-6 |
| **Fase 4** | Kebutuhan Properti, Jadwal Syuting, Rincian Biaya real-time | Minggu 7-9 |
| **Fase 5** | Riwayat dan versi, ekspor PDF/Excel, Beranda | Minggu 10-11 |
| Fase 6 | Panel Admin: beranda admin, data user, data properti (katalog master), kontrol akses berbasis role | Minggu 12-13 |
| **Fase 7** | Pengujian (akurasi NER, UAT), perbaikan, deployment | Minggu 14 |

## 14. Rencana Pengujian dan Evaluasi

- **Dataset uji**: minimal 10 naskah (pendek hingga panjang) dengan *ground truth* breakdown manual.
- **Evaluasi NER**: precision, recall, dan F1 per jenis entitas.
- **Evaluasi biaya**: selisih estimasi sistem dengan RAB manual (MAPE).
- **Pengujian fungsional**: unit test, integrasi, dan end-to-end (Playwright).
- **Pengujian keamanan**: verifikasi RLS dan akses lintas pengguna.
- **UAT** dengan minimal 5 praktisi produksi atau mahasiswa perfilman.

## 15. Pertanyaan Terbuka

1. Apakah rate card default mengacu pada standar harga wilayah tertentu (misal Surabaya/Jawa Timur atau nasional)?
2. Apakah dibutuhkan peran pengguna lebih dari satu (admin, produser, kru) pada versi awal?
3. Apakah ekspor harus mengikuti format baku tertentu (misal format RAB institusi/kampus)?
4. Apakah naskah berbahasa daerah perlu didukung?
5. Apakah ada batas jumlah naskah atau halaman per pengguna?

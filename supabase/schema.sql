-- =====================================================================
-- ScriptFlow AI — Skema Supabase PostgreSQL (sesuai PRD v1.0, bagian 9)
-- Jalankan seluruh file ini di Supabase > SQL Editor. Aman dijalankan ulang.
-- =====================================================================
create extension if not exists pgcrypto;

-- Tabel rate_cards versi lama (kolom sub_kategori) diganti skema PRD.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'rate_cards' and column_name = 'sub_kategori') then
    drop table public.rate_cards cascade;
  end if;
end $$;

-- ---------- ENUM ----------
do $$ begin create type public.user_role as enum ('user', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin create type public.entity_type as enum (
  'SCENE_HEADING','LOCATION','CHARACTER','EXTRA','PROP','COSTUME','VEHICLE',
  'ANIMAL','SPECIAL_FX','STUNT','TIME_OF_DAY','SOUND_MUSIC');
exception when duplicate_object then null; end $$;

-- ---------- TABEL ----------
create table if not exists public.profiles (
  id                      uuid primary key references auth.users(id) on delete cascade,
  full_name               text,
  avatar_url              text,
  role_title              text,
  company_name            text,
  default_currency        text not null default 'IDR',
  default_city            text,
  default_work_hours      int  not null default 10 check (default_work_hours between 1 and 24),
  default_contingency_pct numeric(5,2) not null default 10 check (default_contingency_pct between 0 and 100),
  role                    public.user_role not null default 'user',
  is_active               boolean not null default true,
  last_login_at           timestamptz,
  created_at              timestamptz not null default now()
);

create table if not exists public.scripts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  title             text not null,
  production_type   text not null default 'film' check (production_type in ('film','serial','iklan','konten')),
  genre             text,
  main_location     text,
  currency          text not null default 'IDR',
  active_version_id uuid,
  status            text not null default 'queued'
                    check (status in ('queued','processing','completed','failed','archived')),
  created_at        timestamptz not null default now()
);
create index if not exists scripts_user_idx on public.scripts(user_id, created_at desc);

create table if not exists public.script_versions (
  id              uuid primary key default gen_random_uuid(),
  script_id       uuid not null references public.scripts(id) on delete cascade,
  version_no      int  not null,
  file_path       text,
  file_name       text,
  raw_text        text,
  page_count      int,
  status          text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  current_step    text,
  progress        int  not null default 0 check (progress between 0 and 100),
  error_message   text,
  confirmed       boolean not null default false,
  schedule_config jsonb not null default '{}'::jsonb,   -- {start_date, hours_per_day, holidays[]}
  total_estimate  numeric(16,2) not null default 0,     -- cache total biaya terbaru (HIS-01, HOME-02)
  created_at      timestamptz not null default now(),
  unique (script_id, version_no)
);

do $$ begin
  alter table public.scripts add constraint scripts_active_version_fk
    foreign key (active_version_id) references public.script_versions(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.locations (
  id              uuid primary key default gen_random_uuid(),
  version_id      uuid not null references public.script_versions(id) on delete cascade,
  name            text not null,
  address         text,
  permit_required boolean not null default false
);
create index if not exists locations_version_idx on public.locations(version_id);

create table if not exists public.scenes (
  id               uuid primary key default gen_random_uuid(),
  version_id       uuid not null references public.script_versions(id) on delete cascade,
  scene_no         int  not null,
  heading          text,
  int_ext          text check (int_ext in ('INT','EXT','INT/EXT')),
  time_of_day      text,
  location_id      uuid references public.locations(id) on delete set null,
  summary          text,
  body             text,                                 -- teks adegan (pratinjau/sorotan, STD-06)
  page_eighths     int  not null default 8 check (page_eighths > 0),
  complexity       text not null default 'sedang' check (complexity in ('rendah','sedang','tinggi')),
  est_duration_min int  not null default 60,
  unique (version_id, scene_no)
);

create table if not exists public.entities (
  id        uuid primary key default gen_random_uuid(),
  scene_id  uuid not null references public.scenes(id) on delete cascade,
  type      public.entity_type not null,
  name      text not null,
  quantity  int  not null default 1 check (quantity >= 1),
  category  text,                                       -- sub-kategori properti (opsional)
  notes     text,
  source    text not null default 'ai' check (source in ('ai','manual'))
);
create index if not exists entities_scene_idx on public.entities(scene_id);

create table if not exists public.property_master (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  category            text not null check (category in
                      ('properti_tangan','set_dressing','kostum','kendaraan','tata_rias','efek_khusus','hewan')),
  aliases             text[] not null default '{}',
  default_unit        text not null default 'item',
  ref_price_min       numeric(14,2) not null default 0 check (ref_price_min >= 0),
  ref_price_max       numeric(14,2) not null default 0 check (ref_price_max >= ref_price_min),
  procurement_default text not null default 'belum'
                      check (procurement_default in ('belum','sewa','beli','buat','tersedia')),
  is_active           boolean not null default true,
  created_by          uuid references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now()
);
create unique index if not exists property_master_name_uq on public.property_master (lower(name));

create table if not exists public.props (
  id                 uuid primary key default gen_random_uuid(),
  version_id         uuid not null references public.script_versions(id) on delete cascade,
  name               text not null,
  category           text not null default 'properti_tangan' check (category in
                     ('properti_tangan','set_dressing','kostum','kendaraan','tata_rias','efek_khusus','hewan')),
  quantity           int  not null default 1 check (quantity >= 1),
  procurement_status text not null default 'belum'
                     check (procurement_status in ('belum','sewa','beli','buat','tersedia')),
  scene_ids          uuid[] not null default '{}',
  property_master_id uuid references public.property_master(id) on delete set null,
  source             text not null default 'ai' check (source in ('ai','manual'))
);
create index if not exists props_version_idx on public.props(version_id);

create table if not exists public.shooting_days (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.script_versions(id) on delete cascade,
  day_no      int  not null,
  shoot_date  date,
  call_time   time not null default '07:00',
  wrap_time   time,
  location_id uuid references public.locations(id) on delete set null,
  unique (version_id, day_no)
);

create table if not exists public.schedule_items (
  id               uuid primary key default gen_random_uuid(),
  shooting_day_id  uuid not null references public.shooting_days(id) on delete cascade,
  scene_id         uuid not null references public.scenes(id) on delete cascade,
  order_no         int  not null,
  est_duration_min int  not null default 60,
  unique (scene_id)
);
create index if not exists schedule_items_day_idx on public.schedule_items(shooting_day_id, order_no);

-- user_id NULL = rate card default global (dikelola admin); user_id terisi = override milik pengguna
create table if not exists public.rate_cards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  code       text not null,                              -- kunci pencocokan mesin biaya
  category   text not null check (category in
             ('kru','pemeran','properti_kostum','lokasi','peralatan','transportasi',
              'konsumsi','perizinan','pascaproduksi')),
  item_name  text not null,
  unit       text not null,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  currency   text not null default 'IDR'
);
create unique index if not exists rate_cards_code_uq
  on public.rate_cards (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
-- Diperlukan untuk upsert override per pengguna (onConflict: user_id,code)
create unique index if not exists rate_cards_user_code_uq on public.rate_cards (user_id, code);

create table if not exists public.budget_lines (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.script_versions(id) on delete cascade,
  category      text not null check (category in
                ('kru','pemeran','properti_kostum','lokasi','peralatan','transportasi',
                 'konsumsi','perizinan','pascaproduksi')),
  description   text not null,
  qty           numeric(14,2) not null default 1 check (qty >= 0),
  unit          text not null default 'item',
  unit_price    numeric(14,2) not null default 0 check (unit_price >= 0),
  subtotal      numeric(16,2) generated always as (qty * unit_price) stored,
  source        text not null default 'auto' check (source in ('auto','manual')),
  ref_key       text,                                   -- kunci idempotensi hitung ulang
  rate_card_id  uuid references public.rate_cards(id) on delete set null
);
create index if not exists budget_lines_version_idx on public.budget_lines(version_id);

create table if not exists public.budget_settings (
  version_id     uuid primary key references public.script_versions(id) on delete cascade,
  contingency_pct numeric(5,2) not null default 10 check (contingency_pct between 0 and 100),
  tax_pct        numeric(5,2) not null default 0  check (tax_pct between 0 and 100),
  currency       text not null default 'IDR'
);

create table if not exists public.ai_jobs (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.script_versions(id) on delete cascade,
  step        text not null,
  status      text not null check (status in ('running','completed','failed')),
  tokens_used int,
  latency_ms  int,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists ai_jobs_version_idx on public.ai_jobs(version_id, created_at);

create table if not exists public.admin_audit_logs (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  detail_json jsonb,
  created_at  timestamptz not null default now()
);

-- ---------- FUNGSI BANTU (SECURITY DEFINER agar RLS tidak rekursif) ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active);
$$;

create or replace function public.owns_script(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.scripts where id = sid and user_id = auth.uid());
$$;

create or replace function public.owns_version(vid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.script_versions v join public.scripts s on s.id = v.script_id
                 where v.id = vid and s.user_id = auth.uid());
$$;

create or replace function public.owns_scene(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.scenes sc where sc.id = sid and public.owns_version(sc.version_id));
$$;

create or replace function public.owns_day(did uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.shooting_days d where d.id = did and public.owns_version(d.version_id));
$$;

-- ---------- TRIGGER ----------
-- Registrasi publik SELALU menghasilkan role 'user' (AUTH-08); metadata role diabaikan.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url, role)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          new.raw_user_meta_data->>'avatar_url',
          'user')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Hanya admin (atau service role) yang boleh mengubah role / is_active.
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Tidak berwenang mengubah role atau status akun';
  end if;
  return new;
end $$;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns before update on public.profiles
  for each row execute function public.protect_profile_columns();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists property_master_touch on public.property_master;
create trigger property_master_touch before update on public.property_master
  for each row execute function public.touch_updated_at();

-- ---------- ROW LEVEL SECURITY ----------
alter table public.profiles         enable row level security;
alter table public.scripts          enable row level security;
alter table public.script_versions  enable row level security;
alter table public.locations        enable row level security;
alter table public.scenes           enable row level security;
alter table public.entities         enable row level security;
alter table public.props            enable row level security;
alter table public.shooting_days    enable row level security;
alter table public.schedule_items   enable row level security;
alter table public.rate_cards       enable row level security;
alter table public.budget_lines     enable row level security;
alter table public.budget_settings  enable row level security;
alter table public.ai_jobs          enable row level security;
alter table public.property_master  enable row level security;
alter table public.admin_audit_logs enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- scripts & versi (admin TIDAK dapat membaca naskah pengguna — kerahasiaan)
drop policy if exists scripts_all on public.scripts;
create policy scripts_all on public.scripts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists versions_all on public.script_versions;
create policy versions_all on public.script_versions for all
  using (public.owns_script(script_id)) with check (public.owns_script(script_id));

-- tabel turunan per versi
do $$
declare t text;
begin
  foreach t in array array['locations','scenes','props','shooting_days','budget_lines','budget_settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('create policy %I on public.%I for all using (public.owns_version(version_id)) with check (public.owns_version(version_id))', t || '_all', t);
  end loop;
end $$;

drop policy if exists entities_all on public.entities;
create policy entities_all on public.entities for all
  using (public.owns_scene(scene_id)) with check (public.owns_scene(scene_id));

drop policy if exists schedule_items_all on public.schedule_items;
create policy schedule_items_all on public.schedule_items for all
  using (public.owns_day(shooting_day_id)) with check (public.owns_day(shooting_day_id));

drop policy if exists ai_jobs_select on public.ai_jobs;
create policy ai_jobs_select on public.ai_jobs for select using (public.owns_version(version_id));

-- rate_cards: baca default global + milik sendiri; tulis milik sendiri; admin kelola global
drop policy if exists rate_cards_select on public.rate_cards;
create policy rate_cards_select on public.rate_cards for select
  using (user_id is null or user_id = auth.uid() or public.is_admin());
drop policy if exists rate_cards_write_own on public.rate_cards;
create policy rate_cards_write_own on public.rate_cards for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists rate_cards_write_admin on public.rate_cards;
create policy rate_cards_write_admin on public.rate_cards for all
  using (public.is_admin()) with check (public.is_admin());

-- property_master: pengguna login membaca item aktif; admin kelola
drop policy if exists property_master_select on public.property_master;
create policy property_master_select on public.property_master for select
  using (auth.uid() is not null and (is_active or public.is_admin()));
drop policy if exists property_master_admin on public.property_master;
create policy property_master_admin on public.property_master for all
  using (public.is_admin()) with check (public.is_admin());

-- audit log: hanya admin
drop policy if exists audit_select on public.admin_audit_logs;
create policy audit_select on public.admin_audit_logs for select using (public.is_admin());
drop policy if exists audit_insert on public.admin_audit_logs;
create policy audit_insert on public.admin_audit_logs for insert
  with check (public.is_admin() and admin_id = auth.uid());

-- ---------- STORAGE (bucket privat untuk naskah) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('naskah', 'naskah', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

drop policy if exists naskah_select on storage.objects;
create policy naskah_select on storage.objects for select to authenticated
  using (bucket_id = 'naskah' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists naskah_insert on storage.objects;
create policy naskah_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'naskah' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists naskah_delete on storage.objects;
create policy naskah_delete on storage.objects for delete to authenticated
  using (bucket_id = 'naskah' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- REALTIME ----------
do $$
declare t text;
begin
  foreach t in array array['script_versions','budget_lines','budget_settings','shooting_days','schedule_items','props'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- SEED: RATE CARD DEFAULT GLOBAL (IDR, estimasi awal) ----------
insert into public.rate_cards (user_id, code, category, item_name, unit, unit_price) values
  (null,'kru_paket_harian',        'kru',             'Paket Kru Inti (sutradara, DOP, AD, sound, dll)', 'hari',      6000000),
  (null,'cast_utama',              'pemeran',         'Pemeran Utama',                                   'hari',      2500000),
  (null,'cast_pendukung',          'pemeran',         'Pemeran Pendukung',                               'hari',      1000000),
  (null,'cast_figuran',            'pemeran',         'Figuran',                                         'orang/hari', 150000),
  (null,'peralatan_kamera_paket',  'peralatan',       'Paket Kamera & Lensa',                            'hari',      3500000),
  (null,'peralatan_lighting_paket','peralatan',       'Paket Lighting & Grip',                           'hari',      2000000),
  (null,'peralatan_stunt',         'peralatan',       'Koordinator & Pengaman Stunt',                    'adegan',    4000000),
  (null,'prop_properti_tangan',    'properti_kostum', 'Properti Tangan',                                 'item',       100000),
  (null,'prop_set_dressing',       'properti_kostum', 'Set Dressing',                                    'item',       250000),
  (null,'prop_kostum',             'properti_kostum', 'Kostum',                                          'set',        200000),
  (null,'prop_kendaraan',          'properti_kostum', 'Sewa Kendaraan',                                  'hari',       750000),
  (null,'prop_tata_rias',          'properti_kostum', 'Tata Rias & Rambut',                              'paket',      150000),
  (null,'prop_efek_khusus',        'properti_kostum', 'Efek Khusus (SFX)',                               'item',      1000000),
  (null,'prop_hewan',              'properti_kostum', 'Sewa Hewan + Handler',                            'hari',       500000),
  (null,'lokasi_interior',         'lokasi',          'Sewa Lokasi Interior',                            'hari',      2000000),
  (null,'lokasi_eksterior',        'lokasi',          'Sewa Lokasi Eksterior',                           'hari',      1500000),
  (null,'perizinan_lokasi',        'perizinan',       'Izin Lokasi & Keamanan',                          'lokasi',     750000),
  (null,'transport_harian',        'transportasi',    'Transportasi Kru & Peralatan',                    'hari',      1200000),
  (null,'konsumsi_per_orang',      'konsumsi',        'Konsumsi (makan & minum)',                        'orang/hari',  60000),
  (null,'pascaproduksi_per_menit', 'pascaproduksi',   'Editing, Color & Sound (per menit hasil)',        'menit',     1500000)
on conflict do nothing;

-- ---------- SEED: KATALOG MASTER PROPERTI ----------
insert into public.property_master (name, category, aliases, default_unit, ref_price_min, ref_price_max, procurement_default) values
  ('Ponsel',              'properti_tangan','{hp,handphone,smartphone,telepon genggam}', 'item',   50000,  150000,'tersedia'),
  ('Koper',               'properti_tangan','{tas koper,travel bag}',                    'item',   75000,  200000,'sewa'),
  ('Pisau Dapur',         'properti_tangan','{pisau,golok kecil}',                       'item',   25000,  100000,'beli'),
  ('Senjata Api Replika', 'properti_tangan','{pistol,pistol replika,senjata,senapan}',   'item',  500000, 2500000,'sewa'),
  ('Infus',               'properti_tangan','{tiang infus,kantong infus}',               'set',    50000,  150000,'sewa'),
  ('Meja & Kursi Set',    'set_dressing',   '{meja makan,kursi,meja kursi}',             'set',   150000,  500000,'sewa'),
  ('Seragam Polisi',      'kostum',         '{baju polisi,seragam pol}',                 'set',   150000,  400000,'sewa'),
  ('Kebaya',              'kostum',         '{kebaya modern,kebaya tradisional}',        'set',   200000,  600000,'sewa'),
  ('Snelli Dokter',       'kostum',         '{jas dokter,jas putih,snelli}',             'set',    75000,  200000,'sewa'),
  ('Mobil Sedan Hitam',   'kendaraan',      '{mobil,sedan,mobil hitam}',                 'hari',  600000, 1500000,'sewa'),
  ('Sepeda Motor',        'kendaraan',      '{motor,sepeda motor}',                      'hari',  200000,  500000,'sewa'),
  ('Ledakan (SFX)',       'efek_khusus',    '{ledakan,bom,explosion}',                   'item', 2000000, 8000000,'buat'),
  ('Asap & Kabut',        'efek_khusus',    '{asap,kabut,smoke}',                        'item',  300000, 1000000,'sewa'),
  ('Hujan Buatan',        'efek_khusus',    '{hujan,rain machine}',                      'item', 1500000, 4000000,'sewa'),
  ('Anjing',              'hewan',          '{anjing peliharaan,dog}',                   'hari',  300000, 1000000,'sewa')
on conflict do nothing;

-- =====================================================================
-- AKUN ADMIN PERTAMA (AUTH-10): daftar dulu lewat aplikasi, lalu jalankan:
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'EMAIL_ADMIN_ANDA');
-- =====================================================================

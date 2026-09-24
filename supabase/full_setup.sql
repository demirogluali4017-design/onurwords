-- ============================================
-- QuizAnki (İngilizce sürüm) — TAM KURULUM
-- Yeni/boş bir Supabase projesinde SQL Editor'de
-- BİR KERE çalıştırın. Tüm tabloları, sütunları,
-- indeksleri ve RLS politikalarını tek seferde kurar.
-- (Bu dosya, orijinal quizanki projesindeki 7 ayrı
-- migration'ın birleştirilmiş/sadeleştirilmiş halidir.)
-- ============================================

create extension if not exists "uuid-ossp";

-- ============================================
-- 1) Ana kelime tablosu
-- ============================================
create table if not exists public.flashcards (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamp with time zone default now(),
  word text not null,
  preposition text,
  meaning text not null,
  example_sentence text,

  -- SM-2 aralıklı tekrar alanları
  repetitions integer not null default 0,
  interval integer not null default 1,
  ease_factor double precision not null default 2.5,
  next_review_date timestamp with time zone not null default now(),

  -- Öğrenme motoru / zayıf kelime takibi
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  struggle_count integer not null default 0,
  is_weak boolean not null default false,
  last_reviewed_at timestamp with time zone,

  -- SM-2 geçiş sistemi (öğrenme kutusu)
  in_learning_phase boolean not null default false,
  learning_streak integer not null default 0,

  -- Eş anlamlı grup bağlantısı (aşağıda tanımlanan word_groups'a işaret eder)
  group_id uuid
);

create index if not exists idx_flashcards_next_review_date
  on public.flashcards (next_review_date);
create index if not exists idx_flashcards_word
  on public.flashcards (word);
create index if not exists idx_flashcards_is_weak
  on public.flashcards (is_weak) where is_weak = true;
create index if not exists idx_flashcards_group_id
  on public.flashcards (group_id);

alter table public.flashcards enable row level security;

create policy "Herkes okuyabilir (flashcards)" on public.flashcards for select using (true);
create policy "Herkes güncelleyebilir (flashcards)" on public.flashcards for update using (true);
create policy "Herkes silebilir (flashcards)" on public.flashcards for delete using (true);

-- ============================================
-- 2) Eş anlamlı gruplar
-- ============================================
create table if not exists public.word_groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamp with time zone default now()
);

alter table public.flashcards
  add constraint flashcards_group_id_fkey
  foreign key (group_id) references public.word_groups(id) on delete set null;

alter table public.word_groups enable row level security;

create policy "Herkes okuyabilir (word_groups)" on public.word_groups for select using (true);
create policy "Herkes ekleyebilir (word_groups)" on public.word_groups for insert with check (true);
create policy "Herkes silebilir (word_groups)" on public.word_groups for delete using (true);

-- ============================================
-- 3) Test modu sonuçları
-- ============================================
create table if not exists public.test_results (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamp with time zone default now(),
  score integer not null,
  correct_count integer not null,
  total_questions integer not null,
  best_streak integer not null default 0
);

create index if not exists idx_test_results_created_at
  on public.test_results (created_at desc);

alter table public.test_results enable row level security;

create policy "Herkes okuyabilir (test_results)" on public.test_results for select using (true);
create policy "Herkes ekleyebilir (test_results)" on public.test_results for insert with check (true);

-- ============================================
-- 4) Eşleştir modu sonuçları
-- ============================================
create table if not exists public.match_results (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamp with time zone default now(),
  pairs_count integer not null,
  duration_ms integer not null,
  mistakes integer not null default 0
);

create index if not exists idx_match_results_created_at
  on public.match_results (created_at desc);

alter table public.match_results enable row level security;

create policy "Herkes okuyabilir (match_results)" on public.match_results for select using (true);
create policy "Herkes ekleyebilir (match_results)" on public.match_results for insert with check (true);

-- ============================================
-- 5) Günlük aktivite (streak) + genel ayarlar
-- ============================================
create table if not exists public.daily_activity (
  id uuid primary key default uuid_generate_v4(),
  activity_date date not null unique,
  reviews_done integer not null default 0,
  new_words_done integer not null default 0,
  created_at timestamp with time zone default now()
);

create index if not exists idx_daily_activity_date
  on public.daily_activity (activity_date desc);

alter table public.daily_activity enable row level security;

create policy "Herkes okuyabilir (daily_activity)" on public.daily_activity for select using (true);
create policy "Herkes ekleyebilir (daily_activity)" on public.daily_activity for insert with check (true);
create policy "Herkes güncelleyebilir (daily_activity)" on public.daily_activity for update using (true);

create table if not exists public.app_settings (
  id integer primary key default 1,
  daily_new_goal integer not null default 10,
  daily_review_goal integer not null default 30,
  learning_phase_threshold integer not null default 2,
  auto_promote_enabled boolean not null default true,
  updated_at timestamp with time zone default now(),
  constraint app_settings_singleton check (id = 1)
);

insert into public.app_settings (id) values (1) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

create policy "Herkes okuyabilir (app_settings)" on public.app_settings for select using (true);
create policy "Herkes güncelleyebilir (app_settings)" on public.app_settings for update using (true);

-- ============================================
-- KURULUM TAMAMLANDI
-- ============================================

alter table public.flashcards
  add column if not exists hint_word text;

alter table public.flashcards
  add column if not exists synonyms text;



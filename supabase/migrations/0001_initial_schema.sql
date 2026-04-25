-- Clean. — initial schema (T0.4)
-- Reference: docs/lld.md § Database Schema

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles
-- One row per Supabase auth user. Auto-created by handle_new_user trigger.
-- health_conditions: subset of {'diabetes','cholesterol','hypertension','obesity'}
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                uuid references auth.users(id) on delete cascade primary key,
  health_conditions text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint health_conditions_valid check (
    health_conditions <@ array['diabetes','cholesterol','hypertension','obesity']::text[]
  )
);

-- updated_at maintenance trigger
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- RLS: users can only read/write their own profile
alter table public.profiles enable row level security;

create policy "users manage own profile"
  on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- scan_history
-- One row per food-detail view by an authenticated user.
-- ---------------------------------------------------------------------------
create table public.scan_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  barcode      text,
  product_name text not null,
  brand        text,
  image_url    text,
  score        integer not null,
  scanned_at   timestamptz not null default now()
);

create index scan_history_user_scanned_at_idx
  on public.scan_history (user_id, scanned_at desc);

alter table public.scan_history enable row level security;

create policy "users manage own history"
  on public.scan_history
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- food_insights
-- AI body-impact summary cache. Keyed by (barcode, conditions_key).
-- conditions_key = sorted comma-joined conditions, "" for guest.
-- Shared across users => NO RLS.
-- ---------------------------------------------------------------------------
create table public.food_insights (
  barcode        text not null,
  conditions_key text not null,
  message        text not null,
  created_at     timestamptz not null default now(),
  primary key (barcode, conditions_key)
);

-- ---------------------------------------------------------------------------
-- food_cache
-- Open Food Facts product cache. 7-day TTL enforced in application code.
-- Public product data => NO RLS.
-- ---------------------------------------------------------------------------
create table public.food_cache (
  barcode    text primary key,
  data       jsonb not null,
  cached_at  timestamptz not null default now()
);

create index food_cache_cached_at_idx
  on public.food_cache (cached_at);

-- ---------------------------------------------------------------------------
-- handle_new_user trigger
-- Auto-creates a profiles row whenever a Supabase auth user is created.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

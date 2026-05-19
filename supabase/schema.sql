create extension if not exists pgcrypto;

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  youtube_channel_id text unique not null,
  title text not null,
  description text,
  thumbnail_url text,
  custom_url text,
  uploads_playlist_id text,
  added_at timestamptz default now(),
  last_checked_at timestamptz,
  hidden boolean default false
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  youtube_video_id text unique not null,
  youtube_channel_id text not null,
  title text not null,
  description text,
  thumbnail_url text,
  duration_seconds integer,
  published_at timestamptz,
  is_short boolean default false,
  fetched_at timestamptz default now()
);

create table if not exists public.watch_later (
  id uuid primary key default gen_random_uuid(),
  youtube_video_id text unique not null,
  added_at timestamptz default now()
);

create table if not exists public.watched_videos (
  youtube_video_id text primary key,
  watched_at timestamptz default now(),
  progress_seconds integer default 0,
  completed boolean default true
);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

create index if not exists channels_hidden_added_at_idx
  on public.channels (hidden, added_at desc);

create index if not exists videos_channel_published_idx
  on public.videos (youtube_channel_id, published_at desc);

create index if not exists videos_published_idx
  on public.videos (published_at desc);

create index if not exists videos_is_short_idx
  on public.videos (is_short);

create index if not exists watch_later_added_at_idx
  on public.watch_later (added_at desc);

create index if not exists watched_videos_watched_at_idx
  on public.watched_videos (watched_at desc);

alter table public.channels enable row level security;
alter table public.videos enable row level security;
alter table public.watch_later enable row level security;
alter table public.watched_videos enable row level security;
alter table public.settings enable row level security;

revoke all on public.channels from anon, authenticated;
revoke all on public.videos from anon, authenticated;
revoke all on public.watch_later from anon, authenticated;
revoke all on public.watched_videos from anon, authenticated;
revoke all on public.settings from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.channels to service_role;
grant select, insert, update, delete on public.videos to service_role;
grant select, insert, update, delete on public.watch_later to service_role;
grant select, insert, update, delete on public.watched_videos to service_role;
grant select, insert, update, delete on public.settings to service_role;

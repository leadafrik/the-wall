-- the wall: schema
create extension if not exists pgcrypto;

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  text        text not null check (char_length(text) <= 280 and char_length(text) >= 1),
  section     text not null check (section in ('venting','ideas','memory','things unsaid','confessions')),
  color       text not null,
  x           integer not null,
  y           integer not null,
  rotation    real not null,
  z_index     integer not null,
  created_at  timestamptz not null default now(),
  is_visible  boolean not null default true,
  ip_hash     text,
  flagged     boolean not null default false
);

create index if not exists notes_visible_created_idx on notes (is_visible, created_at desc);
create index if not exists notes_section_idx on notes (section);
create index if not exists notes_xy_idx on notes (x, y);
-- For the per-IP duplicate-within-an-hour guard in POST /api/notes.
create index if not exists notes_iphash_created_idx on notes (ip_hash, created_at desc);

-- Row Level Security: only allow public reads of visible notes via the anon key.
-- Writes go through the service role on the server (API route).
alter table notes enable row level security;

drop policy if exists "notes_public_read" on notes;
create policy "notes_public_read"
  on notes for select
  using (is_visible = true);

-- Realtime: enable replication on the notes table in the Supabase dashboard
-- (Database -> Replication -> add `notes` to supabase_realtime publication),
-- or run:
-- alter publication supabase_realtime add table notes;

-- Moderation log: written every time a submission is rejected by the pipeline.
-- Never log the note text — only the reason and length, to tune thresholds over time.
create table if not exists moderation_log (
  id          uuid primary key default gen_random_uuid(),
  reason      text not null,
  text_length integer not null,
  created_at  timestamptz not null default now()
);

create index if not exists moderation_log_reason_idx on moderation_log (reason, created_at desc);

alter table moderation_log enable row level security;
-- No policies = no anon access. Writes go through the service-role key.

-- Per-IP read rate limiting (anti-scraping). One row per (ip_hash, minute)
-- bucket. The incr_read_rate() function atomically inserts-or-increments
-- and returns the post-update hit count, which the API checks against the
-- per-minute limit in src/lib/read-rate-limit.ts.
create table if not exists read_rate (
  ip_hash text not null,
  bucket  bigint not null,         -- floor(epoch_ms / 60000)
  hits    integer not null default 1,
  primary key (ip_hash, bucket)
);
create index if not exists read_rate_bucket_idx on read_rate (bucket);

create or replace function incr_read_rate(p_ip_hash text, p_bucket bigint)
returns integer
language sql
as $$
  insert into read_rate (ip_hash, bucket, hits)
  values (p_ip_hash, p_bucket, 1)
  on conflict (ip_hash, bucket)
  do update set hits = read_rate.hits + 1
  returning hits;
$$;

alter table read_rate enable row level security;
-- No policies = no anon access. The function is called by the API via the
-- service role.

-- Optional cleanup: prune buckets older than a day. Either run this manually
-- once in a while or wire up pg_cron in the Supabase dashboard.
--   delete from read_rate where bucket < floor((extract(epoch from now()) * 1000 - 86400000) / 60000);

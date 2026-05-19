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

-- Scalable shuffle. Two strategies based on table size:
--   * Small tables (< 5k rows): plain `order by random()` — gives truly uniform
--     sampling and is cheap when the table fits comfortably in memory.
--   * Large tables: TABLESAMPLE SYSTEM_ROWS pulls a bounded number of rows from
--     random disk pages — O(table_pages_sampled), independent of total size.
--     We oversample 20× the limit and then shuffle/filter so the per-section
--     filter still has enough material.
--
-- Requires the standard `tsm_system_rows` extension (free, built into Postgres).
create extension if not exists tsm_system_rows;

create or replace function shuffle_notes(
  p_section text default null,
  p_limit   int default 200
)
returns setof notes
language plpgsql
stable
as $$
declare
  total bigint;
begin
  select count(*) into total from notes;

  if total < 5000 then
    return query
      select *
      from notes
      where is_visible = true
        and (p_section is null or section = p_section)
      order by random()
      limit p_limit;
  else
    return query
      select *
      from (
        select * from notes tablesample system_rows(p_limit * 20)
      ) s
      where s.is_visible = true
        and (p_section is null or s.section = p_section)
      order by random()
      limit p_limit;
  end if;
end;
$$;

-- Unique-visitor count over a time window, derived from rate-limit data
-- we already collect. No new tracking, no IPs in clear — just a count of
-- distinct hashed IPs that have hit the read endpoints since p_since_bucket.
-- p_since_bucket is a minute-bucket (floor(epoch_ms / 60000)). Capping to
-- a bigint and using count() keeps this cheap on the indexed bucket column.
create or replace function visitor_count(p_since_bucket bigint)
returns integer
language sql
stable
as $$
  select count(distinct ip_hash)::int
  from read_rate
  where bucket >= p_since_bucket;
$$;

-- Atomic placement: serialize the read-check-write sequence with an
-- advisory transaction lock so two simultaneous POSTs can't both pass
-- their overlap check against the same snapshot and then land on top of
-- each other.
--
-- The function takes a *proposed* (x, y) that the caller has already
-- screened against an in-memory snapshot. We re-check overlap against
-- the live table inside the lock. If clear, insert and return the row.
-- If overlapping (because a racing insert landed first), return NULL —
-- the caller refetches and tries again with a fresh placement.
create or replace function place_note(
  p_text      text,
  p_section   text,
  p_color     text,
  p_x         int,
  p_y         int,
  p_rotation  real,
  p_z_index   int,
  p_ip_hash   text,
  p_min_dx    int default 175,
  p_min_dy    int default 320
)
returns notes
language plpgsql
as $$
declare
  v_row notes;
begin
  -- 64-bit constant key — any stable integer works; this one is just a
  -- magic number so we don't collide with other advisory locks.
  perform pg_advisory_xact_lock(872913041);

  if exists (
    select 1
    from notes
    where is_visible = true
      and abs(x - p_x) < p_min_dx
      and abs(y - p_y) < p_min_dy
  ) then
    return null;
  end if;

  insert into notes (text, section, color, x, y, rotation, z_index, ip_hash, flagged)
  values (p_text, p_section, p_color, p_x, p_y, p_rotation, p_z_index, p_ip_hash, false)
  returning * into v_row;

  return v_row;
end;
$$;

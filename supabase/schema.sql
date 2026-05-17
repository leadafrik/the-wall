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

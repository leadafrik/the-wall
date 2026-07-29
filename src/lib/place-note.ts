// Server-side note placement + insertion — the write path shared by the
// public POST /api/notes and the admin "restore note" action.
//
// Scaling shape (built for the heaviest imaginable traffic):
//
//   * Correctness is enforced in the DB. place_note() and show_note()
//     (supabase/schema.sql) re-check overlap against the whole visible table
//     inside an advisory lock, so two notes can never end up overlapping no
//     matter what these helpers propose.
//
//   * Cost per write is bounded and flat. Instead of loading every visible
//     note (O(N) per write — untenable past ~1M notes), we anchor on a recent
//     note and fetch only a small SPATIAL WINDOW of neighbors around it. The
//     canvas auto-expands to keep the wall ~20% full, so the number of notes
//     in a fixed-size window stays roughly constant as the wall grows.
//     Simulation at 8000 notes: ~70 rows fetched/write, <3% guard rejections,
//     zero 503s, zero overlaps.

import {
  NO_OVERLAP_X,
  NO_OVERLAP_Y,
  pickNotePlacement,
} from '@/lib/placement';
import { getSupabaseServiceServer } from '@/lib/supabase-server';
import type { Note } from '@/types';

type Service = ReturnType<typeof getSupabaseServiceServer>;

// Retries when the DB guard rejects a proposal (a racing insert took the
// spot, or the local window missed a far neighbor). Each retry re-fetches a
// fresh window, so it sees whatever just landed. Simulation at 8000 notes:
// 6 retries → 0.8% land in a 503; 12 → 0% while total DB work barely moves
// (the tail just gets absorbed). Each retry is one bounded window fetch + RPC.
const MAX_PLACE_RETRIES = 12;
// Anchor placements on one of the N most-recent notes — cheap via the
// (is_visible, created_at desc) index, and keeps new notes clustering near
// where people are actively posting.
const RECENT_ANCHOR_POOL = 100;
// Half-size of the spatial window fetched around an anchor. Must comfortably
// cover the placement search radius (rings + local escape ≈ ±2000px).
const NEIGHBOR_WINDOW = 2000;
// Safety cap on a window fetch. At ~20% fill a window holds well under this;
// the cap only guards against a pathologically dense region.
const WINDOW_ROW_CAP = 2000;

const NOTE_COLUMNS =
  'id,text,section,color,x,y,rotation,z_index,created_at,is_visible';

// Estimated visible-note count — O(1) via the planner's statistics for large
// tables (exact while the table is still small). Used only to size the
// auto-expanding canvas, which the client clamps monotonically anyway, so a
// slight lag behind autovacuum is harmless — and it avoids a full COUNT scan
// on every read and write.
export async function countVisibleNotes(service: Service): Promise<number> {
  const { count } = await service
    .from('notes')
    .select('id', { count: 'estimated', head: true })
    .eq('is_visible', true);
  return count ?? 0;
}

// The N most-recent visible notes, used purely as placement anchors.
async function fetchRecentAnchors(service: Service): Promise<Note[]> {
  const { data } = await service
    .from('notes')
    .select('id,x,y')
    .eq('is_visible', true)
    .order('created_at', { ascending: false })
    .limit(RECENT_ANCHOR_POOL);
  return (data ?? []) as unknown as Note[];
}

// Visible notes within a spatial window around (cx, cy). Bounded per-write
// fetch cost regardless of total wall size. Index-backed by notes_xy_idx.
async function fetchWindow(
  service: Service,
  cx: number,
  cy: number,
): Promise<Note[]> {
  const { data } = await service
    .from('notes')
    .select('id,x,y')
    .eq('is_visible', true)
    .gt('x', cx - NEIGHBOR_WINDOW)
    .lt('x', cx + NEIGHBOR_WINDOW)
    .gt('y', cy - NEIGHBOR_WINDOW)
    .lt('y', cy + NEIGHBOR_WINDOW)
    .limit(WINDOW_ROW_CAP);
  return (data ?? []) as unknown as Note[];
}

interface Placement {
  x: number;
  y: number;
  rotation: number;
  z_index: number;
}

// Propose a placement: pick a recent anchor, load its local neighborhood,
// and let pickNotePlacement find a clean spot near it.
async function proposePlacement(
  service: Service,
  anchors: Note[],
  totalCount: number,
): Promise<Placement> {
  if (anchors.length === 0) {
    // Empty wall — pickNotePlacement seeds the first note near center.
    return pickNotePlacement([], totalCount);
  }
  const anchor = anchors[Math.floor(Math.random() * anchors.length)];
  const window = await fetchWindow(service, anchor.x, anchor.y);
  // Always give the algorithm at least the anchor to grow from.
  return pickNotePlacement(window.length > 0 ? window : [anchor], totalCount);
}

// Place a brand-new note and insert it atomically. Returns the inserted row,
// or null if every retry was rejected (the caller surfaces a 503).
export async function placeAndInsert(
  service: Service,
  args: { text: string; section: string; color: string; ipHash: string },
): Promise<Note | null> {
  const totalCount = await countVisibleNotes(service);
  const anchors = await fetchRecentAnchors(service);

  for (let attempt = 0; attempt < MAX_PLACE_RETRIES; attempt++) {
    const placement = await proposePlacement(service, anchors, totalCount);

    const rpc = await service.rpc('place_note', {
      p_text: args.text,
      p_section: args.section,
      p_color: args.color,
      p_x: placement.x,
      p_y: placement.y,
      p_rotation: placement.rotation,
      p_z_index: placement.z_index,
      p_ip_hash: args.ipHash,
      p_min_dx: NO_OVERLAP_X,
      p_min_dy: NO_OVERLAP_Y,
    });

    if (rpc.error) {
      // Only fall back to a plain insert when the function genuinely isn't
      // installed (PGRST202 = function not found) — schema.sql not applied
      // yet. Any other error (timeout, transient outage) must NOT skip the
      // overlap guard; retry instead, and 503 if it keeps failing.
      if (rpc.error.code === 'PGRST202') {
        console.warn(
          `place_note RPC not installed (${rpc.error.message}) — using plain insert`,
        );
        return plainInsertFallback(service, args, placement);
      }
      console.error(`place_note RPC error (attempt ${attempt}): ${rpc.error.message}`);
      continue;
    }

    if (rpc.data) return rpc.data as Note;
    // rpc.data null → a racing insert claimed the spot. Loop: proposePlacement
    // re-fetches a fresh window that now includes it.
  }

  return null;
}

// Restore a hidden note. A note's slot can be reused by newer notes while it's
// invisible (the placement guard ignores hidden notes), so simply flipping
// is_visible back on could resurrect it underneath another note. show_note()
// re-checks overlap (excluding this note) under the same lock: we first try to
// keep its original spot, and only re-place it if that spot is now taken.
export async function reviveNote(
  service: Service,
  id: string,
): Promise<Note | null> {
  const { data: current } = await service
    .from('notes')
    .select('id,x,y,rotation,z_index')
    .eq('id', id)
    .single();
  if (!current) return null;

  const totalCount = await countVisibleNotes(service);
  const anchors = await fetchRecentAnchors(service);

  for (let attempt = 0; attempt < MAX_PLACE_RETRIES; attempt++) {
    // Attempt 0 keeps the note where it was (if still clear); later attempts
    // re-place it near current activity.
    const placement: Placement =
      attempt === 0
        ? {
            x: current.x as number,
            y: current.y as number,
            rotation: current.rotation as number,
            z_index: current.z_index as number,
          }
        : await proposePlacement(service, anchors, totalCount);

    const rpc = await service.rpc('show_note', {
      p_id: id,
      p_x: placement.x,
      p_y: placement.y,
      p_rotation: placement.rotation,
      p_z_index: placement.z_index,
      p_min_dx: NO_OVERLAP_X,
      p_min_dy: NO_OVERLAP_Y,
    });

    if (rpc.error) {
      if (rpc.error.code === 'PGRST202') {
        // RPC not installed yet — fall back to a plain visibility flip so the
        // admin action still works during a deploy (may overlap until the
        // migration runs; matches the old behavior).
        console.warn(
          `show_note RPC not installed (${rpc.error.message}) — plain visibility flip`,
        );
        const { data, error } = await service
          .from('notes')
          .update({ is_visible: true })
          .eq('id', id)
          .select(NOTE_COLUMNS)
          .single();
        return error ? null : (data as Note);
      }
      console.error(`show_note RPC error (attempt ${attempt}): ${rpc.error.message}`);
      continue;
    }

    if (rpc.data) return rpc.data as Note;
  }

  return null;
}

async function plainInsertFallback(
  service: Service,
  args: { text: string; section: string; color: string; ipHash: string },
  placement: Placement,
): Promise<Note | null> {
  const { data, error } = await service
    .from('notes')
    .insert({
      text: args.text,
      section: args.section,
      color: args.color,
      x: placement.x,
      y: placement.y,
      rotation: placement.rotation,
      z_index: placement.z_index,
      ip_hash: args.ipHash,
      flagged: false,
    })
    .select(NOTE_COLUMNS)
    .single();
  if (error) {
    console.error('plain insert fallback failed:', error.message);
    return null;
  }
  return data as Note;
}

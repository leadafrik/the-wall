// Where to pin the next note on the wall.
//
// Notes anchor near an existing note so the populated area stays cohesive,
// and always land inside the auto-expanding canvas (the client clamps
// panning to it, so out-of-bounds notes would be unreachable).
//
// Rule: a new note is never allowed to cover another note's text. We treat
// each note as an axis-aligned bounding box and reject any placement whose
// box would intersect an existing note's box. A tiny margin (~10px each
// way) absorbs the bounding-box stretch caused by rotation up to ±4°.

import type { Note } from '@/types';

export const NOTE_WIDTH = 150;
// Hard upper bound on rendered height — enforced by the CSS clamp on .note
// (max-height + line-clamp in globals.css). Keep the two in sync.
export const NOTE_HEIGHT_APPROX = 300;

// Canvas auto-expands with population. Space needed grows with *area*, so
// the side length must grow with sqrt(noteCount) — the old linear-per-1000
// formula fell behind the cluster's actual spread by ~2000 notes, leaving
// notes stranded outside the pannable bounds. Sized so the wall stays at
// ~20% fill: dense enough to feel alive, sparse enough that placement never
// churns. Rounded up to 1000px steps so the size only changes occasionally.
const CANVAS_BASE = 10_000;
const CANVAS_FILL_TARGET = 0.2;
const CANVAS_ROUND = 1_000;

export function canvasSizeForNotes(noteCount: number): number {
  const side = Math.sqrt(
    (noteCount * NO_OVERLAP_X * NO_OVERLAP_Y) / CANVAS_FILL_TARGET,
  );
  return Math.max(CANVAS_BASE, Math.ceil(side / CANVAS_ROUND) * CANVAS_ROUND);
}

// Legacy export — kept so anything importing CANVAS_SIZE doesn't break.
// Treat as "the smallest canvas the wall ever shows," not "the actual size now."
export const CANVAS_SIZE = CANVAS_BASE;

// Center-to-center distances at or above which two notes can't visually
// overlap. True upper bounds: a 150×NOTE_HEIGHT_APPROX note rotated ±4°
// has a bounding box of ~166 × ~310, so these values include real slack.
// Kept in sync with place_note()'s defaults in supabase/schema.sql.
export const NO_OVERLAP_X = 175;
export const NO_OVERLAP_Y = 320;

// Starting search radius for the next note's anchor offset. Must be ≥ the
// largest no-overlap distance or the first ring is guaranteed to fail.
const MIN_OFFSET = 340;
const MAX_OFFSET = 520;

// Cap on attempts, then a hard escape hatch that pushes far enough to be
// guaranteed clear of any anchor cluster.
const MAX_ATTEMPTS = 60;

// Keep whole notes (plus rotation slack) inside the canvas edge. The client
// clamps panning to the canvas bounds, so anything placed outside them is
// unreachable — placement must never put a note there.
const EDGE_MARGIN = 40;

const CENTER = CANVAS_SIZE / 2;

interface Candidate {
  x: number;
  y: number;
  rotation: number;
  z_index: number;
}

// `existing` is the overlap/anchor snapshot — at scale this is a bounded
// *local* window of nearby notes, NOT the whole wall (see src/lib/place-note.ts).
// `totalCount` is the true visible-note count, used only to size the canvas;
// it's passed separately so a partial snapshot doesn't shrink the canvas.
// Correctness never rests on `existing` being complete: the DB guard
// (place_note / show_note) re-checks the full table under a lock.
export function pickNotePlacement(
  existing: Note[],
  totalCount: number = existing.length,
): Candidate {
  const rotation = roundTo(randomBetween(-4, 4), 2);
  const z_index = Math.floor(Math.random() * 1000);

  // Every candidate must land fully inside the *current* canvas — the
  // client clamps panning to canvasSizeForNotes(count), so an out-of-bounds
  // note would be unreachable. (x, y) is the note's top-left corner.
  const size = canvasSizeForNotes(totalCount);
  const minX = EDGE_MARGIN;
  const maxX = size - NOTE_WIDTH - EDGE_MARGIN;
  const minY = EDGE_MARGIN;
  const maxY = size - NOTE_HEIGHT_APPROX - EDGE_MARGIN;
  const inBounds = (x: number, y: number) =>
    x >= minX && x <= maxX && y >= minY && y <= maxY;

  if (existing.length === 0) {
    return {
      x: Math.round(CENTER + randomBetween(-200, 200)),
      y: Math.round(CENTER + randomBetween(-200, 200)),
      rotation,
      z_index,
    };
  }

  // Try increasing rings around random anchors until a non-overlapping spot
  // is found. Each failed attempt widens the search so we eventually escape
  // dense clusters instead of churning.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const anchor = existing[Math.floor(Math.random() * existing.length)];
    const angle = Math.random() * Math.PI * 2;
    const distance =
      randomBetween(MIN_OFFSET, MAX_OFFSET) + attempt * 24;
    const x = Math.round(anchor.x + Math.cos(angle) * distance);
    const y = Math.round(anchor.y + Math.sin(angle) * distance);
    if (inBounds(x, y) && !overlapsAny(existing, x, y)) {
      return { x, y, rotation, z_index };
    }
  }

  // Hard escape: pick a random anchor and go well past the local cluster.
  // This re-checks overlap because even the far ring isn't guaranteed empty.
  for (let escape = 0; escape < 20; escape++) {
    const anchor = existing[Math.floor(Math.random() * existing.length)];
    const angle = Math.random() * Math.PI * 2;
    const distance = MAX_OFFSET + 1500 + escape * 200 + randomBetween(0, 200);
    const x = Math.round(anchor.x + Math.cos(angle) * distance);
    const y = Math.round(anchor.y + Math.sin(angle) * distance);
    if (inBounds(x, y) && !overlapsAny(existing, x, y)) {
      return { x, y, rotation, z_index };
    }
  }

  // Last resort: uniform random sampling across the whole canvas. The
  // canvas is sized to ~20% full, so free space always exists — anchor
  // walks just can't always find it from inside a dense cluster.
  for (let sample = 0; sample < 200; sample++) {
    const x = Math.round(randomBetween(minX, maxX));
    const y = Math.round(randomBetween(minY, maxY));
    if (!overlapsAny(existing, x, y)) {
      return { x, y, rotation, z_index };
    }
  }

  // Pathological: nothing found anywhere. Return an in-bounds candidate and
  // let the DB-side place_note() guard reject it (the API then retries or
  // 503s) — never hand back a spot we know overlaps outside the guard.
  return {
    x: Math.round(randomBetween(minX, maxX)),
    y: Math.round(randomBetween(minY, maxY)),
    rotation,
    z_index,
  };
}

function overlapsAny(existing: Note[], x: number, y: number): boolean {
  for (const n of existing) {
    if (
      Math.abs(n.x - x) < NO_OVERLAP_X &&
      Math.abs(n.y - y) < NO_OVERLAP_Y
    ) {
      return true;
    }
  }
  return false;
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

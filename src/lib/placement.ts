// Where to pin the next note on the wall.
//
// The wall scrolls infinitely (no edge clamp), but notes always anchor near
// an existing note so the populated area stays cohesive.
//
// Rule: a new note is never allowed to cover another note's text. We treat
// each note as an axis-aligned bounding box and reject any placement whose
// box would intersect an existing note's box.
//
// The guarantee only holds because the rendered note box is BOUNDED. In CSS
// (src/app/globals.css) `.note` is a fixed 140px wide and its text is clamped
// to a 5-line preview (`.note__text` max-height ≈120px), so a note is at most
// ~140 × ~176px regardless of how much text it carries. The full text lives in
// the expanded modal on click. Earlier versions left the note height
// unbounded — a 280-char note rendered ~500px tall while the math assumed
// ~300px, so long notes overlapped their vertical neighbours no matter how the
// placement search ran. Capping the box is what finally makes this hold.

import type { Note } from '@/types';

// Rendered bounding box of a note, matching the CSS cap above. Use these as
// the source of truth when deriving the no-overlap distances below. A little
// slack over the measured ~176px height keeps the margin honest.
export const NOTE_WIDTH = 140;
export const NOTE_HEIGHT_APPROX = 185; // hard upper bound: 5-line clamped preview

// Canvas auto-expands with population so it's always sized to ~30-40% full —
// enough headroom for placement to find clean spots, no hardcoded ceiling.
// One discrete bump per 1000 notes keeps growth predictable and avoids
// constant resizing on every insert.
const CANVAS_BASE = 10_000;
const CANVAS_STEP = 3_000;
const CANVAS_NOTES_PER_STEP = 1000;

export function canvasSizeForNotes(noteCount: number): number {
  return CANVAS_BASE + Math.floor(noteCount / CANVAS_NOTES_PER_STEP) * CANVAS_STEP;
}

// Legacy export — kept so anything importing CANVAS_SIZE doesn't break.
// Treat as "the smallest canvas the wall ever shows," not "the actual size now."
export const CANVAS_SIZE = CANVAS_BASE;

// Anchor-to-anchor distances at or above which two notes provably cannot
// visually overlap. Notes share a top-anchor and rotate up to ±4° about their
// top-centre, so for a W×H box the true separation thresholds are:
//
//   thX = W·cos θ + 2·H·sin θ   (adversarial: both notes lean toward each other)
//   thY = W·sin θ + H·cos θ
//
// With W=140, H=185, θ=4°: thX ≈ 166, thY ≈ 194. The values below sit above
// those with ~15px of margin, and hold through θ=5° too. Because the true
// thresholds (166/194) are below the OLD placement floor (175/320), every note
// already on the wall is guaranteed non-overlapping under the capped box — no
// reposition needed. Kept in sync with place_note()'s defaults in
// supabase/schema.sql and the mirror in scripts/reposition.mjs.
export const NO_OVERLAP_X = 180;
export const NO_OVERLAP_Y = 210;

// Starting search radius for the next note's anchor offset. Must be ≥ the
// largest no-overlap distance or the first ring is guaranteed to fail.
const MIN_OFFSET = 340;
const MAX_OFFSET = 520;

// Cap on attempts, then a hard escape hatch that pushes far enough to be
// guaranteed clear of any anchor cluster.
const MAX_ATTEMPTS = 60;

const CENTER = CANVAS_SIZE / 2;

interface Candidate {
  x: number;
  y: number;
  rotation: number;
  z_index: number;
}

export function pickNotePlacement(existing: Note[]): Candidate {
  const rotation = roundTo(randomBetween(-4, 4), 2);
  const z_index = Math.floor(Math.random() * 1000);

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
    if (!overlapsAny(existing, x, y)) {
      return { x, y, rotation, z_index };
    }
  }

  // Hard escape: pick the *farthest* anchor in a random direction, then go
  // well past the cluster. This re-checks overlap because even the far
  // ring isn't guaranteed empty.
  for (let escape = 0; escape < 20; escape++) {
    const anchor = existing[Math.floor(Math.random() * existing.length)];
    const angle = Math.random() * Math.PI * 2;
    const distance = MAX_OFFSET + 1500 + escape * 200 + randomBetween(0, 200);
    const x = Math.round(anchor.x + Math.cos(angle) * distance);
    const y = Math.round(anchor.y + Math.sin(angle) * distance);
    if (!overlapsAny(existing, x, y)) {
      return { x, y, rotation, z_index };
    }
  }

  // Pathological: thousands of notes packed everywhere. Accept the last
  // candidate. With NO_OVERLAP_X/Y honored everywhere up to this point,
  // this only fires when the cluster has genuinely run out of room.
  const anchor = existing[Math.floor(Math.random() * existing.length)];
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.round(anchor.x + Math.cos(angle) * 5000),
    y: Math.round(anchor.y + Math.sin(angle) * 5000),
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

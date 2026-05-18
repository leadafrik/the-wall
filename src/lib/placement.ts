// Where to pin the next note on the wall.
//
// The wall scrolls infinitely (no edge clamp), but notes always anchor near
// an existing note so the populated area stays cohesive instead of drifting
// off into nothing.
//
// Placement rules:
//   * notes never visually overlap (a sticky covering another sticky's text
//     is unreadable, even though some corner-touching is allowed)
//   * spread far enough to feel like a real wall, close enough to feel dense
//   * the canvas is virtually infinite, so x/y are unbounded

import type { Note } from '@/types';

// Kept as a centering anchor for the initial viewport. Doesn't bound placement.
export const CANVAS_SIZE = 10_000;

export const NOTE_WIDTH = 150;
// A 280-char note at 17px / 1.4 line-height runs ~220-240px. Use the upper
// bound so spacing logic plans for the worst case, not the average.
export const NOTE_HEIGHT_APPROX = 240;

const CENTER = CANVAS_SIZE / 2;

// Center-to-center minimum that prevents text-covering overlap even for the
// tallest possible note. Tuned against NOTE_HEIGHT_APPROX above; lowering it
// reintroduces the "stickies cover each other" bug.
const MIN_SPACING = 240;
// Search radius for anchoring near an existing note. Must be ≥ MIN_SPACING
// or the first candidate is guaranteed to fail the overlap check.
const MIN_OFFSET = 260;
const MAX_OFFSET = 440;
// How many random candidates to try before giving up on collision avoidance.
const MAX_ATTEMPTS = 40;

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

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const anchor = existing[Math.floor(Math.random() * existing.length)];
    const angle = Math.random() * Math.PI * 2;
    // Push further out as attempts fail — we keep widening the search until
    // we find an unoccupied spot.
    const distance = randomBetween(MIN_OFFSET, MAX_OFFSET) + attempt * 12;
    const x = Math.round(anchor.x + Math.cos(angle) * distance);
    const y = Math.round(anchor.y + Math.sin(angle) * distance);

    if (!overlaps(existing, x, y)) {
      return { x, y, rotation, z_index };
    }
  }

  // Couldn't find a non-overlapping spot inside the search radius. Push way
  // out so the new note lands in fresh territory rather than stacking on top
  // of an existing one.
  const anchor = existing[Math.floor(Math.random() * existing.length)];
  const angle = Math.random() * Math.PI * 2;
  const distance = MAX_OFFSET + MAX_ATTEMPTS * 12 + randomBetween(0, 200);
  return {
    x: Math.round(anchor.x + Math.cos(angle) * distance),
    y: Math.round(anchor.y + Math.sin(angle) * distance),
    rotation,
    z_index,
  };
}

function overlaps(existing: Note[], x: number, y: number): boolean {
  return existing.some(
    (n) => Math.abs(n.x - x) < MIN_SPACING && Math.abs(n.y - y) < MIN_SPACING,
  );
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

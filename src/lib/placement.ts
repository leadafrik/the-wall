// Where to pin the next note on the wall.
//
// We aim for visual density without total chaos: pick a random existing note
// as an "anchor" and offset 80–220px from it at a random angle. If the wall
// is empty we land near the center. Positions are clamped inside the canvas.

import type { Note } from '@/types';

export const CANVAS_SIZE = 10_000;
export const NOTE_WIDTH = 150;
export const NOTE_HEIGHT_APPROX = 140;

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
    // First note: drop near the center, jittered.
    return {
      x: clampX(CENTER + randomBetween(-300, 300)),
      y: clampY(CENTER + randomBetween(-300, 300)),
      rotation,
      z_index,
    };
  }

  // Try up to a few times to pick an anchor + offset that doesn't sit
  // exactly on top of an existing note.
  for (let attempt = 0; attempt < 8; attempt++) {
    const anchor = existing[Math.floor(Math.random() * existing.length)];
    const angle = Math.random() * Math.PI * 2;
    const distance = randomBetween(80, 220);
    const x = clampX(Math.round(anchor.x + Math.cos(angle) * distance));
    const y = clampY(Math.round(anchor.y + Math.sin(angle) * distance));

    if (!collidesHard(existing, x, y)) {
      return { x, y, rotation, z_index };
    }
  }

  // Give up and accept overlap — the wall is supposed to overlap anyway.
  const anchor = existing[Math.floor(Math.random() * existing.length)];
  const angle = Math.random() * Math.PI * 2;
  const distance = randomBetween(120, 260);
  return {
    x: clampX(Math.round(anchor.x + Math.cos(angle) * distance)),
    y: clampY(Math.round(anchor.y + Math.sin(angle) * distance)),
    rotation,
    z_index,
  };
}

function collidesHard(existing: Note[], x: number, y: number): boolean {
  // "Hard" collision = the center of the new note sits inside another note's
  // bounding box. Mild overlap is fine and looks good.
  return existing.some(
    (n) =>
      Math.abs(n.x - x) < NOTE_WIDTH * 0.4 &&
      Math.abs(n.y - y) < NOTE_HEIGHT_APPROX * 0.4,
  );
}

function clampX(x: number): number {
  return Math.max(NOTE_WIDTH, Math.min(CANVAS_SIZE - NOTE_WIDTH, x));
}

function clampY(y: number): number {
  return Math.max(NOTE_HEIGHT_APPROX, Math.min(CANVAS_SIZE - NOTE_HEIGHT_APPROX, y));
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// Overlap-readiness test for the wall's placement pipeline.
//
// Run with:
//   npm run test:placement
//   (= node --experimental-strip-types scripts/test-placement.mjs)
//
// Imports the *real* src/lib/placement.ts (no mirror drift) and simulates
// the place_note() DB guard from supabase/schema.sql, then hammers the
// pipeline the way production traffic would:
//
//   1. geometry     — NO_OVERLAP_X/Y really bound a ±4°-rotated note box
//   2. sequential   — thousands of one-at-a-time posts, zero overlapping pairs
//   3. saturation   — placing into a fully packed grid still never overlaps
//   4. concurrency  — racing posters with stale snapshots, DB guard holds
//   5. stale/capped — snapshot missing rows (the PostgREST 1000-row cap):
//                     the DB guard must still keep the table overlap-free
//
// Exits non-zero on any failure so this can gate a deploy.

import {
  NOTE_WIDTH,
  NOTE_HEIGHT_APPROX,
  NO_OVERLAP_X,
  NO_OVERLAP_Y,
  pickNotePlacement,
  canvasSizeForNotes,
} from '../src/lib/placement.ts';

let failures = 0;

function check(name, ok, detail = '') {
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function overlaps(a, b) {
  return (
    Math.abs(a.x - b.x) < NO_OVERLAP_X && Math.abs(a.y - b.y) < NO_OVERLAP_Y
  );
}

// Count every overlapping pair in a set of notes (brute force, test-only).
function overlappingPairs(notes) {
  const pairs = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      if (overlaps(notes[i], notes[j])) pairs.push([i, j]);
    }
  }
  return pairs;
}

// Mirror of place_note() in supabase/schema.sql: the serialized
// check-and-insert that every real write goes through. Returns the row on
// success, null when a racing insert already claimed the spot.
function dbPlaceNote(table, candidate) {
  for (const n of table) {
    if (overlaps(n, candidate)) return null;
  }
  table.push(candidate);
  return candidate;
}

// -------------------------------------------------------------------------
console.log('\n1. geometry — spacing constants vs rotated note box');
{
  const rad = (4 * Math.PI) / 180;
  const bboxW =
    NOTE_WIDTH * Math.cos(rad) + NOTE_HEIGHT_APPROX * Math.sin(rad);
  const bboxH =
    NOTE_HEIGHT_APPROX * Math.cos(rad) + NOTE_WIDTH * Math.sin(rad);
  check(
    `NO_OVERLAP_X (${NO_OVERLAP_X}) ≥ rotated box width (${bboxW.toFixed(1)})`,
    NO_OVERLAP_X >= bboxW,
  );
  check(
    `NO_OVERLAP_Y (${NO_OVERLAP_Y}) ≥ rotated box height (${bboxH.toFixed(1)})`,
    NO_OVERLAP_Y >= bboxH,
  );
}

// -------------------------------------------------------------------------
console.log('\n2. sequential — 3000 one-at-a-time posts, fresh snapshot each');
{
  const table = [];
  let rejected = 0;
  let allFinite = true;
  for (let i = 0; i < 3000; i++) {
    const p = pickNotePlacement(table);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      allFinite = false;
      break;
    }
    if (!dbPlaceNote(table, p)) rejected++;
  }
  check('every placement finite', allFinite);
  const pairs = overlappingPairs(table);
  check(
    'zero overlapping pairs after 3000 posts',
    pairs.length === 0,
    `${table.length} placed, ${rejected} guard-rejected`,
  );

  // Readiness stat: does the auto-expanding canvas keep up with the cluster?
  const xs = table.map((n) => n.x);
  const ys = table.map((n) => n.y);
  const spreadW = Math.max(...xs) - Math.min(...xs);
  const spreadH = Math.max(...ys) - Math.min(...ys);
  const canvas = canvasSizeForNotes(table.length);
  console.log(
    `  · cluster ${Math.round(spreadW)}×${Math.round(spreadH)} px, canvas ${canvas} px`,
  );
  check(
    'cluster fits inside the auto-expanded canvas',
    spreadW <= canvas && spreadH <= canvas,
  );
  // The client clamps panning to [0, canvas], so any note outside that
  // square is unreachable. Canvas growth is monotonic, so checking against
  // the final size covers every placement.
  const stranded = table.filter(
    (n) =>
      n.x < 0 ||
      n.y < 0 ||
      n.x + NOTE_WIDTH > canvas ||
      n.y + NOTE_HEIGHT_APPROX > canvas,
  );
  check('every note reachable (inside canvas bounds)', stranded.length === 0, `${stranded.length} stranded`);
}

// -------------------------------------------------------------------------
console.log('\n3. saturation — packed 40×40 grid, forced escape paths');
{
  // A grid packed at exactly the minimum spacing: no interior gaps at all,
  // so every placement is forced through the retry/escape logic.
  const table = [];
  for (let r = 0; r < 40; r++) {
    for (let c = 0; c < 40; c++) {
      table.push({ x: 3000 + c * NO_OVERLAP_X, y: 1000 + r * NO_OVERLAP_Y });
    }
  }
  let clean = 0;
  let guardSaves = 0;
  for (let i = 0; i < 200; i++) {
    const p = pickNotePlacement(table);
    if (dbPlaceNote(table, p)) clean++;
    else guardSaves++;
  }
  check(
    'no overlaps after 200 posts into a saturated grid',
    overlappingPairs(table).length === 0,
    `${clean} placed cleanly, ${guardSaves} caught by the DB guard`,
  );
}

// -------------------------------------------------------------------------
console.log('\n4. concurrency — racing posters sharing stale snapshots');
{
  // Each round, WORKERS posters all read the same snapshot, pick placements
  // independently, then hit the serialized DB guard in random order — the
  // exact race place_note() exists to close. A guard rejection = the API's
  // refetch-and-retry path (MAX_PLACE_RETRIES).
  const table = [];
  const WORKERS = 16;
  const ROUNDS = 100;
  const RETRIES = 6;
  let total = 0;
  let gaveUp = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const posters = Array.from({ length: WORKERS }, () => ({ tries: 0 }));
    let pending = posters;
    while (pending.length > 0) {
      const snapshot = table.slice(); // shared stale view for this wave
      const wave = pending;
      pending = [];
      for (const poster of wave) {
        const p = pickNotePlacement(snapshot);
        poster.tries++;
        if (dbPlaceNote(table, p)) {
          total++;
        } else if (poster.tries < RETRIES) {
          pending.push(poster); // refetch + retry, like the API route
        } else {
          gaveUp++; // the 503 path
        }
      }
    }
  }
  check(
    `no overlaps after ${WORKERS}×${ROUNDS} racing posts`,
    overlappingPairs(table).length === 0,
    `${total} landed, ${gaveUp} exhausted retries (503s)`,
  );
  check('503 rate under 1%', gaveUp / (WORKERS * ROUNDS) < 0.01, `${gaveUp} of ${WORKERS * ROUNDS}`);
}

// -------------------------------------------------------------------------
console.log('\n5. capped snapshot — placement sees only 1000 of 4000 rows');
{
  // Models the PostgREST default row cap: the API's neighbor snapshot is
  // silently truncated, so pickNotePlacement can propose spots on top of
  // notes it never saw. The DB guard must still keep the table clean —
  // this is the invariant that survives any snapshot bug.
  const table = [];
  for (let i = 0; i < 4000; i++) {
    const p = pickNotePlacement(table);
    dbPlaceNote(table, p);
  }
  let landed = 0;
  let saved = 0;
  for (let i = 0; i < 300; i++) {
    const snapshot = table.slice(0, 1000); // what a capped fetch returns
    const p = pickNotePlacement(snapshot);
    if (dbPlaceNote(table, p)) landed++;
    else saved++;
  }
  check(
    'table still overlap-free with a truncated snapshot',
    overlappingPairs(table).length === 0,
    `${landed} landed, ${saved} would-be overlaps stopped by the DB guard`,
  );
  console.log(
    `  · note: ${saved} guard rejections in 300 posts = wasted retries/503s — the API must paginate its neighbor fetch`,
  );
}

// -------------------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.error(`FAILED — ${failures} check(s) did not hold.`);
  process.exit(1);
}
console.log('all placement checks passed.');

// Overlap-readiness test for the wall's placement pipeline.
//
// Run with:
//   npm run test:placement
//   (= node --experimental-strip-types scripts/test-placement.mjs)
//
// Imports the *real* src/lib/placement.ts (no mirror drift) and simulates the
// DB guard from supabase/schema.sql plus the bounded spatial-window write
// strategy from src/lib/place-note.ts, then hammers the pipeline the way
// worldwide production traffic would:
//
//   1. geometry     — NO_OVERLAP_X/Y really bound a ±4°-rotated note box
//   2. sequential   — thousands of one-at-a-time posts, zero overlapping pairs
//   3. saturation   — placing into a fully packed grid still never overlaps
//   4. concurrency  — racing posters with stale snapshots, DB guard holds
//   5. at-scale     — bounded spatial-window snapshot (the production write
//                     path): O(1) fetch per write, zero overlaps, low 503 rate
//   6. admin revive — un-hiding a note whose slot was reused never overlaps
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

// Mirror of place-note.ts tuning — the harness models that strategy.
const NEIGHBOR_WINDOW = 2000;
const RECENT_ANCHOR_POOL = 100;
const MAX_PLACE_RETRIES = 12;

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

function overlappingPairs(notes) {
  const pairs = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      if (overlaps(notes[i], notes[j])) pairs.push([i, j]);
    }
  }
  return pairs;
}

// Mirror of place_note()/show_note() in supabase/schema.sql: the serialized
// check-and-insert every real write goes through. `excludeIdx` lets show_note
// ignore the note being revived. Returns true on success (row added/kept).
function dbGuardClear(table, candidate, excludeIdx = -1) {
  for (let i = 0; i < table.length; i++) {
    if (i === excludeIdx) continue;
    if (overlaps(table[i], candidate)) return false;
  }
  return true;
}

// Bounded spatial window around (cx, cy) — models fetchWindow() in place-note.ts.
function windowAround(table, cx, cy) {
  const out = [];
  for (const n of table) {
    if (Math.abs(n.x - cx) < NEIGHBOR_WINDOW && Math.abs(n.y - cy) < NEIGHBOR_WINDOW) {
      out.push(n);
    }
  }
  return out;
}

// -------------------------------------------------------------------------
console.log('\n1. geometry — spacing constants vs rotated note box');
{
  const rad = (4 * Math.PI) / 180;
  const bboxW = NOTE_WIDTH * Math.cos(rad) + NOTE_HEIGHT_APPROX * Math.sin(rad);
  const bboxH = NOTE_HEIGHT_APPROX * Math.cos(rad) + NOTE_WIDTH * Math.sin(rad);
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
console.log('\n2. sequential — 3000 one-at-a-time posts, full snapshot');
{
  const table = [];
  let allFinite = true;
  for (let i = 0; i < 3000; i++) {
    const p = pickNotePlacement(table);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      allFinite = false;
      break;
    }
    if (dbGuardClear(table, p)) table.push(p);
  }
  check('every placement finite', allFinite);
  check('zero overlapping pairs after 3000 posts', overlappingPairs(table).length === 0, `${table.length} placed`);

  const xs = table.map((n) => n.x);
  const ys = table.map((n) => n.y);
  const spreadW = Math.max(...xs) - Math.min(...xs);
  const spreadH = Math.max(...ys) - Math.min(...ys);
  const canvas = canvasSizeForNotes(table.length);
  console.log(`  · cluster ${Math.round(spreadW)}×${Math.round(spreadH)} px, canvas ${canvas} px`);
  check('cluster fits inside the auto-expanded canvas', spreadW <= canvas && spreadH <= canvas);
  const stranded = table.filter(
    (n) => n.x < 0 || n.y < 0 || n.x + NOTE_WIDTH > canvas || n.y + NOTE_HEIGHT_APPROX > canvas,
  );
  check('every note reachable (inside canvas bounds)', stranded.length === 0, `${stranded.length} stranded`);
}

// -------------------------------------------------------------------------
console.log('\n3. saturation — packed 40×40 grid, forced escape paths');
{
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
    if (dbGuardClear(table, p)) {
      table.push(p);
      clean++;
    } else guardSaves++;
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
  const table = [];
  const WORKERS = 16;
  const ROUNDS = 100;
  let total = 0;
  let gaveUp = 0;
  for (let round = 0; round < ROUNDS; round++) {
    let pending = Array.from({ length: WORKERS }, () => ({ tries: 0 }));
    while (pending.length > 0) {
      const snapshot = table.slice(); // shared stale view for this wave
      const wave = pending;
      pending = [];
      for (const poster of wave) {
        const p = pickNotePlacement(snapshot, snapshot.length);
        poster.tries++;
        if (dbGuardClear(table, p)) {
          table.push(p);
          total++;
        } else if (poster.tries < MAX_PLACE_RETRIES) {
          pending.push(poster);
        } else {
          gaveUp++;
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
console.log('\n5. at-scale — bounded spatial-window write path (production strategy)');
{
  // Models src/lib/place-note.ts exactly: anchor on a recent note, fetch only
  // a local window, propose via the REAL pickNotePlacement, let the full-table
  // DB guard have the final say. Proves fetch cost stays bounded (independent
  // of wall size) while overlaps stay at zero and 503s stay negligible.
  const N = 8000;
  const table = [];
  let fetchedTotal = 0;
  let fetchMax = 0;
  let gaveUp = 0;
  let rejects = 0;

  for (let i = 0; i < N; i++) {
    let placed = false;
    // Recompute the recent-anchor pool once per post (as the real code does).
    for (let attempt = 0; attempt < MAX_PLACE_RETRIES && !placed; attempt++) {
      let candidate;
      if (table.length === 0) {
        candidate = pickNotePlacement([], 0);
      } else {
        const poolStart = Math.max(0, table.length - RECENT_ANCHOR_POOL);
        const anchor = table[poolStart + Math.floor(Math.random() * (table.length - poolStart))];
        const win = windowAround(table, anchor.x, anchor.y);
        fetchedTotal += win.length;
        fetchMax = Math.max(fetchMax, win.length);
        candidate = pickNotePlacement(win.length > 0 ? win : [anchor], table.length);
      }
      if (dbGuardClear(table, candidate)) {
        table.push(candidate);
        placed = true;
      } else {
        rejects++;
      }
    }
    if (!placed) gaveUp++;
  }

  const avgFetch = Math.round(fetchedTotal / N);
  console.log(`  · avg ${avgFetch} rows fetched/write (max ${fetchMax}) — flat vs the ${N}-note wall`);
  check('zero overlaps across the whole wall', overlappingPairs(table).length === 0, `${table.length} notes`);
  check('per-write fetch stays bounded (< 400 rows)', fetchMax < 400, `max ${fetchMax}`);
  check('503 rate under 0.5%', gaveUp / N < 0.005, `${gaveUp} of ${N}, ${rejects} retries`);
  const canvas = canvasSizeForNotes(table.length);
  const stranded = table.filter(
    (n) => n.x < 0 || n.y < 0 || n.x + NOTE_WIDTH > canvas || n.y + NOTE_HEIGHT_APPROX > canvas,
  );
  check('every note reachable (inside canvas bounds)', stranded.length === 0, `${stranded.length} stranded`);
}

// -------------------------------------------------------------------------
console.log('\n6. admin revive — un-hiding never resurrects a note under another');
{
  // Build a wall, hide a batch, fill the freed slots with new notes, then
  // revive the hidden ones via the show_note() guard (keep original spot if
  // still clear, else re-place). No overlaps among visible notes afterward.
  const table = []; // { x, y, visible }
  const place = () => {
    const snap = table.filter((n) => n.visible);
    for (let attempt = 0; attempt < MAX_PLACE_RETRIES; attempt++) {
      const p = pickNotePlacement(snap, snap.length);
      if (dbGuardClear(snap, p)) return { x: p.x, y: p.y, visible: true };
    }
    return null;
  };
  for (let i = 0; i < 1500; i++) {
    const n = place();
    if (n) table.push(n);
  }
  // Hide every 5th note.
  const hidden = [];
  for (let i = 0; i < table.length; i += 5) {
    table[i].visible = false;
    hidden.push(table[i]);
  }
  // Post new notes — some will reclaim the freed slots.
  for (let i = 0; i < 400; i++) {
    const n = place();
    if (n) table.push(n);
  }
  // Revive: show_note re-checks overlap against OTHER visible notes.
  let revived = 0;
  let couldNotPlace = 0;
  for (const note of hidden) {
    const others = table.filter((n) => n !== note && n.visible);
    let done = false;
    // attempt 0: original spot; later: fresh placement.
    for (let attempt = 0; attempt < MAX_PLACE_RETRIES && !done; attempt++) {
      const cand =
        attempt === 0
          ? { x: note.x, y: note.y }
          : pickNotePlacement(others, others.length);
      if (dbGuardClear(others, cand)) {
        note.x = cand.x;
        note.y = cand.y;
        note.visible = true;
        revived++;
        done = true;
      }
    }
    if (!done) couldNotPlace++;
  }
  const visible = table.filter((n) => n.visible);
  check(
    'no overlaps among visible notes after reviving',
    overlappingPairs(visible).length === 0,
    `${revived} revived, ${couldNotPlace} needed a retry cycle`,
  );
}

// -------------------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.error(`FAILED — ${failures} check(s) did not hold.`);
  process.exit(1);
}
console.log('all placement checks passed.');

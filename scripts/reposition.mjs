// One-time persistent fix for the wall layout.
//
// Walks every visible note through the new placement algorithm and writes
// fresh x/y/rotation/z_index back to the DB. After this runs, no two notes
// will visually overlap — for everyone, on every page load, on permalinks,
// forever. Real user notes and seeds are both repositioned.
//
// Run with:
//   node --env-file=.env.local scripts/reposition.mjs            # dry run
//   node --env-file=.env.local scripts/reposition.mjs --apply    # actually write
//
// Idempotent: running twice just produces another clean layout. There is no
// "undo" — the previous positions are overwritten, so make sure you mean it
// before passing --apply. (Supabase has point-in-time recovery on paid plans
// if you ever need to roll back.)

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('missing SUPABASE_URL or SERVICE_ROLE_KEY');
  process.exit(1);
}

const CANVAS_SIZE = 10_000;
const CENTER = CANVAS_SIZE / 2;
// Mirror of src/lib/placement.ts — keep in sync.
const NO_OVERLAP_X = 175;
const NO_OVERLAP_Y = 320;
const MIN_OFFSET = 340;
const MAX_OFFSET = 520;
const MAX_ATTEMPTS = 60;

function randBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function overlapsAny(existing, x, y) {
  for (const n of existing) {
    if (Math.abs(n.x - x) < NO_OVERLAP_X && Math.abs(n.y - y) < NO_OVERLAP_Y) {
      return true;
    }
  }
  return false;
}

function pickPlacement(existing) {
  const rotation = +randBetween(-4, 4).toFixed(2);
  const z_index = Math.floor(Math.random() * 1000);
  if (existing.length === 0) {
    return {
      x: Math.round(CENTER + randBetween(-200, 200)),
      y: Math.round(CENTER + randBetween(-200, 200)),
      rotation,
      z_index,
    };
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const anchor = existing[Math.floor(Math.random() * existing.length)];
    const angle = Math.random() * Math.PI * 2;
    const distance = randBetween(MIN_OFFSET, MAX_OFFSET) + attempt * 24;
    const x = Math.round(anchor.x + Math.cos(angle) * distance);
    const y = Math.round(anchor.y + Math.sin(angle) * distance);
    if (!overlapsAny(existing, x, y)) {
      return { x, y, rotation, z_index };
    }
  }
  for (let escape = 0; escape < 20; escape++) {
    const anchor = existing[Math.floor(Math.random() * existing.length)];
    const angle = Math.random() * Math.PI * 2;
    const distance = MAX_OFFSET + 1500 + escape * 200 + randBetween(0, 200);
    const x = Math.round(anchor.x + Math.cos(angle) * distance);
    const y = Math.round(anchor.y + Math.sin(angle) * distance);
    if (!overlapsAny(existing, x, y)) {
      return { x, y, rotation, z_index };
    }
  }
  const anchor = existing[Math.floor(Math.random() * existing.length)];
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.round(anchor.x + Math.cos(angle) * 5000),
    y: Math.round(anchor.y + Math.sin(angle) * 5000),
    rotation,
    z_index,
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('fetching all visible notes…');
  const { data, error } = await supabase
    .from('notes')
    .select('id, created_at, x, y, rotation, z_index')
    .eq('is_visible', true)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('fetch failed:', error.message);
    process.exit(1);
  }
  const notes = data ?? [];
  console.log(`got ${notes.length} notes.`);

  const placed = [];
  const updates = [];
  for (const note of notes) {
    const p = pickPlacement(placed);
    placed.push({ x: p.x, y: p.y });
    updates.push({
      id: note.id,
      old: { x: note.x, y: note.y },
      new: { x: p.x, y: p.y, rotation: p.rotation, z_index: p.z_index },
    });
  }

  // Compactness stat for sanity-checking the dry-run.
  const xs = placed.map((n) => n.x);
  const ys = placed.map((n) => n.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  console.log(`new cluster: ${w} × ${h} px around (${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)}, ${Math.round(ys.reduce((a, b) => a + b, 0) / ys.length)}).`);

  if (!apply) {
    console.log('\n(dry run — pass --apply to write these positions back to the DB)');
    return;
  }

  console.log('\napplying updates…');
  let done = 0;
  for (const u of updates) {
    const { error: updErr } = await supabase
      .from('notes')
      .update({
        x: u.new.x,
        y: u.new.y,
        rotation: u.new.rotation,
        z_index: u.new.z_index,
      })
      .eq('id', u.id);
    if (updErr) {
      console.error(`  ✗ ${u.id}: ${updErr.message}`);
      continue;
    }
    done++;
    if (done % 10 === 0 || done === updates.length) {
      console.log(`  ${done}/${updates.length}`);
    }
  }
  console.log(`\nrepositioned ${done} / ${updates.length} notes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

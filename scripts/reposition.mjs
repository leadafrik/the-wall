// One-time persistent fix for the wall layout.
//
// Walks every visible note through the new placement algorithm and writes
// fresh x/y/rotation/z_index back to the DB. After this runs, no two notes
// will visually overlap — for everyone, on every page load, on permalinks,
// forever. Real user notes and seeds are both repositioned.
//
// Run with:
//   node --env-file=.env.local --experimental-strip-types scripts/reposition.mjs            # dry run
//   node --env-file=.env.local --experimental-strip-types scripts/reposition.mjs --apply    # actually write
//
// Idempotent: running twice just produces another clean layout. There is no
// "undo" — the previous positions are overwritten, so make sure you mean it
// before passing --apply. (Supabase has point-in-time recovery on paid plans
// if you ever need to roll back.)

import { createClient } from '@supabase/supabase-js';

// The real placement algorithm — no hand-copied mirror to drift out of sync.
import { pickNotePlacement } from '../src/lib/placement.ts';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('missing SUPABASE_URL or SERVICE_ROLE_KEY');
  process.exit(1);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('fetching all visible notes…');
  // Page past PostgREST's silent 1000-row cap — repositioning only *some*
  // notes would leave the unfetched rest overlapping the new layout.
  const PAGE = 1000;
  const notes = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('notes')
      .select('id, created_at, x, y, rotation, z_index')
      .eq('is_visible', true)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('fetch failed:', error.message);
      process.exit(1);
    }
    notes.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  console.log(`got ${notes.length} notes.`);

  const placed = [];
  const updates = [];
  for (const note of notes) {
    const p = pickNotePlacement(placed);
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

import { NextResponse } from 'next/server';

import { isAdmin } from '@/lib/admin-auth';
import { pickNotePlacement } from '@/lib/placement';
import { getSupabaseServiceServer } from '@/lib/supabase-server';
import type { Note } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/reposition — re-lay-out every visible note through the
// current placement algorithm and write fresh x/y/rotation/z_index back.
//
// This is the one-click equivalent of scripts/reposition.mjs, gated behind the
// admin cookie. It's needed once after the note box grows (see placement.ts):
// notes packed under an older, tighter layout can overlap under the new box,
// and this re-spaces them so — for everyone, on every load — no two overlap.
// Idempotent: running it again just produces another clean layout.
const PAGE = 1000; // Supabase caps rows per select; page through them all.
const WRITE_CONCURRENCY = 25;

export async function POST() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const service = getSupabaseServiceServer();

  // Pull every visible note, oldest first, so the re-layout is deterministic
  // in creation order (the same order the wall grew in).
  const notes: Array<Pick<Note, 'id'>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await service
      .from('notes')
      .select('id')
      .eq('is_visible', true)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    notes.push(...(data as Array<Pick<Note, 'id'>>));
    if (data.length < PAGE) break;
  }

  // Compute the whole new layout up front. pickNotePlacement only reads x/y
  // off its neighbours, so we accumulate placed points as we go — the result
  // is guaranteed internally non-overlapping before we write a single row.
  const placed: Array<Pick<Note, 'x' | 'y'>> = [];
  const updates = notes.map((n) => {
    const p = pickNotePlacement(placed as Note[]);
    placed.push({ x: p.x, y: p.y });
    return { id: n.id, x: p.x, y: p.y, rotation: p.rotation, z_index: p.z_index };
  });

  // Write in small concurrent batches. Only x/y/rotation/z_index change; text,
  // colour, section, timestamps and moderation flags are untouched.
  let done = 0;
  let failed = 0;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    const batch = updates.slice(i, i + WRITE_CONCURRENCY);
    const results = await Promise.all(
      batch.map((u) =>
        service
          .from('notes')
          .update({ x: u.x, y: u.y, rotation: u.rotation, z_index: u.z_index })
          .eq('id', u.id)
          .then(({ error }) => (error ? false : true)),
      ),
    );
    for (const ok of results) ok ? done++ : failed++;
  }

  return NextResponse.json({ ok: failed === 0, repositioned: done, failed, total: updates.length });
}

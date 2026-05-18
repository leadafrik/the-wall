import { NextRequest, NextResponse } from 'next/server';

import { hashIp } from '@/lib/admin-auth';
import { checkReadRateLimit } from '@/lib/read-rate-limit';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { getSupabaseServiceServer } from '@/lib/supabase-server';
import { isSection } from '@/lib/sections';
import { pickNotePlacement } from '@/lib/placement';
import type { Note } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RETURN = 200;

// GET /api/notes/shuffle
// Returns up to 200 random visible notes WITH freshly-computed positions
// so the resulting layout has no overlap, even if the underlying DB rows
// happen to be clustered or were placed with the old buggy algorithm.
// The fresh x/y/rotation/z_index are ephemeral — never written to the DB —
// so each shuffle produces a clean view without disturbing permalinks
// or other users' sessions. The same session-cookie + per-IP rate-limit
// gates as the other read endpoints apply, so this is still bounded.
export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(sessionToken))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const ip = clientIp(req);
  const ipHash = hashIp(ip);
  const service = getSupabaseServiceServer();

  const rl = await checkReadRateLimit(service, ipHash);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'slow down — too many reads' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const url = new URL(req.url);
  const sectionParam = url.searchParams.get('section');
  const sectionArg = sectionParam && isSection(sectionParam) ? sectionParam : null;

  // Prefer the shuffle_notes Postgres function — it switches between
  // `order by random()` (small tables) and TABLESAMPLE SYSTEM_ROWS (large
  // tables) for bounded cost as the wall grows.
  const rpc = await service.rpc('shuffle_notes', {
    p_section: sectionArg,
    p_limit: MAX_RETURN,
  });

  let picked: Note[];
  if (!rpc.error) {
    picked = (rpc.data ?? []) as Note[];
  } else {
    // Fallback when the RPC isn't installed in this Supabase project yet.
    console.warn(
      `shuffle_notes RPC unavailable (${rpc.error.message}) — using JS fallback`,
    );
    let q = service
      .from('notes')
      .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
      .eq('is_visible', true)
      .order('created_at', { ascending: false });
    if (sectionArg) q = q.eq('section', sectionArg);
    const { data, error } = await q.limit(MAX_RETURN * 5);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const pool = (data ?? []).slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    picked = pool.slice(0, MAX_RETURN) as Note[];
  }

  // Re-lay-out the picked notes from scratch so this view has no overlap,
  // regardless of what positions the DB rows carry. We feed each placement
  // call only the notes we've already placed, so the algorithm builds a
  // fresh cohesive cluster.
  const repositioned: Note[] = [];
  for (const original of picked) {
    const placement = pickNotePlacement(repositioned);
    repositioned.push({
      ...original,
      x: placement.x,
      y: placement.y,
      rotation: placement.rotation,
      z_index: placement.z_index,
    });
  }

  return NextResponse.json(
    { notes: repositioned },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return '127.0.0.1';
}

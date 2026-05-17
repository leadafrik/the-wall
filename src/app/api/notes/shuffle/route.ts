import { NextRequest, NextResponse } from 'next/server';

import { hashIp } from '@/lib/admin-auth';
import { checkReadRateLimit } from '@/lib/read-rate-limit';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { getSupabaseServiceServer } from '@/lib/supabase-server';
import { isSection } from '@/lib/sections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RETURN = 200;

// GET /api/notes/shuffle
// Returns up to 200 random visible notes. Caller can optionally pass
// ?section=memory to shuffle within one section. Same session-cookie +
// per-IP rate-limit gates as the other read endpoints, so this is not
// a "give me everything" door for scrapers — they get a different random
// 200 each call but still bounded by the per-minute read budget.
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

  if (!rpc.error) {
    return NextResponse.json(
      { notes: rpc.data ?? [] },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  // Fallback when the RPC isn't installed in this Supabase project yet.
  // Pull a pool of recent notes and shuffle in JS. Works at small scale,
  // bounded at the pool size — install shuffle_notes for true scalability.
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

  return NextResponse.json(
    { notes: pool.slice(0, MAX_RETURN) },
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

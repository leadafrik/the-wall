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
  const section = url.searchParams.get('section');

  // Pull a pool of recent notes from the DB, shuffle client-side, take 200.
  // True SQL random sampling (`order by random()`) would need a Postgres
  // function — overkill at the wall's expected scale. The pool size (1000)
  // is the max breadth a shuffle can ever reach without that upgrade.
  let q = service
    .from('notes')
    .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
    .eq('is_visible', true)
    .order('created_at', { ascending: false });

  if (section && isSection(section)) {
    q = q.eq('section', section);
  }

  const { data, error } = await q.limit(MAX_RETURN * 5);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pool = data ?? [];
  shuffleInPlace(pool);
  const picked = pool.slice(0, MAX_RETURN);

  return NextResponse.json(
    { notes: picked },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return '127.0.0.1';
}

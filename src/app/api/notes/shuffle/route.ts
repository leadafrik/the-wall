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

  // Delegate sampling to the shuffle_notes Postgres function. It switches
  // between `order by random()` (small tables) and TABLESAMPLE SYSTEM_ROWS
  // (large tables) so cost stays bounded regardless of how many notes
  // the wall accumulates.
  const { data, error } = await service.rpc('shuffle_notes', {
    p_section: sectionArg,
    p_limit: MAX_RETURN,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { notes: data ?? [] },
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

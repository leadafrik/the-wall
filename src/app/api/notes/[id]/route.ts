import { NextRequest, NextResponse } from 'next/server';

import { hashIp } from '@/lib/admin-auth';
import { checkReadRateLimit } from '@/lib/read-rate-limit';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { getSupabaseAnonServer, getSupabaseServiceServer } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Session cookie required — blocks curl / wget cleanly.
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(sessionToken))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  // Per-IP read rate limit (shared budget with /api/notes).
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

  const supabase = getSupabaseAnonServer();
  const { data, error } = await supabase
    .from('notes')
    .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
    .eq('id', id)
    .eq('is_visible', true)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json(
    { note: data },
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

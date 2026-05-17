import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseAnonServer, getSupabaseServiceServer } from '@/lib/supabase-server';
import { hashIp } from '@/lib/admin-auth';
import { checkNoteRateLimit } from '@/lib/rate-limit';
import { checkReadRateLimit } from '@/lib/read-rate-limit';
import { moderateNote } from '@/lib/moderation';
import { CANVAS_SIZE, pickNotePlacement } from '@/lib/placement';
import { isSection, SECTION_COLORS } from '@/lib/sections';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import type { Note } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Hard cap on the largest possible payload from a single request. Wall
// users only see ~30 notes in viewport at once (virtualization), so this
// cap has no effect on real UX but caps what a scraper can pull per call.
const MAX_RETURN = 200;

// GET /api/notes
// Optional query params:
//   section=memory   filter to one section
//   x1,y1,x2,y2      viewport bounds (clamp results to a viewport)
//   limit=N          requested cap, clamped to MAX_RETURN regardless
export async function GET(req: NextRequest) {
  // 1. Browser session check — no valid HMAC cookie, no notes.
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(sessionToken))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 2. Per-IP read rate limit.
  const ip = clientIp(req);
  const ipHash = hashIp(ip);
  const service = getSupabaseServiceServer();
  const rl = await checkReadRateLimit(service, ipHash);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'slow down — too many reads' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  const url = new URL(req.url);
  const section = url.searchParams.get('section');
  const requested = parseInt(url.searchParams.get('limit') ?? String(MAX_RETURN), 10);
  const limit = Math.min(MAX_RETURN, Number.isFinite(requested) ? requested : MAX_RETURN);

  const supabase = getSupabaseAnonServer();
  let q = supabase
    .from('notes')
    .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
    .eq('is_visible', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (section && isSection(section)) {
    q = q.eq('section', section);
  }

  const bounds = parseBounds(url);
  if (bounds) {
    q = q
      .gte('x', bounds.x1)
      .lte('x', bounds.x2)
      .gte('y', bounds.y1)
      .lte('y', bounds.y2);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { notes: data ?? [] },
    {
      headers: {
        // Per-user cookie means we can't share this across sessions.
        'Cache-Control': 'private, no-store',
      },
    },
  );
}

// POST /api/notes — moderate, rate-limit, place, insert.
// Wrapped in a top-level try so the response is always JSON even when
// the env is misconfigured. (Without this, an uncaught throw becomes an
// HTML 500 page and the composer can't parse the body → "network hiccup".)
export async function POST(req: NextRequest) {
  try {
    return await handlePost(req);
  } catch (err) {
    console.error('POST /api/notes uncaught:', err);
    const message = err instanceof Error ? err.message : 'unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handlePost(req: NextRequest) {
  const ip = clientIp(req);

  // Origin check — cross-site bots tend not to set / spoof Origin properly.
  // Same-origin browser submissions always send a matching Origin header.
  if (!originAllowed(req)) {
    logRejection('bad_origin', 0).catch(() => {});
    return NextResponse.json({ error: 'bad request' }, { status: 403 });
  }

  let body: {
    text?: unknown;
    section?: unknown;
    color?: unknown;
    _h?: unknown;
    _t?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // Honeypot: any value here = bot. Respond with a generic 200-ish lie so
  // the bot doesn't learn its honeypot was the trigger.
  if (typeof body._h === 'string' && body._h.length > 0) {
    logRejection('honeypot', 0).catch(() => {});
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Min time to submit — a real person cannot read, pick a section, write 20+
  // characters, and click in under ~2 seconds. Bots can.
  const timeOpen = typeof body._t === 'number' ? body._t : 0;
  if (timeOpen < 2000) {
    logRejection('too_fast', 0).catch(() => {});
    return NextResponse.json({ error: 'slow down' }, { status: 429 });
  }

  const rawText = typeof body.text === 'string' ? body.text : '';
  const section = typeof body.section === 'string' ? body.section : '';
  const colorIn = typeof body.color === 'string' ? body.color : '';

  // Hard length cap from the schema. Moderation enforces the lower bound (20 chars).
  if (rawText.length > 280) {
    return NextResponse.json(
      { error: 'note is too long (max 280 chars)' },
      { status: 400 },
    );
  }
  if (!isSection(section)) {
    return NextResponse.json({ error: 'invalid section' }, { status: 400 });
  }

  // Color must be in this section's palette; otherwise fall back to the default.
  const palette = SECTION_COLORS[section];
  const color = palette.includes(colorIn) ? colorIn : palette[0];

  // Run the full moderation pipeline before doing anything else expensive.
  const moderation = await moderateNote(rawText);
  if (!moderation.allowed) {
    // Fire-and-forget rejection log — no text, just reason + length.
    logRejection(moderation.reason ?? 'unknown', rawText.trim().length).catch(
      (err) => console.error('moderation log failed:', err),
    );
    return NextResponse.json({ error: moderation.message }, { status: 422 });
  }

  const trimmed = rawText.trim();
  const ipHash = hashIp(ip);
  const service = getSupabaseServiceServer();

  // Per-IP rate limit (1 note / hour) — subsumes the prior duplicate guard
  // since you can't repeat a note when you can't post at all.
  const rl = await checkNoteRateLimit(service, ipHash);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: 'you left a note recently — come back soon',
        retry_after_seconds: rl.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  const { data: neighbors } = await service
    .from('notes')
    .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
    .eq('is_visible', true)
    .order('created_at', { ascending: false })
    .limit(400);

  const placement = pickNotePlacement((neighbors as Note[] | null) ?? []);

  const insert = {
    text: trimmed,
    section,
    color,
    x: placement.x,
    y: placement.y,
    rotation: placement.rotation,
    z_index: placement.z_index,
    ip_hash: ipHash,
    flagged: false,
  };

  const { data, error } = await service
    .from('notes')
    .insert(insert)
    .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 });
  }

  return NextResponse.json({
    note: data,
    crisisDetected: moderation.crisisDetected ?? false,
    canvas_size: CANVAS_SIZE,
  });
}

async function logRejection(reason: string, textLength: number): Promise<void> {
  try {
    const service = getSupabaseServiceServer();
    await service.from('moderation_log').insert({
      reason,
      text_length: textLength,
    });
  } catch {
    // Best-effort. If the table doesn't exist or env vars are missing, do nothing.
  }
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return '127.0.0.1';
}

// Accept the request only if Origin (or Referer as a fallback) matches the
// site we're being served from. Same-origin browser submits always do; most
// drive-by API spam doesn't bother.
function originAllowed(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const host = req.headers.get('host');
  if (!host) return false;

  const allowed = new Set<string>([
    `http://${host}`,
    `https://${host}`,
  ]);
  // Production canonical
  allowed.add('https://humanitywall.org');
  allowed.add('https://www.humanitywall.org');

  if (origin) return allowed.has(origin);
  if (referer) {
    try {
      const r = new URL(referer);
      return allowed.has(`${r.protocol}//${r.host}`);
    } catch {
      return false;
    }
  }
  // Some same-origin XHRs from older browsers don't send Origin/Referer.
  // We err on the side of allowing if both are missing — the other gates
  // (honeypot, time-to-submit, rate limit, moderation) still apply.
  return true;
}

function parseBounds(
  url: URL,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const x1 = url.searchParams.get('x1');
  const y1 = url.searchParams.get('y1');
  const x2 = url.searchParams.get('x2');
  const y2 = url.searchParams.get('y2');
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
  const nums = [x1, y1, x2, y2].map((s) => parseInt(s, 10));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return { x1: nums[0], y1: nums[1], x2: nums[2], y2: nums[3] };
}

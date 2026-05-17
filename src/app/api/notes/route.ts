import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseAnonServer, getSupabaseServiceServer } from '@/lib/supabase-server';
import { hashIp } from '@/lib/admin-auth';
import { checkNoteRateLimit } from '@/lib/rate-limit';
import { moderateNote } from '@/lib/moderation';
import { CANVAS_SIZE, pickNotePlacement } from '@/lib/placement';
import { isSection, SECTION_COLORS } from '@/lib/sections';
import type { Note } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/notes
// Optional query params:
//   section=memory                         filter to one section
//   x1,y1,x2,y2 viewport bounds            (clamp results to a viewport)
//   limit=500                              cap
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const section = url.searchParams.get('section');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '2000', 10) || 2000, 5000);

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
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
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

  let body: { text?: unknown; section?: unknown; color?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
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

  // Duplicate guard: same normalized text from the same hashed IP within the last hour.
  // Cuts down on accidental double-submits and copy-paste spam.
  const service = getSupabaseServiceServer();
  if (await isDuplicateRecent(service, ipHash, trimmed)) {
    return NextResponse.json(
      {
        error: "you already posted that one — try saying something new.",
      },
      { status: 422 },
    );
  }

  const rl = await checkNoteRateLimit(ip);
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

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function isDuplicateRecent(
  service: ReturnType<typeof getSupabaseServiceServer>,
  ipHash: string,
  text: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await service
    .from('notes')
    .select('text')
    .eq('ip_hash', ipHash)
    .gte('created_at', since)
    .limit(50);
  if (error || !data) return false;
  const target = normalize(text);
  return data.some((row: { text: string }) => normalize(row.text) === target);
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return '127.0.0.1';
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

// Vercel Cron entry point. Runs on the schedule defined in vercel.json
// (currently 02:30 UTC daily). Hides seeded notes once the wall is well
// enough populated by real users to stand on its own.
//
// SAFETY: this endpoint ONLY ever touches rows where ip_hash = 'seed'.
// Real user notes carry a 16-char SHA-256 hash of their IP+salt, which can
// never equal the literal string 'seed'. The UPDATE below is filtered on
// that exact value — user notes are untouchable by this job, by design.
//
// Two retirement conditions (whichever happens first):
//   * MAX_AGE_DAYS days since the oldest seed was inserted
//   * MIN_REAL_NOTES distinct visible real-user notes exist
//
// Hides via is_visible = false rather than deleting so an admin can
// restore everything if needed. To permanently remove, use:
//   node --env-file=.env.local scripts/seed.mjs --purge

import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServiceServer } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AGE_DAYS = 60;
const MIN_REAL_NOTES = 100;

export async function GET(req: NextRequest) {
  // Vercel Cron sets Authorization: Bearer ${CRON_SECRET} automatically.
  // Anything else hitting this URL gets 401.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 },
    );
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const service = getSupabaseServiceServer();

  // How many real (non-seed) visible notes exist?
  const { count: realCount, error: countErr } = await service
    .from('notes')
    .select('id', { count: 'exact', head: true })
    .eq('is_visible', true)
    .neq('ip_hash', 'seed');
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }

  // Are any seeds visible, and how old is the oldest one?
  const { data: oldestSeed, error: seedErr } = await service
    .from('notes')
    .select('created_at')
    .eq('ip_hash', 'seed')
    .eq('is_visible', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (seedErr) {
    return NextResponse.json({ error: seedErr.message }, { status: 500 });
  }

  if (!oldestSeed) {
    return NextResponse.json({
      ok: true,
      action: 'noop',
      reason: 'no visible seeds left',
      real_notes: realCount ?? 0,
    });
  }

  const ageMs = Date.now() - new Date(oldestSeed.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  const realThresholdHit = (realCount ?? 0) >= MIN_REAL_NOTES;
  const ageThresholdHit = ageDays >= MAX_AGE_DAYS;

  if (!realThresholdHit && !ageThresholdHit) {
    return NextResponse.json({
      ok: true,
      action: 'noop',
      real_notes: realCount ?? 0,
      seed_age_days: Number(ageDays.toFixed(2)),
      thresholds: { real_notes: MIN_REAL_NOTES, age_days: MAX_AGE_DAYS },
    });
  }

  // Hide all seeded notes.
  const { error: updErr, count: hidden } = await service
    .from('notes')
    .update({ is_visible: false }, { count: 'exact' })
    .eq('ip_hash', 'seed')
    .eq('is_visible', true);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    action: 'expired',
    hidden,
    triggered_by: realThresholdHit ? 'real_note_count' : 'age',
    real_notes: realCount ?? 0,
    seed_age_days: Number(ageDays.toFixed(2)),
  });
}

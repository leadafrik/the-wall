// Per-IP rate limit, backed by the notes table.
//
// Why Supabase and not Redis: keeps infra at one moving part. The
// (ip_hash, created_at desc) index makes this query O(1)-ish per submission.
// We use the service-role client so RLS doesn't hide moderated/hidden notes —
// an attacker shouldn't be able to dodge the limit by writing notes that
// later get hidden.

import type { getSupabaseServiceServer } from './supabase-server';

// One note per IP per WINDOW_MS. Change here if you want a softer cap.
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function checkNoteRateLimit(
  service: ReturnType<typeof getSupabaseServiceServer>,
  ipHash: string,
): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { data, error } = await service
    .from('notes')
    .select('created_at')
    .eq('ip_hash', ipHash)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return { ok: true, retryAfterSeconds: 0 };
  }

  const lastMs = new Date(data[0].created_at).getTime();
  const remaining = RATE_LIMIT_WINDOW_MS - (Date.now() - lastMs);
  if (remaining <= 0) return { ok: true, retryAfterSeconds: 0 };
  return { ok: false, retryAfterSeconds: Math.ceil(remaining / 1000) };
}

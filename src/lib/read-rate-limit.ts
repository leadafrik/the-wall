// Per-IP read rate limit, backed by Supabase.
//
// Increments a per-minute counter atomically via the incr_read_rate RPC,
// then rejects if this minute's count has crossed the limit. The RPC is
// defined in supabase/schema.sql.
//
// Real visitors hit a handful of reads per minute; scrapers hit hundreds.

import type { getSupabaseServiceServer } from './supabase-server';

export const READ_LIMIT_PER_MIN = 60;

export async function checkReadRateLimit(
  service: ReturnType<typeof getSupabaseServiceServer>,
  ipHash: string,
): Promise<{ ok: boolean; retryAfterSeconds: number; hits: number }> {
  const bucket = Math.floor(Date.now() / 60_000);

  const { data, error } = await service.rpc('incr_read_rate', {
    p_ip_hash: ipHash,
    p_bucket: bucket,
  });

  // Fail open on RPC errors — better to let a real user through than block
  // everyone when our infra hiccups.
  if (error) {
    console.error('incr_read_rate failed:', error.message);
    return { ok: true, retryAfterSeconds: 0, hits: 0 };
  }

  const hits = typeof data === 'number' ? data : 0;
  if (hits > READ_LIMIT_PER_MIN) {
    const msToNextBucket = (bucket + 1) * 60_000 - Date.now();
    return {
      ok: false,
      retryAfterSeconds: Math.ceil(msToNextBucket / 1000),
      hits,
    };
  }
  return { ok: true, retryAfterSeconds: 0, hits };
}

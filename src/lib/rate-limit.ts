import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let limiter: Ratelimit | null = null;
let enabled = false;

function init() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    enabled = false;
    return;
  }
  const redis = new Redis({ url, token });
  limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(1, '1 h'),
    analytics: false,
    prefix: 'thewall:notes',
  });
  enabled = true;
}

init();

export async function checkNoteRateLimit(ip: string): Promise<{
  ok: boolean;
  retryAfterSeconds: number;
}> {
  if (!enabled || !limiter) {
    // No Upstash configured — fail open so local dev still works.
    return { ok: true, retryAfterSeconds: 0 };
  }
  const res = await limiter.limit(ip);
  if (res.success) return { ok: true, retryAfterSeconds: 0 };
  const retry = Math.max(0, Math.ceil((res.reset - Date.now()) / 1000));
  return { ok: false, retryAfterSeconds: retry };
}

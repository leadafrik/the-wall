// Cloudflare Turnstile server-side verification.
//
// Behavior:
//  - No TURNSTILE_SECRET_KEY in env -> fail open (dev/preview without secret).
//  - Explicit verify failure (CF says success:false) -> reject.
//  - Network/timeout reaching CF -> fail open. The other gates (honeypot,
//    time-to-submit, moderation, rate limit) still apply; we'd rather not
//    take the whole composer offline because CF is having a bad minute.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  ok: boolean;
  reason?: string;
}

export async function verifyTurnstile(
  token: string | undefined,
  ip: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, reason: 'unconfigured' };

  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'missing_token' };
  }

  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(4000),
    });
    const data = (await res.json()) as {
      success?: boolean;
      'error-codes'?: string[];
    };
    if (data.success) return { ok: true };
    return {
      ok: false,
      reason: (data['error-codes'] ?? ['failed']).join(','),
    };
  } catch {
    return { ok: true, reason: 'verify_unreachable' };
  }
}

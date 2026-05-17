// Signed session cookies, Edge-runtime compatible (uses Web Crypto, no Node `crypto`).
//
// What this buys us:
//   * `curl /api/notes` returns 401 unless the caller already has a valid
//     cookie. Browsers get one automatically via middleware on first visit.
//   * Tokens are HMAC-signed and embed the issue time, so a leaked token
//     expires after MAX_AGE_MS.
//   * The secret never leaves the server — there's no way for client JS to
//     forge a token without it.

export const SESSION_COOKIE = 'wall_session';
export const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    // Dev fallback so we don't crash. Production should always set this.
    return 'dev-only-insecure-session-secret-please-set-env';
  }
  return s;
}

async function hmacHex(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function issueSessionToken(): Promise<string> {
  const issuedAt = Date.now().toString(36);
  const sig = await hmacHex(issuedAt);
  return `${issuedAt}.${sig}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [issuedAt, providedSig] = parts;
  const issuedMs = parseInt(issuedAt, 36);
  if (!Number.isFinite(issuedMs)) return false;
  if (Date.now() - issuedMs > MAX_AGE_MS) return false;
  if (issuedMs > Date.now() + 60_000) return false; // can't be from the future
  const expected = await hmacHex(issuedAt);
  return constantTimeEqual(expected, providedSig);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

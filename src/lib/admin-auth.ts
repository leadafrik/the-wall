import { cookies } from 'next/headers';
import crypto from 'node:crypto';

const COOKIE_NAME = 'wall_admin';

function expectedToken(): string {
  const password = process.env.ADMIN_PASSWORD ?? '';
  const salt = process.env.IP_HASH_SALT ?? '';
  return crypto.createHash('sha256').update(password + ':' + salt).digest('hex');
}

export async function isAdmin(): Promise<boolean> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return false;
  const expected = expectedToken();
  return safeEqual(token, expected);
}

export async function setAdminCookie() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, expectedToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8, // 8 hours
  });
}

export async function clearAdminCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export function passwordMatches(submitted: string): boolean {
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!password) return false;
  return safeEqual(submitted, password);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? '';
  return crypto.createHash('sha256').update(ip + ':' + salt).digest('hex').slice(0, 16);
}

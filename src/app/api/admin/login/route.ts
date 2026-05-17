import { NextRequest, NextResponse } from 'next/server';

import {
  clearAdminCookie,
  passwordMatches,
  setAdminCookie,
} from '@/lib/admin-auth';

export const runtime = 'nodejs';

// Artificial delay on every wrong-password attempt. Brute force on a single
// node now costs ≥ FAIL_DELAY_MS per guess, which makes any meaningful
// attack against a strong password infeasible.
const FAIL_DELAY_MS = 1500;

export async function POST(req: NextRequest) {
  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const password = typeof body.password === 'string' ? body.password : '';

  if (!passwordMatches(password)) {
    await new Promise((resolve) => setTimeout(resolve, FAIL_DELAY_MS));
    return NextResponse.json({ error: 'wrong password' }, { status: 401 });
  }

  await setAdminCookie();
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await clearAdminCookie();
  return NextResponse.json({ ok: true });
}

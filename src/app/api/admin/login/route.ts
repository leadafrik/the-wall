import { NextRequest, NextResponse } from 'next/server';

import {
  clearAdminCookie,
  passwordMatches,
  setAdminCookie,
} from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const password = typeof body.password === 'string' ? body.password : '';

  if (!passwordMatches(password)) {
    return NextResponse.json({ error: 'wrong password' }, { status: 401 });
  }

  await setAdminCookie();
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await clearAdminCookie();
  return NextResponse.json({ ok: true });
}

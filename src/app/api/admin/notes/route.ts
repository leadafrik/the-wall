import { NextRequest, NextResponse } from 'next/server';

import { isAdmin } from '@/lib/admin-auth';
import { getSupabaseServiceServer } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/notes — list every note (including hidden) for moderation.
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200', 10) || 200, 500);

  const service = getSupabaseServiceServer();
  const { data, error } = await service
    .from('notes')
    .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible,ip_hash,flagged')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data ?? [] });
}

// PATCH /api/admin/notes — toggle visibility / flagged.
// Body: { id, is_visible?, flagged? }
export async function PATCH(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { id?: unknown; is_visible?: unknown; flagged?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const patch: { is_visible?: boolean; flagged?: boolean } = {};
  if (typeof body.is_visible === 'boolean') patch.is_visible = body.is_visible;
  if (typeof body.flagged === 'boolean') patch.flagged = body.flagged;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const service = getSupabaseServiceServer();
  const { error } = await service.from('notes').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseAnonServer } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const supabase = getSupabaseAnonServer();
  const { data, error } = await supabase
    .from('notes')
    .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
    .eq('id', id)
    .eq('is_visible', true)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({ note: data });
}

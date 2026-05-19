import { NextResponse } from 'next/server';

import { isAdmin } from '@/lib/admin-auth';
import { getSupabaseServiceServer } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/stats — small dashboard counts, derived entirely from
// data we already keep. Distinct ip_hash from the rate-limit table is the
// non-invasive "how many people stopped by" signal.
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const service = getSupabaseServiceServer();
  const nowMs = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const bucket24h = Math.floor((nowMs - day) / 60_000);
  const bucket7d = Math.floor((nowMs - 7 * day) / 60_000);
  const since24hIso = new Date(nowMs - day).toISOString();

  const [notesTotal, notesLast24h, visitors24h, visitors7d] = await Promise.all([
    service
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .eq('is_visible', true),
    service
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since24hIso),
    service.rpc('visitor_count', { p_since_bucket: bucket24h }),
    service.rpc('visitor_count', { p_since_bucket: bucket7d }),
  ]);

  return NextResponse.json({
    notes_visible: notesTotal.count ?? 0,
    notes_last_24h: notesLast24h.count ?? 0,
    visitors_24h: (visitors24h.data as number | null) ?? null,
    visitors_7d: (visitors7d.data as number | null) ?? null,
  });
}

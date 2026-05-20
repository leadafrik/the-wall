import { notFound } from 'next/navigation';

import { WallClient } from '@/components/WallClient';
import { canvasSizeForNotes } from '@/lib/placement';
import { getSupabaseAnonServer } from '@/lib/supabase-server';
import type { Note } from '@/types';

export const revalidate = 60;

// Individual notes are intentionally kept out of search indexes.
// Backs up the disallow rule in robots.ts so any crawler that ignores
// robots.txt still sees a hard in-page noindex.
export const metadata = {
  robots: { index: false, follow: false },
};

export default async function NotePermalink({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const loaded = await loadNoteAndContext(id);
  if (!loaded) notFound();

  return (
    <WallClient
      initialNotes={loaded.all}
      initialCanvasSize={loaded.canvasSize}
      activeSection={null}
      initialFocus={loaded.focus}
    />
  );
}

async function loadNoteAndContext(
  id: string,
): Promise<{ focus: Note; all: Note[]; canvasSize: number } | null> {
  try {
    const supabase = getSupabaseAnonServer();

    const [focusRes, restRes, countRes] = await Promise.all([
      supabase
        .from('notes')
        .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
        .eq('id', id)
        .eq('is_visible', true)
        .maybeSingle(),
      supabase
        .from('notes')
        .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
        .eq('is_visible', true)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('notes')
        .select('id', { count: 'exact', head: true })
        .eq('is_visible', true),
    ]);

    const focus = focusRes.data;
    if (!focus) return null;

    const all: Note[] = (restRes.data as Note[] | null) ?? [];
    if (!all.some((n) => n.id === focus.id)) all.unshift(focus as Note);
    return {
      focus: focus as Note,
      all,
      canvasSize: canvasSizeForNotes(countRes.count ?? 0),
    };
  } catch {
    return null;
  }
}

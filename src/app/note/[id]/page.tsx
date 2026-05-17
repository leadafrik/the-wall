import { notFound } from 'next/navigation';

import { WallClient } from '@/components/WallClient';
import { getSupabaseAnonServer } from '@/lib/supabase-server';
import type { Note } from '@/types';

export const revalidate = 60;

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
      activeSection={null}
      initialFocus={loaded.focus}
    />
  );
}

async function loadNoteAndContext(
  id: string,
): Promise<{ focus: Note; all: Note[] } | null> {
  try {
    const supabase = getSupabaseAnonServer();

    const { data: focus } = await supabase
      .from('notes')
      .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
      .eq('id', id)
      .eq('is_visible', true)
      .maybeSingle();

    if (!focus) return null;

    const { data: rest } = await supabase
      .from('notes')
      .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
      .eq('is_visible', true)
      .order('created_at', { ascending: false })
      .limit(2000);

    const all: Note[] = (rest as Note[] | null) ?? [];
    if (!all.some((n) => n.id === focus.id)) all.unshift(focus as Note);
    return { focus: focus as Note, all };
  } catch {
    return null;
  }
}

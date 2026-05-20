import { WallClient } from '@/components/WallClient';
import { canvasSizeForNotes } from '@/lib/placement';
import { getSupabaseAnonServer } from '@/lib/supabase-server';
import type { Note } from '@/types';

export const revalidate = 60;

export default async function Home() {
  const { notes, canvasSize } = await loadNotes();
  return (
    <WallClient
      initialNotes={notes}
      initialCanvasSize={canvasSize}
      activeSection={null}
    />
  );
}

async function loadNotes(): Promise<{ notes: Note[]; canvasSize: number }> {
  try {
    const supabase = getSupabaseAnonServer();
    const [notesRes, countRes] = await Promise.all([
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
    return {
      notes: (notesRes.data as Note[] | null) ?? [],
      canvasSize: canvasSizeForNotes(countRes.count ?? 0),
    };
  } catch {
    return { notes: [], canvasSize: canvasSizeForNotes(0) };
  }
}

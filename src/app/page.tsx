import { WallClient } from '@/components/WallClient';
import { getSupabaseAnonServer } from '@/lib/supabase-server';
import type { Note } from '@/types';

export const revalidate = 60;

export default async function Home() {
  const notes = await loadNotes();
  return <WallClient initialNotes={notes} activeSection={null} />;
}

async function loadNotes(): Promise<Note[]> {
  try {
    const supabase = getSupabaseAnonServer();
    const { data } = await supabase
      .from('notes')
      .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
      .eq('is_visible', true)
      .order('created_at', { ascending: false })
      .limit(200);
    return (data as Note[] | null) ?? [];
  } catch {
    return [];
  }
}

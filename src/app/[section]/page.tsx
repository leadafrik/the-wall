import { notFound } from 'next/navigation';

import { WallClient } from '@/components/WallClient';
import { canvasSizeForNotes } from '@/lib/placement';
import { slugToSection } from '@/lib/sections';
import { getSupabaseAnonServer } from '@/lib/supabase-server';
import type { Note } from '@/types';

export const revalidate = 60;

// Reserve known top-level routes so /about and /admin aren't treated as section slugs.
const RESERVED = new Set(['about', 'admin', 'api', 'note', 'legal']);

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section: slug } = await params;
  if (RESERVED.has(slug)) notFound();
  const section = slugToSection(slug);
  if (!section) notFound();

  const { notes, canvasSize } = await loadSectionNotes(section);

  return (
    <WallClient
      initialNotes={notes}
      initialCanvasSize={canvasSize}
      activeSection={section}
    />
  );
}

async function loadSectionNotes(
  section: string,
): Promise<{ notes: Note[]; canvasSize: number }> {
  try {
    const supabase = getSupabaseAnonServer();
    // Count is across the whole wall (not just this section) — the canvas
    // belongs to the wall, not to the section view.
    const [notesRes, countRes] = await Promise.all([
      supabase
        .from('notes')
        .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
        .eq('is_visible', true)
        .eq('section', section)
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

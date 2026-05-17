import { notFound } from 'next/navigation';

import { WallClient } from '@/components/WallClient';
import { slugToSection } from '@/lib/sections';
import { getSupabaseAnonServer } from '@/lib/supabase-server';
import type { Note } from '@/types';

export const revalidate = 60;

// Reserve known top-level routes so /about and /admin aren't treated as section slugs.
const RESERVED = new Set(['about', 'admin', 'api', 'note']);

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section: slug } = await params;
  if (RESERVED.has(slug)) notFound();
  const section = slugToSection(slug);
  if (!section) notFound();

  const notes = await loadSectionNotes(section);

  return <WallClient initialNotes={notes} activeSection={section} />;
}

async function loadSectionNotes(section: string): Promise<Note[]> {
  try {
    const supabase = getSupabaseAnonServer();
    const { data } = await supabase
      .from('notes')
      .select('id,text,section,color,x,y,rotation,z_index,created_at,is_visible')
      .eq('is_visible', true)
      .eq('section', section)
      .order('created_at', { ascending: false })
      .limit(200);
    return (data as Note[] | null) ?? [];
  } catch {
    return [];
  }
}

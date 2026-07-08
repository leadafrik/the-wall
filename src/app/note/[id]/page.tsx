import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

import { WallClient } from '@/components/WallClient';
import { notePath, noteUrl } from '@/lib/note-url';
import { canvasSizeForNotes } from '@/lib/placement';
import { getSupabaseAnonServer } from '@/lib/supabase-server';
import type { Note } from '@/types';

export const revalidate = 60;

// The param is either a slug ("first-words-of-the-note-1a2b3c4d") or a
// bare uuid from links minted before slugs existed. UUID links still
// resolve, then 308 to the canonical slug URL so search engines converge
// on one address per note.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const note = await fetchNote((await params).id);
  if (!note) return { robots: { index: false, follow: false } };

  const title = `${excerpt(note.text, 60)} — the wall`;
  const description = `${excerpt(note.text, 150)} · an anonymous note in ${note.section} on the wall.`;
  const url = noteUrl(note);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: 'the wall',
      type: 'article',
      publishedTime: note.created_at,
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function NotePermalink({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const focus = await fetchNote(id);
  if (!focus) notFound();

  // Old uuid links: send crawlers and shares to the canonical slug URL.
  if (UUID_RE.test(id) && focus.slug) {
    permanentRedirect(notePath(focus));
  }

  const loaded = await loadContext(focus);
  if (!loaded) notFound();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SocialMediaPosting',
            url: noteUrl(loaded.focus),
            text: loaded.focus.text,
            datePublished: loaded.focus.created_at,
            articleSection: loaded.focus.section,
            isPartOf: { '@type': 'WebSite', name: 'the wall', url: 'https://humanitywall.org' },
          }),
        }}
      />
      <WallClient
        initialNotes={loaded.all}
        initialCanvasSize={loaded.canvasSize}
        activeSection={null}
        initialFocus={loaded.focus}
      />
    </>
  );
}

function excerpt(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max)}…`;
}

async function fetchNote(idOrSlug: string): Promise<Note | null> {
  const byId = UUID_RE.test(idOrSlug);
  if (!byId && !SLUG_RE.test(idOrSlug)) return null;

  try {
    const supabase = getSupabaseAnonServer();
    const { data } = await supabase
      .from('notes')
      .select('id,slug,text,section,color,x,y,rotation,z_index,created_at,is_visible')
      .eq(byId ? 'id' : 'slug', idOrSlug)
      .eq('is_visible', true)
      .maybeSingle();
    return (data as Note | null) ?? null;
  } catch {
    return null;
  }
}

async function loadContext(
  focus: Note,
): Promise<{ focus: Note; all: Note[]; canvasSize: number } | null> {
  try {
    const supabase = getSupabaseAnonServer();
    const [restRes, countRes] = await Promise.all([
      supabase
        .from('notes')
        .select('id,slug,text,section,color,x,y,rotation,z_index,created_at,is_visible')
        .eq('is_visible', true)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('notes')
        .select('id', { count: 'exact', head: true })
        .eq('is_visible', true),
    ]);

    const all: Note[] = (restRes.data as Note[] | null) ?? [];
    if (!all.some((n) => n.id === focus.id)) all.unshift(focus);
    return {
      focus,
      all,
      canvasSize: canvasSizeForNotes(countRes.count ?? 0),
    };
  } catch {
    return null;
  }
}

import type { MetadataRoute } from 'next';

import { notePath, SITE_URL } from '@/lib/note-url';
import { SECTIONS, sectionToSlug } from '@/lib/sections';
import { getSupabaseAnonServer } from '@/lib/supabase-server';

// Re-generate at most hourly — new notes show up in the next build of the
// sitemap without hammering the DB on every crawler fetch.
export const revalidate = 3600;

// Supabase caps a single select at 1000 rows; page through in chunks.
// 50 pages × 1000 rows = 50k URLs, the per-file limit of the sitemap spec.
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`,               lastModified: now, changeFrequency: 'hourly', priority: 1.0 },
    { url: `${SITE_URL}/about`,          lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/legal/terms`,    lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/legal/privacy`,  lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/legal/takedown`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    ...SECTIONS.map((s) => ({
      url: `${SITE_URL}/${sectionToSlug(s)}`,
      lastModified: now,
      changeFrequency: 'hourly' as const,
      priority: 0.8,
    })),
  ];

  return [...staticEntries, ...(await noteEntries())];
}

async function noteEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const supabase = getSupabaseAnonServer();
    const entries: MetadataRoute.Sitemap = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from('notes')
        .select('id,slug,created_at')
        .eq('is_visible', true)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error || !data) break;

      for (const note of data) {
        entries.push({
          url: `${SITE_URL}${notePath(note)}`,
          lastModified: new Date(note.created_at),
          changeFrequency: 'yearly',
          priority: 0.5,
        });
      }

      if (data.length < PAGE_SIZE) break;
    }

    return entries;
  } catch {
    // Env misconfigured or DB unreachable — a sitemap without note URLs
    // is still valid; don't fail the whole route.
    return [];
  }
}

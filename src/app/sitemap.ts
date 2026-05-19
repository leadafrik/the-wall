import type { MetadataRoute } from 'next';

import { SECTIONS, sectionToSlug } from '@/lib/sections';

const SITE = 'https://humanitywall.org';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`,                 lastModified: now, changeFrequency: 'hourly', priority: 1.0 },
    { url: `${SITE}/about`,            lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE}/legal/terms`,      lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE}/legal/privacy`,    lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE}/legal/takedown`,   lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    ...SECTIONS.map((s) => ({
      url: `${SITE}/${sectionToSlug(s)}`,
      lastModified: now,
      changeFrequency: 'hourly' as const,
      priority: 0.8,
    })),
  ];
}

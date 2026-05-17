import type { MetadataRoute } from 'next';

import { SECTIONS, sectionToSlug } from '@/lib/sections';

const SITE = 'https://humanitywall.org';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`,      lastModified: now, changeFrequency: 'always',  priority: 1 },
    { url: `${SITE}/about`, lastModified: now, changeFrequency: 'yearly',  priority: 0.5 },
    ...SECTIONS.map((s) => ({
      url: `${SITE}/${sectionToSlug(s)}`,
      lastModified: now,
      changeFrequency: 'hourly' as const,
      priority: 0.8,
    })),
  ];
}

import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Note: /note/ is deliberately NOT disallowed. Individual notes stay
        // out of search via a hard in-page noindex (see note/[id]/page.tsx) —
        // and a crawler must be *allowed* to fetch the page to see that
        // noindex, so blocking /note/ here would actually be counterproductive.
        // Allowing the fetch also lets social scrapers (X, Facebook, Discord,
        // Slack) read each note's Open Graph share card. Search: no. Share: yes.
        disallow: ['/admin', '/api/'],
      },
    ],
    sitemap: 'https://humanitywall.org/sitemap.xml',
    host: 'https://humanitywall.org',
  };
}

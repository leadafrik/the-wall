import type { Metadata, Viewport } from 'next';
import { Caveat, Lora } from 'next/font/google';

import './globals.css';

// next/font self-hosts the fonts and inlines optimized CSS at build time.
// That means there's no FOUT (flash of unstyled text) or FOIT (flash of
// invisible text) — the wall renders with the right font from frame one.
// We also pass a `fallback` chain so even if a browser somehow can't load
// the font, the substitute is legible (not the generic `cursive` mess).
const caveat = Caveat({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-caveat',
  display: 'swap',
  fallback: ['Bradley Hand', 'Segoe Print', 'system-ui', 'sans-serif'],
  adjustFontFallback: false,
});

const lora = Lora({
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-lora',
  display: 'swap',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://humanitywall.org'),
  title: 'the wall',
  description:
    'an anonymous, public, living archive of human expression. no names, no accounts — just words left on a wall.',
  verification: {
    // Google Search Console — emits <meta name="google-site-verification" ...>.
    // Token is from the URL-prefix property at https://search.google.com/search-console.
    google: 'aSAC_GBY8kbbJVgaQjLLH2pNYTlT4-0cI7LEOkgk7VM',
  },
  openGraph: {
    title: 'the wall',
    description:
      'an anonymous, public, living archive of human expression.',
    url: 'https://humanitywall.org',
    siteName: 'the wall',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'the wall',
    description: 'an anonymous, public, living archive of human expression.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 2,
  userScalable: true,
  themeColor: '#f5f0e8',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${caveat.variable} ${lora.variable}`}>
      <head>
        {/* Tells Google "this is a real site with a name and a description"
            so brand searches can render a sitelinks card instead of just a
            blue link. Schema.org WebSite is the minimum useful structured
            data for a site like this — no fake author, no fake rating. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'the wall',
              alternateName: 'humanity wall',
              url: 'https://humanitywall.org',
              description:
                'an anonymous, public, living archive of human expression. no names, no accounts — just words left on a wall.',
              inLanguage: 'en',
            }),
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

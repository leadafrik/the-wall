import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://humanitywall.org'),
  title: 'the wall',
  description:
    'an anonymous, public, living archive of human expression. no names, no accounts — just words left on a wall.',
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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500&family=Lora:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

import Link from 'next/link';
import type { Metadata } from 'next';
import { marked } from 'marked';

import { FAQ } from '@/lib/faq';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'frequently asked questions · the wall',
  description:
    'what the wall is, where to vent anonymously, what to write, how privacy works, and more — the common questions, answered plainly.',
  alternates: { canonical: '/faq' },
  openGraph: {
    title: 'frequently asked questions · the wall',
    description:
      'what the wall is, where to vent anonymously, what to write, and how privacy works.',
    url: 'https://humanitywall.org/faq',
    type: 'website',
  },
};

export default function Faq() {
  const items = FAQ.map((f) => ({ ...f, html: marked.parse(f.a, { async: false }) as string }));

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.html },
    })),
  };

  return (
    <main className="read read--article">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />

      <header className="read__topbar">
        <Link href="/" className="read__home">the wall</Link>
        <span className="read__crumb">faq</span>
      </header>

      <div className="read__inner">
        <h1 className="read__title">frequently asked questions</h1>

        <dl className="faq">
          {items.map((f, i) => (
            <div className="faq__item" key={i}>
              <dt className="faq__q">{f.q}</dt>
              <dd
                className="faq__a read__body"
                dangerouslySetInnerHTML={{ __html: f.html }}
              />
            </div>
          ))}
        </dl>

        <aside className="read__cta">
          <p className="read__cta-links">
            <Link href="/">leave a note on the wall →</Link>
          </p>
        </aside>

        <p className="read__back">
          <Link href="/read">← read</Link>
          {' · '}
          <Link href="/about">about</Link>
        </p>
      </div>
    </main>
  );
}

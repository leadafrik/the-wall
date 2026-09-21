import Link from 'next/link';
import type { Metadata } from 'next';

import { getArticlesBySection } from '@/lib/read';
import { SECTIONS, sectionToSlug } from '@/lib/sections';
import type { Section } from '@/types';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'read — venting, unsent words & human questions · the wall',
  description:
    'quiet writing on venting, confessions, things left unsaid, memory, and the ideas we don’t finish. from the people behind the wall.',
  alternates: { canonical: '/read' },
  openGraph: {
    title: 'read · the wall',
    description:
      'quiet writing on venting, confessions, things unsaid, memory, and the ideas we don’t finish.',
    url: 'https://humanitywall.org/read',
    type: 'website',
  },
};

// One line of the wall's voice per section, and the soft door into it.
const SECTION_HUB: Record<Section, { line: string; cta: string }> = {
  venting: {
    line: 'for the things you need to get out without turning them into a performance.',
    cta: 'go to venting',
  },
  ideas: {
    line: 'for questions, sparks and thoughts that haven’t decided what they are yet.',
    cta: 'leave an idea',
  },
  memory: {
    line: 'for small moments, and people, you don’t want to lose.',
    cta: 'leave a memory',
  },
  'things unsaid': {
    line: 'for messages that may never have a recipient.',
    cta: 'leave something unsaid',
  },
  confessions: {
    line: 'for the things that feel easier to say without a name.',
    cta: 'read anonymous confessions',
  },
};

export default function ReadHub() {
  const sections = SECTIONS.map((s) => ({ section: s, articles: getArticlesBySection(s) })).filter(
    (g) => g.articles.length > 0,
  );

  return (
    <main className="read read--hub">
      <header className="read__topbar">
        <Link href="/" className="read__home">the wall</Link>
        <span className="read__crumb">read</span>
      </header>

      <div className="read__inner">
        <h1 className="read__title">read — words for what people carry</h1>
        <p className="read__lede">
          some things need an answer. some just need somewhere to be put. this is a
          small library about the words people carry: the rant you don’t want advice
          on, the message you won’t send, the memory you’re afraid of losing, the
          thing you’ve never told anyone. read what helps. when you’re ready, the
          wall is there too.
        </p>

        {sections.map(({ section, articles }) => (
          <section className="read__cluster" key={section}>
            <h2 className="read__cluster-title">{section}</h2>
            <p className="read__cluster-line">{SECTION_HUB[section].line}</p>
            <ul className="read__list">
              {articles.map((a) => (
                <li key={a.slug}>
                  <Link href={`/read/${a.slug}`}>{a.hubTitle}</Link>
                  {a.pillar && <span className="read__tag"> · start here</span>}
                </li>
              ))}
            </ul>
            <Link className="read__section-link" href={`/${sectionToSlug(section)}`}>
              {SECTION_HUB[section].cta} →
            </Link>
          </section>
        ))}

        <p className="read__footnote">
          new here? the <Link href="/faq">faq</Link> explains how the wall works.
          this is a place to read and reflect, not a substitute for professional
          support — if you’re struggling, a counselor or a crisis line can help in
          ways a page can’t.
        </p>
      </div>
    </main>
  );
}

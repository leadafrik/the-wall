import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { getAllArticles, getArticle, type Safety } from '@/lib/read';
import { sectionToSlug } from '@/lib/sections';
import type { Section } from '@/types';

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllArticles().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) return {};
  return {
    title: `${article.title} · the wall`,
    description: article.description,
    alternates: { canonical: `/read/${article.slug}` },
    openGraph: {
      title: article.title,
      description: article.description,
      url: `https://humanitywall.org/read/${article.slug}`,
      type: 'article',
      publishedTime: article.published || undefined,
      modifiedTime: article.updated || undefined,
    },
  };
}

// Soft, single, late CTA into the matching wall section.
const SECTION_CTA: Record<Section, string> = {
  venting:
    'if you don’t need an answer — just somewhere to put it — you can leave a note in venting.',
  ideas:
    'if it’s only half a thought, it still belongs somewhere. you can leave it in ideas.',
  memory:
    'if there’s one detail you don’t want to lose, you can leave it in memory.',
  'things unsaid':
    'if the sentence is still with you, you can leave it in things unsaid.',
  confessions: 'if you only needed to say it once, confessions is there.',
};

export default async function Article({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const related = article.related
    .map((s) => getArticle(s))
    .filter((a): a is NonNullable<typeof a> => a !== null);
  const sectionSlug = sectionToSlug(article.section);

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    datePublished: article.published || undefined,
    dateModified: article.updated || article.published || undefined,
    author: { '@type': 'Organization', name: 'the wall' },
    publisher: { '@type': 'Organization', name: 'the wall', url: 'https://humanitywall.org' },
    mainEntityOfPage: `https://humanitywall.org/read/${article.slug}`,
    isAccessibleForFree: true,
  };

  const faqLd =
    article.faqs.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: article.faqs.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        }
      : null;

  return (
    <main className="read read--article">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      {faqLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
        />
      )}

      <header className="read__topbar">
        <Link href="/" className="read__home">the wall</Link>
        <Link href="/read" className="read__crumb read__crumb--link">read</Link>
      </header>

      <article className="read__inner">
        <h1 className="read__title">{article.title}</h1>
        <p className="read__byline">
          the wall
          {article.updated && (
            <>
              {' · '}
              <time dateTime={article.updated}>{formatDate(article.updated)}</time>
            </>
          )}
        </p>

        <div
          className="read__body"
          dangerouslySetInnerHTML={{ __html: article.html }}
        />

        {article.safety !== 'none' && <CrisisNote level={article.safety} />}

        {article.faqs.length > 0 && (
          <section className="read__faq" aria-label="questions people ask">
            <h2>questions people ask</h2>
            <dl>
              {article.faqs.map((f, i) => (
                <div className="read__faq-item" key={i}>
                  <dt>{f.q}</dt>
                  <dd>{f.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <aside className="read__cta">
          <p>{SECTION_CTA[article.section]}</p>
          <p className="read__cta-links">
            <Link href={`/${sectionSlug}`}>go to {article.section} →</Link>
          </p>
        </aside>

        {related.length > 0 && (
          <nav className="read__related" aria-label="related reading">
            <h2>more on this</h2>
            <ul>
              {related.map((a) => (
                <li key={a.slug}>
                  <Link href={`/read/${a.slug}`}>{a.hubTitle}</Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <p className="read__back">
          <Link href="/read">← more from read</Link>
        </p>
      </article>
    </main>
  );
}

function CrisisNote({ level }: { level: Safety }) {
  return (
    <aside className="read__crisis" role="note">
      <p>
        the wall is a place for words, not emergency or crisis support.
        {level === 'grief'
          ? ' if today feels unsafe or too heavy, please reach out to a real person or a crisis line.'
          : ' if you may hurt yourself or someone else, or you need immediate help, please use a crisis service.'}
      </p>
      <ul>
        <li><strong>US:</strong> call or text <a href="tel:988">988</a> (Suicide &amp; Crisis Lifeline)</li>
        <li><strong>UK &amp; Ireland:</strong> Samaritans, <a href="tel:116123">116 123</a></li>
        <li>
          <strong>Anywhere:</strong>{' '}
          <a href="https://findahelpline.com" rel="noreferrer nofollow" target="_blank">
            findahelpline.com
          </a>
        </li>
      </ul>
    </aside>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

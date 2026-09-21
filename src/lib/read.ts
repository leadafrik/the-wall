import fs from 'node:fs';
import path from 'node:path';

import matter from 'gray-matter';
import { marked } from 'marked';

import { isSection } from '@/lib/sections';
import type { Section } from '@/types';

// The "read" library: long-form guides that rank in search and answer engines
// and open a soft door into the matching wall section. Each article is one
// markdown file in src/content/read/ with YAML frontmatter — so adding a piece
// (written here or handed over) is literally: drop in a .md file.

const DIR = path.join(process.cwd(), 'src/content/read');

export type Safety = 'none' | 'light' | 'grief';

export interface Faq {
  q: string;
  a: string;
}

export interface ArticleMeta {
  slug: string;
  /** Full <title> / <h1>. */
  title: string;
  /** Short label used in the hub listing. */
  hubTitle: string;
  /** Meta description (~150 chars). */
  description: string;
  /** Wall section this article feeds. */
  section: Section;
  /** Cluster pillar (listed first, weighted in linking). */
  pillar: boolean;
  published: string; // ISO date
  updated: string; // ISO date
  /** Related article slugs for internal linking. */
  related: string[];
  /** Safety treatment: controls the disclaimer / crisis block. */
  safety: Safety;
  /** Extractable Q&A — rendered on-page and as FAQPage JSON-LD (AEO). */
  faqs: Faq[];
}

export interface Article extends ArticleMeta {
  /** Rendered HTML body. */
  html: string;
}

function parseFile(file: string): Article | null {
  const slug = file.replace(/\.md$/, '');
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
  const { data, content } = matter(raw);

  const section = String(data.section ?? '');
  if (!isSection(section)) {
    // A miswired section would break the CTA/linking — skip loudly in the log
    // rather than ship a broken page.
    console.warn(`read: "${slug}" has invalid section "${section}" — skipped`);
    return null;
  }

  return {
    slug,
    title: String(data.title ?? slug),
    hubTitle: String(data.hubTitle ?? data.title ?? slug),
    description: String(data.description ?? ''),
    section,
    pillar: Boolean(data.pillar),
    published: String(data.published ?? ''),
    updated: String(data.updated ?? data.published ?? ''),
    related: Array.isArray(data.related) ? data.related.map(String) : [],
    safety: (['none', 'light', 'grief'].includes(data.safety) ? data.safety : 'none') as Safety,
    faqs: Array.isArray(data.faqs)
      ? data.faqs
          .filter((f: unknown): f is Faq => !!f && typeof (f as Faq).q === 'string')
          .map((f: Faq) => ({ q: String(f.q), a: String(f.a) }))
      : [],
    html: marked.parse(content, { async: false }) as string,
  };
}

let cache: Article[] | null = null;

export function getAllArticles(): Article[] {
  if (cache) return cache;
  let files: string[] = [];
  try {
    files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md'));
  } catch {
    return []; // no content dir yet
  }
  const articles = files
    .map(parseFile)
    .filter((a): a is Article => a !== null)
    .sort((a, b) => (a.published < b.published ? 1 : -1));
  cache = articles;
  return articles;
}

export function getArticle(slug: string): Article | null {
  return getAllArticles().find((a) => a.slug === slug) ?? null;
}

export function getArticlesBySection(section: Section): Article[] {
  // Pillar first, then the rest — mirrors the hub's ordering.
  return getAllArticles()
    .filter((a) => a.section === section)
    .sort((a, b) => Number(b.pillar) - Number(a.pillar));
}

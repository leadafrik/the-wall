'use client';

import Link from 'next/link';

import { SECTIONS, sectionToSlug } from '@/lib/sections';
import type { Section } from '@/types';

interface Props {
  active: Section | null;
}

export function SectionFilter({ active }: Props) {
  return (
    <nav className="filter" aria-label="filter by section">
      <Link
        href="/"
        className={`filter__pill${active === null ? ' filter__pill--active' : ''}`}
      >
        all
      </Link>
      {SECTIONS.map((s) => (
        <Link
          key={s}
          href={`/${sectionToSlug(s)}`}
          className={`filter__pill${active === s ? ' filter__pill--active' : ''}`}
        >
          {s}
        </Link>
      ))}
    </nav>
  );
}

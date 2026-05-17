'use client';

import Link from 'next/link';

import { SECTIONS, sectionToSlug } from '@/lib/sections';
import type { Section } from '@/types';

interface Props {
  active: Section | null;
  onShuffle?: () => void;
  shuffling?: boolean;
}

export function SectionFilter({ active, onShuffle, shuffling }: Props) {
  return (
    <nav className="filter" aria-label="filter by section">
      {onShuffle && (
        <button
          type="button"
          className="filter__pill filter__pill--shuffle"
          onClick={onShuffle}
          disabled={shuffling}
          aria-label="shuffle the wall"
        >
          {shuffling ? '…' : 'shuffle'}
        </button>
      )}
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

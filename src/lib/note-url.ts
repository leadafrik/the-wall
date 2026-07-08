import type { Note } from '@/types';

export const SITE_URL = 'https://humanitywall.org';

// Canonical permalink path for a note. Slugged URLs are the indexable
// canonical form; pre-migration rows without a slug fall back to the id,
// which the /note/[id] page still resolves.
export function notePath(note: Pick<Note, 'id' | 'slug'>): string {
  return `/note/${note.slug ?? note.id}`;
}

export function noteUrl(note: Pick<Note, 'id' | 'slug'>): string {
  return `${SITE_URL}${notePath(note)}`;
}

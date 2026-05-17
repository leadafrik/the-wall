import type { Section } from '@/types';

export const SECTIONS: Section[] = [
  'venting',
  'ideas',
  'memory',
  'things unsaid',
  'confessions',
];

export const SECTION_COLORS: Record<Section, string[]> = {
  venting:         ['#fffde7', '#fff9c4', '#fff59d', '#fdf3b5', '#f5ecc1'],
  ideas:           ['#e8f5e9', '#dcedc8', '#c8e6c9', '#d8e6c8', '#e0ecd6'],
  memory:          ['#fff3e0', '#ffe6c4', '#ffd9a8', '#ffccbc', '#fbe5d0'],
  'things unsaid': ['#fce4ec', '#fad0d6', '#f8bbd0', '#f5a8c0', '#f3c5cf'],
  confessions:     ['#ede7f6', '#dfd5eb', '#d1c4e9', '#c2afe0', '#cdbce0'],
};

export const SECTION_DEFAULT_COLOR: Record<Section, string> = {
  venting:         '#fffde7',
  ideas:           '#e8f5e9',
  memory:          '#fff3e0',
  'things unsaid': '#fce4ec',
  confessions:     '#ede7f6',
};

export function isSection(value: string): value is Section {
  return (SECTIONS as string[]).includes(value);
}

// URL slug helpers — "things unsaid" -> "things-unsaid".
export function sectionToSlug(section: Section): string {
  return section.replace(/ /g, '-');
}

export function slugToSection(slug: string): Section | null {
  const restored = slug.replace(/-/g, ' ');
  return isSection(restored) ? restored : null;
}

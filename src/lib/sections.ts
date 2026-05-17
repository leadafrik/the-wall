import type { Section } from '@/types';

export const SECTIONS: Section[] = [
  'venting',
  'ideas',
  'memory',
  'things unsaid',
  'confessions',
];

// Per-section palette. Each section has a clear emotional hue, with five
// shades that progress from pale to saturated so swatches read as distinct
// choices — not five flavors of "kinda the same color".
//
//   venting        warm yellows → honey → amber  (heat, frustration)
//   ideas          mint → sage → pistachio       (fresh, growing)
//   memory         peach → apricot → terracotta  (faded photo, warmth)
//   things unsaid  blush → dusty rose → mauve    (tender, intimate)
//   confessions    pale lavender → plum          (quiet, weighted)
export const SECTION_COLORS: Record<Section, string[]> = {
  venting:         ['#fffbe6', '#fff2a1', '#ffe066', '#f0d878', '#e8c547'],
  ideas:           ['#edf7ed', '#c8e6c9', '#a5d6a7', '#d4e9b8', '#b5cf90'],
  memory:          ['#fff3e0', '#ffe0b2', '#ffccbc', '#fad7b2', '#f1c89e'],
  'things unsaid': ['#fce4ec', '#f8bbd0', '#f4a8c0', '#edc5cf', '#e8b3c2'],
  confessions:     ['#ede7f6', '#d1c4e9', '#b39ddb', '#c5b3df', '#bca0c7'],
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

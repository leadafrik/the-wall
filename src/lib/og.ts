// Helpers shared by the Open Graph image routes (opengraph-image.tsx).
//
// These images are what a wall link turns into when someone shares it — in
// iMessage, WhatsApp, Discord, Slack, X, Facebook, LinkedIn. They're the main
// way a single note travels to a new reader, so they're worth getting right.

// The wall's palette, mirrored from globals.css so the cards match the site.
export const OG = {
  bg: '#f5f0e8',
  ink: '#2b2724',
  tape: 'rgba(255, 235, 130, 0.55)',
  width: 1200,
  height: 630,
} as const;

// Fetch a Google font as an ArrayBuffer for satori (next/og). Passing `text`
// makes Google return a subsetted TTF containing only the glyphs we render —
// small and fast. This is the pattern from Vercel's own og docs; the `text`
// subset is what makes the css2 endpoint hand back `truetype` (satori can't
// use woff2). Callers should try/catch — on failure, render without a custom
// font (next/og falls back to its bundled default) rather than 500.
export async function loadGoogleFont(
  family: string,
  weight: number,
  text: string,
): Promise<ArrayBuffer> {
  const url =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}` +
    `&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const src = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/);
  if (!src) throw new Error(`could not parse font src for ${family}`);
  const res = await fetch(src[1]);
  if (!res.ok) throw new Error(`font fetch failed: ${res.status}`);
  return res.arrayBuffer();
}

// Pick a body font size that keeps the note text comfortably inside the card.
export function noteFontSize(len: number): number {
  if (len <= 70) return 60;
  if (len <= 140) return 48;
  if (len <= 210) return 40;
  return 36;
}

// Trim a note for the card — the card is a teaser; the full text is on the
// page. Cuts on a word boundary near the limit and adds an ellipsis.
export function teaser(text: string, max = 240): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max - 40 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

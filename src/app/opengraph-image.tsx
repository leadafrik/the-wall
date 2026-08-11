import { ImageResponse } from 'next/og';

import { loadGoogleFont, OG } from '@/lib/og';

// Site-level share card — what humanitywall.org itself previews as.
export const runtime = 'edge';
export const alt = 'the wall — an anonymous, public, living archive of human expression';
export const size = { width: OG.width, height: OG.height };
export const contentType = 'image/png';

// A few of the section paper colours, scattered as faint notes behind the
// wordmark so the card reads as "a wall" at a glance.
const CONFETTI: Array<{ c: string; left: number; top: number; r: number }> = [
  { c: '#fff2a1', left: 90, top: 90, r: -8 },
  { c: '#c8e6c9', left: 940, top: 70, r: 7 },
  { c: '#ffccbc', left: 120, top: 400, r: 6 },
  { c: '#f8bbd0', left: 980, top: 410, r: -6 },
  { c: '#d1c4e9', left: 520, top: 30, r: 4 },
  { c: '#ffe066', left: 470, top: 470, r: -5 },
];

const WORDMARK = 'the wall';
const TAGLINE =
  'words left where anyone who needs them can find them. no names, no accounts.';
const URL = 'humanitywall.org';

export default async function Image() {
  let fonts;
  try {
    // Subset must include every glyph we draw, or missing ones fall back to a
    // different font (Caveat only returns the glyphs named in `text`).
    fonts = [
      {
        name: 'Caveat',
        data: await loadGoogleFont('Caveat', 600, WORDMARK + TAGLINE + URL),
        style: 'normal' as const,
      },
    ];
  } catch {
    fonts = undefined;
  }
  const fontFamily = fonts ? 'Caveat' : undefined;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: OG.bg,
          fontFamily,
          color: OG.ink,
          position: 'relative',
        }}
      >
        {CONFETTI.map((n, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: n.left,
              top: n.top,
              width: 150,
              height: 150,
              background: n.c,
              opacity: 0.5,
              borderRadius: 2,
              transform: `rotate(${n.r}deg)`,
              boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
            }}
          />
        ))}

        <div style={{ fontSize: 128, marginBottom: 18 }}>{WORDMARK}</div>
        <div
          style={{
            fontSize: 36,
            color: 'rgba(43,39,36,0.62)',
            maxWidth: 860,
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          {TAGLINE}
        </div>
        <div style={{ fontSize: 27, color: 'rgba(43,39,36,0.45)', marginTop: 44 }}>
          {URL}
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}

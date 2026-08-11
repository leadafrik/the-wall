import { ImageResponse } from 'next/og';

import { loadGoogleFont, noteFontSize, OG, teaser } from '@/lib/og';
import { getSupabaseAnonServer } from '@/lib/supabase-server';

// A share for a single note renders as the note itself — the words, the paper
// colour, the tape. That card is the thing that makes a stranger tap through,
// which is why individual notes stay out of *search* (noindex) but are made as
// shareable as possible here.
export const runtime = 'edge';
export const alt = 'a note on the wall';
export const size = { width: OG.width, height: OG.height };
export const contentType = 'image/png';

interface CardNote {
  text: string;
  section: string;
  color: string;
}

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const { id } = await Promise.resolve(params);
  const note = await loadNote(id);

  // Text that will actually be drawn — used to subset the font download.
  const body = note ? teaser(note.text) : '';
  const glyphText =
    body + (note ? `· ${note.section}` : 'the wall') + 'the wall · humanitywall.org …';

  let fonts;
  try {
    fonts = [
      { name: 'Caveat', data: await loadGoogleFont('Caveat', 600, glyphText), style: 'normal' as const },
    ];
  } catch {
    fonts = undefined; // degrade to next/og's default font rather than fail
  }

  const options = { ...size, fonts };

  if (!note) return brandedFallback(options);

  const fontFamily = fonts ? 'Caveat' : undefined;
  const fontSize = noteFontSize(body.length);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: OG.bg,
          fontFamily,
          position: 'relative',
        }}
      >
        {/* the note */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 720,
            background: note.color,
            padding: '58px 52px 46px',
            borderRadius: 2,
            transform: 'rotate(-2deg)',
            boxShadow: '0 10px 40px rgba(0,0,0,0.16)',
            position: 'relative',
          }}
        >
          {/* tape */}
          <div
            style={{
              position: 'absolute',
              top: -18,
              left: 285,
              width: 150,
              height: 38,
              background: OG.tape,
              transform: 'rotate(-2deg)',
            }}
          />
          <div style={{ fontSize: 26, color: 'rgba(43,39,36,0.5)', marginBottom: 18 }}>
            {`· ${note.section}`}
          </div>
          <div
            style={{
              fontSize,
              color: OG.ink,
              lineHeight: 1.35,
              whiteSpace: 'pre-wrap',
              display: 'flex',
            }}
          >
            {body}
          </div>
        </div>

        {/* wordmark */}
        <div
          style={{
            position: 'absolute',
            bottom: 38,
            right: 54,
            fontSize: 27,
            color: 'rgba(43,39,36,0.5)',
          }}
        >
          the wall · humanitywall.org
        </div>
      </div>
    ),
    options,
  );
}

function brandedFallback(options: ConstructorParameters<typeof ImageResponse>[1]) {
  const fontFamily = options?.fonts?.length ? 'Caveat' : undefined;
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
          textAlign: 'center',
          padding: 80,
        }}
      >
        <div style={{ fontSize: 96, marginBottom: 20 }}>the wall</div>
        <div style={{ fontSize: 34, color: 'rgba(43,39,36,0.6)', maxWidth: 820, lineHeight: 1.4 }}>
          an anonymous, public, living archive of human expression
        </div>
        <div style={{ fontSize: 26, color: 'rgba(43,39,36,0.45)', marginTop: 40 }}>
          humanitywall.org
        </div>
      </div>
    ),
    options,
  );
}

async function loadNote(id: string): Promise<CardNote | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const supabase = getSupabaseAnonServer();
    const { data } = await supabase
      .from('notes')
      .select('text,section,color')
      .eq('id', id)
      .eq('is_visible', true)
      .maybeSingle();
    return (data as CardNote | null) ?? null;
  } catch {
    return null;
  }
}

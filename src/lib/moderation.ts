// Moderation pipeline for note submissions.
//
// Run synchronously-cheapest first, network-call last. Return on first failure.
// Order is intentional and must not be reordered.

export interface ModerationResult {
  allowed: boolean;
  reason?: string;        // internal — for logging only, never shown
  message?: string;       // user-facing rejection copy
  crisisDetected?: boolean;
}

// Matches:
//   - explicit schemes:        https://anything, http://anything
//   - www. shortcuts:          www.anything
//   - bare domains:            3+ chars . 2+ letter TLD  (catches .ing, .ai, .xyz...)
// Min 3 chars before the dot prevents "e.g.", "Mr.", "U.S.A.", "2.5" from matching.
const URL_PATTERN =
  /https?:\/\/|\bwww\.[a-z0-9]|\b[a-zA-Z0-9][a-zA-Z0-9-]{2,}\.[a-zA-Z]{2,24}\b/i;

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

const PHONE_PATTERN =
  /(\+?\d{1,3}[\s.\-]?)?(\(?\d{2,4}\)?[\s.\-]?)(\d{3,4}[\s.\-]?)(\d{3,6})/;

const CRISIS_KEYWORDS = [
  'kill myself',
  'killing myself',
  'want to die',
  'end it all',
  'end my life',
  'take my life',
  'commit suicide',
  'no reason to live',
  'cant go on',
  "can't go on",
  'not worth living',
  'better off dead',
  'want it to end',
  'ending it tonight',
  'goodbye forever',
];

const PII_MESSAGE =
  "looks like there's personal info in there — the wall keeps everyone anonymous, including you.";

export async function moderateNote(text: string): Promise<ModerationResult> {
  const trimmed = text.trim();

  // 1. Character minimum
  if (trimmed.length < 20) {
    return {
      allowed: false,
      reason: 'too_short',
      message: "that's a bit short for the wall — say a little more.",
    };
  }

  // 2. URL detection
  if (URL_PATTERN.test(trimmed)) {
    return {
      allowed: false,
      reason: 'contains_url',
      message: 'the wall is just words — no links allowed.',
    };
  }

  // 3. Repeated-character spam
  const chars = trimmed.replace(/\s/g, '');
  if (chars.length > 0) {
    const counts = new Map<string, number>();
    for (const c of chars) counts.set(c, (counts.get(c) ?? 0) + 1);
    let max = 0;
    for (const n of counts.values()) if (n > max) max = n;
    if (max / chars.length > 0.4) {
      return {
        allowed: false,
        reason: 'repeated_characters',
        message: "that doesn't look like a real note — try writing something.",
      };
    }
  }

  // 4. Email detection
  if (EMAIL_PATTERN.test(trimmed)) {
    return { allowed: false, reason: 'contains_email', message: PII_MESSAGE };
  }

  // 5. Phone detection
  if (PHONE_PATTERN.test(trimmed)) {
    return { allowed: false, reason: 'contains_phone', message: PII_MESSAGE };
  }

  // 6. OpenAI moderation — fail open if the call fails.
  // Per-category thresholds: strict on the genuinely dangerous stuff, lenient
  // on raw emotion. self-harm is intentionally NOT blocked — those notes are
  // exactly what the wall is for, and the crisis-keyword check below surfaces
  // a gentle support nudge instead.
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'omni-moderation-latest',
          input: trimmed,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = (await res.json()) as OpenAIModerationResponse;
        const scores = data.results?.[0]?.category_scores ?? {};
        const breach = findThresholdBreach(scores);
        if (breach) {
          return {
            allowed: false,
            reason: `openai_${breach.category.replace(/[\/]/g, '_')}_${breach.score.toFixed(2)}`,
            message:
              "this one didn't make it to the wall — the wall is for honesty, not harm.",
          };
        }
      } else {
        console.error(
          `OpenAI moderation non-OK response: ${res.status} — failing open`,
        );
      }
    } catch (err) {
      console.error('OpenAI moderation error — failing open:', err);
    }
  }

  // 7. Crisis keyword detection — never blocks. Surfaces a gentle support nudge.
  const lower = trimmed.toLowerCase();
  const crisisDetected = CRISIS_KEYWORDS.some((kw) => lower.includes(kw));

  return { allowed: true, crisisDetected };
}

// Per-category block thresholds. Tuning notes:
//   * threatening variants are stricter than the parent category
//   * sexual/minors is near-zero tolerance
//   * self-harm intentionally omitted — handled by CRISIS_KEYWORDS as a soft nudge
const BLOCK_THRESHOLDS: Record<string, number> = {
  hate: 0.85,
  'hate/threatening': 0.5,
  harassment: 0.85,
  'harassment/threatening': 0.5,
  sexual: 0.85,
  'sexual/minors': 0.3,
  violence: 0.9,
  'violence/graphic': 0.85,
  illicit: 0.9,
  'illicit/violent': 0.85,
};

function findThresholdBreach(
  scores: Record<string, number>,
): { category: string; score: number } | null {
  for (const [category, threshold] of Object.entries(BLOCK_THRESHOLDS)) {
    const score = scores[category];
    if (typeof score === 'number' && score > threshold) {
      return { category, score };
    }
  }
  return null;
}

interface OpenAIModerationResponse {
  results?: {
    flagged?: boolean;
    category_scores?: Record<string, number>;
  }[];
}

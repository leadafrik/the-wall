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

const URL_PATTERN =
  /https?:\/\/|www\.|[a-zA-Z0-9-]+\.(com|net|org|io|co|me|ly|gg|app|dev|xyz)/i;

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

  // 6. Perspective API (toxicity) — fail open if the call fails.
  const apiKey = process.env.PERSPECTIVE_API_KEY;
  if (apiKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(
        `https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            comment: { text: trimmed },
            requestedAttributes: { TOXICITY: {} },
            languages: ['en'],
            doNotStore: true,
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timeout);
      if (res.ok) {
        const data = (await res.json()) as PerspectiveResponse;
        const score = data.attributeScores?.TOXICITY?.summaryScore?.value ?? 0;
        if (score > 0.85) {
          return {
            allowed: false,
            reason: `toxicity_score_${score.toFixed(2)}`,
            message:
              "this one didn't make it to the wall — the wall is for honesty, not harm.",
          };
        }
      } else {
        console.error(
          `Perspective API non-OK response: ${res.status} — failing open`,
        );
      }
    } catch (err) {
      console.error('Perspective API error — failing open:', err);
    }
  }

  // 7. Crisis keyword detection — never blocks. Surfaces a gentle support nudge.
  const lower = trimmed.toLowerCase();
  const crisisDetected = CRISIS_KEYWORDS.some((kw) => lower.includes(kw));

  return { allowed: true, crisisDetected };
}

interface PerspectiveResponse {
  attributeScores?: {
    TOXICITY?: {
      summaryScore?: { value?: number };
    };
  };
}

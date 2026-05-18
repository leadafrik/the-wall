// Gentle mode — client-side, opt-in, reader-controlled.
//
// Philosophy:
//   The wall is for raw human expression. Casual coarse language ("piss",
//   "ass", "damn", "shit", "crap", "hell") is how real people actually talk
//   about real feelings, and posts using it are exactly what the wall is
//   for. We don't filter that.
//
//   What gentle mode hides is the small set of words that have a meaningfully
//   stronger register — words a reader looking for a calmer surface might
//   genuinely not want unexpectedly. That's it.
//
//   Slurs are not in this list because the moderation pipeline already
//   blocks them at submission. Anything that slipped through belongs in the
//   admin queue, not behind a reader toggle.
//
// If you're tempted to add words here: stop and re-read the section above.
// The whole point of this list is that it stays small.

const GENTLE_PATTERN = /\b(fuck|motherfuck|cunt)\w*/i;

export function containsStrongLanguage(text: string): boolean {
  return GENTLE_PATTERN.test(text);
}

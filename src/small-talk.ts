// Small talk: bounded, deterministic matching. No model call.
//
// A greeting or a thank-you matches nothing in a knowledge index, so retrieval
// scores it as a question the docs cannot answer. It is not a question: nothing
// should be searched, reported as a gap or escalated on its account.

/** A longer message is never small talk, so the cost is fixed whatever the input size. */
const MAX_CHARS = 80;
const MAX_WORDS = 6;

// Whole phrases first: their words are ordinary vocabulary on their own
// ("how much", "are you billing me") and must not match singly.
const PHRASES: readonly string[] = [
  'how are you doing',
  'how are you',
  'how is it going',
  'good morning',
  'good afternoon',
  'good evening',
  'good night',
  'good day',
  'thank you',
  'got it',
  'see you',
];

const WORDS: ReadonlySet<string> = new Set([
  'hi', 'hello', 'hey', 'hiya', 'heya', 'howdy', 'yo', 'sup', 'greetings',
  'thanks', 'thx', 'ty', 'cheers',
  'ok', 'okay', 'cool', 'great', 'nice', 'awesome', 'perfect',
  'bye', 'goodbye',
]);

// Only ever alongside one of the above: alone, "team?" or "so much?" can be a real follow-up.
const FILLER_PHRASES: readonly string[] = ['so much', 'very much', 'a lot'];
const FILLER_WORDS: ReadonlySet<string> = new Set([
  'there', 'team', 'everyone', 'all', 'folks', 'again', 'support', 'later',
]);

/** `text` (space-padded) without any of the phrases. Repeated, because adjacent matches share the space between them. */
function strip(text: string, phrases: readonly string[]): string {
  let rest = text;
  for (const phrase of phrases) {
    while (rest.includes(` ${phrase} `)) rest = rest.replace(` ${phrase} `, ' ');
  }
  return rest;
}

/** True when the message is only a greeting, thanks, acknowledgement or sign-off: it asks for nothing. */
export function isSmallTalk(message: string): boolean {
  if (typeof message !== 'string' || message.length > MAX_CHARS) return false;
  const words = message.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // Nothing but punctuation or emoji.
  if (words === '') return true;
  if (words.split(' ').length > MAX_WORDS) return false;
  const padded = ` ${words} `;
  const afterPhrases = strip(padded, PHRASES);
  const rest = strip(afterPhrases, FILLER_PHRASES).trim().split(' ').filter((w) => w !== '');
  const anchored = afterPhrases !== padded || rest.some((w) => WORDS.has(w));
  return anchored && rest.every((w) => WORDS.has(w) || FILLER_WORDS.has(w));
}

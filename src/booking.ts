// Booking intent: bounded, deterministic phrase matching. No model call.

/** Only this much of a message is scanned, so the cost is fixed whatever the input size. */
const MAX_SCAN_CHARS = 2000;

// Whole phrases only. A bare "call", "demo", "human", "enterprise" or "pricing"
// is ordinary product vocabulary ("how do I call the API?") and must not match.
const BOOKING_PHRASES: readonly RegExp[] = [
  /\bbook an? (?:meeting|call|demo)\b/,
  /\bschedule an? (?:call|demo|meeting)\b/,
  /\btalk to (?:sales|a human|a person|someone)\b/,
  /\bspeak (?:to|with) (?:sales|someone|a person)\b/,
  /\bget a demo\b/,
  /\brequest a demo\b/,
  /\bcontact sales\b/,
  /\benterprise (?:pricing|plan|contract|agreement)\b/,
  /\bcustom pricing\b/,
  /\bvolume discounts?\b/,
  /\bprocurement\b/,
  /\bsecurity review\b/,
  /\bsla\b/,
];

/** True when the visitor's message asks for a meeting, sales contact or a commercial conversation. */
export function matchesBookingIntent(message: string): boolean {
  if (typeof message !== 'string') return false;
  const text = message.slice(0, MAX_SCAN_CHARS).toLowerCase().replace(/\s+/g, ' ');
  return BOOKING_PHRASES.some((re) => re.test(text));
}

const HUMAN_PHRASES: readonly RegExp[] = [
  /\b(?:talk|speak) (?:to|with) (?:a human|a person|an agent|someone|support|representative)\b/,
  /\bhuman (?:agent|support|help|representative)\b/,
  /\bescalate(?: to human)?\b/,
  /\bconnect (?:me )?(?:to|with) (?:a human|a person|an agent|support)\b/,
];

/** True when the visitor explicitly asks for human support or escalation. */
export function matchesHumanIntent(message: string): boolean {
  if (typeof message !== 'string') return false;
  const text = message.slice(0, MAX_SCAN_CHARS).toLowerCase().replace(/\s+/g, ' ');
  return HUMAN_PHRASES.some((re) => re.test(text));
}


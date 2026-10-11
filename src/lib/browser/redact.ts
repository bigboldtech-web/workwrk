// What a page shows that the model never reads (docs/plans/ai-teammates-phase4.md
// Decision 17): card numbers, codes and bank account numbers in the page's
// own text become "[hidden]" before a read reaches the model. Best effort,
// said in the page note (BROWSER_COPY.pageNote): a teammate never types one
// anyway (Decision 18), and field values never reach the model at all.
//
// It hides, toward the safer side:
//   - 13 to 19 digits, in groups with short runs of spaces, line breaks,
//     non-breaking spaces, hyphens or dashes between them, that pass the Luhn
//     check (a card number), wherever in a longer row of such groups they
//     stand (review of Phase 4 step 1: one separator at a time let
//     "4242  4242  4242  4242" through, and a number after the card,
//     "4242 4242 4242 4242 123", made the whole row fail the check);
//   - a run of 4 to 8 digits within 24 characters after "code", "OTP",
//     "passcode", "verification", "PIN" or "one-time", or within 24
//     characters before "code", "OTP", "passcode", "verification" or
//     "one-time" ("482913 is your verification code"), in any case;
//   - an IBAN's shape: 2 capital letters, 2 digits, then 11 to 30 capitals or
//     digits, in groups or not.
//
// Pure, and linear in the text's length.

export const HIDDEN_MARK = "[hidden]";

/** Whether a string of digits passes the Luhn check. */
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g;
/** What may stand between a card number's groups: a run of up to four spaces, line breaks, non-breaking spaces, hyphens or dashes. */
const CARD_GAP = /^[\s\u00a0\u2010-\u2015-]{1,4}$/;
const DIGIT_RUN = /\d+/g;
/** A card number's fewest and most digits. */
const CARD_MIN = 13;
const CARD_MAX = 19;
const CODE_AFTER = /\b(?:code|otp|passcode|verification|pin|one-time)\b/gi;
const CODE_BEFORE = /\b(?:code|otp|passcode|verification|one-time)\b/gi;
const DIGITS = /(?<!\d)\d{4,8}(?!\d)/g;

/** How far from the word a code may stand. */
const NEAR = 24;

interface Span {
  start: number;
  end: number;
}

/** The 4 to 8 digit runs that start within NEAR characters after, or end within NEAR before, a code word. */
function codeSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(CODE_AFTER)) {
    const from = (m.index ?? 0) + m[0].length;
    const window = text.slice(from, from + NEAR + 8);
    for (const d of window.matchAll(DIGITS)) {
      const at = d.index ?? 0;
      const end = from + at + d[0].length;
      // A run the window cut short is part of a longer number, never a code.
      if (at <= NEAR && !/\d/.test(text[end] ?? "")) out.push({ start: from + at, end });
    }
  }
  for (const m of text.matchAll(CODE_BEFORE)) {
    const to = m.index ?? 0;
    const lo = Math.max(0, to - NEAR - 8);
    const window = text.slice(lo, to);
    for (const d of window.matchAll(DIGITS)) {
      const start = lo + (d.index ?? 0);
      const end = start + d[0].length;
      if (to - end <= NEAR && !/\d/.test(text[start - 1] ?? "")) out.push({ start, end });
    }
  }
  return out;
}

/**
 * The card numbers: every row of digit groups joined by CARD_GAP runs, and
 * in it every stretch of whole groups holding 13 to 19 digits that passes
 * Luhn. Each stretch starts at a group and stops past 19 digits, so the
 * work stays linear in the text's length.
 */
function cardSpans(text: string): Span[] {
  const out: Span[] = [];
  let row: Array<{ start: number; end: number; digits: string }> = [];
  const flush = () => {
    for (let i = 0; i < row.length; i += 1) {
      let digits = "";
      for (let j = i; j < row.length; j += 1) {
        digits += row[j].digits;
        if (digits.length > CARD_MAX) break;
        if (digits.length >= CARD_MIN && luhn(digits)) out.push({ start: row[i].start, end: row[j].end });
      }
    }
    row = [];
  };
  for (const m of text.matchAll(DIGIT_RUN)) {
    const run = { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, digits: m[0] };
    const last = row[row.length - 1];
    if (last && !CARD_GAP.test(text.slice(last.end, run.start))) flush();
    row.push(run);
  }
  flush();
  return out;
}

/** Replace the spans, merged where they overlap, each with one mark. */
function hideSpans(text: string, spans: Span[]): { text: string; hidden: number } {
  if (spans.length === 0) return { text, hidden: 0 };
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  let out = "";
  let at = 0;
  for (const s of merged) {
    out += text.slice(at, s.start) + HIDDEN_MARK;
    at = s.end;
  }
  return { text: out + text.slice(at), hidden: merged.length };
}

/** A page's text with its card numbers, codes and IBANs hidden, and how many were. */
export function redactPageText(text: string): { text: string; hidden: number } {
  const src = typeof text === "string" ? text : "";
  if (!src) return { text: "", hidden: 0 };
  const spans: Span[] = [];
  for (const m of src.matchAll(IBAN)) spans.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  spans.push(...cardSpans(src));
  spans.push(...codeSpans(src));
  return hideSpans(src, spans);
}

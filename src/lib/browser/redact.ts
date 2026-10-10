// What a page shows that the model never reads (docs/plans/ai-teammates-phase4.md
// Decision 17): card numbers, codes and bank account numbers in the page's
// own text become "[hidden]" before a read reaches the model. Best effort,
// said in the page note (BROWSER_COPY.pageNote): a teammate never types one
// anyway (Decision 18), and field values never reach the model at all.
//
// It hides, toward the safer side:
//   - 13 to 19 digits, with single spaces or hyphens between them, that pass
//     the Luhn check (a card number);
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
const CARD = /(?<![\d])\d(?:[  -]?\d){12,18}(?![\d])/g;
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
  for (const m of src.matchAll(CARD)) {
    const digits = m[0].replace(/[^\d]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) spans.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  spans.push(...codeSpans(src));
  return hideSpans(src, spans);
}

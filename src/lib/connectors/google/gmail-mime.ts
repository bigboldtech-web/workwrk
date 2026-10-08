// The email a teammate sends or drafts, as Gmail takes it: one plain-text
// MIME message, base64url (docs/plans/ai-teammates-phase3.md step 3). Pure.
//
// WHAT RUNS IS WHAT THE CARD SHOWED. Every header value is one line
// (headerSafe): a line break in a subject the model wrote would start a
// header of its own, such as a Bcc the person never saw. There is no From
// header (Gmail sets it from the account) and never a Bcc header. Every
// recipient must be one plain address (isEmailAddress), or nothing is built.
//
// A text a mail client would decode is never left for it to decode: a subject
// that is not plain ASCII, or that holds "=?" (what starts an encoded word),
// is encoded here (RFC 2047), so the recipient reads exactly the words on the
// card.

import { createHash } from "node:crypto";

export interface MimeInput {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** The Message-ID a reply answers, and the thread's References, both as Gmail read them. */
  inReplyTo?: string | null;
  references?: string | null;
}

/** `s` with each control mark (U+0000 to U+001F but the tab, and U+007F) replaced by `by`. */
function controlsTo(s: string, by: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += (c < 0x20 && c !== 0x09) || c === 0x7f ? by : ch;
  }
  return out;
}

/** A header value on one line: each line break becomes a space, and NUL and every other control mark but the tab goes. */
export function headerSafe(s: string): string {
  return controlsTo(String(s ?? "").replace(/[\r\n]+/g, " "), "").trim();
}

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/**
 * One plain address, local@domain.tld, at most 254 characters: no name, no
 * spaces, no angle brackets, no list. Anything else is refused rather than
 * guessed at.
 */
export function isEmailAddress(s: string): boolean {
  if (typeof s !== "string" || s.length === 0 || s.length > 254) return false;
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@")) return false;
  const local = s.slice(0, at);
  return local.length <= 64 && LOCAL_PART.test(local) && DOMAIN.test(s.slice(at + 1));
}

/** A header's list split at its commas, never inside a quoted name or angle brackets. */
function splitAddresses(header: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = 0;
  for (let i = 0; i < header.length; i += 1) {
    const c = header[i];
    if (quoted && c === "\\" && i + 1 < header.length) {
      cur += c + header[i + 1];
      i += 1;
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "<") angle += 1;
    else if (!quoted && c === ">" && angle > 0) angle -= 1;
    else if (!quoted && angle === 0 && (c === "," || c === ";")) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function unquoted(s: string): string {
  const q = /^"((?:[^"\\]|\\.)*)"$/.exec(s.trim());
  return (q ? q[1].replace(/\\(.)/g, "$1") : s).replace(/\s+/g, " ").trim();
}

/**
 * The addresses in a To, Cc, From or Reply-To header as written:
 * `"Max Chen" <max@x.test>, lea@y.test`. Split first and decoded after, so a
 * name can never add an address of its own. An entry with no plain address
 * is left out.
 */
export function parseAddressList(header: string): Array<{ name: string | null; email: string }> {
  const out: Array<{ name: string | null; email: string }> = [];
  for (const part of splitAddresses(String(header ?? ""))) {
    let t = part.trim();
    if (!t) continue;
    const angle = /<([^<>]*)>\s*$/.exec(t);
    if (angle) {
      const email = angle[1].trim();
      const name = decodeHeaderWords(unquoted(t.slice(0, angle.index))).replace(/\s+/g, " ").trim();
      if (isEmailAddress(email)) out.push({ name: name || null, email });
      continue;
    }
    // A group's name ("Team: a@x.test, b@x.test;") and a comment ("a@x.test (Max)") are not the address.
    t = t.replace(/^[^"@<>]*:\s*/, "").replace(/\s*\([^()]*\)\s*/g, "").trim();
    if (isEmailAddress(t)) out.push({ name: null, email: t });
  }
  return out;
}

function qBytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const hex = text.slice(i + 1, i + 3);
    if (c === "_") out.push(0x20);
    else if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      out.push(parseInt(hex, 16));
      i += 2;
    } else out.push(text.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(out);
}

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

/**
 * A header text with its RFC 2047 encoded words read back, for the words a
 * person reads (a subject, a name). A word in a charset this runtime cannot
 * read stays as it was. Control marks become spaces.
 */
export function decodeHeaderWords(s: string): string {
  // The space between two encoded words is not part of the text (RFC 2047 6.2).
  const joined = String(s ?? "").replace(/(\?=)\s+(?==\?)/g, "$1");
  return joined.replace(ENCODED_WORD, (whole: string, charset: string, enc: string, text: string) => {
    try {
      const bytes = enc.toUpperCase() === "B" ? Uint8Array.from(Buffer.from(text, "base64")) : qBytes(text);
      return controlsTo(new TextDecoder(charset.split("*")[0]).decode(bytes).replace(/\t/g, " "), " ");
    } catch {
      return whole;
    }
  });
}

/** The most bytes of text one encoded word carries: 60 base64 characters, 72 with its wrapper, under RFC 2047's 75. */
const WORD_BYTES = 45;

/**
 * A header text as it goes on the wire: plain ASCII as it is; anything else
 * as UTF-8 encoded words (=?UTF-8?B?...?=), never splitting a character,
 * folded one word to a line.
 */
export function encodeHeaderWord(s: string): string {
  const t = String(s ?? "");
  if (/^[\x20-\x7E]*$/.test(t) && !t.includes("=?")) return t;
  const words: string[] = [];
  let chunk = "";
  let bytes = 0;
  for (const ch of t) {
    const n = Buffer.byteLength(ch, "utf8");
    if (chunk && bytes + n > WORD_BYTES) {
      words.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += ch;
    bytes += n;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

/** "To: a, b, c", folded onto continuation lines before 78 characters (RFC 5322 2.2.3). */
function foldedHeader(name: string, items: readonly string[], separator: string): string {
  const lines: string[] = [];
  let line = `${name}:`;
  items.forEach((item, i) => {
    const piece = i < items.length - 1 ? `${item}${separator}` : item;
    if (i > 0 && line.length + 1 + piece.length > 76) {
      lines.push(line);
      line = ` ${piece}`;
    } else line += ` ${piece}`;
  });
  lines.push(line);
  return lines.join("\r\n");
}

/** The recipients as written on the wire: each one plain address, each once. Never builds with one that is not. */
function recipients(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    const e = headerSafe(raw);
    // The address stays out of the message: errors reach the server log.
    if (!isEmailAddress(e)) throw new Error("A recipient is not one plain email address");
    if (!out.some((x) => x.toLowerCase() === e.toLowerCase())) out.push(e);
  }
  return out;
}

/**
 * One plain-text message: CRLF lines; To, Cc (when any), Subject,
 * In-Reply-To and References (when given), MIME-Version, text/plain UTF-8,
 * and the body in base64. No From and no Bcc header.
 */
export function buildMime(m: MimeInput): string {
  const to = recipients(m.to);
  const cc = recipients(m.cc);
  if (to.length === 0) throw new Error("An email needs at least one recipient");
  const head = [foldedHeader("To", to, ",")];
  if (cc.length > 0) head.push(foldedHeader("Cc", cc, ","));
  head.push(`Subject: ${encodeHeaderWord(headerSafe(m.subject))}`);
  const inReplyTo = headerSafe(m.inReplyTo ?? "");
  if (inReplyTo) head.push(`In-Reply-To: ${inReplyTo}`);
  const references = headerSafe(m.references ?? "").split(/\s+/).filter(Boolean);
  if (references.length > 0) head.push(foldedHeader("References", references, ""));
  head.push("MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64");
  // Text is sent in its canonical form, CRLF line ends (RFC 2045 6.8).
  const body = Buffer.from(String(m.body ?? "").replace(/\r\n|\r|\n/g, "\r\n"), "utf8").toString("base64");
  return [...head, "", ...(body.match(/.{1,76}/g) ?? [])].join("\r\n") + "\r\n";
}

/** The message as Gmail's `raw` takes it: base64url, no padding. */
export function rawOf(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64url");
}

/**
 * The same email, whoever asked for it: a sha256 of the recipients (lower
 * case, each once, sorted), the exact subject and body, and the thread. Two
 * identical sends waiting at once share it (Decision 23).
 */
export function dedupeKey(m: { to: string[]; cc: string[]; subject: string; body: string; threadId?: string | null }): string {
  const list = (l: readonly string[]) => [...new Set((l ?? []).map((a) => String(a).trim().toLowerCase()).filter(Boolean))].sort();
  return createHash("sha256")
    .update(JSON.stringify([list(m.to), list(m.cc), String(m.subject ?? ""), String(m.body ?? ""), m.threadId ?? null]))
    .digest("hex");
}

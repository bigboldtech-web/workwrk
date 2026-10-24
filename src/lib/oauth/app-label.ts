// The name a person is shown for an app (docs/plans/mcp-server.md 3.4 appLabel).
//
// The stored name, unless it could pass for WorkwrK or for an address:
//   - its SKELETON contains "workwrk": decomposed (NFKD) with its accents
//     stripped, look-alike letters and digits folded to the Latin letter they
//     pass for (0 for o, Cyrillic о к г, Greek ο κ ω, "vv" for w, and the
//     like), blank-rendering characters, spaces and punctuation dropped. So
//     "W0rkwrK", "Wоrkwrk" with a Cyrillic о, "Wörkwrk", "Work wrK" and
//     "Vvorkwrk" are all caught (review of step 1, M2);
//   - any of its characters is of a script other than Latin, Common or
//     Inherited (final review of the MCP server, security M2): look-alikes
//     come from every script (Myanmar U+101D, Lao U+0ED0, Georgian U+10FF and
//     Cherokee U+13B3, U+13A1 and U+13E6 pass for o, o, o, W, R and K), and
//     no table of them is ever whole, so only a name written in Latin letters
//     is shown, and still through the skeleton check above. DECIDED by its
//     worst case: a real app named in another script shows its host instead,
//     never a name that passes for another. This also covers the old rule
//     (Latin mixed with Cyrillic or Greek, "Сlaude" with a Cyrillic С);
//   - it is address-like: "://", "@", "www.", or the whole name shaped like a
//     host ("google.com");
//   - it is empty, or renders as nothing (only blank-rendering characters
//     such as U+3164 or U+2800, combining marks, invisible formatting).
// Then the redirect's label: its https host, "an app on this computer" or
// "the cursor app". Never a refusal (review H3): the worst case of refusing
// is that Claude Code cannot connect; of showing the name, a fake "WorkwrK
// Security Check" asking for access. The label is frozen as grant.appName.
//
// Pure.

import { redirectLabelOf } from "./redirect-uri";

const HOST_SHAPED = /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+\.?$/u;

/**
 * Characters that render as nothing: white space, combining and enclosing
 * marks, invisible formatting, and the letters and symbols fonts draw blank
 * (Hangul fillers, the blank Braille pattern, the Khmer inherent vowels,
 * the Mongolian separators, variation selectors, tag characters).
 */
const BLANK = /[\s\p{Mn}\p{Me}\p{Cf}ᅟᅠ឴឵᠋-᠏⠀ㅤ︀-️ﾠ\u{1D159}\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}]/gu;

/** Look-alikes of Latin letters, folded to the letter they pass for (after lower case and NFKD). */
const CONFUSABLES: Record<string, string> = {
  // o
  "0": "o", "о": "o", "ο": "o", "օ": "o", "ø": "o", "ɵ": "o", "ᴏ": "o", "ⲟ": "o", "σ": "o", "ഠ": "o",
  // w
  "ԝ": "w", "ѡ": "w", "ω": "w", "ա": "w", "ɯ": "w", "ᴡ": "w", "ш": "w",
  // r
  "г": "r", "ʀ": "r", "ᴦ": "r", "ꭇ": "r", "ɾ": "r", "ѓ": "r",
  // k
  "к": "k", "κ": "k", "ĸ": "k", "ҝ": "k", "ҟ": "k", "қ": "k", "ᴋ": "k", "ⲕ": "k", "ϰ": "k",
  // The rest of the common Cyrillic and Greek look-alikes, and the digits that pass for letters.
  "а": "a", "α": "a", "е": "e", "ε": "e", "р": "p", "ρ": "p", "с": "c", "ϲ": "c", "у": "y", "γ": "y",
  "х": "x", "χ": "x", "і": "i", "ι": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "ӏ": "l", "τ": "t",
  "υ": "u", "ν": "v", "в": "b", "н": "h", "м": "m", "т": "t", "1": "l", "|": "l", "3": "e", "5": "s",
};

/** The name as it reads to the eye: lower case, decomposed, accents and blanks gone, look-alikes folded, letters and digits only. */
export function nameSkeleton(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(BLANK, "");
  const folded = [...base].map((c) => CONFUSABLES[c] ?? c).join("");
  return folded.replace(/[^\p{L}\p{N}]/gu, "").replace(/vv/g, "w");
}

/** Does the name mix Latin letters with Cyrillic or Greek ones (UTS 39 mixed script)? */
export function mixesScripts(name: string): boolean {
  return /\p{Script=Latin}/u.test(name) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(name);
}

/** Is every character of the name Latin, or of the Common or Inherited script (digits, spaces, punctuation, marks)? */
export function onlyLatinScript(name: string): boolean {
  return /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]*$/u.test(name);
}

/** Would this name be mistaken for WorkwrK or for an address, or show as nothing? */
export function nameIsMisleading(name: string): boolean {
  const n = name.trim();
  if (!n || n.replace(BLANK, "") === "") return true;
  if (nameSkeleton(n).includes("workwrk")) return true;
  if (!onlyLatinScript(n) || mixesScripts(n)) return true;
  const folded = n.normalize("NFKC").toLowerCase();
  if (folded.includes("://") || folded.includes("@") || folded.includes("www.")) return true;
  return HOST_SHAPED.test(folded);
}

/** The label shown at consent and frozen on the grant: at most 60 characters, never empty. */
export function appLabel(clientName: string, redirectUri: string): string {
  const name = clientName.trim();
  if (!nameIsMisleading(name)) return [...name].slice(0, 60).join("");
  return redirectLabelOf(redirectUri);
}

/** The label with a capital first letter, for the start of a sentence or a row. */
export function capitalLabel(label: string): string {
  return label ? label[0].toUpperCase() + label.slice(1) : label;
}

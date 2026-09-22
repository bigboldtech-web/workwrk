// The OAuth connect flow's failure codes, turned into sentences.
//
// spec-planner.md section 2, `/account/connections`: "?error=<code> on load:
// a 44px --os-danger-bg strip inside the card 'Couldn't connect: {plain
// sentence by code}' with a 'Try again' text link".
//
// A SEPARATE MODULE FROM THE PAGE so the mapping can be tested and so the
// list of codes sits next to the sentences rather than being rediscovered
// from the callback route every time somebody edits one.
//
// Pure: no React, no imports.

/**
 * Every code the connect flow can put in the URL.
 *
 * The first three are what `returnTo(false, ...)` sends in
 * src/app/api/integrations/google-calendar/callback/route.ts; `access_denied`
 * is Google's own, handed straight through; `not_configured` is what the
 * connect route answers on a deployment with no credentials.
 */
export const GOOGLE_CONNECT_ERRORS = [
  "access_denied",
  "state_mismatch",
  "bad_state",
  "missing_code_or_state",
  "not_configured",
] as const;

/**
 * A plain sentence for a code, or the code itself when it is not one we
 * know.
 *
 * Falling through to the raw code is deliberate. A vague "something went
 * wrong" tells the person nothing and tells whoever they report it to even
 * less; a code somebody can grep for at least lands in the right file.
 *
 * Sentence FRAGMENTS, lower case and unpunctuated, because the card reads
 * "Google Calendar did not connect: {sentence}." around them.
 */
export function googleConnectSentence(code: string): string {
  switch (code) {
    case "access_denied": return "you did not give WorkwrK access";
    case "state_mismatch":
    case "bad_state": return "the sign-in took too long and the request expired";
    case "missing_code_or_state": return "Google did not send enough back to finish";
    case "not_configured": return "this workspace has no Google credentials";
    default: return code;
  }
}

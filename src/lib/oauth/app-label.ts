// The name a person is shown for an app (docs/plans/mcp-server.md 3.4 appLabel).
//
// The stored name, unless it could pass for WorkwrK or for an address:
//   - it contains "workwrk" in any case, also spaced or punctuated
//     ("Work wrK", "W.O.R.K.W.R.K") or in look-alike letters NFKC folds;
//   - it is address-like: "://", "@", "www.", or the whole name shaped like a
//     host ("google.com");
//   - it is empty.
// Then the redirect's label: its https host, "an app on this computer" or
// "the cursor app". Never a refusal (review H3): the worst case of refusing
// is that Claude Code cannot connect; of showing the name, a fake "WorkwrK
// Security Check" asking for access. The label is frozen as grant.appName.
//
// Pure.

import { redirectLabelOf } from "./redirect-uri";

const HOST_SHAPED = /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+\.?$/u;

/** Would this name be mistaken for WorkwrK or for an address? */
export function nameIsMisleading(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  const folded = n.normalize("NFKC").toLowerCase();
  if (folded.replace(/[^\p{L}\p{N}]/gu, "").includes("workwrk")) return true;
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

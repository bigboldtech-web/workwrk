// The /register split (spec-account-auth section 0), as one pure rule the
// route handler and the tests share. The invitation arm keeps its token and
// every other parameter; the self-serve arm keeps ?utm_content= and
// ?template=, which the marketing CTAs append.
export function registerTarget(search: URLSearchParams): string {
  const q = search.toString();
  return `${search.has("token") ? "/join" : "/signup"}${q ? `?${q}` : ""}`;
}

// /welcome and /setup retired into the one wizard (spec-account-auth
// section 0): both 308 to /onboard, which renders the wizard for an Owner or
// Admin of an org still being set up and the "Nothing to set up" view (with
// its way on to Work home) for everyone else, so no visitor of an old URL
// meets a dead end. The query rides along.
export function onboardTarget(search: URLSearchParams): string {
  const q = search.toString();
  return `/onboard${q ? `?${q}` : ""}`;
}

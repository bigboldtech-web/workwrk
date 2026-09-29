// The /register split (spec-account-auth section 0), as one pure rule the
// route handler and the tests share. The invitation arm keeps its token and
// every other parameter; the self-serve arm keeps ?utm_content= and
// ?template=, which the marketing CTAs append.
export function registerTarget(search: URLSearchParams): string {
  const q = search.toString();
  return `${search.has("token") ? "/join" : "/signup"}${q ? `?${q}` : ""}`;
}

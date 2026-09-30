// The key a strict zod schema refused, for a 400 that names it (settings rule:
// "a 400 from the strict schema names the key"). An unknown key is named by
// itself; any other issue by its path; an empty path is the body.

type IssueLike = { path?: ReadonlyArray<PropertyKey>; code?: string; keys?: readonly string[] } | undefined;

export function issueKey(issue: IssueLike): string {
  if (!issue) return "body";
  if (issue.code === "unrecognized_keys" && issue.keys?.length) {
    const at = (issue.path ?? []).map(String).join(".");
    return issue.keys.map((k) => (at ? `${at}.${k}` : k)).join(",");
  }
  const path = (issue.path ?? []).map(String).join(".");
  return path || "body";
}

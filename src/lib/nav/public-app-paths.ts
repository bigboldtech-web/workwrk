// App pages a signed-OUT visitor may open even though their first segment is an
// app prefix (proxy.ts APP_PREFIXES). The edge auth gate matches on the first
// segment only, so without this list the public form responder at
// /forms/[id]/respond (moved into the (public) route group in Phase 5) would be
// bounced to /login at the edge, exactly the bug the move exists to fix.
//
// Keep it to exact shapes: one form id, the literal "respond", an optional
// trailing slash. /forms and /forms/[id] (the list and the builder) stay gated.
//
// Pure: imported by the edge proxy and by the node test suite.

const SIGNED_OUT_APP_PATHS: readonly RegExp[] = [
  /^\/forms\/[^/]+\/respond\/?$/,
];

export function isSignedOutAppPath(path: string): boolean {
  return SIGNED_OUT_APP_PATHS.some((re) => re.test(path));
}

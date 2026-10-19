// The Chrome flags the host never passes, in any mode
// (docs/plans/browser-host.md 5.3, Decision 13): the tests' own list.
// chrome-args.test.ts holds the generated arguments to it, and
// boundaries.test.ts holds every other file in services/browser-host to it.
// The fixture resolver rules are allowed in proof mode only, so they have
// their own line.

export const FORBIDDEN_FLAGS: readonly string[] = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--single-process",
  "--no-zygote",
  "--disable-web-security",
  "--remote-allow-origins",
  "--allow-running-insecure-content",
  "--ignore-certificate-errors",
  "--disable-site-isolation-trials",
  "--proxy-server",
  "--enable-automation",
  "--disable-blink-features",
];

/** Proof mode only: the fixture sites' resolver rules. */
export const PROOF_ONLY_FLAG = "--host-resolver-rules";

// Whether a live view's address may be shown (docs/plans/ai-teammates-phase4.md
// Decision 19): only from the browser provider's own origin, over https, with
// no user name or password in it. The server checks it before it answers an
// address (config.ts liveViewOriginOk, read by browserbase.ts liveViewUrl),
// and the browser card checks it again in the page before it embeds the frame
// (step 4: "the client repeats the origin check"), so an address that is not
// the provider's is never put in a frame, whatever answered it.
//
// THE PAGE'S CHECK holds Browserbase's origin itself, our own host's origin
// (docs/plans/browser-host.md section 9.3: NEXT_PUBLIC_BROWSER_HOST_ORIGIN,
// written into the page when the app is built, used only when it is an https
// origin), and outside production only (the stand-in, Decision 2, which runs
// on this machine) an address on a loopback host too. The server's check
// holds the configured origins.
//
// THE FRAME'S PERMISSIONS (liveViewFrameAllow, browser host final review,
// security L2): clipboard-write only for Browserbase's own live view, as
// before. Our host's page never writes to the clipboard, so its frame is
// granted nothing.
//
// Pure: the URL parser only, safe on the client.

/** The origin Browserbase serves its live view from. **verify:** against Browserbase's reference before production (Founder action 3). */
export const BROWSERBASE_LIVE_VIEW_ORIGIN = "https://www.browserbase.com";

/**
 * The server's check: the address's origin is one of the provider's, over
 * https (the stand-in's own origin outside production may be http).
 */
export function liveViewOriginOk(url: string, cfg: { liveViewOrigins: readonly string[]; standIn: boolean }): boolean {
  if (typeof url !== "string" || !URL.canParse(url)) return false;
  const u = new URL(url);
  if (u.username || u.password) return false;
  if (u.protocol !== "https:" && !(cfg.standIn && u.protocol === "http:")) return false;
  return cfg.liveViewOrigins.includes(u.origin);
}

/** Where the stand-in provider runs: this machine only (scripts/browser-stand-in.mjs listens on 127.0.0.1). */
const LOOPBACK: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Whether a configured host origin is an https origin and nothing more: no path, no user, no trailing slash. */
function httpsOrigin(v: string | null | undefined): string | null {
  if (typeof v !== "string" || !v || !URL.canParse(v)) return null;
  const u = new URL(v);
  return u.protocol === "https:" && u.origin === v ? v : null;
}

/**
 * The page's check before it embeds a live view: Browserbase's own origin
 * over https, or our own host's (`hostOrigin`, when it is an https origin
 * equal to the address's); outside production, also an address on a
 * loopback host (the stand-in). Anything else is never embedded.
 */
export function liveViewShownOk(url: string, o: { production: boolean; hostOrigin?: string | null }): boolean {
  if (liveViewOriginOk(url, { liveViewOrigins: [BROWSERBASE_LIVE_VIEW_ORIGIN], standIn: false })) return true;
  const host = httpsOrigin(o.hostOrigin);
  if (host && liveViewOriginOk(url, { liveViewOrigins: [host], standIn: false })) return true;
  if (o.production || typeof url !== "string" || !URL.canParse(url)) return false;
  const u = new URL(url);
  if (u.username || u.password) return false;
  return (u.protocol === "http:" || u.protocol === "https:") && LOOPBACK.has(u.hostname);
}

/**
 * The live view frame's `allow` (browser host final review, security L2):
 * "clipboard-write" for an address on Browserbase's own origin over https,
 * and nothing for any other, our own host's and the stand-in's included,
 * whose page never uses the clipboard. Undefined leaves the attribute out.
 */
export function liveViewFrameAllow(url: string): "clipboard-write" | undefined {
  return liveViewOriginOk(url, { liveViewOrigins: [BROWSERBASE_LIVE_VIEW_ORIGIN], standIn: false }) ? "clipboard-write" : undefined;
}

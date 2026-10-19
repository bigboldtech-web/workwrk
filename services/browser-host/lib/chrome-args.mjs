// @ts-check
// Chrome's flags (docs/plans/browser-host.md 5.3, Decision 13): its sandbox
// on, no stealth, the back/forward cache off, permission prompts denied.
//
// The back/forward cache is off so every page change makes a request the
// app's guard sees; the driver's commit check stays as a second wall.
// Production keeps Safe Browsing and component updates on: certificate
// revocation lists arrive as a component.
//
// boundaries.test.ts and chrome-args.test.ts hold this file, and every file
// in the folder, to the forbidden list of 5.3. The fixture resolver rules are
// proof mode's alone.
//
// Pure.

/**
 * @typedef {{
 *   mode: "process" | "container",
 *   proof: boolean,
 *   viewport: { width: number, height: number },
 *   profile: string,
 *   fixturePort?: number | null,
 *   headlessShell?: boolean,
 * }} ChromeArgsAsk
 */

/** Where the fixture sites live in proof mode (src/lib/browser/sites.ts FIXTURE_SUFFIX). */
export const FIXTURE_SUFFIX = ".proof.test";

/**
 * The flags for one session's Chrome, without the first page.
 * @param {ChromeArgsAsk} a
 * @returns {string[]}
 */
export function chromeArgs(a) {
  const features = ["BackForwardCache", "Translate", "MediaRouter"];
  // The fixture sites are plain http: proof mode only.
  if (a.proof) features.push("HttpsUpgrades", "HttpsFirstBalancedModeAutoEnable");
  const args = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--metrics-recording-only",
    "--password-store=basic",
    "--use-mock-keychain",
    "--deny-permission-prompts",
    "--mute-audio",
    "--disk-cache-size=67108864",
    "--force-device-scale-factor=1",
    "--lang=en-US",
    `--window-size=${Math.round(a.viewport.width)},${Math.round(a.viewport.height)}`,
    `--user-data-dir=${a.profile}`,
    `--disable-features=${features.join(",")}`,
  ];
  if (a.mode === "container") {
    args.push("--headless=new", "--remote-debugging-port=9222", "--remote-debugging-address=0.0.0.0");
  } else {
    args.push("--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1");
    if (!a.headlessShell) args.push("--headless=new");
    args.push("--disable-background-networking", "--disable-component-update");
  }
  if (a.proof && a.mode === "process" && a.fixturePort) {
    // Every fixture site resolves to the fixture server, every other name to nothing (the stand-in's rule).
    args.push(`--host-resolver-rules=MAP *${FIXTURE_SUFFIX} 127.0.0.1:${a.fixturePort}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`);
  }
  return args;
}

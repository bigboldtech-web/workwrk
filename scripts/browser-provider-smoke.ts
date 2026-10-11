// The browser provider's smoke check (docs/plans/ai-teammates-phase4.md step
// 2, Founder action 5): one session made, the navigation guard attached, an
// allowed page opened, a disallowed hop refused before it leaves, the page
// read and pictured, the session released, and nothing of this deployment's
// left running. It prints counts and outcomes only: never the key, a connect
// or live view address, or anything the page said.
//
// Against the stand-in (the default): start scripts/browser-stand-in.mjs, then
//   npx tsx scripts/browser-provider-smoke.ts [--base http://127.0.0.1:8789]
// It allows docs.proof.test, opens it, follows /redirect-blocked (a 302 to
// blocked.proof.test) and checks the stand-in's fixture log has no hit there.
//
// Against Browserbase, on the server, before BROWSER_OFFERED=1 (Founder
// action 5), with the deployment's BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID,
// BROWSER_REGION and BROWSER_DEPLOYMENT_TAG in the environment:
//   npx tsx scripts/browser-provider-smoke.ts --real
// It allows example.com, opens https://example.com/, and asks for a page on
// a host it does not allow (www.iana.org): the guard refuses it before any
// request leaves. It reads no .env file and touches no database.
//
// Exit 0 only when every check held.

import { createProviderSession, listRunningProviderSessions, releaseProviderSession } from "../src/lib/browser/browserbase";
import { attachBrowser, type GuardHooks } from "../src/lib/browser/cdp-driver";
import type { BrowserConfig, BrowserReleaseConfig } from "../src/lib/browser/config";
import { appHostsFrom, FIXTURE_SUFFIX, neverReason, siteOf, siteVerdict, type SiteRules } from "../src/lib/browser/sites";

const argv = process.argv.slice(2);
const real = argv.includes("--real");
const baseArg = argv.indexOf("--base") >= 0 ? argv[argv.indexOf("--base") + 1] : null;

function fail(message: string): never {
  console.error(`smoke: FAILED: ${message}`);
  process.exit(1);
}

const env = process.env;
const apiBase = real ? "https://api.browserbase.com" : (baseArg ?? env.BROWSERBASE_BASE_URL ?? "http://127.0.0.1:8789").replace(/\/+$/, "");
if (real && env.BROWSERBASE_BASE_URL) fail("unset BROWSERBASE_BASE_URL for the real check");
const apiKey = real ? (env.BROWSERBASE_API_KEY ?? "") : (env.BROWSERBASE_API_KEY ?? "stand-in");
const projectId = real ? (env.BROWSERBASE_PROJECT_ID ?? "") : (env.BROWSERBASE_PROJECT_ID ?? "stand-in");
const region = env.BROWSER_REGION ?? "us-east-1";
const deploymentTag = env.BROWSER_DEPLOYMENT_TAG ?? "workwrk";
if (!apiKey || !projectId) fail("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are needed");

const cfg: BrowserConfig = {
  provider: real ? "browserbase" : "stand-in",
  apiKey,
  projectId,
  apiBase,
  region,
  deploymentTag,
  maxAtOnce: 1,
  priceCentsPerHour: null,
  shotsDir: "/nonexistent",
  liveViewOrigins: [real ? "https://www.browserbase.com" : new URL(apiBase).origin],
  standIn: !real,
  testTimes: { sessionSeconds: null, idleSeconds: null, waitSeconds: null },
};
const release: BrowserReleaseConfig = { provider: cfg.provider, apiKey, projectId, apiBase, deploymentTag, standIn: cfg.standIn };

const allowed = real ? "example.com" : `docs${FIXTURE_SUFFIX}`;
const rules: SiteRules = {
  allow: [allowed],
  block: [],
  appHosts: appHostsFrom(env),
  schemes: real ? ["https:"] : ["https:", "http:"],
  fixtureSuffix: real ? null : FIXTURE_SUFFIX,
};

const seen = { refused: [] as Array<{ host: string | null; code: string; main: boolean }>, popups: 0, dialogs: 0, downloads: 0, lost: 0 };
const hooks: GuardHooks = {
  verdict: (url, main) => {
    if (main) return siteVerdict(url, rules);
    const site = siteOf(url);
    if (site && neverReason(site, { appHosts: rules.appHosts, fixtureSuffix: rules.fixtureSuffix })) return { ok: false, code: "never", site };
    return { ok: true, frame: true };
  },
  onRefused: (host, code, main) => void seen.refused.push({ host, code, main: main !== false }),
  onLost: () => void (seen.lost += 1),
  onDialog: () => void (seen.dialogs += 1),
  onDownload: () => void (seen.downloads += 1),
  onUpload: () => undefined,
  onPopup: () => void (seen.popups += 1),
};

async function fixtureHits(host: string): Promise<number> {
  const res = await fetch(`${apiBase}/__stand-in/log`);
  const log = (await res.json()) as Array<{ kind?: string; host?: string }>;
  return log.filter((e) => e.kind === "fixture" && e.host === host).length;
}

async function main(): Promise<void> {
  const rowId = `smoke-${Date.now()}`;
  const before = real ? 0 : await fixtureHits("blocked.proof.test");
  const created = await createProviderSession(cfg, { rowId, timeoutSeconds: 180 });
  if (!created.ok) fail(`no session: ${created.failure}`);
  console.log("smoke: a session was made");
  const { providerSessionId, connectUrl } = created.data;
  let ok = true;
  try {
    const handle = await attachBrowser(connectUrl, hooks, { fixtureSuffix: rules.fixtureSuffix });
    console.log("smoke: the guard is attached");

    const opened = await handle.navigate(real ? "https://example.com/" : `http://${allowed}/`);
    console.log(`smoke: open ${allowed}: ${opened.ok ? "ok" : opened.code}`);
    if (!opened.ok) ok = false;

    const hop = real ? await handle.navigate("https://www.iana.org/") : await handle.navigate(`http://${allowed}/redirect-blocked`);
    const refusedHost = hop.ok ? null : (hop.host ?? null);
    console.log(`smoke: a disallowed ${real ? "open" : "redirect"}: ${hop.ok ? "NOT refused" : `${hop.code} (${refusedHost})`}`);
    if (hop.ok || hop.code !== "blocked_hop") ok = false;
    if (handle.currentUrl() !== (opened.ok ? opened.url : handle.currentUrl())) {
      console.log("smoke: the page moved after a refused hop");
      ok = false;
    }

    const snap = await handle.snapshot();
    console.log(`smoke: read: ${snap.blocks.length} text blocks, ${snap.elements.length} controls, ${snap.links.length} links, ${snap.contentType}`);
    if (snap.blocks.length === 0) ok = false;
    if (JSON.stringify(snap).includes('"value"')) {
      console.log("smoke: a field value reached the snapshot");
      ok = false;
    }

    const shot = await handle.screenshot({});
    const jpeg = shot.jpeg[0] === 0xff && shot.jpeg[1] === 0xd8;
    console.log(`smoke: picture: ${shot.jpeg.length} bytes, ${shot.width}x${shot.height}, ${jpeg ? "jpeg" : "NOT jpeg"}`);
    if (!jpeg) ok = false;

    if (!real) {
      const after = await fixtureHits("blocked.proof.test");
      console.log(`smoke: hits on blocked.proof.test: ${after - before}`);
      if (after !== before) ok = false;
    }
    await handle.close();
  } catch (err) {
    console.error(`smoke: ${err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : "error"}`);
    ok = false;
  } finally {
    const out = await releaseProviderSession(release, providerSessionId);
    console.log(`smoke: released: ${out}`);
    if (out === "failed") ok = false;
  }

  const listed = await listRunningProviderSessions(release);
  if (!listed.ok) fail(`no list: ${listed.failure}`);
  const mine = listed.data.filter((s) => s.tag === deploymentTag && s.rowId === rowId).length;
  console.log(`smoke: running with this check's tag and row: ${mine}`);
  if (mine !== 0) ok = false;
  console.log(`smoke: guard saw ${seen.refused.length} refusal(s), ${seen.popups} popup(s), ${seen.dialogs} dialog(s), ${seen.downloads} download(s)`);
  if (!ok) fail("a check did not hold");
  console.log("smoke: every check held");
}

main().catch((err) => fail(err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : "error"));

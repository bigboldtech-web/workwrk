// The browser stand-in: the WorkwrK browser host in proof mode
// (docs/plans/browser-host.md Decision 17 and section 10), for the AI
// teammates proofs on THIS MACHINE ONLY.
//
// It runs services/browser-host/main.mjs in process mode with proof mode on:
// our own host, with the stand-in's fixture sites, its controls and its log.
// Every proof, the smoke test and every older note start it the same way:
//
//   node scripts/browser-stand-in.mjs [port]   (default 8789; fixture sites on port + 1)
//
// and start next dev with BROWSER_PROVIDER=stand-in, BROWSERBASE_BASE_URL
// pointing here and BROWSERBASE_API_KEY=stand-in. Both servers listen on
// 127.0.0.1 only, and each browser resolves the fixture sites (*.proof.test)
// to the fixture server and every other name to nothing.
//
// WHAT IT SETS: process mode, proof on, the port and the next one, the key
// "stand-in" (the one the proofs and the smoke test send). The host's own
// proof defaults do the rest: region us-east-1 and app origin
// http://localhost:3016, the proofs' own, unless BROWSER_HOST_REGION or
// BROWSER_HOST_APP_ORIGIN say otherwise.
//
// WHAT IT READS, as before:
//   BROWSER_STAND_IN_LOG           the log file (default: the system temp folder)
//   BROWSER_STAND_IN_FIXTURE_PORT  the fixture sites' port (default: port + 1)
//   CHROME                         the Chrome to run (else the newest
//                                  chrome-headless-shell under ~/.cache/chrome-headless)
// The dev server's own windows (BROWSER_STAND_IN_IDLE_SECONDS, _WAIT_SECONDS,
// _TAKE_OVER_SECONDS and _SESSION_SECONDS) are the app's, read by
// src/lib/browser/config.ts, never here.
//
// THE API (port P) is the host's (services/browser-host/lib/api.mjs), in
// Browserbase's shapes, with X-BB-API-Key: stand-in:
//   POST /v1/sessions               a fresh Chrome on its own empty profile: { id, connectUrl }.
//                                   It ends at its `timeout`, when its one CDP client leaves
//                                   (keepAlive false), or when nobody connects within 60 seconds.
//   GET  /v1/sessions/{id}/debug    { debuggerFullscreenUrl }: the live view's address
//   POST /v1/sessions/{id}          { status: "REQUEST_RELEASE" } ends it
//   GET  /v1/sessions?status=RUNNING  the running sessions with userMetadata
// The connect address goes through the host, which takes one client a
// session (a second connect is refused 409).
//
// THE CONTROLS (services/browser-host/proof/controls.mjs), POST unless said:
//   /__stand-in/reset, /__stand-in/fail?route=&status=&times=&delayMs=,
//   /__stand-in/kill?session=, /__stand-in/type?session=&selector=&text=&enter=1&keys=1,
//   /__stand-in/click?session=&selector=, /__stand-in/choose?session=&selector=&index=,
//   /__stand-in/back?session=, /__stand-in/page?session=&fn=, /__stand-in/start-orphan?tag=,
//   GET /__stand-in/sessions, GET /__stand-in/log?since=<seq>
//
// THE FIXTURE SITES (port P+1, services/browser-host/proof/fixtures.mjs):
// docs, inject, login, shop, ads, blocked and exfil, and Phase 5's
// "expenses.proof.test" and "pay.proof.test".
//
// THE PROOFS READ THIS FILE for what the stand-in serves, until their checks
// read services/browser-host/proof/ (docs/plans/browser-host.md 12.1);
// proof/stand-in.test.ts holds every one of these to what fixtures.mjs and
// controls.mjs really serve:
//   Phase 4 (line 1460): the planted page's "Covered list words" and the rest of
//     review round 1's planted words;
//   Phase 5 (lines 1183 to 1187): the sites "expenses.proof.test" and
//     "pay.proof.test", the page functions renameSubmit, jumpy and fakeEvents,
//     and the controls what === "click", what === "choose" and what === "back".
//
// Stop it by its PID: it ends every browser it started.

import { run } from "../services/browser-host/main.mjs";

const PORT = Number(process.argv[2] || 8789);
const FIXTURE_PORT = Number(process.env.BROWSER_STAND_IN_FIXTURE_PORT || PORT + 1);

/** @type {Record<string, string | undefined>} */
const env = {
  ...process.env,
  BROWSER_HOST_MODE: "process",
  BROWSER_HOST_PORT: String(PORT),
  BROWSER_HOST_FIXTURE_PORT: String(FIXTURE_PORT),
  BROWSER_HOST_KEY: "stand-in",
};
// The proofs' own: never a public address or a stored key from the shell.
delete env.BROWSER_HOST_PUBLIC_URL;
delete env.BROWSER_HOST_KEY_SHA256;
delete env.BROWSER_HOST_STATE_DIR;

const host = await run(env, ["--proof"]);
if (!host) {
  console.error("browser stand-in: the host refused to start (see the reasons above)");
  process.exit(1);
}
console.log(`browser stand-in: the WorkwrK browser host in proof mode on 127.0.0.1 port ${PORT}, fixture sites on port ${FIXTURE_PORT}`);

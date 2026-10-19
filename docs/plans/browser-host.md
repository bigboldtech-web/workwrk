# WorkwrK browser host: our own home for AI teammates' browsers, implementation spec

**Status:** decided by the founder on 2026-10-19 (`~/workwrk-launch-backup/browser-host-plan.md`): build our own host for AI teammates' browsers. There is no Browserbase account and no open-source host; Chrome runs inside it, and every other line is ours. Browserbase stays in the code only as an optional provider.
- The plan's twelve decisions are taken as given. Each is refined below only where the code shows a better or a necessary choice, and every refinement names its worst case.
- The spec is written against `agents-p1` (main at 196a4cd8), and was revised after its spec review on 2026-10-20 (0 high, 11 medium, every one fixed, plus the lows: "After", first entry).
- The founder set the small start and its sizing on 2026-10-20 (Founder actions 1 and 7).
- Save this file as `docs/plans/browser-host.md`.

**How this was checked:** read only. Every file, function and line cited was opened and read, and line numbers come from that read.
- A read-only helper read every line of both live proofs, all of `teammate-copy.ts`, the marketing pages, the SQL manifest and the `prisma/sql` files it lists, and answered with exact lines.
- Where something can only be settled on a real server or on the server's Chrome, the text says **verify:** with what to check.

**Conventions carried from Phases 1 to 5 (unchanged):**
- Every teammate string lives in `src/lib/agents/teammate-copy.ts`. No em dash, en dash or double hyphen in copy; `teammate-copy.test.ts` and `iconic.test.ts` scan for them.
- SQL is additive, idempotent and catalogue-guarded, listed in `scripts/deploy-migrations.mjs` SQL_MANIFEST. The last entry today is `"2026-10-17-ai-teammates-phase5-step1-fixes.sql"` (line 413). The proofs never import or run that script; the lead applies the files to the local database twice with the local-only runner.
- Tests use Vitest in the node environment. A test file is extended when one exists. Each new behaviour test is run once against the code before its change, where it must fail.
- One reviewer per step, one round, high and medium findings fixed (founder, 2026-10-17). The gate (`env -u NODE_OPTIONS scripts/verify-commit.sh`) runs before every push. The final three-reviewer round runs once the build is done (founder, 2026-10-19).
- One run at a time on the laptop. The proofs run their own servers on their own ports and stop them by PID only, never a broad kill.

---

## 0. What the app already asks of a provider (the contract, read from the code)

The host must answer exactly this, or the app changes. Every line here is today's code.

**The client** (`src/lib/browser/browserbase.ts`):
- Every request:
  - sends `X-BB-API-Key` (line 130);
  - follows no redirect (`redirect: "error"`, line 132);
  - gives up after 10 seconds (line 40, `call` lines 98 to 115);
  - reads at most 2 MB (line 43);
  - logs codes only (line 54).
- Status mapping (`failureOf`, lines 67 to 73):
  - 429 is `rate_limited`, with `Retry-After` read as seconds or a date, from 1 to 3600 (lines 58 to 65);
  - 401 and 403 are `client`;
  - 404 is `not_found`;
  - 500 and above are `unavailable`;
  - any other status is `refused`.
- A create whose answer does not arrive, cannot be read or is not JSON is `unknown_outcome`, and is never retried (lines 136 to 172).
- **Create:** `POST /v1/sessions` with `{ projectId, region, timeout, keepAlive: false, browserSettings: { viewport: {1280, 800}, recordSession: false, logSession: false, blockAds: true }, userMetadata: { wk, row } }` (lines 196 to 203).
  - The answer needs an `id` matching `/^[A-Za-z0-9_-]{1,200}$/` (line 46).
  - It needs a `connectUrl` that is `wss:`, or `ws:` for the stand-in (`connectUrlOk`, lines 182 to 186).
- **Live view:** `GET /v1/sessions/{id}/debug` reads `debuggerFullscreenUrl`, refused unless its origin is a configured one over https (lines 220 to 230, `live-view-origin.ts` lines 22 to 28).
- **Release:** `POST /v1/sessions/{id}` with `{ projectId, status: "REQUEST_RELEASE" }`. 404 and 409 read as `already` (lines 239 to 253).
- **List:** `GET /v1/sessions?status=RUNNING`, an array or `{ sessions }`. Each entry's `id`, `status`, and `userMetadata.wk` and `.row` are read, each at most 80 characters (lines 261 to 284).

**The connect address** is a secret, never logged (`cdp.ts` lines 11 to 13). The app opens it once with `ws`, with no redirects and a 32 MB payload cap (`cdp.ts` lines 22 and 182).

**What the app does over CDP on the browser connection** (`cdp-driver.ts setup`, lines 572 to 605, and `setupPage`, lines 608 to 625):
- `Browser.setDownloadBehavior deny`, `Browser.resetPermissions`, and `Browser.setPermission denied` for 14 names (line 202).
- `Target.setDiscoverTargets`, then `Target.getTargets`. The first page is the tab (line 589). A new one is made only when none exists (line 590), and every other page is closed.
- `Target.setAutoAttach` with `waitForDebuggerOnStart` and flat sessions.
- On the tab: `Fetch.enable` for every Document request, `Network.setBypassServiceWorker` (line 617) and `Page.setInterceptFileChooserDialog`.
- Popups are held, refused and closed (lines 653 to 661).
- The reader and the recorder run in isolated worlds (`Page.createIsolatedWorld`, lines 951 and 1406). The recorder adds `Page.addScriptToEvaluateOnNewDocument` with `worldName` (line 1530) and a binding by context id (`Runtime.addBinding`, line 1423, with `Runtime.bindingCalled`, lines 838 to 855). It never calls `Runtime.enable`.
- Acts use `Input.dispatchMouseEvent` and `Input.insertText` (lines 1272 to 1276 and 1304).
- `close()` closes the tab, then the socket (lines 1346 to 1349).
- **The host must change none of this.** It relays the app's connection byte for byte, and opens its own connection to the tab for the live view only (Decision 6).

**The rest of the app's side:**
- **keepAlive false:** `dropLiveBrowser` closes the connection and expects the provider to end the browser then (`live.ts` lines 138 to 152).
- **A lost connection:** `guardHooks.onLost` marks the browser lost and ends the row `provider_ended` (`sessions.ts` lines 280 to 286). The next use ends it the same way (`useBrowserSession`, lines 864 to 869).
- **The sweep:**
  - A release that fails is tried again every 2 minutes, 8 times (lines 99 and 100).
  - An `ending` row past `endsBy` plus 60 seconds is ended at its reserved minutes (lines 2209 to 2220).
  - The reaper releases RUNNING sessions tagged with this deployment that no live row names, at most 50 a tick (lines 2249 to 2272).
- **The provider's own limit** is the reserved time plus 60 seconds (`sessions.ts` line 491).
- **The live view is minted** by three callers, each with `liveViewUrl(cfg, id)`:
  - the live-view route, `src/app/api/teammate-browser/sessions/[id]/live-view/route.ts` line 54, which answers `interactive: row.status === "handed_over"` (line 56);
  - `take-over.ts startTakeOver`, line 162;
  - `src/lib/skills/recorder.ts startRecording`, line 490.
- **The card** (`src/components/agents/browser-card.tsx` `LiveFrame`, lines 673 to 710):
  - It frames the address with `sandbox="allow-scripts allow-same-origin"`, `referrerPolicy="no-referrer"` and `allow="clipboard-write"`.
  - Outside a take over the frame is `inert`, under a transparent overlay that swallows every pointer and key event.
  - It embeds only when `liveViewShownOk` passes (lines 263 to 276). In production that is Browserbase's origin alone (`live-view-origin.ts` lines 38 to 44).
- **How many browsers the plans allow at once** (`src/lib/plan-limits-data.ts BROWSER_LIMITS`, Phase 4 Decision 5): GROWTH 2, SCALE 5 and ENTERPRISE 20 a workspace. Demand starts small (Founder action 1).

---

## 1. Decisions taken (each decided by its worst case)

1. **Same API as the Browserbase subset the app already uses** (plan 1), with three additions that only our host is asked for.
   - Section 0's paths, bodies, shapes and statuses are answered exactly.
   - The app sends three new things, and only when the provider is our host: `workwrk`, or `stand-in`, which is now our host in proof mode (Decision 17). Browserbase never gets them.
     - `?mode=watch|control` on the debug call;
     - a revoke route for control views (Decision 7);
     - a check that the connect address is on the host's own name.
   - Worst case avoided: two clients drifting apart, and an unknown query sent to Browserbase.

2. **A server of its own, on a domain of its own, never the app server** (plan 2, refined).
   - The host refuses to start in container mode when it finds a Postgres or the app on its machine: a listener on 5432, 5433 or 3000 in `/proc/net/tcp` and `/proc/net/tcp6`, or a process named `postgres` or `next-server`.
   - **Refinement: the host's name is not under `workwrk.com`.** The app's session cookie takes `Domain=COOKIE_DOMAIN` when that is set (`src/lib/auth.ts` lines 405 to 441). A host at `browsers.workwrk.com` would then receive every watcher's WorkwrK session token on every frame and live view request, on the very machine that runs pages from anywhere.
   - In production, `config.ts` refuses a `BROWSER_HOST_URL` that `sites.ts neverReason` names: an app host, `workwrk.com` with every subdomain, an IP literal, or an internal name.
   - Worst case of the plan's example name: a Chrome escape harvests WorkwrK sessions. Worst case of this choice: one more domain to buy (Founder action 2).

3. **One container per session in production** (plan 3), with the exact settings in 5.2:
   - non-root (uid 10001);
   - a read-only root, with `/tmp`, the home and the profile on tmpfs;
   - `CapDrop ALL`, `no-new-privileges`, and Chrome's own sandbox ON;
   - **seccomp:** Docker's defaults plus the three calls Chrome's namespace sandbox needs (`clone`, `unshare` and `chroot`, with no argument filter). A `socket` for the netfilter netlink family is refused.
   - **AppArmor:** Docker's defaults plus `userns,` and `unix,`, denying `net_admin`, `net_raw`, `sys_module`, `bpf` and the other capabilities in 5.2. `sys_chroot` and `sys_admin` are kept for Chrome's sandbox (the reasoning is in 5.2).
   - memory, CPU and pids caps, and an OOM score of 500;
   - no published port, no mount and no device.
   - The boot self-test proves the sandbox is on and the denials hold (5.2).
   - Worst case avoided:
     - a page escaping into the host;
     - one person's browser reading another's;
     - a compromised browser process using a user namespace to reach the kernel's nf_tables (the class of local privilege escalations behind CVE-2024-1086).

4. **Egress: our own nftables table, not the DOCKER-USER chain** (plan 3, refined).
   - The table is `inet workwrk_browsers`, loaded before Docker starts. It is replaced atomically on every load: the file declares, deletes and defines the table in one transaction. It is checked by meaning every 5 minutes.
   - It covers four hooks:
     - forward, for a container reaching anything;
     - input, for a container reaching the host itself, which DOCKER-USER never sees;
     - output, where only the host's own user may reach a session's DevTools port;
     - the host's public inbound.
   - Session traffic that is not allowed is **rejected** (a TCP reset, or ICMP administratively prohibited), never silently dropped, and every refusal rule has its own named counter. What it refuses:
     - every range of `addresses.ts privateV4`;
     - the host's own addresses and the app server's;
     - all IPv6;
     - any port but TCP 80 and 443 and UDP 443;
     - DNS except to four public resolvers.
   - Traffic into a session network that is not a reply is dropped.
   - Each session has its own bridge, so containers never share a link.
   - Worst cases avoided:
     - DOCKER-USER alone: a page reaches the host's SSH, Caddy or API through the bridge gateway.
     - A silent drop: every blocked request hangs for about two minutes, for the person and for the proof alike.
     - A reload that appends: duplicate rules that no check notices.

5. **Process mode is for this laptop and the proofs only** (plan 4).
   - It is refused when `NODE_ENV=production`, and whenever the host would listen beyond 127.0.0.1.
   - **Proof mode** (`--proof`, process mode only) adds the stand-in's fixture sites, its controls and its log.
   - Worst case avoided: a Chrome with no container and no egress rules facing the internet for a customer.

6. **The live view is ours** (plan 5).
   - The frames come from `Page.startScreencast` and are relayed over a websocket.
   - Input goes through CDP `Input`, so the page sees trusted events, which the recorder needs.
   - **The live view's connection to the tab** may send only `LIVE_METHODS`:
     - `Page.startScreencast`, `Page.stopScreencast`, `Page.screencastFrameAck` and `Page.bringToFront`;
     - `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText` and `Input.imeSetComposition`.
     - It never sends `Runtime`, `DOM`, `Emulation`, `Network`, `Fetch` or `Target` commands, so the guard the app set up is never touched.
     - `LIVE_METHODS` binds the live view's connection only. The proof controls have their own, in proof mode only (Decision 17).
   - The remote viewport never changes. Resizing is drawn in the page, and touch becomes mouse and wheel in the viewer's page.
   - Worst case of emulation or resizing from the live view: the page's layout changes under a waiting card, which then fails `changed`, or a watcher changes the person's browser.

7. **Watch and control views, enforced by the host and revoked before the hand back** (plan 5, refined).
   - **The token:** an HMAC bound to one session and one mode.
     - A watch token lives until its session's own end plus 60 seconds. A control token lives 15 minutes, never past that end.
     - It travels in the address's fragment (`#t=`), never in a query, and the page removes it from its own address.
   - **Watch views never type:** the host never relays their input, and the first input message closes the view (4403).
   - **Reconnects:** the newest socket on a token wins and the older is closed. The host pings every viewer and frees a silent one.
   - **Revoke:** Done and Give it back bump the session's control epoch, through a new call made before the session is handed back. That closes every control view.
   - **A viewer that leaves** has any mouse button or key it held released.
   - Worst cases avoided:
     - a watcher typing;
     - a control link that still drives the browser after the person gave it back;
     - a person locked out of their own take over after a network blip.

8. **One CDP client per session, ever** (plan 6, refined from "clients are counted").
   - The connect token works once.
   - A second upgrade is refused 409, both while the first is open and after it, since the session has ended (keepAlive false).
   - A session nobody connects to within 60 seconds ends.
   - The host pings the client to keep the connection alive through anything between.
   - Worst case of several clients: a leaked connect address becomes a second driver of the person's signed-in browser, with no guard. Nothing in the app needs two (`attachBrowser` connects once).

9. **Lifecycle** (plan 7), exact in section 6:
   - a timeout backstop on the host's monotonic clock, and a second one inside the container (`timeout -s KILL`);
   - release;
   - a list of RUNNING sessions with their `userMetadata`;
   - a reaper at start and every minute, over a state file, Docker labels and the process mode's profile folder;
   - a max from memory and CPU (Decision 18), answering 429 when full;
   - a restart that ends every session, which the app reads as `provider_ended`.

10. **Nothing kept** (plan 8).
    - No page, frame, input, download or Chrome output, and no id, token, address, header or body in any log. Counts only.
    - Caddy writes no access log, and no log from its handlers or its proxy.
    - The state file names containers or processes only.

11. **Auth, transport and being watched** (plan 9, refined).
    - **Keys:** the host keeps only the SHA-256 of the app's key, never the key. Keys are compared in constant time, and two hashes may be set for rotation.
    - **Who may reach what:**
      - The API, the connect route and `/health` answer only the app server's addresses (a Caddy matcher).
      - `/live/*` and `/healthz` are public.
      - TLS comes from Caddy, with automatic certificates.
    - **`/healthz`** answers 503 whenever creates would be refused for a reason that needs a person, so an uptime monitor (Founder action 9) sees it. It answers 200 during a scheduled drain and when full.
    - **The app's sweep reads `/health` once an hour** and logs the host's problems and its capacity refusals.
    - Worst cases avoided:
      - a key alone: a leaked key mints a control view for any running session from anywhere;
      - a `/healthz` that always says ok: a broken host nobody notices until people complain.

12. **Chrome, Docker and the rest kept current** (plan 10, refined).
    - **The image:**
      - It installs `google-chrome-stable` from Google's signed apt repository.
      - A daily check rebuilds it when Chrome or the base image changed, and a weekly rebuild runs regardless.
      - The build and its self-test hold a browser slot.
      - A new image becomes current only after its self-test passes.
      - Creates are refused (503 `chrome_stale`) once the current image is 14 days old.
    - **The rest of the server:**
      - Ubuntu's own security updates install every night, with no automatic reboot.
      - A daily maintenance job checks Docker Engine, containerd (with runc), Caddy, Node.js and whether a reboot is needed. Only when something is pending does it drain the host, apply it and restart.
    - `/health` reports every version.
    - The smoke test refuses a Chrome below its floor, and a runc below its floor.
    - Worst cases avoided:
      - a weekly image only: a Chrome zero-day runs unpatched up to 7 days;
      - no update path for Docker's repository: a known runc escape (such as CVE-2024-21626) stays on a box that runs pages from anywhere;
      - automatic updates mid-day: dockerd restarts and kills every browser at a random hour.
    - Worst case of the staleness refusal: the computer stops starting browsers until the job is fixed, which `/healthz` and `/health` say.

13. **Chrome's flags: its sandbox on, no stealth, the back/forward cache off, permission prompts denied.**
    - Never `--no-sandbox`. The user agent is Chrome's own, with no fingerprint tricks.
    - `--disable-features=BackForwardCache`, so every page change makes a request the app's guard sees. The driver's commit check (`cdp-driver.ts` lines 34 to 45) stays as a second wall.
    - `--deny-permission-prompts`, so a public page's request to a local address is denied, not asked.
    - Worst case of stealth: an arms race against site owners' terms, and the person's own account flagged for evasion. Worst case of none: some sites challenge or refuse (Risk 11).

14. **Copy and legal** (plan 11, refined).
    - The privacy page, the cookie page and Settings, Apps & modules say the browsers run on a server WorkwrK runs, in its region.
    - The cookie page says the frame sets nothing in the person's browser.
    - New: `src/lib/browser/disclosed.ts DISCLOSED_PRODUCTION_PROVIDER = "workwrk"`. In production `browserConfig()` is null for any other provider, while `browserReleaseConfig()` still releases.
    - Worst case avoided: the privacy page naming our servers while browsers run at Browserbase. Using Browserbase in production becomes a deliberate change of the constant and the pages, in one commit.

15. **Code** (plan 12).
    - The host lives in `services/browser-host/`, as plain ES modules (`.mjs`), each starting `// @ts-check`.
    - `tsconfig.json` includes them, and Vitest includes their tests.
    - It has its own entry points (the host and the launcher), its own `package.json` (only `ws`) and its own install script.
    - It imports nothing from `src/` or Next.js. Its tests may import the pure `src/lib/browser/addresses.ts`, to hold the firewall's ranges to it.
    - Worst case of TypeScript on Node's type stripping: Node 20 in CI cannot run it, and a type-only import fails only at runtime.

16. **The data change** (section 2): the session CHECK gains `'workwrk'`.
    - Worst case without it: once `BROWSER_PROVIDER=workwrk`, every start's insert fails the CHECK (23514), and no browser ever starts.

17. **The stand-in becomes our host in proof mode.**
    - The fixture sites, the controls and the log move out of `scripts/browser-stand-in.mjs` into `services/browser-host/proof/`.
    - The stand-in's provider half is deleted: its own Chrome launcher, API, CDP proxy and `<img>` live view (lines 142 to 492 and 1225 to 1278).
    - `scripts/browser-stand-in.mjs` stays as a short launcher. It runs the host in process mode, with proof mode on, on the same ports, so every proof, the smoke test and every older note still work.
    - **The proof controls keep a connection of their own to the tab**, opened only in proof mode:
      - Their coordinates come from `Runtime.evaluate`, as the stand-in's did (`centreOf`, lines 495 to 502).
      - Back uses `Page.getNavigationHistory` and `Page.navigateToHistoryEntry` (lines 639 to 653).
      - Their input is built by the live view's own mapper (`live-input.mjs`) and sent on that connection, so the person's clicks and keys in the proofs are the same CDP commands a control viewer's would be.
    - Worst cases avoided:
      - keeping two providers: the proofs prove a stand-in, not the host;
      - widening `LIVE_METHODS` for the proofs: a production connection that can run script on the page.

18. **The max, from memory, with the host kept alive under pressure.**
    - `max = min(floor((MemTotal - 2 GiB) / (S + 32 MiB)), 2 × vCPUs, 100)`, where:
      - S is `BROWSER_HOST_SESSION_MEMORY_MB` (default 1280, allowed 1024 to 4096);
      - 32 MiB per session covers its containerd shim and bridge;
      - process mode uses S = 1024 and no shim.
    - `BROWSER_HOST_MAX` may only lower the max, and a max below 1 refuses to start.
    - The image build and every self-test run only while holding a free slot.
    - **OOM scores:** the host, the launcher and Caddy run at -900, and every session container at 500, so under memory pressure the kernel kills a browser first. Docker's own units keep their scores (dockerd -500, containerd -999).
    - Worst cases avoided:
      - overcommit, or a build beside a full box: the kernel kills the host process or Docker, and every browser with it.

19. **A split launcher, the only part that touches Docker** (new, the review's finding 3).
    - `workwrk-browser-launcher` runs as its own user, `wkblaunch`, in the `docker` group, with no network at all (`PrivateNetwork=yes`).
    - It answers eight fixed operations over a unix socket that only the host's user may open.
    - **It builds every Engine body itself**, from fixed settings and three checked arguments (the session id, the viewport and the timeout).
    - The public host process (`wkbhost`) has no Docker access at all.
    - **Chosen over an allowlisting socket proxy**, by worst case: a proxy that allows paths cannot tell `POST /containers/create` with `Privileged: true`, or a bind of `/`, from ours unless it parses and rebuilds the body, which is this launcher with more moving parts. So a compromised host process behind a proxy is root on the server. Behind the launcher it can only start and stop browser containers with our settings: a denial of service at most.

---

## 2. Data

### 2.1 Why there is any

- `prisma/sql/2026-10-11-ai-teammates-phase4.sql` line 200 holds `"provider" IN ('browserbase', 'stand-in')`.
- `sessions.ts` writes `provider: cfg.provider` into every new row (line 450).
- No later file replaces that CHECK: the Phase 5 columns file adds `TeammateBrowserSession_skill_check` beside it.
- `types.test.ts` holds `BROWSER_PROVIDERS` to the Phase 4 file (lines 15 and 28).

### 2.2 `prisma/sql/<build day>-browser-host-provider.sql`

The date is the build day, for example 2026-10-21.

```sql
-- <build day> The WorkwrK browser host (docs/plans/browser-host.md Decision 16):
-- the session CHECK gains the provider 'workwrk'.
--
-- REPLACED UNDER ITS OWN NAME, guarded on its definition naming 'workwrk', as
-- 2026-10-11-ai-teammates-phase4-erasure.sql did for "AccountErasure" (After
-- Phase 4, step 2, "The CHECK keeps its name"): the Phase 4 file adds
-- "TeammateBrowserSession_values_check" whenever none of that name exists, so
-- a new name would bring the old list back beside the new one.
--
-- NOT VALID here, VALIDATE in the next file, its own transaction: this file
-- holds ACCESS EXCLUSIVE on "TeammateBrowserSession" for the drop and the add
-- only, with no scan; the scan takes SHARE UPDATE EXCLUSIVE, so reads and
-- writes go on. Every row the old list allowed the new one does.
-- Before the reload: the new build writes 'workwrk' once it is configured.
-- Rollback: nothing to undo; the old build never writes 'workwrk', and the new
-- CHECK allows all it writes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'TeammateBrowserSession_values_check'
       AND conrelid = '"TeammateBrowserSession"'::regclass
       AND pg_get_constraintdef(oid) LIKE '%''workwrk''%'
  ) THEN
    ALTER TABLE "TeammateBrowserSession" DROP CONSTRAINT IF EXISTS "TeammateBrowserSession_values_check";
    ALTER TABLE "TeammateBrowserSession" ADD CONSTRAINT "TeammateBrowserSession_values_check" CHECK (
      "provider" IN ('browserbase', 'stand-in', 'workwrk')
      AND "status" IN ('starting', 'live', 'waiting', 'handed_over', 'ending', 'ended')
      AND ("endReason" IS NULL OR "endReason" IN ('idle', 'time_cap', 'waited_too_long', 'take_over_too_long', 'stopped',
           'closed_by_teammate', 'turned_off', 'plan', 'left', 'deactivated', 'no_access', 'workspace_closed', 'teammate_off',
           'restarted', 'start_failed', 'provider_ended', 'admin_stopped'))
      AND "reservedMinutes" BETWEEN 1 AND 120
      AND ("billedMinutes" IS NULL OR "billedMinutes" >= 0)
      AND "stopAttempts" >= 0
      AND "endsBy" > "startedAt"
    ) NOT VALID;
  END IF;
END $$;
```

### 2.3 `prisma/sql/<build day>-browser-host-provider-validate.sql`

```sql
-- <build day> Validates the CHECK the file before it replaced
-- (docs/plans/browser-host.md section 2), in its own transaction: SHARE
-- UPDATE EXCLUSIVE, so the session table's reads and writes go on.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'TeammateBrowserSession_values_check'
       AND conrelid = '"TeammateBrowserSession"'::regclass
       AND NOT convalidated
  ) THEN
    ALTER TABLE "TeammateBrowserSession" VALIDATE CONSTRAINT "TeammateBrowserSession_values_check";
  END IF;
END $$;
```

### 2.4 The manifest, the schema and the types

- **SQL_MANIFEST:** both files, in that order, after whatever is last at build time. The comment names this spec, the lock each file takes, and "before the reload".
- **`prisma/schema.prisma`:** the `TeammateBrowserSession.provider` comment reads `/// "browserbase" | "stand-in" | "workwrk"`. No column changes, so `check-schema-sql` is unaffected.
- **`src/lib/browser/types.ts`** (lines 15 to 17): `BrowserProviderName = "browserbase" | "stand-in" | "workwrk"`, and `BROWSER_PROVIDERS = ["browserbase", "stand-in", "workwrk"]`. **verify:** other readers of the list, with `grep -rn "BROWSER_PROVIDERS" src`.
- **`types.test.ts`:**
  - The provider list is read from the new file's CHECK, and must equal `BROWSER_PROVIDERS`.
  - The new file's status and end-reason lists must equal the Phase 4 file's, which keeps its own `['browserbase', 'stand-in']`.
  - Both new files are wholly inside catalogue-guarded DO blocks, the first adds `NOT VALID`, and the manifest lists the validate file after the other.
  - It fails today: the file is missing.

---

## 3. The host's API

The base is `BROWSER_HOST_PUBLIC_URL`: `https://browsers.<the host's own domain>` in production, `http://127.0.0.1:<port>` in process mode. The host listens on 127.0.0.1 only, in both modes. In production, Caddy is in front.

### 3.1 Auth and limits

**The key:**
- Every `/v1/*` request and `/health` must carry `X-BB-API-Key`, the header the app already sends.
- The host holds `BROWSER_HOST_KEY_SHA256=<64 hex>[,<64 hex>]`.
- It hashes the header's bytes and compares the hash with each stored one using `crypto.timingSafeEqual`, always both, so the timing never says which one matched or how long the key is.
- Process mode may take `BROWSER_HOST_KEY` in the clear; it hashes it at start and drops it. Container mode refuses a clear key.
- A missing or wrong key answers 401 `{ "error": "unauthorized" }`.

**The client address** is read from `X-Forwarded-For` only when the TCP peer is 127.0.0.1 (Caddy); otherwise it is the peer itself. It is kept in memory for the limit's window only, and never logged.

**Limits** (all in memory, each answering 429 with `Retry-After` in whole seconds):
- 10 auth failures in a minute from one address block that address on every route for 10 minutes;
- 120 API requests a minute overall, and 30 creates a minute;
- 60 live view connects a minute per address;
- 20 live token failures a minute per address block that address's live view connects for 10 minutes.

**Caddy** answers 404 to `/v1/*`, `/connect/*` and `/health` from any address not in `BROWSER_HOST_APP_IPS` (Founder action 5).

### 3.2 The endpoints, and how `browserbase.ts` reads each answer

**`POST /v1/sessions`** (create). The body is section 0's shape, JSON, at most 64 KB.

| Answer | When | How the app reads it |
|---|---|---|
| 400 `{ "error": "bad_request", "field": "<name>" }` | any check below fails | `refused`: the row ends `start_failed` and the person reads `providerUnavailable` |
| 429 `{ "error": "at_capacity" }`, `Retry-After: 30` | running plus starting sessions plus held slots are at least the max; counted in `/health` as a capacity refusal | `rate_limited`: the person reads `providerBusy`, with the wait |
| 503 `{ "error": "unavailable", "why": "<code>" }` | `chrome_did_not_start` (Chrome not ready within 8 seconds; the container or process is killed first), `draining`, `chrome_stale`, `firewall_unchecked`, `launcher_unreachable` or `preflight` | `unavailable` |
| 201 | the session JSON (below), with `connectUrl: "<wss or ws>://<host>/connect/<id>?t=<token>"`, sent only once Chrome's DevTools endpoint is up, so the connect cannot race the launch | ok |

The 400 checks:
- `region` must equal `BROWSER_HOST_REGION`, so the app's region line is never false;
- `timeout` must be a whole number from 60 to 21600;
- `keepAlive` must be false or absent;
- `browserSettings.recordSession` and `logSession` must be false or absent: the host never records or logs, and says so rather than ignore the ask;
- the viewport's width must be 320 to 1920 and its height 240 to 1200;
- `userMetadata` must be an object of at most 10 keys matching `/^[A-Za-z0-9_]{1,40}$/`, each value a string of at most 80 characters;
- `projectId` must be at most 200 characters.

`browserSettings.blockAds` is accepted and ignored: the host has no ad blocker.

**`GET /v1/sessions/{id}/debug?mode=watch|control`**
- 200 `{ "debuggerFullscreenUrl": "<base>/live/<id>#t=<token>", "debuggerUrl": "<same>", "wsUrl": null, "pages": [] }`.
- No `mode` means watch, so a client that forgets is safe.
- 400 for any other mode value.
- 404 for an unknown or ended session, read as `not_found`.

**`POST /v1/sessions/{id}`** with `{ projectId?, status: "REQUEST_RELEASE" }` (release)
- 200: the session JSON, with `status: "COMPLETED"`.
- 409: already ended, while remembered (one hour). 404: unknown or forgotten. Both read as `already`.
- 400: any other status.

**`GET /v1/sessions?status=RUNNING`** (list)
- 200: an array of session JSON.
- `RUNNING` covers starting and running sessions; `COMPLETED` covers the ended ones still remembered; no filter gives every remembered session.
- 400 for any other status.

**`POST /v1/sessions/{id}/live-views/revoke`** (new; only our host is asked)
- Bumps the session's control epoch and closes every control view (4401 `revoked`).
- 200 `{ "revoked": <n> }`, or 404 when unknown or ended.

**`GET /health`** (the key is needed)
- 200 `{ ok, mode, version, chrome, chromeMajor, imageBuiltAt, imageAgeDays, versions: { node, kernel, docker, containerd, runc, caddy }, max, running, starting, held, region, draining, firewallCheckedAt, counts: { capacityRefusals1h, capacityRefusals24h, ... }, problems: [...] }`.
- `version` is the host's commit, written into `VERSION` by the archive step.
- `chrome` is the full version (for example `"154.0.7xxx.yy"`), read from `Browser.getVersion` at the boot self-test.
- `versions` comes from the launcher's `versions` operation and from the maintenance job's `versions.json` (8.4).

**`GET /healthz`** (no key)
- 503 `unavailable` while `problems` holds anything that needs a person: `chrome_stale`, `image_build_failing` (no good build in 3 days), `firewall_unchecked`, `launcher_unreachable`, `selftest_failed`, `preflight` or `drain_stuck` (draining over 40 minutes).
- Otherwise 200 `ok`, or `draining` during a scheduled drain. Being full is no fault.
- Plain text. It tells nothing else.

**WebSocket `/connect/{id}?t=<token>`**
- Refused before the upgrade with an HTTP status, then the socket is destroyed: 401 for a wrong token, 404 when unknown or not running, 409 when already connected once.
- Then a byte-for-byte relay (6.3).

**`GET /live/{id}`, `GET /live/assets/*`, and WebSocket `/live/{id}/ws`:** section 4.

**The session JSON** (the shape the stand-in answered, `browser-stand-in.mjs sessionJson` lines 272 to 288):

```json
{ "id": "<uuid v4>", "createdAt": "<iso>", "updatedAt": "<iso>", "startedAt": "<iso>", "endedAt": "<iso>|null",
  "expiresAt": "<iso>", "projectId": "<as sent>", "status": "RUNNING|COMPLETED", "proxyBytes": 0,
  "keepAlive": false, "contextId": null, "region": "<host region>", "userMetadata": { "wk": "...", "row": "..." } }
```

Error bodies hold codes only, never a value sent. The host never answers a redirect. No response sets a cookie.

### 3.3 Tokens

**The boot key:** each boot makes a random 32-byte key, held in memory only. A restart voids every token, and every session goes too.

**The connect token:**
- `base64url(HMAC-SHA256(bootKey, "connect." + id))`.
- Checked in constant time. Good once: the session's `connected` flag.

**The live token:**
- `payload = base64url(JSON {s: id, m: "w"|"c", e: exp unix seconds, g: control epoch, n: 16 random bytes})`.
- `mac = base64url(HMAC-SHA256(bootKey, "live." + payload))`.
- The token is `payload.mac`.
- It is valid while `e` is in the future (by the host's own clock), `s` is the path's id, and, for control, `g` equals the session's epoch.
- **Lifetimes:**
  - Watch: `e` is the session's `expiresAt` plus 60 seconds, so a watch view outlives its session's own end; at most 2 hours from minting.
  - Control: `e` is 15 minutes from minting (the take over and recording window is 10 minutes), never past that same end.
- While a socket uses a token, the host keeps only the token's SHA-256, so that the newest socket on a token wins (4.2).
- Nothing about the person, the workspace or the teammate is in any token.

---

## 4. The live view

### 4.1 The page

**`GET /live/{id}`** answers the same static shell for any id that matches the id format, so the page never tells whether a session exists. The websocket decides.

**Headers** on the shell and on every asset:
- the shell's `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src <wss or ws origin of the host>; frame-ancestors <BROWSER_HOST_APP_ORIGIN>; base-uri 'none'; form-action 'none'`;
- `Cache-Control: no-store`;
- `Referrer-Policy: no-referrer`;
- `X-Content-Type-Options: nosniff`;
- on the assets, `Cross-Origin-Resource-Policy: same-origin`;
- no `Set-Cookie`, ever.

**`services/browser-host/live/page.html`** holds four elements:
- a `<canvas>` with `role="img"` and `aria-label="The teammate's browser"`, filling the frame;
- an off-screen `<textarea>` that receives keys in control mode (`autocomplete="off" autocapitalize="off" spellcheck="false" aria-hidden="true"`);
- a status line (`role="status"`) centred over the canvas;
- `<script type="module" src="/live/assets/live.mjs">`.

There is no other element: no button, no menu, no new app UI.

**The look, in the app's tokens:**
- The background is the card frame's `bg-subtle` (`--os-surface-1`); the status text is `text-ink-2` (`--os-ink-2`).
- Light: `#F6F7F9` and `#5C6779` (`src/app/(dashboard)/tokens.css` lines 100 and 118).
- Dark, under `@media (prefers-color-scheme: dark)`: `#15181D` and `#9AA3B2` (lines 472 and 486; lines 375 and 389 give the same for `.dark`).
- The type is the system UI stack at 14px.
- A test reads `tokens.css` and `live.css` and holds the four values equal.
- Worst case: a person who forced light on a dark system sees the connecting line in dark for a moment.

**The words** (`services/browser-host/live/copy.mjs`, scanned for dashes):
- `connecting: "Connecting to the browser"`
- `reconnecting: "Connection lost. Trying again"`
- `ended: "This browser has closed."`
- `expired: "This view has expired. Open it again from the chat."`
- `revoked: "This view was closed."`
- `refused: "This view can't be shown here."`

**`live.mjs`:**
- reads the token from `location.hash`, then calls `history.replaceState(null, "", location.pathname)`, so the token leaves the frame's address;
- never touches `document.cookie`, `localStorage`, `sessionStorage`, `indexedDB`, `eval` or `innerHTML`, and never writes the clipboard;
- registers input listeners only inside `attachControl()`, which runs only after the server's hello says `control`.

### 4.2 The protocol (`/live/{id}/ws`)

**The upgrade:** the `Origin` header must be the host's own public origin (the page is the host's); anything else is refused 403 before the upgrade. At most 4 viewers a session; a fifth is closed 4409.

**Messages from the viewer** (JSON text):
- `{"t":"hello","token":"<token>"}`, first, within 5 seconds, or the socket is closed 4400.
- Control only:
  - `{"t":"mouse","type":"move"|"down"|"up","x":n,"y":n,"button":"left"|"middle"|"right"|"none","buttons":0..7,"clicks":1..3,"mods":0..15}`
  - `{"t":"wheel","x":n,"y":n,"dx":n,"dy":n,"mods":0..15}`
  - `{"t":"key","type":"down"|"up","key":"<1..32 chars>","code":"<[A-Za-z0-9]{1,32}>","vk":0..255,"text":"<0..8 chars>","mods":0..15,"repeat":bool,"location":0..3}`
  - `{"t":"text","text":"<1..10000 chars>"}`: a paste, a committed IME text or a soft keyboard's words
  - `{"t":"ime","text":"<0..200 chars>","start":n,"end":n}`
- Both modes: `{"t":"ping"}` every 20 seconds (it keeps idle middleboxes open both ways).

**Messages from the host:**
- `{"t":"hello","mode":"watch"|"control","width":1280,"height":800,"exp":<unix s>}`.
- Binary frames: one byte `0x01`, a 4-byte big-endian header length, a JSON header `{"w","h","sx","sy","seq"}` (the screencast metadata's device size and scroll), then the JPEG.
- `{"t":"pong"}`, and `{"t":"ended"}` before a 4404 close.
- **Host pings:** a websocket ping every 15 seconds; a viewer with no pong for 45 seconds is closed and its slot freed.

**Close codes:**

| Code | Meaning | The page shows |
|---|---|---|
| 4400 | No hello, or a bad one | `refused` |
| 4401 | Token `invalid`, `expired` or `revoked` (the reason text) | `refused`, `expired` or `revoked` |
| 4403 | Input sent on a watch view | `refused` |
| 4404 | Session unknown or ended | `ended` |
| 4408 | Replaced by a newer socket on the same token | nothing (that page is gone or reconnecting) |
| 4409 | A fifth viewer | `refused` |
| 4429 | Rate limited | `reconnecting` |
| 1011 | Host error | `reconnecting` |

After any other close, the page reconnects with the same token at 0.5, 1, 2, 4 and 8 seconds, five tries, while `exp` has not passed.

**The newest socket wins.** A socket that says hello with a token already in use closes the older socket (4408) and takes its place.
- Worst case of the older winning: a person whose network dropped is locked out of their own take over until the dead socket times out.
- Worst case of the newer winning: someone holding a leaked token can push the person off for a moment, which the person sees at once (their view reconnects and pushes back), and Done revokes it (Decision 7).

**When a control viewer leaves, by any close**, the host sends:
- `mouseReleased` at the last position for any button it last pressed and never released;
- `keyUp` for each key it last pressed and never released;
- so no button stays held in the remote page for the teammate's next act.

**The input mapping** (`services/browser-host/lib/live-input.mjs`, pure; on the live view's connection, or the proof controls' in proof mode):

| Message | CDP |
|---|---|
| mouse move | `Input.dispatchMouseEvent { type: "mouseMoved", x, y, button: <the held button or "none">, buttons, modifiers }` |
| mouse down / up | `mousePressed` / `mouseReleased` with `button`, `buttons`, `clickCount: clicks`, `modifiers` |
| wheel | `Input.dispatchMouseEvent { type: "mouseWheel", x, y, deltaX: dx, deltaY: dy, modifiers }` |
| key down with `text` | `Input.dispatchKeyEvent { type: "keyDown", key, code, text, unmodifiedText: text, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, autoRepeat, location }`; Enter carries `text: "\r"` |
| key down without `text` | the same with `type: "rawKeyDown"`, and no text |
| key up | `{ type: "keyUp", key, code, windowsVirtualKeyCode, nativeVirtualKeyCode, modifiers, location }` |
| text | `Input.insertText { text }` |
| ime | `Input.imeSetComposition { text, selectionStart: start, selectionEnd: end }` |

Checks on every message:
- coordinates are clamped to the viewport, deltas to ±10,000 and modifiers to 0 to 15;
- control characters are stripped from `text`, except a line break and a tab;
- unknown types and fields are dropped, and counted.

Rates:
- at most 300 messages a second and 100,000 characters of text a minute, per viewer;
- past that, moves and wheels are dropped first; presses, releases and keys are never dropped out of order;
- at most 50 commands in flight, sent in order on the one connection, which CDP runs in order.

**What the page sends** (`live.mjs`, control mode only):
- **Pointer events** on the canvas, mapped through the frame's metadata: `x = (clientX - left) × w / width`, letterboxed to the frame's 16:10. Moves are coalesced to one per animation frame. Double and triple clicks are counted within 500 ms and 4 px.
- **Wheel events**, normalised to pixels (a line is 40 px, a page 800 px), coalesced per frame, with `preventDefault`.
- **Keys** come from the focused textarea:
  - `isComposing` or `keyCode 229` leaves the key to composition and `input`;
  - a printable key sends `text`;
  - **Cmd on a Mac viewer is sent as Ctrl**, since the remote browser is Linux, so Cmd+A selects all there;
  - Ctrl or Cmd with V is never sent as a key: the `paste` event sends `{t:"text"}` from `clipboardData`, at most 10,000 characters.
- **Composition:** `compositionupdate` sends `ime`, and `compositionend` sends `text`.
- **Soft keyboards:** `beforeinput` with `deleteContentBackward` sends a Backspace press; `insertLineBreak` and `insertParagraph` send Enter; `input` with `insertText` sends `text`.
- **Touch:** a tap becomes a move, a press and a release; a one-finger drag becomes wheel deltas; anything else is ignored.
- A tap or click on the canvas focuses the textarea, so a phone's keyboard opens.

**Choices made by worst case:**
- **Touch becomes mouse**, never `Emulation.setTouchEmulationEnabled`, which would change the page for the teammate's reads (Decision 6).
- **Copying out of the remote browser is not offered.** The page holds no clipboard write, and the app denies the remote page clipboard access (`cdp-driver.ts` line 202). Worst case of offering it: words from a planted page placed on the person's clipboard.
- **Tab is sent to the remote page**, as the card already expects: its buttons sit above the frame (`browser-card.tsx` lines 671 and 672).

**The frames:**
- The first viewer starts `Page.startScreencast { format: "jpeg", quality: 65, maxWidth: <viewport width>, maxHeight: <viewport height>, everyNthFrame: 1 }`, and the last to leave stops it.
- Each `Page.screencastFrame` must decode to at most 2 MB, starting `FF D8`, or it is dropped.
- It goes to every viewer whose `bufferedAmount` is under 1 MB. A viewer behind keeps only the newest pending frame.
- Each frame is acknowledged (`Page.screencastFrameAck`) no sooner than 66 ms after the last acknowledgement, so at most 15 frames a second leave Chrome.
- The newest frame is held in memory, only while a viewer is attached, to give a viewer who joins. It is dropped with the last viewer, or with the session.

**The tab:**
- The live view's connection is to `/devtools/page/<the tab>`. It is opened at the first viewer, never at the session's start, so it never meets the driver's setup.
- The tab is the page target Chrome opened at launch, whose id is kept on the session.
- If the driver closed it and made its own (`cdp-driver.ts` line 590 makes one only when none exists), the tab is the one page left once popups are closed: `/json/list` is polled each second while a viewer waits.
- On the first control viewer, the host sends `Page.bringToFront` on its own connection. **verify:** whether the caret shows and typing lands without it on the server's Chrome; if so, drop it.

---

## 5. Process mode and container mode

### 5.1 One interface

```js
/** @typedef {{ id: string, viewport: {width:number,height:number}, timeoutSeconds: number, proof: boolean }} LaunchAsk */
/** @typedef {{ browserWs: string, devtoolsBase: string, tabTargetId: string, stop: () => Promise<void>, exited: Promise<string>, stateEntry: object }} Launched */
// launch(ask): Promise<Launched>        Chrome ready (DevTools answering) within 8 s, else it is killed and this rejects
// reap(stateEntries): Promise<number>   kill what a state file names (start)
// sweep(liveIds): Promise<number>       kill what no live session owns (start and every minute)
// selfTest(image?): Promise<{ chrome: string, sandbox: string | null, probes: object | null }>   with a slot held
```

- `lib/sessions.mjs` holds the session table over one launcher. Nothing else knows which mode runs.
- **Process mode** (`lib/launcher-process.mjs`) does everything in the host process.
- **Container mode** (`lib/launcher-client.mjs`) asks the launcher service over its socket (5.5). It then polls `http://<container IP>:9222/json/version` itself, every 100 ms for up to 8 seconds, and reads the launch tab from `/json/list`.

**Process mode details:**
- **Chrome** is `CHROME`, else the newest `chrome-headless-shell` under `~/.cache/chrome-headless`, else Google Chrome on macOS (the stand-in's `chromePath`, lines 144 to 160). It is spawned `detached`, so the whole process group can be killed.
- **The profile** is `<state dir>/profiles/<id>`.
- **DevTools** listens on `--remote-debugging-address=127.0.0.1 --remote-debugging-port=0`.
- **Stderr** is read until `DevTools listening on ws://...`, then drained and discarded: never kept, never logged. A pipe never read would block Chrome.
- **`stop`** sends SIGTERM to the group, SIGKILL 2 seconds later, then removes the profile.

### 5.2 Container settings (exact; built only by the launcher, `launcher/bodies.mjs`)

**The image** (`services/browser-host/container/Dockerfile`) is built on the server as `workwrk-chrome:<yyyymmdd-hhmm>` and tagged `workwrk-chrome:current` after its self-test:

```dockerfile
FROM debian:trixie-slim
ARG CACHE_DAY
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg tini \
      fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
 && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-linux.gpg \
 && gpg --show-keys --with-colons /usr/share/keyrings/google-linux.gpg | grep -q "fpr:::::::::EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796:" \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
 && rm -f /opt/google/chrome/chrome-sandbox \
 && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 chrome && useradd -u 10001 -g 10001 -d /home/chrome -s /usr/sbin/nologin -M chrome
USER 10001:10001
ENV HOME=/home/chrome TZ=UTC LANG=C.UTF-8
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/bin/timeout", "-s", "KILL"]
```

- **verify:** the key fingerprint, against Google's published Linux signing key at build time.
- The setuid `chrome-sandbox` is removed. Under `no-new-privileges` it could never work, and Chrome uses its namespace sandbox instead.
- Each session's `CMD` is `["<timeoutSeconds + 60>", "/opt/google/chrome/chrome", ...flags, "about:blank"]`. The container's own timeout is a backstop that does not need the host to be alive.
- `perl-base` and `util-linux` (both Essential in Debian, so present in the slim image) carry the self-test's two probes. Nothing is added for them.

**The container** (`containerCreateBody(session, viewport, timeoutSeconds, net)`, the launcher's own function):

```json
{
  "Image": "workwrk-chrome:current",
  "User": "10001:10001",
  "Cmd": ["<timeout+60>", "/opt/google/chrome/chrome", "<flags of 5.3>", "about:blank"],
  "Env": ["HOME=/home/chrome", "TZ=UTC", "LANG=C.UTF-8"],
  "Labels": { "workwrk.browser": "1", "workwrk.session": "<id>" },
  "StopTimeout": 5,
  "HostConfig": {
    "NetworkMode": "wkb-<id8>",
    "ReadonlyRootfs": true,
    "Privileged": false,
    "CapDrop": ["ALL"],
    "CapAdd": null,
    "SecurityOpt": ["no-new-privileges:true", "seccomp=<the JSON of container/chrome-seccomp.json>", "apparmor=workwrk-browser"],
    "Tmpfs": {
      "/tmp": "rw,nosuid,nodev,noexec,size=128m,mode=1777",
      "/home/chrome": "rw,nosuid,nodev,noexec,size=512m,uid=10001,gid=10001,mode=0700"
    },
    "ShmSize": 268435456,
    "Memory": "<S MiB in bytes>", "MemorySwap": "<the same>", "OomKillDisable": false, "OomScoreAdj": 500,
    "NanoCpus": 1000000000,
    "PidsLimit": 1024,
    "Ulimits": [{ "Name": "nofile", "Soft": 4096, "Hard": 4096 }, { "Name": "core", "Soft": 0, "Hard": 0 }],
    "Sysctls": { "net.ipv6.conf.all.disable_ipv6": "1", "net.ipv6.conf.default.disable_ipv6": "1" },
    "Dns": ["1.1.1.1", "9.9.9.9"], "DnsSearch": [], "DnsOptions": [],
    "LogConfig": { "Type": "none" },
    "AutoRemove": true,
    "Init": false,
    "IpcMode": "private", "CgroupnsMode": "private",
    "PortBindings": {}, "PublishAllPorts": false, "Binds": [], "Mounts": [], "Devices": []
  },
  "NetworkingConfig": { "EndpointsConfig": { "wkb-<id8>": { "IPAMConfig": { "IPv4Address": "<subnet + 2>" } } } }
}
```

- tmpfs pages count against the container's memory cap, so `Memory` bounds everything the session writes. That is at most 896 MB of tmpfs within 1,280, with the disk cache capped at 64 MB (5.3).
- `LogConfig none`: Chrome's own output, which can hold addresses, is never kept.

**The network** (`networkCreateBody(id8, subnet)`), one per session:

```json
{ "Name": "wkb-<id8>", "Driver": "bridge", "CheckDuplicate": true, "Internal": false, "Attachable": false, "EnableIPv6": false,
  "IPAM": { "Driver": "default", "Config": [{ "Subnet": "10.250.X.Y/28", "Gateway": "10.250.X.(Y+1)" }] },
  "Options": { "com.docker.network.bridge.name": "wkb-<id8>", "com.docker.network.bridge.enable_icc": "false", "com.docker.network.bridge.enable_ip_masquerade": "true" },
  "Labels": { "workwrk.browser": "1", "workwrk.session": "<id>" } }
```

- `id8` is the first 8 hex characters of the session id. When that name is in use, the next 8 are taken.
- Subnets are the lowest free /28 of 10.250.0.0/16 (4,096 of them).
- The bridge name `wkb-<id8>` (12 characters) is what the firewall matches.

**The seccomp profile** (`container/chrome-seccomp.json`, committed and reviewed):
- **The base:** Docker's default profile, copied from moby at the Docker Engine version the install pins (named in the file's `"comment"`). The default action is `SCMP_ACT_ERRNO`.
- **One added rule:** `clone`, `unshare` and `chroot` are allowed with no argument filter, so Chrome's zygote can make its user, PID and network namespaces and chroot inside them. Those are the three calls the namespace sandbox needs.
- **`socket`** is taken out of the base's unconditional allow list and allowed by two rules instead:
  - any family but `AF_NETLINK` (`args[0] != 16`);
  - `AF_NETLINK` with any protocol but `NETLINK_NETFILTER` (`args[0] == 16 && args[2] != 12`).
  - Chrome's network change watcher uses `NETLINK_ROUTE`, so it is unaffected. A process in its own user and network namespace cannot open the netfilter family at all.
- **`clone3`** stays ENOSYS, as in the base, so glibc falls back to `clone`.
- **Never allowed**, whatever the base allows: `mount`, `umount2`, `pivot_root`, `bpf`, `kexec_load`, `kexec_file_load`, `init_module`, `finit_module`, `delete_module`, `open_by_handle_at`, `keyctl`, `add_key`, `request_key`, `userfaultfd`, `perf_event_open`, `swapon`, `swapoff`, `reboot` and `acct`. `setns` stays capability-gated, as in the base.

**The AppArmor profile** (`container/apparmor-workwrk-browser`, loaded by the install with `apparmor_parser -r`):
- **The base:** Docker's `docker-default` rules as the pinned Docker version writes them (moby `profiles/apparmor/template.go`), renamed `workwrk-browser`, with `abi <abi/4.0>,`.
- **Rules added:**
  - `userns,` (Ubuntu 24.04 mediates user namespaces under abi 4.0);
  - `unix,` (abi 4.0 mediates unix sockets, which Chrome's IPC uses throughout);
  - `deny capability net_admin, deny capability net_raw, deny capability sys_module, deny capability bpf, deny capability perfmon, deny capability sys_rawio, deny capability mknod, deny capability syslog, deny capability mac_admin, deny capability mac_override, deny capability sys_boot, deny capability sys_time,`.
- These denials hold inside any user namespace the container makes, so the nf_tables class needs `net_admin` it can never get.
- **`sys_chroot` and `sys_admin` stay allowed.** The kernel checks `CAP_SYS_ADMIN` in Chrome's new user namespace when it creates that sandbox's PID and network namespaces (`copy_namespaces`).
  - Worst case of denying it: Chrome has no sandbox and refuses to start, and the only way on is `--no-sandbox`, which is forbidden.
  - Mounting, the other use of `sys_admin`, is denied anyway by `docker-default`'s `deny mount,`.
  - The step 3 builder runs the self-test once more with `deny capability sys_admin,` added. If `chrome://sandbox` still reports the namespace sandbox, the denial stays, and After records it.
- Ubuntu 24.04's `kernel.apparmor_restrict_unprivileged_userns=1` stays on for the rest of the host.

**The self-test** (the launcher's `selftest` and `probe` operations, run by the host while it holds a slot):
- **Chrome:** a container from the image under test starts Chrome. The host reads `Browser.getVersion`, then `chrome://sandbox` over its own CDP connection: "Seccomp-BPF sandbox Yes", the namespace sandbox in use, "You are adequately sandboxed."
- **`probe` netlink:** `perl -e 'socket(my $s,16,3,12) ? exit 1 : exit 0'` must exit 0 (the netfilter socket is refused).
- **`probe` net_admin:** `unshare -Urn perl -e 'socket(S,2,2,0) or exit 2; ioctl(S,0x8914,pack("a16s","lo",1)) ? exit 1 : exit 0'` must exit 0. That is `SIOCSIFFLAGS` on its own namespace's `lo`, which `net_admin` would allow.
- A failure at boot refuses creates (`selftest_failed`). A failure on a new image keeps the old one current.

**Considered and refused:**
- gVisor: Chrome's namespace sandbox inside it is uncertain, and the fallback would be `--no-sandbox`.
- userns-remap: the container runs no root, and remapping only adds nesting.

### 5.3 Chrome's flags (`lib/chrome-args.mjs`, pure)

Both modes:
```
--no-first-run --no-default-browser-check --disable-sync --disable-default-apps --disable-extensions
--disable-breakpad --disable-crash-reporter --metrics-recording-only --password-store=basic --use-mock-keychain
--deny-permission-prompts --mute-audio --disk-cache-size=67108864 --force-device-scale-factor=1 --lang=en-US
--window-size=<width>,<height> --user-data-dir=<profile>
--disable-features=BackForwardCache,Translate,MediaRouter[,HttpsUpgrades,HttpsFirstBalancedModeAutoEnable in proof mode]
```

**Container mode** adds `--headless=new --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0`.
- **verify:** that the server's Chrome binds this under `--headless=new`. The isolation proof reads `/json/version` at the container's address from the host.
- If it does not bind, the image gains `socat` from the container's address to 127.0.0.1:9222, recorded in After.

**Process mode** adds:
- `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1`;
- `--headless=new`, unless the binary is `chrome-headless-shell`;
- `--disable-background-networking --disable-component-update`.

**Proof mode only:** `--host-resolver-rules=MAP *.proof.test 127.0.0.1:<fixture port>, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1` (the stand-in's, line 171).

**Production keeps Safe Browsing and component updates on**, because certificate revocation lists arrive as a component. Worst case of switching them off: no phishing warning and no revocation list in the teammate's browser.

`--disable-features` is built as one comma-joined flag.

**Never, in any mode.** A test holds the generated arguments, and every file in `services/browser-host`, to this list:
- `--no-sandbox`, `--disable-setuid-sandbox`, `--single-process`, `--no-zygote`;
- `--disable-web-security`, `--remote-allow-origins`, `--allow-running-insecure-content`, `--ignore-certificate-errors`, `--disable-site-isolation-trials`;
- `--proxy-server`, `--enable-automation`, `--disable-blink-features`;
- `--host-resolver-rules` outside proof mode.

### 5.4 The firewall (`lib/firewall.mjs` writes `/etc/workwrk-browser-host/firewall.nft`)

```nft
table inet workwrk_browsers
delete table inet workwrk_browsers
table inet workwrk_browsers {
  set blocked_v4 { type ipv4_addr; flags interval; elements = {
    0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12,
    192.0.0.0/24, 192.0.2.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24,
    224.0.0.0/3 } }
  set host_v4 { type ipv4_addr; flags interval; elements = { <the host's public IPv4s>, <BROWSER_HOST_BLOCK: the app server's IPs> } }
  set resolvers_v4 { type ipv4_addr; elements = { 1.1.1.1, 1.0.0.1, 9.9.9.9, 149.112.112.112 } }

  chain refuse {
    meta l4proto tcp reject with tcp reset
    reject with icmpx type admin-prohibited
  }
  chain from_session {
    meta nfproto ipv6 counter comment "ipv6" jump refuse
    ip daddr @resolvers_v4 udp dport 53 accept
    ip daddr @resolvers_v4 tcp dport 53 accept
    meta l4proto { tcp, udp } th dport 53 counter comment "other_dns" jump refuse
    ip daddr @blocked_v4 counter comment "private" jump refuse
    ip daddr @host_v4 counter comment "host" jump refuse
    meter wkb_rate { iifname limit rate over 6 mbytes/second burst 12 mbytes } counter comment "rate" drop
    tcp dport { 80, 443 } accept
    udp dport 443 accept
    counter comment "port" jump refuse
  }
  chain forward {
    type filter hook forward priority filter - 10; policy accept;
    oifname "wkb-*" ct state established,related accept
    oifname "wkb-*" counter comment "into_session" drop
    iifname "wkb-*" jump from_session
  }
  chain input_sessions {
    type filter hook input priority filter - 10; policy accept;
    iifname "wkb-*" ct state established,related accept
    iifname "wkb-*" counter comment "to_host" jump refuse
  }
  chain output_devtools {
    type filter hook output priority filter - 10; policy accept;
    ip daddr 10.250.0.0/16 tcp dport 9222 meta skuid != <wkbhost's uid> counter comment "devtools_other_user" reject with tcp reset
  }
  chain input_public {
    type filter hook input priority filter; policy drop;
    iif lo accept
    ct state established,related accept
    iifname "wkb-*" drop
    tcp dport { 22, 80, 443 } accept
    icmp type { echo-request, destination-unreachable, time-exceeded } limit rate 10/second accept
    icmpv6 type { echo-request, destination-unreachable, packet-too-big, time-exceeded, nd-neighbor-solicit, nd-neighbor-advert, nd-router-advert } accept
  }
}
```

**The three lines at the top** declare, delete and define the table. `nft -f` applies a file as one transaction, so a reload replaces the table atomically: it never appends a second copy of its rules, and is never without them.

**`blocked_v4` is exactly `addresses.ts privateV4`** (lines 28 to 40): 0/8, 10/8, 127/8, 100.64/10, 169.254/16, 172.16/12, 192.168/16, 192.0.0/24 and 192.0.2/24, 198.18/15, 198.51.100/24, 203.0.113/24, and 224 and above as 224.0.0.0/3. `ranges.test.ts` holds the two equal (step 3).

**IPv6 is refused whole**, so `privateV6` (lines 76 to 101) needs no set. On top of that, there is:
- no IPv6 on session networks (`EnableIPv6 false`, and the sysctls);
- no AAAA record;
- `"ipv6": false` in `daemon.json`.

**DNS:** each container's `Dns` sends Docker's embedded resolver (127.0.0.11 in the container) to Cloudflare and Quad9. That resolver forwards from the container's own namespace, so port 53 is allowed only to those four addresses. **verify:** the forwarding path on the pinned Docker version. The isolation proof checks a name resolves, and a query to any other resolver is refused.

**DNS rebinding** is answered at the IP layer: whatever a name resolves to, a blocked address is never reached. The app's guard still closes a page served from a private address (`cdp-driver.ts` lines 779 to 793).

**A session's CDP port** is reached only by the host process, over the session's bridge:
- Host to container is OUTPUT, where `output_devtools` lets only `wkbhost` through; the replies are `established`.
- It is never published.
- Caddy proxies only the host process.
- The launcher has no network at all.

**Every refusal has its own counter**, named by its comment. The isolation proof reads them with `nft -j list table inet workwrk_browsers`.

**Loading and checking:**
- `workwrk-browser-firewall.service` (root, oneshot, `Before=docker.service`, `RequiredBy=docker.service`) runs `nft -f` on the file. It then saves `nft -j list table inet workwrk_browsers`, with every counter set to 0, to `/run/workwrk-browser-host/firewall.loaded.json`, and the file's SHA-256 beside it.
- **Every 5 minutes**, a root timer:
  1. regenerates the file from the host's current addresses (`ip -j -4 addr show scope global`);
  2. lists the table, with counters set to 0;
  3. reloads (and saves again) when the file's hash changed, the table is missing, or the listing differs from the saved one, so it compares by meaning, never text;
  4. writes `/var/lib/workwrk-browser-host/firewall.ok` with the time.
- A check that changes nothing keeps the counters. The host refuses creates (503 `firewall_unchecked`) when `firewall.ok` is over 10 minutes old.
- **verify:** that `nft -c -f` accepts the meter line on the server's nftables. The install runs that check and stops on failure.

### 5.5 The launcher (`services/browser-host/launcher/`)

**The service:** `workwrk-browser-launcher.service`, user `wkblaunch`, group `docker`, `PrivateNetwork=yes` and `RestrictAddressFamilies=AF_UNIX`.
- It listens on `/run/workwrk-browser-launcher/launcher.sock`, mode 0660, owned by `wkblaunch:wkbhost`, so only the host's user (and root) can open it.
- It talks to `/var/run/docker.sock`. Unix sockets cross network namespaces by path.

**The protocol:** one JSON object per line, `{ id, op, args }`, answered by `{ id, ok, result | error }`. An unknown `op`, an unknown field or a bad value is refused and counted.

| Operation | Arguments (checked) | What it does |
|---|---|---|
| `start` | `session` (a UUID), `viewport` (as 3.2), `timeoutSeconds` (60 to 21600) | creates the network and the container from `bodies.mjs`, starts it, answers `{ name, ip }` |
| `stop` | `session` | kills and removes only the container and network labelled with that session |
| `list` | none | `[{ session, name, ip, running }]` of labelled containers |
| `sweep` | `keep: [session]` | removes labelled containers and networks not in `keep` |
| `build` | none | `docker build --pull --build-arg CACHE_DAY=<today>` of the committed Dockerfile, tagged `workwrk-chrome:candidate` |
| `promote` | `tag` (`candidate` only) | retags candidate as `<yyyymmdd-hhmm>` and `current`; removes images older than the two newest that no container uses |
| `selftest` | `image` (`current` or `candidate`) | a session like `start`, with a reserved id, for the host's self-test |
| `probe` | `image` (`current` or `candidate`) | runs the image with each of the two fixed probe commands of 5.2 and answers their exit codes |
| `versions` | none | Docker, containerd and runc from `GET /version` |

- No argument ever reaches an Engine body but the session id, the viewport and the timeout.
- `bodies.mjs` holds every other field as a constant; `launcher.test.ts` holds them to 5.2.

---

## 6. Lifecycle

### 6.1 States and the backstops

A session is `starting`, then `running`, then `ending`, then `ended`. The API says RUNNING for the first two and COMPLETED for the rest.

| End | When | Reason |
|---|---|---|
| The host's timeout | the create's `timeout`, counted on the monotonic clock | `timeout` |
| The container's own `timeout -s KILL` | timeout plus 60 seconds, even if the host process is dead | (the container exits) |
| Never connected | no `/connect` within 60 seconds of the create; proof mode's `start-orphan` sessions are exempt, as Browserbase's keepAlive sessions would be | `never_connected` |
| keepAlive false | the one client leaving | `last_client_left` |
| Release | the release call | `released` |
| Chrome or the container exits | | `chrome_exited` |
| Proof mode's `kill` control | | `provider_ended` |

**Ending** closes, in order and once:
- the client socket;
- every viewer, with 4404 after `{t:"ended"}` (and a held button or key released first, 4.2);
- the live view's connection;
- Chrome, and then the network.

**The ended record** (id, status, times and `userMetadata`) is kept in memory for one hour, for release (409) and the list, then forgotten (404).

### 6.2 The max, and held slots

`lib/limits.mjs computeMax(memTotalBytes, cpus, sessionMb, override)`, with the default S of 1,280:

| Server | MemTotal, about | Max |
|---|---|---|
| 4 vCPU, 8 GB (the small start, Founder action 1) | 7,936 MiB | min(floor(5,888 / 1,312) = 4, 8) = **4** |
| 8 vCPU, 16 GB | 15,970 MiB | min(10, 16) = 10 |
| 8 vCPU, 32 GB | 32,050 MiB | min(22, 16) = 16 |

- **Starting sessions and held slots count.** `holdSlot(reason)` is taken by the image build and every self-test, and refused when none is free. A daily build waits for a free slot for up to 6 hours, trying every 10 minutes.
- **Full** answers 429 with `Retry-After: 30`, which the app reads as `provider_busy`. Each one is counted (`capacityRefusals1h` and `capacityRefusals24h` in `/health`).
- **The app's `BROWSER_MAX_AT_ONCE`** (default 10, `config.ts` line 96) is set to the max `/health` prints (Founder action 7). The smoke test fails when it is higher.
- With the small start's 4, the box holds two GROWTH workspaces at their full 2 each, or most of one SCALE workspace (5).
- **The resize rule:** when `/health` counts capacity refusals on most days (the app's hourly read logs them, 9.6), rent the next size. The host works out its new max at start, and `BROWSER_MAX_AT_ONCE` follows it.

### 6.3 The CDP proxy (`lib/cdp-proxy.mjs`)

- **The upgrade** checks the session (running, not yet connected) and the token, marks the session connected, and opens `ws` to Chrome's browser endpoint (`browserWs`).
- **The relay** passes messages both ways, unchanged and in order, with `perMessageDeflate: false` and a `maxPayload` of 64 MB each way (above the app's 32 MB, `cdp.ts` line 22). The client's messages are queued until the upstream opens, as the stand-in did (lines 1248 to 1253). Nothing is read, parsed or kept.
- **Keepalive:** the host sends a websocket ping to the app's client every 30 seconds; the app's `ws` answers pings by itself. A client with no pong for 120 seconds is gone, and the session ends `last_client_left`. Worst case of no keepalive: a quiet session's connection is cut by something in between, mid-sign-in.
- **Either side** closing or failing closes the other and ends the session.

### 6.4 The reaper and the state file

**The state file** is `<state dir>/state.json`: mode 0600, written to `state.json.tmp`, synced and renamed on every start and end.
- It holds `{ v: 1, boot, mode, sessions: [...] }`.
- Container entries are `{ id, container, network }`. Process entries are `{ id, pid, pgid, started: <ps lstart>, profile }`.
- No token, no metadata and no address.

**At start:**
1. Read the file and kill each entry: in container mode, the launcher's `stop`; in process mode, a process only while its `ps -o lstart=` still matches, then its profile is removed.
2. Container mode: the launcher's `sweep { keep: [] }`, which removes every labelled container and network. Process mode: kill every process whose command line holds `--user-data-dir=<state dir>/profiles/`, and empty that folder.
3. Write an empty state.

**Every 60 seconds:**
- end sessions past `expiresAt` plus 5 seconds;
- `sweep` with the running sessions as `keep` (or the process mode's equivalent);
- forget ended records older than an hour.

**Signals and the admin socket:**
- **SIGTERM** (a stop or a reboot): stop accepting creates, end every session `shutdown`, write the state, exit within 25 seconds (`TimeoutStopSec=30`).
- **Drain** stops creates (503 `draining`) and keeps the running sessions. It comes from SIGUSR2, or `drain` on the admin socket.
- **The admin socket** is `/run/workwrk-browser-host/admin.sock`, mode 0600, owned by `wkbhost`. It answers `drain`, `undrain` and `status { running, starting, held }` to root's maintenance job (8.4).

### 6.5 A restart, as the app reads it

| What happens at the host | What the app does (today's code) |
|---|---|
| The process dies or restarts, so every client socket closes | `onLost` sets `lb.lost` and ends the row `provider_ended` (`sessions.ts` lines 280 to 286). The person reads "Closed by the browser service." |
| A release reaches the new process | 404, read as `already`, and the row is marked ended (`sessions.ts` lines 1314 to 1326) |
| A release while the host is down | `failed`, tried again by the sweep every 2 minutes, and ended at its reserved minutes once past `endsBy` plus 60 seconds |
| The reaper's list after a restart | empty, so there is nothing to release |
| A take over in progress | The person's frame shows `ended`. The row ends `provider_ended`, the take over card is CANCELLED (`cancelCards`, lines 1220 to 1245), and a recording is kept as a draft (`endRecordingWith`, line 1312) |

---

## 7. What is kept and logged

**The host's and the launcher's log lines** (`lib/log.mjs`, to journald) carry an event name, a status code, a duration in milliseconds and counts:
- `[host] api create 201 2140ms`
- `[host] session ended timeout running=3`
- `[host] live watch_input_refused`
- `[launcher] start ok`

They never carry an id, a token, an address, a path, a query, a header, a body, a host name or a frame.

**Chrome's output** is never kept: `LogConfig none`, and stderr is drained in process mode.

**Counts in memory**, shown in `/health`'s `counts` and never written: creates, ends by reason, capacity refusals, viewers, frames, inputs by type, refused watch inputs, refused connects, replaced sockets and rate-limit hits.

**No frame and no input touches the disk.** A test spies on `fs` across a live session.

**Caddy:**
- There is no `log` directive in the site, so no access log.
- The default logger is `level ERROR`, and excludes `http.log.error` and `http.handlers.reverse_proxy` (8.1). A failed proxy's request line, with its `?t=` connect token, never reaches journald.
- `admin off`.

**journald** keeps at most 200 MB (`SystemMaxUse=200M`) for at most 14 days (`MaxRetentionSec=14day`).

**Proof mode only** keeps the stand-in's log (`BROWSER_STAND_IN_LOG`, `GET /__stand-in/log`) in its exact entry shapes. They hold no page text, no typed character and no password (12.1).

---

## 8. The server

### 8.1 TLS and the reverse proxy (`install/Caddyfile.template`)

```caddy
{
  admin off
  email <ACME contact>
  log default {
    output stderr
    level ERROR
    exclude http.log.error http.handlers.reverse_proxy
  }
}
<BROWSER_HOST_NAME> {
  request_body { max_size 1MB }
  header {
    Strict-Transport-Security "max-age=31536000"
    -Server
  }
  @api path /v1/* /connect/* /health
  handle @api {
    @notapp not remote_ip <BROWSER_HOST_APP_IPS>
    respond @notapp 404
    reverse_proxy 127.0.0.1:8789
  }
  handle /live/* {
    reverse_proxy 127.0.0.1:8789
  }
  handle /healthz {
    reverse_proxy 127.0.0.1:8789
  }
  handle {
    respond 404
  }
}
```

- Caddy sets `X-Forwarded-For`, proxies websockets as they are, and renews certificates by itself (Let's Encrypt, HTTP-01 on port 80).
- **verify:** the two logger names on the pinned Caddy version. The isolation proof forces a proxy error and searches journald for the token.

### 8.2 The install script (`services/browser-host/install/install.sh`; Ubuntu 24.04, x86_64)

It runs as a sudo user over SSH, from a `git archive <gated sha> services/browser-host` tarball the lead copies over. Every step can run again safely. In order:

1. **Refuse** unless `/etc/os-release` says Ubuntu 24.04, `uname -m` is x86_64, and at least 30 GB is free on `/`. Refuse when a Postgres or the app is on the machine (Decision 2's checks).
2. **The OS:**
   - unattended-upgrades for Ubuntu's security pocket, with `Unattended-Upgrade::Automatic-Reboot "false"`: the maintenance job reboots, drained;
   - check `timedatectl show -p NTPSynchronized` (systemd-timesyncd);
   - the journald limits;
   - `dnsutils` and `curl` for the proofs.
3. **SSH:** `PasswordAuthentication no` and `KbdInteractiveAuthentication no`, applied only after checking that the invoking user's `~/.ssh/authorized_keys` is not empty.
4. **Docker Engine** from Docker's signed apt repository, at the pinned major. `/etc/docker/daemon.json`:
   ```json
   { "ipv6": false, "icc": false, "userland-proxy": false, "live-restore": false, "no-new-privileges": true,
     "log-driver": "none", "default-address-pools": [{ "base": "172.30.0.0/16", "size": 24 }] }
   ```
5. **The profiles:** the AppArmor profile (`apparmor_parser -r`), and the seccomp file to `/etc/workwrk-browser-host/`.
6. **The users:** `wkbhost` (system, nologin, never in `docker`) and `wkblaunch` (system, nologin, in `docker`). Make sure no host user and no file is owned by uid 10001.
7. **The firewall:** write the file (with `wkbhost`'s uid), check it with `nft -c -f`, then install and start the service and the 5-minute check timer. The host's public IPv4 addresses come from `ip -j -4 addr show scope global`, and `BROWSER_HOST_BLOCK` adds the app server's.
8. **Node.js 24 LTS** from NodeSource's signed `node_24.x` repository. Then the code to `/opt/workwrk-browser-host/<sha>/`, without `proof/` and without tests, `npm ci --omit=dev --ignore-scripts` there, and `current` as a symlink to it.
9. **The environment**, `/etc/workwrk-browser-host/host.env` (0640, root:wkbhost):
   - `BROWSER_HOST_MODE=container`, `BROWSER_HOST_PORT=8789`;
   - `BROWSER_HOST_PUBLIC_URL=https://<name>`, `BROWSER_HOST_APP_ORIGIN=https://app.workwrk.com`;
   - `BROWSER_HOST_KEY_SHA256=<hash>`, `BROWSER_HOST_REGION=<label>`, `BROWSER_HOST_SESSION_MEMORY_MB=1280`.
   - The script makes the key, prints it once for the app's environment (Founder action 7), and stores only its hash.
10. **Caddy** from Caddy's signed apt repository, with the Caddyfile and a drop-in setting `OOMScoreAdjust=-900`.
11. **The units:** the launcher, the host, and the maintenance timer. The host builds the first image with a slot held, and runs its self-test.
12. **Print** `/health` (with the key read from the terminal, never from a file), and the versions.

**Updates** of the host's own code use the same tarball: `install.sh --update` drains through the admin socket, waits until `running` is 0, then switches `current` and restarts.

### 8.3 The systemd units (`install/`)

`workwrk-browser-host.service`:
```ini
[Unit]
Description=WorkwrK browser host
After=network-online.target workwrk-browser-firewall.service workwrk-browser-launcher.service
Requires=workwrk-browser-firewall.service workwrk-browser-launcher.service
[Service]
Type=simple
User=wkbhost
Group=wkbhost
EnvironmentFile=/etc/workwrk-browser-host/host.env
Environment=NODE_ENV=production
ExecStartPre=+/opt/workwrk-browser-host/current/install/firewall-check.sh
ExecStart=/usr/bin/node /opt/workwrk-browser-host/current/main.mjs
ExecReload=/bin/kill -USR2 $MAINPID
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillMode=mixed
OOMScoreAdjust=-900
StateDirectory=workwrk-browser-host
StateDirectoryMode=0700
RuntimeDirectory=workwrk-browser-host
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
LockPersonality=yes
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
SystemCallArchitectures=native
MemoryMax=512M
TasksMax=256
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
```

- **`AF_NETLINK` is left out on purpose.** The host connects only to addresses, never to names, and never lists interfaces (`boundaries.test.ts` refuses `os.networkInterfaces` and `dns.lookup` in `lib/`). The root scripts read addresses with `ip`.
- **`workwrk-browser-launcher.service`:**
  - `User=wkblaunch`, `Group=wkblaunch`, `SupplementaryGroups=docker`, `PrivateNetwork=yes`, `RestrictAddressFamilies=AF_UNIX`, `IPAddressDeny=any`;
  - `OOMScoreAdjust=-900`, `MemoryMax=256M`;
  - `RuntimeDirectory=workwrk-browser-launcher`, plus the same hardening as the host, with `ProtectSystem=strict` and read-only access to `/etc/workwrk-browser-host`;
  - `ExecStart=/usr/bin/node .../launcher/main.mjs`;
  - `After=` and `Requires=` `docker.service`.
- **`workwrk-browser-firewall.service`** (5.4).
- **`workwrk-browser-firewall-check.timer`**, every 5 minutes, and its root service.
- **`workwrk-browser-maint.timer`**: `OnCalendar=*-*-* 04:30:00`, `Persistent=true`, and its root oneshot service (8.4).

### 8.4 Keeping Chrome and the server current

**The Chrome image** (the host process, daily at 04:15 server time, and at once after a failed build, hourly):
1. Hold a slot (6.2).
2. The launcher's `build`.
3. The self-test and the probes against `candidate` (5.2).
4. On failure: the candidate is dropped, and `images.json` records `lastBuildFailedAt`. Three failed days raise `image_build_failing`.
5. On success: `promote`, when the Chrome version or the base image's digest changed, or when the current image is 7 or more days old. Otherwise the candidate is dropped.
6. Running sessions keep their container; only new sessions get the new image.

`<state dir>/images.json` records each tag's Chrome version, build time and base digest.

**The rest of the server** (`install/maint.sh`, root, daily at 04:30 server time):
1. `apt-get update`. Note any pending upgrade of `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `caddy` or `nodejs` (each held to its major), and whether `/var/run/reboot-required` exists.
2. **Nothing pending:** write `versions.json` (Caddy, Node, kernel) and stop.
3. **Something pending:**
   - `drain` through the admin socket;
   - wait until `running` and `held` are 0 (sessions last 31 minutes at most), for up to 40 minutes;
   - apply the upgrades with `apt-get install --only-upgrade`, or reboot;
   - restart the launcher, the host and Caddy (a restart undrains);
   - write `versions.json`;
   - log one line of package names and versions.
4. **A drain past 40 minutes** is `drain_stuck` (503 on `/healthz`). The job applies anyway, since every session has outlived its own limit by then.

Worst case: a pending upgrade waits up to a day, and a drain refuses new browsers for up to 40 minutes at 04:30, server time, on the days something is pending. The alternative, unattended upgrades of Docker's repository, restarts dockerd at any hour and ends every browser then.

### 8.5 `/health`, `/healthz` and the smoke test's floors

- **`/health`** (3.2) reports:
  - `chrome` and `chromeMajor`, from the boot self-test;
  - `imageAgeDays`, from `images.json`;
  - `versions`: Node, the kernel, Docker, containerd, runc and Caddy;
  - `problems`.
- **`/healthz`** answers 503 for the problems 3.2 names. It is the uptime monitor's address (Founder action 9).
- **The floors**, in `scripts/browser-provider-smoke.ts`:
  - `CHROME_MAJOR_FLOOR = 154`: the Chrome the proofs ran on (chrome-headless-shell 154, After Phase 4, step 2). It moves up when the lead runs the proofs on a newer Chrome.
  - `RUNC_FLOOR = "1.3.3"`: the release fixing the newest runc escapes known when this spec was written. **verify:** at step 3, against runc's security advisories; the lead raises the floor when a newer escape is fixed.

---

## 9. The app side

### 9.1 `src/lib/browser/config.ts`

- `browserConfig` takes `BROWSER_PROVIDER=workwrk`. Line 172 today takes only `browserbase` and `stand-in`.
- **`BROWSER_HOST_URL`** (`hostBase(env)`) must be an origin only: no user, password, path, query or fragment.
  - In production: `https:`, a port empty or 443, and a host that `sites.ts neverReason(host, { appHosts: appHostsFrom(env), fixtureSuffix: null })` does not name. That rules out an app host, `workwrk.com` with every subdomain, an IP literal or an internal name (Decision 2).
  - Outside production: `https:`, or `http:` only to 127.0.0.1, localhost or [::1].
- **`BROWSER_HOST_KEY`:** in production `/^[A-Za-z0-9_-]{32,200}$/`, and never `stand-in`. Outside production, any non-empty value up to 200 characters.
- **In production:**
  - `NEXT_PUBLIC_BROWSER_HOST_ORIGIN` must equal the URL's origin;
  - the provider must be `DISCLOSED_PRODUCTION_PROVIDER` (Decision 14);
  - `BROWSERBASE_BASE_URL`, when set, still makes the config null (line 185, for every provider).
- **For workwrk:**
  - `projectId` is the constant `"workwrk"`, `apiBase` is the URL, and `liveViewOrigins` is `[its origin]`.
  - `standIn` is true only outside production, with a loopback URL. That turns on the fixture suffix, http, `ws:` connect addresses and the proofs' short windows, exactly as for the stand-in (lines 193, 205 to 211, and 267 to 280). The field keeps its name; its comment says "a local proof provider: the stand-in, or our host on this machine".
- `browserReleaseConfig` (lines 243 to 259) takes workwrk with the same URL and key rules, and never the disclosure rule or `BROWSER_OFFERED`. In production it answers workwrk for workwrk and Browserbase for Browserbase. Line 254 today answers Browserbase for anything that is not the stand-in.
- **New `src/lib/browser/disclosed.ts`:** `export const DISCLOSED_PRODUCTION_PROVIDER: BrowserProviderName = "workwrk";`, with a header naming this spec, the privacy page, the cookie page and the iconic tests that read it.

### 9.2 `src/lib/browser/browserbase.ts`: one client, with a few lines only our host is asked

- `const ours = (p: BrowserProviderName) => p !== "browserbase";`, which means workwrk, or the stand-in (our host in proof mode).
- **The live view:** `liveViewUrl(cfg, providerSessionId, mode: "watch" | "control")`.
  - `mode` is required, so the compiler finds all three callers.
  - For `ours` the path is `/debug?mode=<mode>`; for Browserbase it is unchanged.
- **Revoke:** new `revokeLiveViews(cfg: BrowserReleaseConfig, providerSessionId, o: RequestOptions = {}): Promise<"revoked" | "already" | "failed" | "none">`.
  - `none` for Browserbase, with no request sent.
  - Otherwise it POSTs `/v1/sessions/<id>/live-views/revoke` with `{}`. 404 is `already`, and any other failure is `failed`.
- **Health:** new `hostHealth(cfg: BrowserReleaseConfig, o: RequestOptions = {}): Promise<ProviderResult<{ ok: boolean; problems: string[]; capacityRefusals24h: number; max: number }>>`.
  - `GET /health`, for `ours` only. Each field is read defensively.
- `Op` gains `"revoke"` and `"health"`, both logged by code only.
- **The connect address:** in `createProviderSession`, for `ours`, a `connectUrl` whose host differs from `new URL(cfg.apiBase).host` is `unknown_outcome`, and the reaper ends what started, by its tag.
- The header comment's **verify** list names this spec for the workwrk provider.

### 9.3 The callers, and Done

- `src/app/api/teammate-browser/sessions/[id]/live-view/route.ts` line 54: `liveViewUrl(cfg, id, row.status === "handed_over" ? "control" : "watch")`.
- `take-over.ts` line 162: `"control"`.
- `src/lib/skills/recorder.ts` line 490: `"control"`.
- **`take-over.ts finishTakeOver` revokes before the hand back.**
  - Where: after the recording's end (lines 181 to 186) and before `withBrowserLock(row.id, TAKE_OVER_WAIT_MS, handBack)` (line 210).
  - The call: `const rc = browserReleaseConfig(); if (rc && row.providerSessionId) await revokeLiveViews(rc, row.providerSessionId, { timeoutMs: 4000 }).catch(() => "failed");`
  - A failure never fails Done: the control token still dies at its 15 minutes.
  - Worst case of revoking after: between the swap to live and the revoke, the person's input and the teammate's next act interleave on one page.
- **`src/lib/browser/live-view-origin.ts`** `liveViewShownOk(url, { production, hostOrigin })`:
  - In production it accepts Browserbase's origin (as today), or `hostOrigin` when that is an https origin equal to the address's.
  - Outside production it also accepts loopback, as today.
- **`browser-card.tsx`** passes `hostOrigin: process.env.NEXT_PUBLIC_BROWSER_HOST_ORIGIN ?? null` beside `PRODUCTION` (line 128). The card's frame, overlay and buttons are unchanged.
  - Next.js writes that value into the client code when the app is built. So the variable must be in the environment of the build that ships this step (the deploy builds on the server and reads its `.env`), or the card refuses the frame and says `liveViewFailed` (Founder action 7's order).

### 9.4 The smoke test (`scripts/browser-provider-smoke.ts`)

- **New `--host`.** It reads `BROWSER_HOST_URL`, `BROWSER_HOST_KEY`, `BROWSER_REGION`, `BROWSER_MAX_AT_ONCE`, `NEXT_PUBLIC_APP_URL` and `BROWSER_DEPLOYMENT_TAG` from the environment, and reads no `.env` file and no database.
- In order:
  1. `GET /health` and `GET /healthz`:
     - `ok`, `/healthz` 200;
     - `mode: "container"`, for any URL that is not loopback;
     - `chromeMajor >= CHROME_MAJOR_FLOOR`, runc at or above `RUNC_FLOOR`, `imageAgeDays <= 14`;
     - `region === BROWSER_REGION`;
     - `BROWSER_MAX_AT_ONCE` not above `max` (it should equal it; a lower one is printed as a note).
     - It prints every version.
  2. Every check of `--real`, against the host:
     - a session made and the guard attached;
     - `https://example.com/` opened, and `www.iana.org` refused before it leaves;
     - the page read and pictured;
     - released (`already` counts, since closing ends it);
     - none of this check's tag and row left running.
  3. A watch view:
     - its origin is the host's;
     - the shell and an asset answer 200, `no-store`, with `frame-ancestors` exactly the app's origin and no `Set-Cookie`;
     - the websocket's hello says `watch`;
     - one mouse message closes it 4403.
- It prints counts, outcomes and versions only: never the key, an address or a token.
- The default mode (the stand-in, now the launcher) is unchanged.

### 9.5 The copy that depends on the provider

**`teammate-copy.ts`:**
- `BROWSER_POLICY_COPY.intro` (line 1676): the last sentence becomes "Each browser runs on a WorkwrK server for one chat, and is deleted when it closes."
- `regionLine` (line 1677) becomes ``(r) => `Browsers run on WorkwrK's own servers, in ${r}.` ``.
- They are shown by `teammate-browser-section.tsx`, lines 234 and 253. There is one wording and no variants: every provider that can run now is our host (workwrk, or the launcher), or Browserbase outside production only (Decision 14).
- `ENDED_WORDS.provider_ended` stays "Closed by the browser service." (line 1831): the host is a browser service.

**`src/app/(marketing)/privacy/page.tsx`** (each comment gains a note naming this spec):
- **Section 3** (lines 295 and 296): "The browser runs at our browser provider for that one chat" becomes
  > The browser runs on a server WorkwrK runs for these browsers alone, apart from the servers that hold your workspace, for that one chat and is never shared:

  and the rest of the sentence is unchanged.
- **The second paragraph** (after "every teammate request does.") gains:
  > That server keeps no copy of the pages the browser opens, of the picture of it you watch, or of what you type when you take it over; it keeps only counts, such as how many browsers are running.
- **Section 4** (lines 432 to 435) becomes:
  > We use a small number of sub-processors to run the service: hosting providers for our servers, among them the one where AI teammates' browsers run when a workspace turns them on, a payment processor, a transactional email provider and a model provider for the AI features.
- **Section 7** (lines 590 and 591) becomes:
  > An AI teammate's browser runs on WorkwrK's own server, in one region for this deployment, which Owners and Admins see in Settings, Apps & modules.
- `LEGAL_COPY.privacy.updated` is the ship date.

**`src/app/(marketing)/cookies/page.tsx` section 4** (lines 223 to 227) becomes:
> None set by anyone else. When you watch or take over an AI teammate's browser, the picture of that browser comes from WorkwrK's own browser server, which sets no cookie and keeps nothing in your browser. Every cookie in the table above is set by workwrk itself. We load no analytics vendor, no ad tech, no retargeting pixel and no social network tracker on this site or in the product.

- Its comment says Phase 4's Founder action 6 (asking the provider about the frame's cookies) is not needed for our host.
- `LEGAL_COPY.cookies.updated` is the ship date.

**`src/components/marketing/iconic/iconic.test.ts`:**
- The pins become the new sentences, plus the keeps-nothing sentence: line 451 (section 3), 468 (section 4), 470 (section 7), 476 and 526 (the date), and 546 to 556 (cookies).
- `FORBIDDEN` gains:
  - `["privacy", /browser provider/i, "a browser provider this deployment does not use"]`;
  - `["cookies", /browser provider/i, "a third party frame this deployment does not load"]`.
- A new pin checks `DISCLOSED_PRODUCTION_PROVIDER === "workwrk"` while the pages say "WorkwrK's own".
- The cookie test drops its `Founder action 6` and "no row yet" pins, and holds "sets no cookie and keeps nothing in your browser".

**Outside the repo:**
- The sub-processor list is the founder's document, sent on request (Founder action 6).
- **verify:** the documentation.ai pages, for "browser provider" wording. The lead updates them with the copy above.

### 9.6 The sweep reads the host's health once an hour

`sessions.ts sweepBrowserSessions` gains a part, last but one (before the orphaned skills):
- **When:** for `ours` only, at most once an hour per process, through a module-level `lastHostHealthAt`.
- **The call:** `hostHealth(rc, { timeoutMs: min(4000, the budget left) })`.
- **When the host is down or says something is wrong** (unreachable, `ok: false`, or any problem): `counts.failed += 1`, and `[cron-failure] run-due-agents: the browser host's health: <problem codes>`, as the sweep's other parts log (line 2122).
- **Capacity:** `capacityRefusals24h` above 0 logs `[browser] host capacity refusals <n> in a day, max <max>` (Founder action 1's resize rule).
- `BrowserSweepCounts` gains `hostHealth: "ok" | "problems" | "unreachable" | "skipped"` and `hostCapacityRefusals24h`. Codes and counts only.

### 9.7 Browserbase's founder actions, for this provider

| Founder action | For this provider |
|---|---|
| Phase 4, 1 (account and papers) | Not needed |
| Phase 4, 2 (DPA) | Not needed |
| Phase 4, 3 (project) | Not needed |
| Phase 4, 4 (pictures folder) | Still needed |
| Phase 4, 5 (environment) | Still needed, with this spec's variables (Founder action 7) |
| Phase 4, 6, first bullet (ask about the frame's cookies) | Not needed |
| Phase 4, 6, second bullet (counsel, and the AI provider) | Still needed |
| Phase 4, 7 (the provider's egress addresses) | Becomes the server's own IPv4, which may be given to enterprise customers |
| Phase 4, 8 (tell the lead) | Unchanged |
| Phase 5, 1 (ask Browserbase how live view input arrives) | Answered by Decision 6 and the host proof (H7), so not needed |
| Phase 5, 2 to 6 | Unchanged |

The changelog's waiting computer entry keeps its "Founder actions 1 to 7" wording, which `iconic.test.ts` pins. The comment above it gains a line naming this spec's Founder actions.

---

## 10. Code location and coverage

```
services/browser-host/
  package.json, package-lock.json   name workwrk-browser-host, "type": "module", "engines": { "node": ">=20" }, dependencies: { "ws": "<the root's exact 8.x>" }
  main.mjs                          the host: config, preflight, self-test, start; subcommands print-firewall, isolation-proof
  VERSION                           written by the archive step
  lib/config.mjs                    readHostConfig(env, argv): HostConfig | { refusals: string[] }   (pure)
  lib/limits.mjs                    computeMax(...), holdSlot                                          (pure core)
  lib/auth.mjs                      keyOk(header, hashes), limiter(...)                                (pure, injectable clock)
  lib/tokens.mjs                    connectToken, mintLive, verifyLive                                 (pure, injectable key and clock)
  lib/api.mjs                       handler(sessions, cfg): the /v1, /health, /healthz and /live shell routes
  lib/sessions.mjs                  the session table over a launcher: start, end, timers, max, slots, ended records
  lib/cdp-proxy.mjs                 the /connect upgrade, the relay, the keepalive
  lib/live.mjs                      the /live/{id}/ws handler: hello, screencast fan-out, input relay, watch refusal, newest socket wins, pings, revoke
  lib/live-input.mjs                viewer message to CDP command                                      (pure)
  lib/launcher-process.mjs          process mode
  lib/launcher-client.mjs           container mode: the launcher's socket client
  lib/admin-socket.mjs              drain, undrain, status
  lib/chrome-args.mjs, lib/ranges.mjs, lib/firewall.mjs   (pure)
  lib/state.mjs, lib/reaper.mjs, lib/preflight.mjs, lib/log.mjs, lib/images.mjs
  launcher/main.mjs                 the launcher service: the socket, the eight operations
  launcher/bodies.mjs               containerCreateBody, networkCreateBody, the probe commands      (pure)
  launcher/docker-api.mjs           the Engine API over /var/run/docker.sock
  live/page.html, live/live.mjs, live/live.css, live/copy.mjs
  proof/fixtures.mjs                moved from scripts/browser-stand-in.mjs lines 665 to 1221
  proof/controls.mjs                moved from lines 527 to 663: its own tab connection, input built by live-input
  proof/log.mjs                     moved from lines 126 to 140
  proof/isolation.mjs               the server isolation proof (12.3), copied to the server only for that run
  container/Dockerfile, container/chrome-seccomp.json, container/apparmor-workwrk-browser
  install/install.sh, install/maint.sh, install/firewall-check.sh, install/*.service, install/*.timer, install/Caddyfile.template
  **/*.test.ts
scripts/browser-stand-in.mjs        the launcher of proof mode: process mode, proof on, port P and P+1,
                                    key "stand-in", region us-east-1, app origin http://localhost:3016,
                                    BROWSER_STAND_IN_LOG
```

**Coverage by the gate:**
- **tsc:** `tsconfig.json` `include` (lines 25 to 32) gains `"services/browser-host/**/*.mjs"`. `allowJs` is already true (line 5), and every `.mjs` starts `// @ts-check`, so tsc checks it under the gate (`verify-commit.sh` line 126) and in CI (`ci.yml` line 91). The `.test.ts` files are already in `**/*.ts`.
- **Vitest:** `vitest.config.ts` `include` (line 25) becomes `["src/**/*.test.ts", "scripts/**/*.test.ts", "services/**/*.test.ts"]`, which runs under the gate (line 160) and in CI (line 94).
- **ESLint:** `npm run lint` (`package.json` line 14) lints the folder's `.mjs` and `.ts` files by the flat config's defaults. The gate does not run ESLint; the lead runs it on the changed files, as every phase does.

**`services/browser-host/boundaries.test.ts`:**
- No file under `src/` imports `services/`.
- No non-test file under `services/` imports `src/`, `@/`, `next` or `react`.
- Every `.mjs` there starts `// @ts-check`.
- `proof/` is loaded only by a dynamic import inside `if (cfg.proof)` in `main.mjs`.
- Only `launcher/` names `docker.sock`.
- `lib/` never calls `os.networkInterfaces` or `dns.lookup`.
- The host's `ws` version is within the root's range.
- The forbidden Chrome flags of 5.3 appear nowhere in the folder, but in the test's own list.

**Shared code with the stand-in:** the fixtures, the controls and the log are one copy, in `proof/`. The launcher and the host both load it. Between them, `fixtures.mjs` and `controls.mjs` hold every string the Phase 5 proof reads (12.1).

---

## 11. Steps

Each step ships on its own, with one reviewer and one round. Every test named "fails today" is run once against the code before its change.

### Step 1. The host core in process mode, and the stand-in becomes the host

**Files:**
- the `services/browser-host/` package and `main.mjs`;
- `lib/`: `config`, `limits`, `auth`, `tokens` (the connect token only), `api` (no `/live`), `sessions`, `cdp-proxy`, `launcher-process`, `chrome-args`, `state`, `reaper`, `log`, `admin-socket`;
- `proof/`: `fixtures.mjs`, `controls.mjs` (its own connection, with `Input` sent directly; step 2 builds it with `live-input`), and `log.mjs`;
- `scripts/browser-stand-in.mjs`, as the launcher of proof mode;
- the `tsconfig.json` and `vitest.config.ts` includes.

**Tests:**
- **`lib/config.test.ts`:**
  - process mode is refused with `NODE_ENV=production`;
  - container mode refuses a clear key, an http public URL or app origin, and a bad region;
  - `BROWSER_HOST_MAX` lowers only;
  - test windows are read only in process mode outside production;
  - process and proof mode default to the app origin `http://localhost:3016` and the region `us-east-1`; container mode has no defaults.
- **`lib/limits.test.ts`:**
  - the table in 6.2;
  - 4 GiB with 2 vCPU gives 1, and under 2 GiB gives 0, so start is refused;
  - a held slot counts, and `holdSlot` is refused when full.
- **`lib/auth.test.ts`:**
  - a wrong key of any length is false, with both hashes compared (a spy counts `timingSafeEqual` calls);
  - rotation with two hashes;
  - 10 failures from one address give 429 for 10 minutes;
  - `X-Forwarded-For` is read only from 127.0.0.1.
- **`lib/tokens.test.ts`:** the connect token verifies and is good once; another session's is refused.
- **`lib/api.test.ts`** (a fake table):
  - every status of 3.2, the 400 fields, 401 without a key or with a wrong one, and 429 at capacity with `Retry-After: 30`, counted;
  - debug defaults to watch;
  - release answers 200, 409, 404 and 400, and the list filters;
  - `/health` needs the key; `/healthz` needs none, answers 503 for each problem of 3.2, 200 `draining` while draining, and 200 when full;
  - no response sets a cookie, and no error body holds a value sent.
- **`lib/sessions.test.ts`** (a fake launcher and clock):
  - `timeout`, `never_connected` at 60 seconds, `last_client_left`, `released` and `chrome_exited`, each ending once;
  - starting sessions and held slots count toward the max;
  - an ended record answers 409 for an hour, then 404;
  - the state file is written at each start and end, with no token or metadata.
- **`lib/cdp-proxy.test.ts`** (a socket server on 127.0.0.1):
  - bytes are relayed both ways, unchanged and in order;
  - a second upgrade gets 409, during and after;
  - a wrong token gets 401;
  - a client close ends the session, and an upstream close closes the client;
  - a client that stops answering pings is closed after 120 seconds (fake timers).
- **`lib/reaper.test.ts`:**
  - a state entry whose process still runs, with the same start time, is killed and its profile removed;
  - one whose pid now belongs to another start time is left alone;
  - stray profiles under the prefix are removed;
  - the periodic sweep kills a Chrome no session owns.
- **`lib/log.test.ts`:** a request to `/connect/<id>?t=secret` from 203.0.113.9 writes a line holding none of the id, `secret` or the address.
- **`lib/admin-socket.test.ts`:** `drain` refuses creates 503 `draining`; `status` counts; the socket is mode 0600.
- **`lib/chrome-args.test.ts`:** the forbidden list; resolver rules only in proof mode; `BackForwardCache` disabled; the window size from the viewport.
- **`boundaries.test.ts`.**

**Self-test (the builder):**
- `npx tsx scripts/browser-provider-smoke.ts` against the launcher, on 127.0.0.1:18789, holds every check, the planted page and Back included.
- `node scripts/browser-stand-in.mjs 18789` serves every fixture.
- Everything is stopped by its PID.

### Step 2. The live view

**Files:**
- `lib/tokens.mjs` (live tokens and the epoch), `lib/live.mjs`, `lib/live-input.mjs`, `live/*`;
- `api.mjs` (the `/live` routes and revoke);
- `proof/controls.mjs` builds its input with `live-input`, on its own connection.

**Tests:**
- **`lib/live-input.test.ts`:**
  - every message type gives the exact CDP command of 4.2;
  - Cmd+A from a Mac viewer arrives as Ctrl+A;
  - Ctrl or Cmd with V is never a key;
  - clamping, stripping and dropping;
  - text over 10,000 characters is refused.
- **`lib/live.test.ts`** (a fake tab connection):
  - **a watch view's click closes it 4403, and sends no `Input.*`.** It fails on a relay that forwards.
  - control input arrives in order;
  - revoke closes control views 4401 `revoked`, and a reconnect with the same token is refused;
  - `exp` closes 4401 `expired`;
  - a fifth viewer gets 4409;
  - **a second socket on one token closes the first with 4408 and takes over**; on the first revision, a lock-out with 4409;
  - the host pings, and a viewer silent for 45 seconds is closed and its slot freed (fake timers);
  - **a control viewer that leaves while holding the left button, and a key, gets `mouseReleased` and `keyUp` on its behalf**;
  - the screencast starts with the first viewer and stops with the last, with acknowledgements at least 66 ms apart;
  - a slow viewer gets the newest frame only, and a frame not starting `FF D8` is dropped;
  - no `fs` write happens, and no frame or input is logged;
  - the live view's connection sends only `LIVE_METHODS`;
  - a bad `Origin` is refused before the upgrade.
- **`lib/tokens.test.ts`** (extend):
  - mode, `exp`, the epoch, tampering, and another session's path;
  - the payload's keys are exactly `s, m, e, g, n`;
  - a watch token's `exp` is the session's end plus 60 seconds, and a control token's is at most 15 minutes and never past that end.
- **`live/page.test.ts`:**
  - the page and the script hold no cookie, storage, `eval` or `innerHTML` use;
  - the token is read from the fragment and removed with `replaceState`;
  - input listeners appear only inside `attachControl`;
  - `copy.mjs` has no dashes;
  - `live.css` holds the four token values of `tokens.css`.
- **`lib/api.test.ts`** (extend):
  - the headers of 4.1 on `/live/<id>` and on every asset (`no-store` included);
  - the same bytes for any id;
  - no `Set-Cookie`.

**Self-test:** a scratch viewer Chrome opens the live page through a harness page on an allowed frame-ancestor origin.
- Clicks, keys, IME, paste and wheel land on a fixture page.
- A watch view's input changes nothing.
- Closing the frame mid-drag leaves no button held.

### Step 3. Container mode

**Files:**
- `launcher/*`, `lib/launcher-client.mjs`, `lib/ranges.mjs`, `lib/firewall.mjs`, `lib/preflight.mjs`, `lib/images.mjs`;
- `container/*`, `install/*`;
- `/health`'s Chrome, image and version fields.

**Tests (no Docker):**
- **`launcher/launcher.test.ts`:**
  - an unknown operation, an unknown field, or a bad session id, viewport or timeout is refused;
  - `containerCreateBody` and `networkCreateBody` equal 5.2 field by field, `OomScoreAdj: 500` included;
  - no `PortBindings`, `Binds`, `Mounts`, `Devices` or `Privileged`, whatever the request holds (a request carrying any of them is refused);
  - `Cmd` starts with the backstop seconds, and holds no forbidden flag;
  - subnets are the lowest free /28, and names move on when one is taken;
  - `promote` takes only `candidate`.
- **`lib/ranges.test.ts`:** `blockedV4(ip) === isPrivateAddress(ip)`, importing `src/lib/browser/addresses.ts`, for:
  - every range's first and last address, and the addresses just outside them;
  - 200,000 seeded random IPv4 addresses.
- **`lib/firewall.test.ts`:**
  - the text of 5.4 from given addresses and a given uid;
  - the declare, delete and define lines first;
  - every refusal is a counter with a comment, and `jump refuse`;
  - the resolvers only on port 53, and ports 80, 443 and UDP 443;
  - IPv6 refused;
  - the input and output chains.
- **`install/firewall-check.test.ts`:**
  - a listing equal to the saved one, its counters aside, reloads nothing;
  - a changed rule, a missing table or a new host address reloads once, and only once per change (fails on the first revision: it compared text and appended).
- **`container/seccomp.test.ts`:**
  - the JSON parses, and its default action is ERRNO;
  - `clone`, `unshare` and `chroot` are allowed with no filter;
  - `socket` has the two argument rules and no unconditional allow;
  - no forbidden call is allowed without a capability gate.
- **`container/apparmor.test.ts`:** the profile holds `abi <abi/4.0>,`, `userns,`, `unix,`, `deny mount,` and each capability denial of 5.2.
- **`lib/preflight.test.ts`:** refusals for:
  - a `/proc/net/tcp` listener on 5432 (`:1538`), or a `next-server` process;
  - a missing AppArmor profile;
  - a stale `firewall.ok`;
  - IPv6 on in the daemon;
  - an unreachable launcher socket.
- **`install/install.test.ts`**, the script's guards and settings, read as text:
  - Ubuntu 24.04, x86_64, and 30 GB free;
  - the SSH change only after the key check;
  - unattended-upgrades with no automatic reboot;
  - `wkbhost` never in `docker`;
  - the timers' `OnCalendar`;
  - the units' hardening lines, the OOM scores, and `PrivateNetwork=yes` on the launcher;
  - `nft -c` before every load;
  - in the Caddyfile, `admin off` and both logger exclusions.
- **`install/maint.test.ts`:**
  - nothing pending means no drain;
  - a pending `containerd.io`, or `reboot-required`, drains, waits, applies and restarts;
  - a drain past 40 minutes reports `drain_stuck` and applies.

**Live check:** the server isolation proof (12.3), once the server exists, with the `sys_admin` trial of 5.2.

### Step 4. The app side

**Files:**
- `src/lib/browser/types.ts`, `config.ts`, the new `disclosed.ts`, `browserbase.ts`, `live-view-origin.ts`, `sessions.ts` (9.6);
- the live-view route, `take-over.ts`, `recorder.ts`, `browser-card.tsx`;
- the two SQL files, the manifest, and the schema comment;
- `teammate-copy.ts`, and the privacy and cookie pages;
- `scripts/browser-provider-smoke.ts`.

**Tests:**
- **`config.test.ts`** (extend; each fails today, when workwrk is no provider):
  - workwrk is set with every variable, as a local proof provider on a loopback URL;
  - in production it is null for: an http URL, an IP literal, `localhost`, a URL with a path, `browsers.workwrk.com`, the app's host, a 31-character key, the key `stand-in`, or an origin unequal to `NEXT_PUBLIC_BROWSER_HOST_ORIGIN`;
  - in production Browserbase is null for `browserConfig`, and still set for `browserReleaseConfig`.
- **`browserbase.test.ts`** (extend):
  - debug asks `?mode=control` and `?mode=watch` for workwrk and the stand-in, and no query for Browserbase (fails today: no query is ever sent);
  - `revokeLiveViews` and `hostHealth` send their requests for ours, and nothing for Browserbase;
  - a workwrk connect address on another host is `unknown_outcome`.
- **`sessions-route.test.ts`** (extend): the live-view route asks watch while live and control while handed over; the take over asks control.
- **`recorder.test.ts`** (extend): recording asks control.
- **`take-over.test.ts`** or **`sessions-route.test.ts`** (extend):
  - **Done revokes before the row is handed back:** the mock records `revokeLiveViews` before the `updateMany` to `live`;
  - a failed revoke still answers ok.
- **`sessions.test.ts`** (extend):
  - the host health part runs at most once an hour;
  - `ok: false` or unreachable fails the tick with codes only;
  - the capacity count is logged as a count;
  - nothing is read for Browserbase.
- **`live-view-origin.test.ts`** (extend): production accepts the configured https host origin, and refuses its http form and any other.
- **`types.test.ts`** (2.4).
- **`iconic.test.ts`** (9.5).
- **`teammate-copy.test.ts`.**

### Step 5. The proofs and the review rounds

**The live proofs of section 12, in order:**
1. the host proof, on this laptop;
2. Phase 4, on this laptop;
3. Phase 5, on this laptop;
4. the isolation proof, on the server, after the Founder actions.

**Then the final three-reviewer round:**
- **security:** the container, the launcher, the firewall, tokens, auth, Caddy, the install and the maintenance job;
- **the contract:** every app path in section 0 against the host, restarts, races and limits;
- **privacy:** nothing kept, every log, the pages' words.

---

## 12. The live proofs

### 12.1 Phase 4 (229 checks) and Phase 5 (208 checks), against our host in process mode, unchanged in substance

The runs change in their terminals, their environment and one check's files. Terminal 2 is the launcher, now our host:

```
STAND_IN_LOG=$TMPDIR/p4-model.jsonl node scripts/ai-stand-in-model.mjs 8787
BROWSER_STAND_IN_LOG=$TMPDIR/p4-browser.jsonl node scripts/browser-stand-in.mjs 8789
ANTHROPIC_API_KEY=stand-in ANTHROPIC_BASE_URL=http://127.0.0.1:8787 \
  BROWSER_OFFERED=1 BROWSER_PROVIDER=workwrk BROWSER_HOST_URL=http://127.0.0.1:8789 BROWSER_HOST_KEY=stand-in \
  BROWSER_REGION=us-east-1 BROWSER_SHOTS_DIR=$TMPDIR/p4-shots BROWSER_STAND_IN_IDLE_SECONDS=20 BROWSER_STAND_IN_WAIT_SECONDS=30 \
  SECRETS_ENCRYPTION_KEY=<from .env.local> NEXTAUTH_URL=http://localhost:3016 NEXT_PUBLIC_APP_URL=http://localhost:3016 \
  CRON_SECRET=<any> npx next dev -p 3016
BASE=http://localhost:3016 CRON_SECRET=<same> STAND_IN_LOG=$TMPDIR/p4-model.jsonl BROWSER_STAND_IN_LOG=$TMPDIR/p4-browser.jsonl \
  BROWSER_SHOTS_DIR=$TMPDIR/p4-shots BROWSER_STAND_IN_IDLE_SECONDS=20 npx tsx scripts/live-proof-ai-teammates-phase4.ts
```

- Phase 5's terminals are the same, with its own values: `BROWSER_SKILLS_OFFERED=1`, 60, 60 and 90 seconds, and the `p5-*` logs.
- The launcher's defaults (`us-east-1`, `http://localhost:3016`) are the proofs' own, so the host takes their region and frames their app.

**What the code shows about why nothing else changes:**
- **Neither proof compares a provider to "stand-in".** Their `provider: "stand-in"` values seed rows directly (P4 lines 1331, 2126 and 2352, and P5 line 2227), and the new CHECK still allows them.
- **Neither proof reads a `BROWSERBASE_*` variable.** P4 lines 1084 to 1087 pass the stand-in's key to the smoke script, which the launcher accepts in proof mode.
- **No live view address is fetched or origin-checked.** P4 lines 1621, 2192 and 2211, and P5 line 1356, check its type, or its absence from a refusal.
- **The controls they use exist in proof mode, with the same answers:** `reset`, `start-orphan`, `type`, `click`, `choose`, `page`, `back` and `kill`, plus `log` and `sessions` as GETs. `fail` is kept.
  - They run on the controls' own connection to the tab, as the stand-in's did (`ownPage`, lines 257 to 265), so `Runtime.evaluate` and Back's history calls work.
  - Their clicks and keys are built by `live-input`.
- **The log entries they read keep their shapes:**
  - `kind "api", route "create"`, with `recordSession`, `logSession`, `keepAlive`, `tag`, `row`, `region`, `session` and `timeout` (P4 lines 1369 to 1379, and 2144);
  - `route "release"`, with `path` and `at` (P4 lines 521 and 522, and 2000 to 2008; P5 lines 2390 to 2393);
  - `seq`, and `kind "control"` filtered out;
  - the `/__stand-in/sessions` entries' `id` and `status "COMPLETED"` (P4 lines 1322 to 1325).
- **They open no second CDP connection to a session.** P4 line 687 and P5 line 727 connect to their own screenshot Chrome.
- **The one check that changes:** P5 lines 1183 to 1187 read `scripts/browser-stand-in.mjs` for:
  - the fixture strings `"expenses.proof.test"`, `"pay.proof.test"`, `renameSubmit`, `jumpy` and `fakeEvents`;
  - the control strings `what === "click"`, `what === "choose"` and `what === "back"`.

  The check reads `services/browser-host/proof/fixtures.mjs` and `controls.mjs` together, which hold all eight.
- The header RUN blocks of both proofs show the terminals above.

**What these runs now prove of the host:**
- the API, and every refusal path the proofs inject;
- keepAlive false, through the proxy;
- the reaper of an orphan;
- the guard, through our relay: Fetch, auto-attach, the service worker bypass, popups, the isolated worlds and the recorder's binding;
- through the Phase 5 recording items 4 and 5, that **input built by the live view's own mapper is trusted and recorded**, with nothing typed kept.

**What they no longer prove:** with the back/forward cache off, no proof restores a page from it. The driver's commit check stays proven by `cdp-driver.test.ts` (a restore of a refused host held and blanked, with nothing read or acted on: After Phase 4, review of step 2).

Expected: 229 of 229, and 208 of 208.

### 12.2 The host proof (`scripts/live-proof-browser-host.ts`, this laptop)

**Setup:**
- It starts the host itself in process mode, **without** proof mode, on 127.0.0.1:18789, with:
  - `BROWSER_HOST_KEY=<random>`, `BROWSER_HOST_MAX=2`;
  - `BROWSER_HOST_APP_ORIGIN=http://127.0.0.1:18791`;
  - test windows of 5 seconds to connect, and 8 seconds for control.
- Its own fixture server on 127.0.0.1:18790 logs routes and counts only, plus `nickLength` for a profile save, `clicked` for a button, and a count of untrusted events.
- A harness page on 18791 frames the live view.
- A viewer Chrome is the person's browser, on its own debugging port.
- The proof itself is the app: it creates sessions over the API, and drives the remote Chrome over the connect address with `connectCdp`.
- Everything is stopped by its PID.

**Checks:**
- **H1, auth:**
  - no key, and a wrong key, give 401;
  - 11 wrong keys in a minute give 429 on every route;
  - the right key gives 201.
- **H2, shapes:**
  - the create answer has a UUID, a `ws://127.0.0.1:18789/connect/<id>?t=...` address, and every field of 3.2;
  - the list shows it RUNNING, with its `userMetadata`;
  - region `eu-central-1`, `keepAlive: true`, `timeout: 30` and `recordSession: true` each give 400, with its field.
- **H3, connect:**
  - a wrong token is refused;
  - a second connect while the first is open gives 409;
  - after the first closes, the list shows COMPLETED, and release gives 409.
- **H4, never connected:** a create left alone has ended within 6 seconds.
- **H5, timeout:** `timeout: 60` ends at 60 to 62 seconds, and the proof's own CDP socket closes.
- **H6, max:**
  - a third create gives 429 with `Retry-After: 30`, and `/health` counts one capacity refusal;
  - after one release, a create succeeds.
- **H7, control input end to end.** The viewer Chrome opens the harness, which frames `/live/<id>#t=<control>`, and through `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent` on the viewer page:
  - a click on the fixture's button gives `clicked` once;
  - "Hello" typed by keys into the profile field, then saved, gives `nickLength 5`;
  - an IME composition ("日本"), committed, gives `nickLength 2`;
  - a paste event of 3,000 characters gives `nickLength 3000`;
  - a wheel scrolls the fixture's long page (the proof reads `scrollY` through its connect client);
  - a touch tap through `Input.dispatchTouchEvent` on the viewer gives `clicked`;
  - the fixture's untrusted-event count is 0.
- **H8, watch cannot type:**
  - a watch view framed in the viewer Chrome draws frames, and its page attaches no input listener: a click on it gives no `clicked`;
  - a raw websocket with the watch token sends `{t:"mouse"...}` and is closed 4403, still with no `clicked`.
- **H9, revoke, expiry and reconnects:**
  - revoke closes the control view 4401 `revoked`, and a reconnect with that token is refused;
  - a fresh control view closes 4401 `expired` at 8 seconds;
  - a second socket on a live control token closes the first with 4408, and keeps typing.
- **H10, a held button:**
  - the viewer presses the button on a draggable fixture element and closes the frame mid-drag;
  - the fixture logs a `mouseup` within a second;
  - a later proof click on another element is a plain click.
- **H11, frames:** an animated fixture gives at most 15 frames a second over 3 seconds, each starting `FF D8`.
- **H12, the page:**
  - `/live/<id>` and its assets answer `no-store`, and the shell answers `frame-ancestors http://127.0.0.1:18791` and no `Set-Cookie`;
  - a frame on another origin is refused by the viewer Chrome (a CSP report seen through its console).
- **H13, the reaper:**
  - with a session running, the host is killed with SIGKILL, and its Chrome still runs (`ps`);
  - the host started again kills it within 2 seconds and removes its profile;
  - release of the old id gives 404.
- **H14, nothing kept.** The host's captured output, the state file and the state folder hold none of:
  - the key, any connect or live token, or any session id;
  - the fixture's page words, "Hello", or the pasted text.
- **H15, health:**
  - `/health` says `mode "process"`, with the Chrome version matching the self-test's `Browser.getVersion`, and `max 2`;
  - `/healthz` is 200, then 200 `draining` after `drain` on the admin socket, then 503 once `firewall_unchecked` is forced by the test window.
- **H16, a Chrome crash:** killing the session's Chrome ends it `chrome_exited`, and the proof's socket closes within 2 seconds.

### 12.3 The server isolation proof (`services/browser-host/proof/isolation.mjs`, run by the lead, as root, on the server)

It runs after the Founder actions, against `http://127.0.0.1:8789`, with the key given in the shell for this run only. It proves the firewall at the network layer, where Chrome cannot hide a gap, and Chrome's own layer separately, labelled as Chrome's.

**Setup:**
- A dummy interface, `wkbproof0`, with real listeners: `python3 -m http.server 80`, bound to each of 10.77.0.1, 172.16.77.1, 192.168.77.1, 100.64.77.1, 169.254.77.1, 198.18.77.1, 192.0.2.77 and 203.0.113.77 (each a /32).
- The host's own sshd and Caddy, which listen on every address, are real listeners too.
- **Positive controls, from the host's own namespace**, each of which must answer:
  - every dummy listener;
  - `ssh-keyscan` of the public IPv4 and of A's gateway;
  - `curl -k https://<public IPv4>/`;
  - the provider's metadata service, `http://169.254.169.254/`;
  - `https://<the app server>/`;
  - as `wkbhost`, `http://<B's address>:9222/json/version`.
- Two sessions, A and B, are made through the API. Their PIDs come from `docker inspect -f '{{.State.Pid}}'`.

**The network layer**, from A's own network namespace: `nsenter -t <A's pid> -n curl -sS --max-time 5 ...`. Each blocked target must be refused within 1 second (a reset, not a hang), and the counter with the comment named here must rise.

| Target | Counter |
|---|---|
| every dummy listener | `private` |
| `http://169.254.169.254/latest/meta-data/` | `private` |
| `http://<B's address>:9222/json/version` | `private` |
| `http://172.17.0.1:22/` | `private` |
| the public IPv4 on 22 and 443 | `to_host` (it is local delivery) |
| A's gateway on 22 and 443 | `to_host` |
| `https://<the app server>/` | `host` |
| `http://portquiz.net:8080/` | `port` |
| `dig @8.8.8.8 example.com +time=2 +tries=1` | `other_dns` |
| `curl --resolve rebind.test:80:10.77.0.1 http://rebind.test/` (a name that resolves to a private address) | `private` |

More checks from the same namespace:
- **IPv6:** `ip -6 addr` shows no global address, and `curl -6 https://[2606:4700:4700::1111]/` fails "Network is unreachable". The `ipv6` rule is the backstop.
- **The output rule:** root's own `curl http://<B's address>:9222/json/version`, from the host's namespace, is refused (counter `devtools_other_user`), while `wkbhost`'s answered.
- **Must work:**
  - `curl https://example.com/` and `http://portquiz.net/`;
  - `dig @1.1.1.1 example.com`.

**Chrome's own layer** (the proof's CDP client on A, from `http://example.com/`, an http page, so mixed content is not what refuses):
- `fetch("http://10.77.0.1/", { mode: "no-cors" })` rejects. The `private` counter says whether the packet left Chrome (the firewall) or not (Local Network Access); both are recorded.
- **The container's own loopback is not the host's:** `fetch("http://127.0.0.1:8789/")` rejects, since nothing listens there.
- A page websocket to `ws://127.0.0.1:9222/devtools/browser/<A's real id>` is refused, by Chrome's Origin check.
- **verify:** whether `fetch("http://127.0.0.1:9222/json/version")` rejects (Local Network Access). Either result is recorded, and the websocket refusal must hold.
- `chrome://sandbox` reads "Seccomp-BPF sandbox Yes", the namespace sandbox in use, and "You are adequately sandboxed."

**The container:**
- The launcher's `probe` against `current`: the netfilter socket is refused, and `net_admin` in a new namespace is refused (5.2).
- `docker inspect` of A shows:
  - `ReadonlyRootfs true`, `CapDrop [ALL]`, `CapAdd null`;
  - `SecurityOpt` holding `no-new-privileges`, the seccomp profile and `apparmor=workwrk-browser`, and `AppArmorProfile workwrk-browser`;
  - `Memory` and `MemorySwap` at the cap, and `OomScoreAdj 500`;
  - `NanoCpus 1e9`, `PidsLimit 1024`, `User 10001:10001`;
  - no port, bind or mount;
  - network `wkb-*`, `LogConfig none`, and IPv6 off.
- **Memory:** a page on A that allocates until 3 GB crashes its tab or its container. `docker stats` never shows A over its cap, the host and Caddy keep running, and B still reads `example.com`.

**Nothing kept:**
- After release, `docker ps -a` and `docker network ls` show no `wkb-*`.
- A connect through Caddy while the host is stopped (502) is made first. Then `journalctl -u workwrk-browser-host -u workwrk-browser-launcher -u caddy --since <start>`, and a recursive grep of `/var/lib/workwrk-browser-host`, `/run/workwrk-browser-*` and `/tmp`, hold none of:
  - the key, the connect and live tokens, or the session ids;
  - "Example Domain".

**After `sudo reboot`:**
- The firewall service ran before Docker (`systemctl show` timestamps).
- `nft -j list table inet workwrk_browsers` equals the saved listing, its counters aside, with every rule exactly once.
- The network layer table above is refused again.

**Cleanup:** the dummy interface and its listeners are removed.

---

## 13. Risks, and the Decision that answers each

| # | Risk | Answered by |
|---|---|---|
| 1 | A Chrome exploit in a page | 13 (Chrome's sandbox on); 3 (seccomp and AppArmor that allow it, nothing more); 3 and 4 (a browser-process exploit lands in a container with no capabilities, no root, a read-only root and no way out but ports 80 and 443) |
| 2 | A container escape (a kernel or runc exploit) | 2 (a server with no customer data, no database and no app, on its own domain); 3 (seccomp, AppArmor with the capability denials, no-new-privileges, no capabilities); 11 (the host holds only the key's hash); 12 (kernel, Docker, containerd and runc updated, drained, within a day; the runc floor). Accepted residual: the other live sessions on the box |
| 3 | A compromised host process | 19 (no Docker access: the launcher's eight fixed operations, bodies it builds itself); 8.3 (no capabilities, `wkbhost` never in `docker`) |
| 4 | The nf_tables class of kernel escalations, through a user namespace | 3 (`net_admin` denied inside any namespace; the netfilter netlink socket refused by seccomp; both proven by the probes) |
| 5 | The egress firewall bypassed through IPv6 | 4 (no IPv6 on session networks, the sysctls, `"ipv6": false`, all IPv6 forward refused, no AAAA record); 12.3 |
| 6 | DNS rebinding | 4 (refusals at the IP layer, whatever a name says, and DNS only through four public resolvers); Phase 4 Decision 10 (a page from a private address closed); 12.3's `--resolve` check |
| 7 | A firewall that silently stacks duplicates, or hangs blocked requests | 4 (atomic declare, delete and define; checked by meaning; reject, with a counter per rule); 12.3 after a reboot |
| 8 | A leaked API key | 11 (only the app server's addresses reach the API; the host keeps a hash; rotation with two hashes); 1 (the key cannot read a page, only start, list, release and mint views) |
| 9 | A leaked live view link | 7 (one session, one mode, its lifetime tied to the session, in the fragment and removed from the address, Origin checked, revoked before the hand back) |
| 10 | A leaked connect address | 8 (good once, consumed by the app within seconds of the create; a second connect 409) |
| 11 | CAPTCHAs, and blocked datacenter addresses | Accepted (13: no stealth, no residential proxies). The person sees the teammate read the challenge, say so, and ask to take over with reason `captcha` (Phase 4's `ask_to_take_over`); the person solves it in the live view. A site that refuses datacenter addresses outright shows its refusal page, and the teammate says the site refused the browser |
| 12 | A watcher who types | 7 (the host closes a watch view at its first input, 4403); 4.1 (the page attaches no input in watch); the card's overlay and `inert` (`browser-card.tsx` lines 686 to 706); H8 and the smoke test |
| 13 | A person locked out after a network blip | 7 (the newest socket wins; host pings free dead ones); H9 |
| 14 | A button left held in the remote page | 7 (released when a control viewer leaves); H10 |
| 15 | Memory exhaustion | 18 (the max from memory, with a shim allowance; builds and self-tests only with a slot held; OOM scores that kill a browser first); 3 (each container's cap covers its tmpfs and `/dev/shm`) |
| 16 | Zombie Chromes | 9 (the container's own `timeout`, `AutoRemove`, tini as PID 1, the reaper at start and every minute over the state file, labels and the profile prefix, process groups in process mode); H13 |
| 17 | Clock drift | 9 (durations cross the API, never instants; the host's timers run on the monotonic clock; tokens are checked only by the clock that minted them); 8.2 (NTP checked at install) |
| 18 | A host restart in the middle of a take over | 6.5 (every session ends; the app ends the row `provider_ended`, cancels the card and keeps a recording as a draft); 6.4 and 8.4 (planned restarts and reboots drain first) |
| 19 | Chrome, Docker, containerd, runc, Caddy or Node left out of date | 12 and 8.4 (daily checks, drained application, creates refused at 14 days for Chrome); 8.5 (the floors); `/health`'s versions |
| 20 | A broken host nobody notices | 11 (`/healthz` 503, the uptime monitor of Founder action 9, the app's hourly read, 9.6) |
| 21 | The host put on the app server, or beside the database | 2 (start refused) |
| 22 | WorkwrK session cookies sent to the browser server | 2 (a domain of its own; `config.ts` refuses a host under `workwrk.com` or the app's hosts in production) |
| 23 | The privacy page naming the wrong place | 14 (the disclosed constant; production refuses another provider; iconic tests pin the words) |
| 24 | A control view that lives on after Done | 7 (revoked before the hand back; 15 minutes at most if the revoke failed) |
| 25 | The live view disturbing the guard | 6 (`LIVE_METHODS` only; no Runtime, Emulation, Fetch or Target; the connection opened only at the first viewer); 17 (the proof controls' wider connection exists in proof mode only) |
| 26 | A token in a log, through Caddy or Chrome | 10 (no access log, no handler or proxy error log, `LogConfig none`, stderr drained); 12.3's journald check |
| 27 | The database refusing `workwrk` | 16, and section 2 |
| 28 | A planted page using the server for floods or spam | 4 (ports 80 and 443 only, a 6 MB/s cap per session); Chrome's own unsafe-port list. Accepted residual: the hosting company may ask about traffic |
| 29 | The firewall missing after a boot or an accident | 4 (loaded before Docker, checked every 5 minutes, creates refused after 10 minutes without a check) |
| 30 | Process mode in production | 5 (refused with `NODE_ENV=production`, and beyond loopback) |
| 31 | A page reaching its own Chrome's DevTools | 13 (permission prompts denied for local network access; Chrome's Origin check on DevTools websockets; target ids nobody can guess); 4 (only `wkbhost` reaches 9222 from the host); 12.3 |
| 32 | Too few browsers for demand | 6.2 (capacity refusals counted, read hourly by the app, the resize rule); Founder actions 1 and 7 |
| 33 | A create slower than the app's 10 seconds | 3.2 (the host's own 8-second limit answers 503, never silence); the reaper ends whatever `unknown_outcome` left |

---

## 14. What changes for existing rows and people, and rollback

**Capabilities that change on purpose:**
1. **Production can run only the disclosed provider** (`workwrk`). Browserbase stays in the code and works outside production, and releases still go to it everywhere.
2. **The live view is ours.** A watch view can no longer type, even with the overlay gone. A control view ends at Done.
3. **The stand-in is our host in proof mode.** Its live view is the new page, and it accepts one CDP client a session (nothing used two).
4. **The settings, privacy and cookie wording** say WorkwrK's own servers.

**Existing rows that do not change:** every `TeammateBrowserSession` (the CHECK allows every value it held), and every card, chat, recording and skill.

**Rollback** (if the previous release must serve again):
1. Before it, on this release: set `BROWSER_OFFERED=` (empty), reload, and tick the cron once, so every live session ends and is released to our host.
2. Check that `SELECT count(*) FROM "TeammateBrowserSession" WHERE "status" <> 'ended'` answers 0.
3. Then roll back. The old code never writes `workwrk`, and its rows stay valid under the new CHECK. The old Phase 4 file's guard finds the CHECK by name, and adds nothing.
4. The host may keep running, or be stopped: the old release's production config refuses everything but Browserbase.
5. There is no down migration.

---

## Founder actions

1. **Rent the server (the small start).**
   - Ubuntu 24.04 LTS, x86_64, **4 vCPU and 8 GB on a shared plan**, with whatever SSD the plan includes (40 GB or more is plenty), and one public IPv4.
   - At 1,280 MB a browser it runs **4 at once**: two GROWTH workspaces at full use.
   - Use a hosting company that offers a DPA. The one that hosts the app is simplest, since it is already on your list.
   - **Its location is the browsers' region.** Pick the one you would put under your customers' agreements, for example US East or Frankfurt, and tell the lead the label to show (in the `us-east-1` or `eu-central-1` style).
   - Never the app server.
   - In the hosting company's own firewall, allow ports 22, 80 and 443 only.
   - **Resize** when the app's logs (or the lead) report capacity refusals on most days: the next size up, 8 vCPU and 16 GB, runs 10.
2. **Buy a domain of its own, not under workwrk.com** (any short name, for example `workwrkbrowsers.com`). Point `browsers.<that domain>` at the server's IPv4, with an A record only and no AAAA. Tell the lead the name.
3. **Give the lead SSH access:** a sudo user on the server, with the lead's public key, and the server's IP. No password login.
4. **An email address for the certificates.** Let's Encrypt writes to it if renewal ever fails.
5. **Confirm the app server's outgoing address** (172.236.169.129 in today's deploy notes, and any IPv6). Only it may call the browser server's API.
6. **Sign the hosting company's DPA**, if you have not already. Add to the sub-processor list you send on request: that company, the server's location, and that AI teammates' browsers run there.
7. **Set the app's environment** in every place it reads it (`.env`, any `.env.production*`, the aaPanel Node settings), in this order:
   1. Set the variables:
      - `BROWSER_PROVIDER=workwrk`, `BROWSER_HOST_URL=https://browsers.<domain>`, `NEXT_PUBLIC_BROWSER_HOST_ORIGIN=https://browsers.<domain>`;
      - `BROWSER_HOST_KEY=<the key the install printed>`;
      - `BROWSER_REGION=<the label>`;
      - **`BROWSER_MAX_AT_ONCE=<the max /health prints>`**, 4 for the small start, and changed whenever the server is resized;
      - `BROWSER_DEPLOYMENT_TAG=workwrk-prod`;
      - `BROWSER_SHOTS_DIR` (Phase 4 Founder action 4).
   2. Let the next deploy build. The browser origin is written into the app when it is built, so the variable must be there first.
   3. Run `npx tsx scripts/browser-provider-smoke.ts --host` on the app server. It must hold every check.
   4. Only then set `BROWSER_OFFERED=1`, and run `pm2 reload workwrk --update-env && pm2 save`.
8. **Get counsel to read** the new privacy sentences (section 3's server sentence and what it keeps, section 4's sub-processors, section 7's region) and the cookie page's frame sentence.
9. **Set up an uptime monitor**, any free service (UptimeRobot and Better Stack both have one), on `https://browsers.<domain>/healthz` every 5 minutes, emailing you when it fails twice in a row. It goes red when the server needs a person: Chrome out of date, the firewall unchecked, a stuck update.
10. **Accept the maintenance window.** On the days an update of Docker, Caddy or Node, or a reboot, is pending, the server stops starting new browsers at 04:30 its time, waits for the open ones to finish (at most about 30 minutes), updates, and starts again.
11. **Not needed for this provider:**
    - Browserbase's account, papers, DPA and project (Phase 4 actions 1 to 3);
    - asking about its frame's cookies (Phase 4 action 6);
    - its egress addresses (Phase 4 action 7: the server's own IPv4 is the answer for enterprise customers);
    - Phase 5 action 1.

    Still needed: Phase 4 actions 4, 5 (as in 7 above), the counsel and AI provider items of 6, and 8; and Phase 5 actions 2 to 6.
12. **Optional:** `BROWSER_PRICE_CENTS_PER_HOUR`, if you want Settings to show an estimated cost. For example, the server's monthly rent divided by the browser hours you expect.

---

## Questions the code could not settle, and the answer chosen

1. **Does `--remote-debugging-address=0.0.0.0` bind under `--headless=new` on the server's Chrome?** Chosen: yes, as headless Chrome has supported it. **verify:** 12.3 reads `/json/version` at the container's address. If not, the image gains a `socat` relay.
2. **Does a second DevTools client's `Page.startScreencast` coexist with the app's driver session on the tab?** Chosen: yes, as Chrome serves several clients. **verify:** H7 and H11, while the Phase 4 and 5 proofs' reads and acts run.
3. **Does `Input.imeSetComposition` behave on the server's Chrome?** It is experimental. Chosen: use it, falling back to committing with `insertText` at `compositionend` when it errors. **verify:** H7's IME line.
4. **Does focus need `Page.bringToFront` for typing to land in headless?** Chosen: send it on the first control viewer. **verify:** H7; drop it if typing lands without.
5. **Does `--deny-permission-prompts` block a public page's fetch of loopback and private addresses (Local Network Access)?** Chosen: rely on it beside Chrome's Origin check and the firewall. **verify:** 12.3's Chrome layer, which records which one refused.
6. **Which calls does Chrome's namespace sandbox need under Docker's seccomp defaults, and does it survive `deny capability sys_admin`?** Chosen: three calls added, and `sys_admin` kept. **verify:** `chrome://sandbox` in 12.3, the step 3 trial with `sys_admin` denied, and anything more only as the kernel audit names it.
7. **Does Docker's embedded resolver forward from the container's namespace on the pinned Docker?** Chosen: yes, so port 53 is allowed to the four resolvers. **verify:** 12.3's DNS lines.
8. **Google's Linux signing key fingerprint** in the Dockerfile. **verify:** against Google's published key, at build.
9. **The nft meter syntax keyed by `iifname`, and `meta skuid` by number.** **verify:** `nft -c -f` at install, which stops on failure.
10. **The AppArmor profile's base text, for the pinned Docker version, under abi 4.0.** Chosen: moby's template at that version, plus `userns,`, `unix,` and the denials. **verify:** 12.3 reads the profile in use, the sandbox on, and the probes refused.
11. **Caddy's logger names for handler and proxy errors.** Chosen: `http.log.error` and `http.handlers.reverse_proxy`. **verify:** 12.3's forced 502 and the journald search.
12. **How much memory the image build takes at its peak.** Chosen: it fits in the one slot it holds. **verify:** at step 3, `systemctl show docker -p MemoryPeak` across a build, under 1,312 MiB; if not, the build waits for two free slots.
13. **The runc floor.** Chosen: 1.3.3. **verify:** against runc's security advisories, at step 3.
14. **Other readers of `BROWSER_PROVIDERS`.** **verify:** `grep -rn "BROWSER_PROVIDERS" src`.
15. **The documentation.ai pages' wording about the browser provider.** **verify:** the lead's search there, updated with 9.5's words.

---

## After: what was built, and each review

- **Spec review (2026-10-20, one read-only reviewer): 0 high, 11 medium, all fixed, and the lows folded in.** Each finding was checked against the code before it was settled.
  1. **The nft reload stacked duplicate rules** (`nft -f` adds to a table that exists). The file now declares, deletes and defines the table, one atomic transaction. The 5-minute check compares by meaning: a listing with its counters set to 0, against the one saved at load. It reloads only on a real difference, so counters survive (5.4; `firewall-check.test.ts`).
  2. **The isolation proof proved nothing.** From an https page, mixed content and Local Network Access refused every probe before any packet left, its targets had no listeners, and a drop hung for about two minutes. Now:
     - the network layer is proven from the container's own namespace (`nsenter -n`), against real listeners on dummy /32s, sshd, Caddy, the metadata service, another session's DevTools and the app server, each with a positive control from the host;
     - each refusal must reset within a second, and raise its named counter, since session traffic is rejected, never dropped;
     - Chrome's layer is a labelled set of its own, from an http page;
     - the loopback checks say what they are: the container's own loopback, not the host's (12.3; Decision 4).
  3. **The public host process held the Docker socket**, which is root. Split, by worst case (Decision 19): a launcher with no network, eight fixed operations over a unix socket only `wkbhost` may open, and every Engine body built by the launcher itself. An allowlisting socket proxy was refused: it cannot tell our create from `Privileged: true` or a bind of `/` without rebuilding the body (5.5, 8.3).
  4. **Docker, runc, containerd, Caddy and Node had no security updates.** Now:
     - a daily root maintenance job applies pending upgrades only after draining, and reboots the same way;
     - Ubuntu's own pocket updates nightly, without rebooting;
     - `/health` shows every version;
     - the smoke test refuses a runc below `RUNC_FLOOR` (Decision 12, 8.4, 8.5).
  5. **userns with AppArmor's `capability,` reopened the nf_tables class of escalations.** Now:
     - AppArmor denies `net_admin`, `net_raw`, `sys_module`, `bpf` and the rest of 5.2's list;
     - seccomp refuses the netfilter netlink socket;
     - two probes in every self-test prove both.
     - `sys_admin` stays allowed, by worst case: the kernel checks it in Chrome's own user namespace when its sandbox makes its PID and network namespaces, so denying it leaves no sandbox, and the only way on is forbidden. Step 3 tries the denial once and keeps it if the sandbox holds (Decision 3, 5.2).
  6. **The Phase 5 proof's source check reads fixture names too** (P5 lines 1183 to 1187: `"expenses.proof.test"`, `"pay.proof.test"`, `renameSubmit`, `jumpy`, `fakeEvents`, and the three control strings). It reads `proof/fixtures.mjs` and `controls.mjs` together (12.1).
  7. **The proof controls cannot all go through the live view:** Back uses history calls, and every control finds its point with `Runtime.evaluate`. They keep their own connection, in proof mode only, with their input built by `live-input`. `LIVE_METHODS` binds the live view's connection alone (Decision 17, 12.1).
  8. **`/healthz` was always 200.** Now:
     - it answers 503 for every problem that needs a person, and 200 when full or in a scheduled drain;
     - a new founder action sets up an uptime monitor;
     - the app's sweep reads `/health` once an hour, failing the tick on a problem and logging capacity refusals (3.2, 9.6, Founder action 9).
  9. **A network drop in the middle of a take over locked the person out with 4409.** The newest socket on a token now wins (the older is closed 4408), and the host pings every viewer and frees a silent one (Decision 7, 4.2; H9).
  10. **The sizing was not justified:** the plans allow 2 at once on GROWTH and 5 on SCALE. Now:
      - the founder's small start of 4 vCPU and 8 GB, on a shared plan, at 1,280 MB a browser, for a max of 4;
      - a resize when capacity refusals show;
      - `BROWSER_MAX_AT_ONCE` set to what `/health` prints (6.2, Founder actions 1 and 7).
  11. **The 2 GiB reserve missed the shims, the build and the self-test.** Now:
      - 32 MiB a session for its shim is in the formula;
      - the build and every self-test run only while holding a free slot;
      - the host, the launcher and Caddy run at OOM score -900, and sessions at 500 (Decision 18).
  - **Lows:**
    - **token lifetimes:** watch until its session's end plus 60 seconds, and control 15 minutes, never past it, so a watch view no longer dies before its session;
    - "four calls" corrected to the three the sandbox needs;
    - the create table's `blockAds` line rewritten;
    - **revoke before the hand back**, with a test of the order;
    - Caddy excludes the proxy's error logger too;
    - an nft output rule lets only `wkbhost` reach a session's 9222;
    - `no-store` on the live assets;
    - host-side websocket pings, and a `/connect` keepalive;
    - held mouse buttons and keys released when a control viewer leaves;
    - proof mode's defaults are `http://localhost:3016` and `us-east-1`, the proofs' own;
    - `unix,` added for AppArmor abi 4.0;
    - with the back/forward cache off, the commit check is proven by the driver's own tests, and 12.1 says so;
    - the card's build-time origin is placed in Founder action 7's order;
    - `AF_NETLINK` left out, with the reason, and a boundaries check that the host never needs it;
    - the disk sized at whatever the plan includes, with 30 GB free checked at install.
- **Step 1** (the host core in process mode; the stand-in becomes its proof-mode launcher): commit 3c058a44, live as merge 28e3c0c9.
  - 117 new tests, 112 of them failing on the old code.
  - The smoke test held every check.
  - The old and new stand-in gave the same 69 fixture answers.
  - The Phase 4 proof held 229 of 229 and Phase 5 held 208 of 208 against the host. The gate passed 11,262 tests.
- **Step 1 review** (one reviewer: 0 high, 2 medium, 13 low; `workwrk-launch-backup/agents/bh-step1-review.md`), fixed in the next commit:
  - **M1.** The minute's sweep read its keep list before `ps`, so a create during it could lose its profile or its Chrome. It now reads a live getter after each listing.
  - **M2.** A shutdown missed launches in flight, and a detached Chrome survived the exit. It now waits for them, then sweeps with nothing kept before it writes the state.
  - **Six lows fixed:**
    - an absolute-form target that crashed the host;
    - the keepalive on the monotonic clock;
    - the admin socket closing with a connection still open;
    - the token spent only after the handshake;
    - the session clocks starting at the create;
    - all 12 of P4's planted words held to the fixtures.
  - 18 of the new tests fail on 3c058a44.

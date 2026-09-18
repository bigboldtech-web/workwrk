# UI/UX audit: AI, Sidekick, Agents, Automation, Autopilot

Audited 2026-09-10, read-only, against `main` @ 6187227a. All paths are repo-relative to `/Users/bigboldtechnologies/theywrk`.

## 0. Map of the subsystem

| Surface | File | Backed by |
|---|---|---|
| `/sidekick` full-page chat | `src/app/(dashboard)/sidekick/page.tsx` | `/api/sidekick/sessions`, `/api/sidekick/chat/stream` (real Claude, 40 tools) |
| `/sidekick/history`, `/sidekick/prompts` | none (404) | sidebar links only |
| Sidekick side panel ("Brain") | `src/components/layout/os/sidekick-panel.tsx` | same API as the page |
| `/agents` | `src/app/(dashboard)/agents/page.tsx` | NOTHING (hardcoded array); a real `/api/agents` + `lib/agents/catalog.ts` exist but are unused by this page |
| `/ai` | `src/app/(dashboard)/ai/page.tsx` + `layout.tsx` (manager gate) | NOTHING (hardcoded prompts + fake "Recent") |
| `/autopilot` | `src/app/(dashboard)/autopilot/page.tsx` | NOTHING (hardcoded 8 rules); a legacy `/api/autopilot/workflows` exists on the old `Workflow` model with no engine |
| `/automation` | none (404) | |
| `/automation/workflows` | `src/app/(dashboard)/automation/workflows/page.tsx` | `/api/automation/*` (real engine, `lib/automation/*`) |
| `/automation/workflows/[id]` builder | `src/app/(dashboard)/automation/workflows/[id]/page.tsx` | real |
| `/automation/templates` | `src/app/(dashboard)/automation/templates/page.tsx` | real (5 seeded recipes) |
| `/automation/health` | `src/app/(dashboard)/automation/health/page.tsx` | real |
| `/automation/usage` | `src/app/(dashboard)/automation/usage/page.tsx` | real (1000 actions/month hard default) |
| `/automation/logs` | `src/app/(dashboard)/automation/logs/page.tsx` | real |
| `/automation/connections` | `src/app/(dashboard)/automation/connections/page.tsx` | real for WEBHOOK only; every other provider is a 501 stub |
| Shared automation chrome | `src/app/(dashboard)/automation/shared.tsx` | |
| AI sidebar | `src/components/layout/os/apps-catalog.tsx:955-980` (`AiSidebar`) | |
| AI rail app | `apps-catalog.tsx:1182-1185` (key `ai`, Core, matches `/sidekick`, `/agents`, `/automation`) | |
| Automation rail app | `apps-catalog.tsx:1317-1326` (key `automation`, Build & Extend, `requiredAccess: "manager"`, matches `/automation`) | |
| Dashboard agent card | `src/components/dashboard/autonomous-digest.tsx` (mounted at `dashboard-content.tsx:319`) | `/api/agents/runs` |

Three different products called "AI" coexist and none of them link to each other coherently:
1. Sidekick/Brain (real, tool-calling chat).
2. Agents (real backend: catalog, install, schedule, cron `run-due-agents`, `AgentRun`; fake frontend).
3. Automation Hub (real, event-driven engine) plus its dead twin Autopilot (static mock of the same idea with a legacy API nobody calls).

## 1. Shared chrome every route in scope inherits

### Top bar (`src/components/layout/os/click-topbar.tsx`)
Workspace switcher, global search (⌘K palette), **Ask AI** pill (`AskAiButton`, tooltip "Ask the Brain (⌘J)", opens the side panel), active timer pill, pinned quick tools, Notifications bell, Reminders bell, Inbox link, profile/presence avatar. Below it, `TopPinsStrip` (favorites tab row). Nothing in this subsystem changes the top bar.

### Page title row (`src/components/layout/os/title-bar.tsx`, `OsTitleBar`)
Used by `/sidekick`, `/agents`, `/ai`, `/autopilot` (NOT by `/automation/*`). Renders: amber star (always filled, `starred` defaults true, not wired to favorites), title, grey description, fake avatar stack from `PEOPLE` constants (`catalog.ts:79-88`, initials BB/SC/PR with a hardcoded "+N"), page `actions`, then the "standard trio": **Ask AI**, **Share**, **Invite**. All three trio buttons have NO onClick (`title-bar.tsx:89-111`). They are cosmetic on every page that uses this component.

### Secondary sidebar (`src/components/layout/os/click-sidebar.tsx:84-90`)
`getApp(activeAppKey) ?? findAppForPath(pathname)`. `activeAppKey` always resolves (defaults `"home"`, persisted in localStorage), so the route-derived fallback is effectively dead: **the sidebar does not follow the URL**. Arriving at `/automation/workflows` from a board's "Automate" link keeps the Work sidebar; arriving at `/sidekick` from the create menu keeps whatever app was last clicked. Only clicking a rail icon changes it.

When the **AI** app is active (`AiSidebar`, `apps-catalog.tsx:955-980`):
- Ask Sidekick → `/sidekick`
- History → `/sidekick/history` (**404**)
- Prompts → `/sidekick/prompts` (**404**)
- Agents → `/agents` (icon is `Sparkles`, same as Ask Sidekick; no `Bot`)
- Section "Automation" (managers only): Workflows, Templates, Connections. Health, Usage, Logs are omitted here.
- Rail "+" → `/sidekick?new=1` (works, latch in `sidekick/page.tsx:147-154`)

When the **Automation** app is active (`linksSidebar`, `apps-catalog.tsx:1319-1326`): Workflows, Templates, Health, Usage, Logs, Connections. No create action on the rail "+".

`/ai` and `/autopilot` are in no app's `matchPaths`, so even if route-follow worked they would show a foreign sidebar.

### Loader
- Route transitions: `src/app/(dashboard)/loading.tsx` → `ValueLoader` (company value / mission loader).
- In-page: every `/automation/*` page uses `Loader2 animate-spin` + "Loading…" text (`text-zinc-500`, inline in body).
- `/sidekick` uses plain text "Loading messages…" with no spinner; session list has no loading state at all (renders the empty-state copy "No chats yet" for the first paint before sessions arrive, `sidekick/page.tsx:320-324`).
- Side panel history: text "Loading…" (`sidekick-panel.tsx:377`).
- Builder uses the same Loader2 recipe; `Suspense` fallback on Logs also Loader2.

### Back navigation
- No page in scope uses `BackButton{fallbackHref}` (`src/components/ui/back-button.tsx`), the documented convention for detail routes.
- Builder `/automation/workflows/[id]` has a plain `<Link href="/automation/workflows">` chevron (`[id]/page.tsx:928-934`), so browser history is never used; it always goes to the list even when you came from Logs, Health or a Template.
- Every other route is a hub page with no back affordance. The Logs drawer has X (close) only.
- Dashboard 404 (`not-found.tsx`) does offer a `GoBackButton`.

### Error / empty states
- `/automation/*`: consistent. Loader → empty (icon circle + h2 + copy + CTA) → error (plain grey sentence). Toasts on every mutation failure. Health has two distinct empties (no runs vs no failures). Logs has a filter-aware empty.
- `/sidekick`: no error state for session load (silently swallowed, `page.tsx:99-101`); stream failure → toast and the optimistic messages are removed (user's text is lost from the composer).
- Side panel: errors are rendered as a red bubble inline (`sidekick-panel.tsx:488-492`); session-load errors swallowed.
- `/agents`, `/ai`, `/autopilot`: no loading/empty/error states because nothing loads. `/autopilot` has a "No rules match" search empty.

### Style
Two visual systems collide:
- `/sidekick`, `/agents`, `/ai`, `/autopilot` and the side panel use `os.css` BEM classes and `--os-*` tokens (`.os-chat`, `.os-mkt`, `.aip`, `.auto`, `.os-sk`), gradient hero blocks, per-category hues (`C.teal`, `C.pink`, `C.indigo`, `C.purple`, `C.orange`), gradient buttons (`.os-chat__new` is a brand→brand-deep gradient, `os.css:3373`). This is the hue-keyed style the visual-design memo says to move away from.
- `/automation/*` uses Tailwind zinc utilities with hardcoded hex (`#0073EA`, `#00C875`, `#E2445C`, `#F59E0B` in `shared.tsx:21-46`), a **dark zinc-900 pill** as primary CTA (`DARK_PILL`, `shared.tsx:49`) instead of brand blue, a bespoke `AutomationHeader` instead of `OsTitleBar`, native `<select>`s. It is Monday-clean and flat but on a different token system, so it does not respond to `--os-*` theme overrides except through the os.css "dark catchalls" (`os.css:31703`).
- Sidekick page composer footer hardcodes the model label "Sonnet 4.6" (`page.tsx:427`); side panel model pill hardcodes "Max" (`sidekick-panel.tsx:343`). Neither reads `lastModel`/BYOK preferred model.
- Type sizes drift: 12.5/13/13.5/14/14.5/16/20/24 all appear; `.os-mkt__hero h2` and `.aip__hero h2` are 24px marketing headlines inside the app.

### Naming
The same feature is called **Sidekick** (page, sidebar, `AskSidekickButton`, API), **Brain** (side panel aria-label/greeting/eyebrow, topbar tooltip, `AskAiButton` comments), **AI** (rail label, `/ai` page title), **AI Engine** (dashboard header CTA → `/ai`), **Create with AI** and **Super Agent · Hot** (create menu, `create-menu.tsx:331-350`). The side panel calls itself Brain in the greeting but the streaming API system prompt says "You are Sidekick" (`stream/route.ts:36`).

### Mobile / responsive
- `.os-chat` is a fixed `280px 1fr` grid with `height: calc(100vh - top - title)` and no media query (`os.css:3353-3358`); on phones the session rail eats most of the width and the thread is unusable.
- `.os-sk.is-open` is a fixed 380px column with no breakpoint (`os.css:1217-1222`); on narrow viewports it squeezes `<main>` rather than overlaying.
- `.os-mkt__grid` is `repeat(3, 1fr)` with no breakpoint (`os.css:3038-3043`); agent cards collapse to slivers.
- `/ai` grid is `auto-fill minmax(310px)` (fine); hero input row does not wrap.
- `/autopilot` has one breakpoint at 900px for KPIs and stacks the When/If/Then flow (`os.css:10675, 10774`).
- `/automation/*`: list pages scroll horizontally in a `min-w-[860px]`/`min-w-[920px]` wrapper (acceptable). Builder right rail is `hidden lg:block` (`[id]/page.tsx:1214`): below 1024px **Description, Severity, Published/Last run/Versions and Run history are unreachable**. Logs drawer is `w-full max-w-[520px]` (fine).

## 2. Route inventory

### 2.1 `/sidekick`
- **File:** `src/app/(dashboard)/sidekick/page.tsx` (555 lines, client)
- **Title / purpose:** "Sidekick", full-page chat with the tool-calling assistant. Description: "Your AI working partner · ⌘J to toggle the side panel".
- **Reachable from:** AI rail app default href; AI sidebar "Ask Sidekick"; rail "+" → `?new=1`; create menu "Create with AI"; `/ai` page (Send button and every template card, with `?q=`); `/autopilot` and `/ai` title-bar nav links; Favorites page pinned/recent chat cards (`?session=<id>`); stub module catalog entry `sidekick` (`catalog.ts:607`). No server gate; every signed-in user.
- **Back button:** none (hub page).
- **Top bar:** shared. Title row: star, "Sidekick", description (switches to "Chat · <title>" when a session is open), fake avatars BB/SC "+2", dead Ask AI + Share buttons (Invite suppressed via `showInvite={false}`).
- **Sidebar:** whatever app is active (does not follow route). With AI active: Ask Sidekick / History (404) / Prompts (404) / Agents (+ Automation section for managers).
- **Controls:**
  - Left rail: "New chat" gradient button (works: POST session, focuses composer); search input (client filter on title); grouped list Today / This week / Older; each row shows title, relative time, model short-name; hover trash → confirm "Delete chat?" → DELETE (soft-archive) → toast "Chat archived"; pinned rows show a Pin icon instead of trash (no way to pin/unpin here; PATCH exists at `/api/sidekick/sessions/[id]` and Favorites page uses it).
  - Welcome: gradient logo, **"Good morning, BigBold."** hardcoded (`page.tsx:362`) regardless of user or time of day; 6 starter chips (FORM/TABLE/DOC/TASK/ANALYZE/PLAN) that only prefill the composer; PLAN starter contains an em dash.
  - Composer: Paperclip "Attach" button with no handler (`page.tsx:399-401`); textarea (Enter sends, Shift+Enter newline); send button; footer shows kbd hints and a hardcoded green-dot "Sonnet 4.6" label.
  - Message rows: user avatar hardcoded "BB" (`page.tsx:510`); assistant rows render tool calls as collapsible `<details>` with a verb map (`TOOL_VISUAL`, `page.tsx:462-478`) that covers 15 of the 40 registered tools (`lib/agents/tools.ts`), and every entry uses the same `Wrench` icon so the per-tool "visual" is colour only; markdown body via `OsMarkdown`; typing dots while streaming.
- **URL params honoured:** only `?new=1`. `?q=` (sent by `/ai`) and `?session=` (sent by Favorites) are ignored (`page.tsx:72,147-154`).
- **UI state:** rough. Works end to end for chat, but greeting/avatar/model/people are fake, attach is dead, deep links are broken.
- **Issues:**
  - `?session=` deep link from Favorites opens a blank chat instead of the session (high).
  - `?q=` from `/ai` is dropped, so the "prompt playground" never actually runs a prompt (high).
  - Delete copy says Delete, API and toast say Archive; there is no archived view to restore from (medium).
  - No way to pin, rename or share a chat here although the API supports rename/pin (medium).
  - Hardcoded greeting, user initials, model label, fake avatar stack, dead Attach, dead Ask AI/Share in title bar (medium, cosmetic dishonesty).
  - Session list has no loading state and swallows errors; a failed load looks like "No chats yet" (medium).
  - Stream failure removes the user's message and does not restore the draft (medium).
  - Session list groups Today / This week / Older; side panel groups Today / Yesterday / Older (low, inconsistency).
  - Tool chips: 25 tools fall through to the generic "Ran create_okr" text; the `TOOL_VISUAL` map still lists CRM/helpdesk tools (create_lead, create_ticket) the PPMS scope removed (low).
  - The page says "⌘J to toggle the side panel" while a full-page chat is open: two independent chat UIs (page + panel) with separate session state and no hand-off (medium, confusing).
  - No mobile layout (see cross-cutting).

### 2.2 `/sidekick/history` and `/sidekick/prompts`
- **File:** none. Dashboard `not-found.tsx` renders "We haven't built this yet".
- **Reachable from:** AI sidebar items 2 and 3 of 4 (`apps-catalog.tsx:964-965`).
- **UI state:** broken (dead sidebar links). Severity high: half of the AI hub's sidebar 404s.

### 2.3 `/agents`
- **File:** `src/app/(dashboard)/agents/page.tsx` (241 lines, client, no fetch)
- **Title / purpose:** "Agents", marketplace to "hire" AI teammates. Description: "Hire AI teammates. They show up in Sidekick, your Inbox, and on the boards they own."
- **Reachable from:** AI sidebar "Agents"; create menu "Super Agent · Hot"; `/ai` and `/autopilot` title-bar links; `/build` title-bar link; dashboard `AutonomousDigest` card ("Configure" / "Manage"); marketplace category "ai" (`store/page.tsx:40`). No server gate.
- **Back button:** none.
- **Top bar:** shared. Title row: star, "Agents", description, fake avatars BB/SC/PR "+9", dead Ask AI / Share / Invite.
- **Sidebar:** does not follow route; AI sidebar if AI active.
- **Controls:** 9 filter chips (All / Installed / Sales / HR & People / Operations / Support / Finance / Marketing / Executive) with counts, client-only filter over the hardcoded array; section title with "N available"; card grid (3 columns fixed). Each card: gradient initial tile, name, role, description, three metric tiles (drafts today / tasks per week / saved), skill chips, tier pill (core/plus/suite/free), and either **Hired** + **Chat** buttons or **Hire** button. **None of the three buttons has an onClick** (`page.tsx:215-233`). Hero shows "agents hired", "saved per week" (sum of parsed strings) and a hardcoded "156 tasks delegated this month" (`page.tsx:152`).
- **Data honesty:** the 8 agents (Ria, Priya, Aman, Rio, Vinay, Diya, Sage, Ash) list Salesforce, Gmail, Jira, PagerDuty, Zendesk, Intercom, QuickBooks, Xero, HubSpot, Mailchimp, Buffer as skills. None of those integrations exist. Real catalog in `lib/agents/catalog.ts` uses different slugs (`priya-hr`, `ria-sdr`, …) and its own system prompt admits "You do NOT yet have direct read/write access to the user's WorkwrK data".
- **Backend that exists but is not surfaced here:** `GET/POST /api/agents` (installed + available), `POST /api/agents/[slug]/install` (admin only), `PATCH /api/agents/[slug]/schedule` + run-now (manager+), `GET /api/agents/runs`, cron `POST /api/cron/run-due-agents`, and Sidekick sessions accept `agentSlug` to chat with an agent (`sessions/route.ts:42-66`). The `/agents` page uses none of this; therefore "Chat" cannot open an agent-scoped session and there is no schedule UI although the dashboard card sends users here to "Configure".
- **UI state:** stub (looks finished, does nothing).
- **Issues:** Hire / Hired / Chat dead (high); hero metrics fabricated (high); dashboard card's "Configure autonomous runs" leads to a page with no schedule controls (high); category chips for Sales/Support/Finance/Marketing contradict the PPMS scope decision (medium); fixed 3-col grid (low); title-bar trio dead (low).

### 2.4 `/ai`
- **Files:** `src/app/(dashboard)/ai/page.tsx` (175 lines), `layout.tsx` calls `requireManagerOrRedirect()` (employees/agents are bounced to `/dashboard`).
- **Title / purpose:** "AI", self-described "Prompt playground · curated templates · runs in your account". File header says "This is a stub showcase page; the real AI conversation surface lives in /sidekick" (`page.tsx:3-8`).
- **Reachable from:** dashboard header CTA "Ask the AI Engine" (`dashboard-content.tsx:301`); marketplace category; stub module `ai` (`catalog.ts:609`). Not in any rail app's `matchPaths`, not in any sidebar. Effectively orphaned.
- **Back button:** none.
- **Top bar:** shared. Title row: star, "AI", description, page actions "Sidekick" and "Agents" nav links, dead Ask AI / Share / Invite.
- **Sidebar:** none of its own.
- **Controls:** hero input + "Send" link → `/sidekick?q=<text>` (param ignored by target); 7 category chips (All / Writing / Marketing / Code / Data / Operations / HR); 12 template cards each linking to `/sidekick?q=<preview>` (same dead param); "Recent" list of 4 hardcoded runs ("Q3 board update draft · Opus 4.7", etc.) all linking to plain `/sidekick`; "all ›" link.
- **UI state:** stub.
- **Issues:** every CTA lands on a Sidekick that ignores the prompt (high); fake "Recent" with fake model names (high); manager-only gate on a page that only contains prompt text is inconsistent with `/sidekick` being open to everyone (medium); "Code review" / "SQL from question" / "Explain code" templates are off-scope for a PPMS (low); duplicates the starter chips already on `/sidekick` and the Suggested list in the panel, three curated-prompt surfaces with three different lists (medium).

### 2.5 `/autopilot`
- **File:** `src/app/(dashboard)/autopilot/page.tsx` (256 lines, client, no fetch). Header comment: "Stub: showcases sample triggers / conditions / actions across modules."
- **Title / purpose:** "Autopilot", workflow rules list with KPI strip. Description is computed from the fake data ("6 active rules · 107 runs this week · ~26.5h saved").
- **Reachable from:** URL only. Not in any sidebar or rail app; marketplace maps `autopilot` to category ops / tier suite (`store/page.tsx:34,51`); stub module `autopilot` (`catalog.ts:610`). `docs/plans/automation-hub.md:64-67` explicitly lists it as a stub "to leave alone (or later redirect to /automation)".
- **Back button:** none.
- **Top bar:** shared. Title row: page actions "Agents", "Sidekick" links and a **"New rule" primary button with no onClick** (`page.tsx:154-156`); dead Ask AI / Share / Invite.
- **Controls:** 4 KPI tiles (Active rules / Runs per week / Saved / Needs attention); search input; status filter pills All / Active / Paused / Error with counts; card list where each card shows status, name, trigger type, description, When → If → Then flow, footer stats and a ChevronRight that suggests a detail page but the card is not clickable.
- **Data:** 8 fake rules referencing Slack DMs, PR reviews, GL posting, vendor invoices, PTO, "#finance" channels.
- **UI state:** stub.
- **Issues:** duplicate of `/automation/workflows` with a different name and different visual language (high, confusing); "New rule" dead (high); cards look clickable but are not (medium); reachable by every employee by URL while the real Automation hub is manager-only in the sidebar (medium); legacy `/api/autopilot/workflows` (old `Workflow` model, `kind: "AUTOMATION"`, admin-only mutations, no engine) is a second automation backend nothing in the UI calls (medium, tech debt that will confuse a redesign).

### 2.6 `/automation` (root)
- **File:** none. 404 via dashboard `not-found.tsx`.
- **Reachable from:** URL only (rail app default is `/automation/workflows`).
- **UI state:** broken (low severity, but an obvious address for the hub).

### 2.7 `/automation/workflows`
- **File:** `src/app/(dashboard)/automation/workflows/page.tsx` (433 lines)
- **Title / purpose:** "Workflows", the Automation Hub list (ClickUp "Manage" parity per file header). Meta: "N automations · M active".
- **Reachable from:** Automation rail app default href; Automation sidebar "Workflows"; AI sidebar Automation section (managers); "Automate" buttons on Space, Board and Folder headers (`spaces/[slug]/page.tsx:603`, `boards/[slug]/page.tsx:143`, `folders/[id]/page.tsx:186`); Health "Go to workflows"; builder "Back". No server gate; API GET is member-readable, mutations 403 for members.
- **Back button:** none.
- **Top bar:** shared. Page header is the bespoke `AutomationHeader` (icon + title + meta + actions); no star, no avatars, no Ask AI trio. Action: dark pill "New automation" → `usePrompt` name dialog → POST → router push to builder.
- **Sidebar:** does not follow route.
- **Controls:** dense h-7 grid: Name (link to builder, `title=` description), Status pill (Draft/Active/Inactive/Error/Archived), Trigger (registry display name; "· not live" suffix when `isEmitting` false; "No trigger" grey), Last run (relTime or "Never"), Success (% or —, tooltip total runs), Created by, row "…" menu → Edit / Duplicate / Activate or Deactivate (Activate only when a published version exists) / View logs (`/automation/logs?workflowId=`) / Delete (confirm; archives if it has runs). Empty state: Zap icon, "Create your first automation", "New automation" + "Browse templates →".
- **UI state:** polished (for its own style system).
- **Issues:** "New automation" and every row-menu mutation render for read-only members and fail with a 403 toast (medium); no search/filter although the API supports `?q=` and `?status=` (low); no bulk actions; no "Automate this board" context (the Space/Board/Folder "Automate" links land on the org-wide list with no board preselected, medium); dark pill CTA vs brand-blue elsewhere (low); success-rate column has no run-count visible without hover (low).

### 2.8 `/automation/workflows/[id]` (builder)
- **File:** `src/app/(dashboard)/automation/workflows/[id]/page.tsx` (1302 lines)
- **Title / purpose:** Monday-style sentence builder: "When [trigger] / Only if [conditions] / Then [action] and then […]". Name is an inline editable input in the header.
- **Reachable from:** Workflows row link or menu Edit; Templates "Use template"; Logs drawer workflow link; "New automation" prompt. URL-direct works.
- **Back button:** yes, plain `Link` chevron to `/automation/workflows` (`[id]/page.tsx:928-934`), aria "Back to automations". Not `BackButton`; ignores history.
- **Top bar:** shared. Page header: back chevron, Workflow icon, name input, Status pill, "Unsaved changes" hint, then right cluster: **Active** `Switch` (disabled until published, tooltip "Publish this workflow first"), trash icon (confirm → DELETE → push to list), "Save draft" outline pill, "Publish"/"Republish" dark pill.
- **Sidebar:** does not follow route.
- **Controls, centre column:**
  - Trigger token popover (`MorePortal` + `MenuList`, grouped by category; non-emitting triggers disabled with "not emitting yet" chip). Emitting today: task.created, task.status_changed, task.assignee_changed, kpi.recorded, kudos.created (`registry-triggers.ts:51-100`). Catalog-only: review.completed, sop.published, lead.*, quote.*, pickup.*, payment.* (Cashkr ops seeds).
  - Conditions: AND/OR segmented toggle (only shown when >1 row), rows of field `<select>` (from trigger fields) + operator `<select>` (`CONDITION_OPERATORS`) + value input, per-row trash; nested API-authored groups shown as an opaque dashed row that can only be removed. "Add condition" text button.
  - Actions: token popover grouped by category; unavailable actions disabled with "coming soon". Available: assign_user, update_status, create_task, create_notification, send_email; stub: send_whatsapp (requires WHATSAPP connection). Param panel per action with typed inputs: user picker (`UserParamPicker` with specials assignee/actor/board_owner/admins + people search), board `<select>` (from `/api/boards?all=1`), status `<select>` with "Custom…" escape, priority `<select>`, number, text (`{{field}}` tokens). "Add another action".
- **Right rail (lg+ only):** Details card: Description textarea, Severity select (Critical/Major/Minor, "for Health"), Published / Last run / Versions; Run history card: last 10 runs with status pill, error or trigger key, relTime, each linking to `/automation/logs?runId=`; "All logs →".
- **Save semantics:** Save draft = PUT; Publish = save then POST publish (validates trigger + ≥1 action + all actions available; flips ACTIVE server-side). Republish creates a new version. Active toggle = activate/deactivate.
- **UI state:** polished.
- **Issues:** `dirty` is tracked but there is **no navigation guard / beforeunload**; clicking Back or the rail discards edits silently (high); right rail hidden under 1024px so description/severity/run history vanish (medium); versions are counted but cannot be viewed, diffed or rolled back (medium); no per-board scoping of a workflow (task triggers fire org-wide; the only board filter is a manual `boardId` condition the user must type as an id string, medium); condition value for `user`-typed fields is a raw text input, not the user picker (medium); "Severity (for Health)" is jargon with no explanation (low); "Republish" label does not tell the user that an ACTIVE workflow keeps running the old version until republish (low); read-only members can open the builder and edit locally, every save 403s (medium); no test/dry-run button (low).

### 2.9 `/automation/templates`
- **File:** `src/app/(dashboard)/automation/templates/page.tsx` (203 lines)
- **Title / purpose:** "Templates", starter recipe gallery. Meta: "N starter recipes".
- **Reachable from:** Automation sidebar; AI sidebar Automation section; Workflows empty-state link.
- **Back button:** none.
- **Header:** `AutomationHeader`, no actions.
- **Controls:** 3-col card grid; each card: category chip, severity chip (Critical/Major only), amber "not live yet" chip when the trigger is not emitting, name (the recipe sentence), description, dark pill "Use template" → POST workflow clone → toast "Draft created from template" → push to builder. Empty state "No templates yet".
- **Seeds (`api/automation/templates/route.ts:17-113`):** 5 recipes (task created → notify assignee; status Done → notify board owner; created without assignee → assign board owner; lead created → follow-up task [not live]; KPI recorded → notify admins).
- **UI state:** polished.
- **Issues:** no way to save a workflow as a template or manage templates (the model is global, admin-less) (medium); "Use template" visible to read-only members, 403 on click (medium); the lead-created recipe is shipped even though Leads/CRM were removed from the product scope (low).

### 2.10 `/automation/health`
- **File:** `src/app/(dashboard)/automation/health/page.tsx` (246 lines)
- **Title / purpose:** "Health", last-30-day run health. Meta "last 30 days" (not adjustable).
- **Reachable from:** Automation sidebar only (not in AI sidebar; not linked from Workflows or Logs).
- **Back button:** none.
- **Header:** `AutomationHeader`, no actions.
- **Controls:** 3 severity cards (Critical/Major/Minor failures); if no runs: single "No runs yet" panel with "Go to workflows →"; else success-rate SVG donut (green arc, legend Success/Failed/Partial/Skipped counts) + "Recent failures" list (8 rows, each links to `/automation/logs?workflowId=`), "View all logs →". No interactions beyond links.
- **UI state:** polished.
- **Issues:** window is fixed at 30 days with no selector (low); no per-workflow drill-down other than a workflow-filtered logs link (low); Health/Usage/Logs are missing from the AI-app sidebar, so users who reach automation through the AI hub never see this page (medium, navigation).

### 2.11 `/automation/usage`
- **File:** `src/app/(dashboard)/automation/usage/page.tsx` (243 lines)
- **Title / purpose:** "Usage", this month's action metering. Meta: month label.
- **Reachable from:** Automation sidebar only; in-app notification link when the limit is hit (`lib/automation/usage.ts:112`).
- **Back button:** none.
- **Controls:** "Actions used" progress bar (used / limit · %, turns red when blocked, copy "Limit reached — automations are paused until the counter resets on the 1st"); "Daily usage" recharts bar chart (or "No actions executed this month yet"); three mini tables Top workflows / Top actions / Top users. No controls.
- **UI state:** polished.
- **Issues:** limit is a hardcoded `DEFAULT_MONTHLY_LIMIT = 1000` (`lib/automation/usage.ts:13,27`) with no plan/billing linkage and no upgrade path (file header admits "billing isn't wired, so none is shown") (medium); no month navigation (low); em dash in the blocked copy (low).

### 2.12 `/automation/logs`
- **File:** `src/app/(dashboard)/automation/logs/page.tsx` (479 lines)
- **Title / purpose:** "Logs", execution log. Meta "N runs" (of the current page of 100).
- **Reachable from:** Automation sidebar; Workflows row menu "View logs"; Health failures + "View all logs"; builder run history (`?runId=`) and "All logs →". Deep links `?workflowId=` and `?runId=` are honoured.
- **Back button:** none; drawer has X.
- **Header:** `AutomationHeader` with two native `<select>` filters: workflow (includes archived) and status (Success/Failed/Partial/Skipped/Running).
- **Controls:** grid rows (Status pill, Workflow, Trigger key, Record type · id prefix, Started, Duration, Error) → click opens right drawer "Run detail": status pill, "Retry failed steps" (only when FAILED/PARTIAL and all failed action steps are `safeToRetry`), close; `<dl>` Workflow (link to builder) / Trigger / Record / Started / Duration / Error; amber note when unsafe to retry; Steps list with type chip, name, duration, status pill, error, Input/Output JSON blocks; Trigger payload JSON. Empty state is filter-aware.
- **UI state:** polished.
- **Issues:** hard `take=100`, no pagination or date range (medium); "Record" shows raw `recordType · id.slice(0,8)` with no link to the task/KPI/kudos record (medium); trigger shown as raw key (`task.status_changed`) instead of the display name the Workflows page resolves (low); filters do not sync back to the URL after you change them (low); Retry visible to members? No: it is gated client-side only by retry safety, so a member sees the button and gets a 403 toast (low); drawer is not keyboard-dismissable (no Esc handler) (low).

### 2.13 `/automation/connections`
- **File:** `src/app/(dashboard)/automation/connections/page.tsx` (281 lines)
- **Title / purpose:** "Connections", integration providers for actions. Meta "N connected".
- **Reachable from:** Automation sidebar; AI sidebar Automation section.
- **Back button:** none.
- **Controls:** 5 provider cards (WhatsApp, Gmail, Google Calendar, Slack, Webhook), each with icon, status pill (Connected / Not connected / Expired / Error), description, error line, "Last synced". Webhook card: URL input + "Connect"/"Update" dark pill (real: upserts CONNECTED). Other four: outline "Connect" button that always yields toast "<Provider> connection is coming soon" (API returns 501, `connections/[provider]/route.ts:37-39`). No disconnect anywhere (file header: "There is no disconnect endpoint yet").
- **UI state:** rough (honest stubs, but four of five cards are non-functional).
- **Issues:** four "Connect" buttons exist only to show a coming-soon toast (medium); no disconnect / rotate for the webhook (medium); connect is admin-only server-side but the buttons render for managers and members (medium); no webhook secret / signing / test-ping (low); overlaps conceptually with `/settings/integrations` and `/integrations` (the plan lists `(dashboard)/integrations/` as a leftover stub) so there are three "integrations" doors (medium); ZAPIER and CRM providers are accepted by the API but not shown (low); WhatsApp/Gmail/Slack contradict the "integrations are demand-driven, in-house first" strategy (low).

## 3. Non-route surfaces

### 3.1 Sidekick side panel ("Brain"), `src/components/layout/os/sidekick-panel.tsx`
- Mounted in `os-shell.tsx:113` as a right column inside the main flex row (animates 0 → 380px, pushes content rather than overlaying).
- Opened by: topbar Ask AI pill; ⌘J (`shell-context.tsx:541`); `openSidekick(prompt)` from task detail "Ask AI" (`item/[id]/page.tsx:137`, `board-item-drawer.tsx:244`), Planner command bar, command palette Ask AI pill; the DOM event `workwrk:os:ask-sidekick` from `askSidekick()` used by `AskSidekickButton` on Space/Board/Folder headers and `EmptyView` CTAs; doc editor dialog `onOpenSidekick`.
- Top bar of the panel: New chat (works), History toggle (works), **model pill "Max ▾" with no handler** (`:341-345`), **"More" ••• with no handler** (`:350-352`), Collapse (works).
- Empty view: BloomMark greeting "Brain / What can I help with?", copy claims it knows "boards, items, KRAs, KPIs, SOPs, weekly reviews, and team alignment"; three lists Suggested / Featured / Search. Every row only sets the composer text to its label. Featured contains **"Generate an image"** and **"Today's calendar"** tagged "New" and Search contains **"Search the web"**, none of which the backend can do (tools are workspace CRUD/search only).
- Thread: user bubbles, assistant bubbles with `OsMarkdown`, tool chips "Ran <name>" (error variant), typing dots, inline red error bubble.
- Composer: auto-growing textarea, **"+" Attach with no handler** (`:513-515`), **"All sources ▾" is a `<span>`** not a control (`:516-520`), send button.
- History view: search, grouped Today/Yesterday/Older, click to open. No delete, no pin, no rename.
- Context: derives `productContext`/`boardContext` from the URL's first two segments on session creation (`:56-60`), which is a real advantage the full page does not have; but the panel session and the page session are separate state, so a chat started in the panel is only findable on the page after refresh via the list.
- **Issues:** five dead controls (model pill, More, Attach, All sources, and the fake Featured/Search capabilities) (high); brand name "Brain" vs "Sidekick" (medium); on narrow viewports it squeezes the page (medium); no Esc-to-close (low); `aria-hidden` toggles but focusable children remain in the DOM when closed (low).

### 3.2 `AiSidebar` (`apps-catalog.tsx:955-980`)
Covered above. Two of four links 404; Agents uses the Sparkles icon; Automation section omits Health/Usage/Logs; the manager check is display-only (`canAccessTier("manager")`).

### 3.3 Dashboard `AutonomousDigest` (`components/dashboard/autonomous-digest.tsx`)
Real (reads `/api/agents/runs?trigger=SCHEDULED`). When empty it renders a dashed CTA card "Put your agents to work autonomously … Configure →" to `/agents`, where nothing can be configured. When non-empty it lists runs with a "Manage →" link to the same dead page. Uses a third styling system (`text-muted-2`, `bg-surface`, `border-border`, `dark:` classes) from the pre-OS shell.

### 3.4 Create menu AI section (`create-menu.tsx:330-350`)
"Create with AI" → `/sidekick`; "Super Agent" with a red "Hot" badge → `/agents` (the dead marketplace). The badge markets a feature that does not exist.

### 3.5 Legacy catalog stubs (`components/layout/os/catalog.ts:607-610, 659-662`)
`stubModule` entries `sidekick`, `agents`, `ai`, `autopilot` plus path map entries `agents/ria`, `agents/priya`, `agents/maya`, `agents/aman` still exist, and the Marketplace (`store/page.tsx`) lists `sidekick`, `agents`, `ai` as INSTALLED apps and `agents`/`autopilot` as "suite" tier. A redesign should treat these as dead registry rows.

## 4. Broken / confusing (ranked)

| # | Severity | Where | What |
|---|---|---|---|
| 1 | high | AI sidebar → `/sidekick/history`, `/sidekick/prompts` | Both sidebar items 404 (`apps-catalog.tsx:964-965`). |
| 2 | high | `/agents` | Hire / Hired / Chat buttons have no handlers (`agents/page.tsx:215-233`); the whole page is a hardcoded mock while a real agents API + cron exist. |
| 3 | high | Dashboard `AutonomousDigest` → `/agents` | "Configure"/"Manage" autonomous agents sends users to a page with no schedule UI. |
| 4 | high | `/ai` → `/sidekick?q=` | Every template and the hero Send pass `?q=` which `/sidekick` never reads (`sidekick/page.tsx:147-154`). |
| 5 | high | Favorites → `/sidekick?session=` | Pinned/recent chat cards deep-link to a param the page ignores; opens a blank chat. |
| 6 | high | `/autopilot` | Static duplicate of `/automation/workflows` with a dead "New rule" button, unclickable cards, fake integrations, reachable by URL for everyone. |
| 7 | high | Sidekick panel | Model pill, More menu, Attach, "All sources" are inert; Featured/Search rows advertise image generation, calendar and web search the backend cannot do (`sidekick-panel.tsx:88-100, 341-352, 513-520`). |
| 8 | high | Builder | Dirty state tracked but no navigation guard; Back/rail/browser back discard edits silently (`[id]/page.tsx:588, 928`). |
| 9 | medium | Shell (`click-sidebar.tsx:89`) | Secondary sidebar never follows the route; `findAppForPath` is unreachable, so in-page "Automate"/"Ask Sidekick" links land in a page whose sidebar belongs to another app. |
| 10 | medium | Rail | Two rail apps (AI, Automation) both own `/automation`; AI's sidebar shows 3 of 6 automation pages. Health/Usage/Logs are invisible from the AI hub. |
| 11 | medium | `OsTitleBar` on sidekick/agents/ai/autopilot | Ask AI, Share, Invite buttons have no handlers; fake avatar stacks with "+2/+9". |
| 12 | medium | `/sidekick` | Hardcoded "Good morning, BigBold.", "BB" avatar, "Sonnet 4.6" label; Attach dead; Delete copy vs Archive behaviour; no pin/rename here though the API supports it; no loading/error state for the session list. |
| 13 | medium | Naming | Sidekick / Brain / AI / AI Engine / Create with AI / Super Agent all name the same assistant. |
| 14 | medium | `/automation/*` for members | All mutation buttons (New automation, row menu, Use template, Connect, Save/Publish, Retry) render for read-only members and fail with 403 toasts; no client-side role awareness. |
| 15 | medium | `/automation/connections` | Four of five providers are 501 stubs behind a live-looking Connect button; no disconnect. Third "integrations" surface next to `/settings/integrations` and `/integrations`. |
| 16 | medium | Builder right rail | `hidden lg:block` hides description, severity, versions and run history below 1024px. |
| 17 | medium | Builder | No per-board scoping; user-typed condition values are raw ids; versions countable but not viewable/rollbackable. |
| 18 | medium | Space/Board/Folder "Automate" links | Land on the org-wide list with no context of the board you came from. |
| 19 | medium | `/automation/logs` | Fixed 100 rows, no pagination/date range; record column not linked; trigger shown as raw key. |
| 20 | medium | `/automation/usage` | 1000/month limit is a constant, not a plan; blocked state offers no path forward. |
| 21 | medium | `/ai` gate | Manager-only layout on a static prompt list while `/sidekick` is open to all; dashboard CTA sends employees into a redirect. |
| 22 | medium | Style split | os.css hue-keyed gradients (sidekick/agents/ai/autopilot) vs Tailwind zinc + dark pill (automation) vs pre-OS `text-muted-2` (digest card). |
| 23 | medium | Mobile | `.os-chat` 280px rail, `.os-sk` 380px panel, `.os-mkt__grid` 3 columns have no breakpoints. |
| 24 | low | `/automation` root, `/sidekick/*` | 404 for the hub's natural address. |
| 25 | low | Legacy | `/api/autopilot/workflows`, `catalog.ts` stub modules, `store` INSTALLED list still reference agents/ai/autopilot. |
| 26 | low | Copy | Em dashes and "—" placeholders throughout (`sidekick/page.tsx:38`, `usage/page.tsx:149`, `workflows/page.tsx:413`), against the no-double-dash rule. |
| 27 | low | Sidekick tool chips | 25 of 40 tools fall back to generic verbs; all share the Wrench icon; CRM/helpdesk tools remain listed. |

## 5. Cross-cutting conventions observed

- **Back:** no `BackButton` usage in scope; builder uses a hard Link to the parent; everything else is a hub page. Logs drawer closes on X only.
- **Loader:** route-level `ValueLoader`; in-page `Loader2 animate-spin` + "Loading…" on all automation pages; plain text on Sidekick page/panel; no skeletons anywhere.
- **Empty/error:** automation pages have a consistent icon-circle + h2 + copy + CTA empty and a plain-sentence error; Sidekick swallows list errors; agents/ai/autopilot have none because they never load.
- **Style:** automation = flat, zinc, hardcoded YBRG hex, dark zinc-900 primary pill, bespoke header; AI pages = os.css tokens, gradients, per-category hues, `OsTitleBar`; digest card = legacy pre-OS tokens. None of the three matches the "single accent, Monday-clean" target exactly; automation is closest but uses a dark CTA instead of blue.
- **Mobile:** only `/autopilot` (900px) and the automation list pages (horizontal scroll) have any responsive treatment; the builder hides its right rail below lg; chat page, panel and agents grid have none.
- **Naming:** see §1.

## 6. Access notes

- **Server gates:** only `/ai` (`ai/layout.tsx` → `requireManagerOrRedirect`, redirects employees/agents to `/dashboard`). `/sidekick`, `/agents`, `/autopilot`, `/automation/*` have no layout guard and are not in `lib/page-gates.ts`.
- **Display gates:** AI rail app has no `requiredAccess`; its Automation sidebar section is hidden below manager tier (`canAccessTier("manager")`). Automation rail app is `requiredAccess: "manager"` so employees never see it, but can type `/automation/workflows` and get a read-only list (API GET is member-readable per `lib/automation/hub-access.ts`).
- **API matrix (automation):** admin (SUPER_ADMIN/COMPANY_ADMIN) = everything incl. connect integrations; manager (C_LEVEL/VP/DIRECTOR/MANAGER/TEAM_LEAD/HR) = create/edit/publish/activate/retry; member = read-only, 403 on mutation. The UI does not read `ctx.role`, so members see every mutation control.
- **Agents API:** install = admin only (`install/route.ts:24`); schedule/run-now = manager+; runs = any member. `/agents` page ignores all of it.
- **Sidekick:** any signed-in user; sessions are per-user (`userId` scoped); tools are scoped by `toolsForSession` on product context; model = org BYOK preferred model or `claude-sonnet-4-6` (`stream/route.ts:33,151`).
- **Inconsistencies:** `/ai` (static) is manager-gated while the far more capable `/sidekick` is open to all; `/autopilot` (mock of a manager feature) is open to all; Health/Usage (org-wide metering) are readable by any member who types the URL; Connections shows Connect to everyone but only admins may connect.

## 7. Settings notes

**Configurable today**
- Workflow-level: name, description, severity (Critical/Major/Minor, only affects Health cards), trigger, conditions (flat AND/OR), actions + params, active toggle, publish/republish.
- Webhook URL on Connections (admin).
- Sidekick chat: rename / pin via API (surfaced only on Favorites page), archive.
- Org-level AI key/model: BYOK `OrgSecret` (Enterprise feature) via `lib/ai-client.ts`; managed elsewhere (settings/security), not in this subsystem.
- Settings home has two related cards: "API keys · Service tokens for webhooks and automations" (`settings/page.tsx:163-167`) and "AI usage · Sidekick + agent queries" linking to `/analytics` (`settings/page.tsx:257-261`).

**Should be configurable but is not**
- Monthly automation action limit / plan tier (hardcoded 1000).
- Who may build automations (fixed to access tier; no per-space automation permissions; no board-scoped workflows).
- Template management (save as template, edit, hide seeds, org-private templates).
- Agent hiring, enabling, scheduling (cron), autonomous prompt, model override: all exist in the `Agent` model and API but have no UI.
- Sidekick model choice ("Max"/"Sonnet 4.6" labels are decorative), data-source scoping ("All sources" is a span), attachments, default system prompt, tool allow-list per role.
- Sidekick history retention / restore archived chats.
- Health window (fixed 30 days); Logs retention and page size.
- Disconnect / rotate webhook; webhook signing secret; test ping.
- Notification routing when the usage cap is hit (only admins get one in-app notification).
- A single "AI & Automation" settings area does not exist; the pieces are spread over Settings→API keys, Settings→Integrations, `/automation/connections`, `/integrations`, and Analytics.

## 8. Recommendation seeds for the redesign (not exhaustive)

1. Collapse the three AI doors into one: retire `/ai` and `/autopilot` (redirect to `/sidekick` and `/automation/workflows`); delete `/api/autopilot`, the catalog stub modules and the Marketplace INSTALLED rows.
2. Make `/sidekick` the page and the panel the same session store; honour `?session=` and `?q=`; replace History/Prompts sidebar items with real routes or remove them.
3. Either wire `/agents` to `/api/agents` (install, chat via `agentSlug`, schedule) or remove the page and the dashboard card until it is real.
4. One rail owner for `/automation` (Automation app with all six pages); fix `click-sidebar` route-follow so in-page links land with the right sidebar.
5. Role-aware automation UI (hide/disable mutations for members, admin-only Connect), navigation guard in the builder, responsive right rail, board-scoped workflows from the Space/Board "Automate" entry.
6. Pick one visual system (recommend the automation hub's flat zinc but with brand-blue primary and `--os-*` tokens) and remove `OsTitleBar`'s dead trio and fake avatars.

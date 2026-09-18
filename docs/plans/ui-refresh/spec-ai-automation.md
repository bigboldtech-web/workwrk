# AI and automation spec

Unit: `ai-automation`. Owns the **AI hub** (rail key `ai`), its secondary sidebar, the Ask AI page and panel, Agents, and the whole Automation group (workflows, builder, templates, connections, health, usage, logs).

Written against `design-system.md` (look), `access-model-spec.md` (access), `settings-architecture.md` (settings structure), `spec-template.md` (structure), `zoho-reference.md` (the endorsed clean look), `critic-gaps.json`, `phase2-inputs.md`, `existing-direction.md`, `spec-shell.md` (shell container, naming table, ROUTE_HUB), the audit inventory `ai-automation.md`, `docs/plans/automation-hub.md`, and the code at `6187227a`.

One line: **one AI door, one automation list, nothing on screen that is not wired.**

---

## 0. Scope

### Routes covered

| URL | Page file under `src/app` | Disposition |
|---|---|---|
| `/sidekick` | `(dashboard)/sidekick/page.tsx` | KEEP, rebuilt. Labelled **Ask AI** everywhere. URL unchanged because the shell spec's `ROUTE_HUB` and the rail `defaultHref` point at it. |
| `/agents` | `(dashboard)/agents/page.tsx` | KEEP, rebuilt on the real `/api/agents` endpoints. The hardcoded 8-agent marketplace is deleted. |
| `/automation` | new `(dashboard)/automation/page.tsx` | NEW (today a 404). Permanent redirect to `/automation/workflows`. |
| `/automation/workflows` | `(dashboard)/automation/workflows/page.tsx` | KEEP, restyled onto the list-page header stack and `TableCard`. |
| `/automation/workflows/[id]` | `(dashboard)/automation/workflows/[id]/page.tsx` | KEEP, restyled; dirty guard, responsive Details panel, version history, scope picker added. |
| `/automation/templates` | `(dashboard)/automation/templates/page.tsx` | KEEP, restyled; the off-scope Leads recipe dropped. |
| `/automation/connections` | `(dashboard)/automation/connections/page.tsx` | KEEP, rebuilt; the four dead Connect buttons removed. Scope narrows to the one connector that works, the webhook. |
| `/automation/health` | `(dashboard)/automation/health/page.tsx` | KEEP, restyled; window selector added. |
| `/automation/usage` | `(dashboard)/automation/usage/page.tsx` | KEEP, restyled; honest limit copy. |
| `/automation/logs` | `(dashboard)/automation/logs/page.tsx` | KEEP, restyled; real pagination, Esc on the drawer, resolved trigger names and record links. |

Routes discovered in the code that belong to this unit and were not in the brief's list:

| URL | Page file | Disposition |
|---|---|---|
| `/ai` | `(dashboard)/ai/page.tsx` + `layout.tsx` | REMOVED, redirect (below). Static mock, zero backend. |
| `/autopilot` | `(dashboard)/autopilot/page.tsx` | REMOVED, redirect (below). Static mock of the real Automation hub. |
| `/sidekick/history` | none (dead sidebar link, `apps-catalog.tsx:1030`) | Not built; the link is deleted and its job becomes the sidebar CHATS section plus `/sidekick?view=all`. |
| `/sidekick/prompts` | none (dead sidebar link, `apps-catalog.tsx:1031`) | Not built; the link is deleted and its job becomes the starter prompts on the Ask AI landing state. |
| `/integrations` | `(dashboard)/integrations/page.tsx` | **KEPT**, not merged. Page owned by the tools-misc unit (`spec-tools-misc.md` §2.6). This unit renders its sidebar row and keeps its `ROUTE_HUB` prefix under `ai`. See the conflict note below. |

Rows this unit renders in its own sidebar but does **not** specify the page for (owned by the tools-misc unit, `spec-tools-misc.md` §1 and §2.4 to §2.6): `/store` (**Marketplace**), `/integrations` (**Integrations**) and `/build` (**Build apps**).

**Conflict resolved across units: `/integrations` is KEPT.** Two specs disposed of this URL in opposite directions while each believed it was deferring to the other: an earlier draft of this spec deleted it with a 308 into `/automation/connections`, and `spec-tools-misc.md` shipped the same 308 saying the AI spec won. Both 308s are withdrawn and the page survives at `/integrations`. Access wins on access, and three decided sources keep the page and keep it reachable by every Member:

- `access-model-spec.md` §5.2.1 gives `integrations` (`/integrations`) its own app row in the **AI** hub: "every Member browses the catalog; connecting an integration needs `settings.manageIntegrations`".
- `settings-architecture.md` G21, §1.17 and §7.1 make "the demand-driven marketplace at `/integrations` (AI hub sidebar row)" the target of the `/settings/integrations` merge.
- `settings-architecture.md` §5.4 and §7.1 name `/integrations` as the surviving marketplace, the one the `/settings/integrations` stubs fold into.
- `spec-tools-misc.md` §0 and §2.6 spec the page in full as KEPT, in the AI hub's APPS section, with Request-this counts backing the demand-driven connector strategy.

**Ownership, so neither unit writes the other's half.** The sidebar **row** is this unit's (AI hub, APPS section, `Plug`); the **page** is the tools-misc unit's, `spec-tools-misc.md` §2.6. The four providers the old Connections page faked leave Connections and become real Request-this cards on `/integrations`.

Connections is Owner and Admin only, so redirecting `/integrations` into it would take the destination away from every Member, which the hard rule forbids. The two pages are kept apart because they answer different questions, and the naming canon (§1.3) says which is which: **Connections** is where an Owner or Admin sets up the one place automations actually send things (the webhook), and **Integrations** is the catalogue every Member browses and asks for connectors from. Neither page repeats the other's rows: the four providers the old Connections page faked (WhatsApp, Gmail, Google Calendar, Slack) are deleted here and live on `/integrations` as real Request-this cards, so nothing is dropped and nothing is said twice.

### Routes REMOVED / REDIRECTED / MERGED

| From | To | Reason | What moves with it |
|---|---|---|---|
| `/ai` | `/sidekick` (308 in `next.config.ts`) | Static prompt playground with no backend; every CTA already pointed at `/sidekick` with a `?q=` the target ignored. It also held a `requireManagerOrRedirect` gate on a page of prompt text while the real assistant was open to everyone. | The 12 prompt templates become the six real starter prompts on the Ask AI landing (each one now actually runs), and `?q=` is honoured. The "Recent" list of fabricated runs is deleted; real recent chats live in the sidebar CHATS section. |
| `/autopilot` | `/automation/workflows` (308) | Static duplicate of the real hub with a dead "New rule" button, unclickable cards and fake Slack/PR/GL data. `docs/plans/automation-hub.md:64` already names it a stub to redirect. | Nothing: every idea on it exists for real on `/automation/workflows`. The legacy `/api/autopilot/workflows` route and the `Workflow`-model automation rows are deleted in the same change. |
| `/automation` | `/automation/workflows` (308) | The hub's natural address 404s today. | none |
| `/sidekick/history` | `/sidekick?view=all` | Never existed; it 404d from the sidebar. | Chat history is the sidebar CHATS section plus the All chats view, which also holds Archived and Pinned. |
| `/sidekick/prompts` | `/sidekick` | Never existed; it 404d from the sidebar. | Starter prompts on the landing state. |
| `/favorites` pinned-chat cards | `/sidekick?pinned=1` | Agreed with the Work unit (`spec-work-home.md` §0): `/favorites` becomes the real Favorites page and its pinned Sidekick chats become an AI-hub concern. | `?pinned=1` opens the All chats view filtered to pinned. |

Nothing else is removed. Every destination that exists today is reachable after this spec.

### Audit inventories consulted

`ai-automation.md` (primary), `shell.md` (via `spec-shell.md`), `settings-pages.md` (via `settings-architecture.md`), `access-model.md` (via `access-model-spec.md`), `critic-gaps.json`, `existing-direction.md`, `phase2-inputs.md`, `zoho-reference.md`, `design-references.md` (indirectly, through the design system).

### Audit issue IDs this unit resolves

From `ai-automation.md` §4: **1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27** (all 27; 17 is split, and 20 is partly deferred to billing, see §5).

From `critic-gaps.json` `topSystemicIssues`: **#1** (nav decoupled from the URL, orphan routes, dead sidebar links), **#2** (fabricated and inert chrome), **#3** (duplicate surfaces: Sidekick page vs Brain panel, `/autopilot` vs `/automation`, three integrations doors), **#4** (fragmented access, no read-only mode), **#5** (no back convention), **#6** (five visual systems), **#7** (settings that do nothing, no dirty guard on the automation builder), **#9** (naming drift), **#10** (desktop-only, builder right rail hidden below `lg`), **#11** (errors swallowed into empty states, no session-expiry handling), **#12** (hard caps and no pagination), **#14** (dead code and stale registries; the issue names `ai-automation 3.5` as evidence, which is this unit's `catalog.ts` stub modules, its `agents/*` path map and the Marketplace INSTALLED set), **#15** (em dashes and developer jargon in UI copy).

Also corrected here: the inventory's §1 claim that the AI sidebar "omits Health, Usage, Logs" and the critic's stronger claim that those three have no sidebar entry anywhere are both stale. `apps-catalog.tsx:1036-1044` lists all six automation rows today, behind `canAccessTier("manager")`. The real defects are the tier gate (not access-model vocabulary), the two 404 rows above it, and the sticky-sidebar bug that keeps the rows off screen when you arrive from a board.

---

## 1. Unit-level rules

### 1.1 Hub and sidebar

Every route in this unit resolves to rail hub **AI** (`resolveHub(pathname)`, shell spec §1.1). The rail pill is white on navy with the label "AI"; `aria-current="page"`. Nothing here reads `activeAppKey`, `canAccessTier`, `useRole` or `accessLevel`: the hub and the active row come from the URL, and every row gates on `visibleApps` only (shell spec §1.2 rule 1).

`ROUTE_HUB` prefixes this unit registers for `ai`: `/sidekick`, `/agents`, `/automation`, `/store`, `/integrations`, `/build`.

Three edits this unit asks the shell unit to make to `spec-shell.md` §1.1's `ROUTE_HUB` table, because that table is the one nav source and two specs must not describe different hubs:

1. Delete `/ai` and `/autopilot` from the `ai` row; both pages cease to exist in §0 and a 308 is served before any shell renders.
2. **Move the `/favorites` prefix from the `ai` row to the `home` row.** The shell's table currently carries it under `ai` with the note "pinned AI chats; AI unit renames", but `spec-work-home.md` §1 registers `/favorites` for `home` and §2 rebuilds it as the real Favorites page. This unit does not want the prefix: pinned chats are a state of `/sidekick` (`?pinned=1`), not a route. Until the move lands the URL-derived highlight for `/favorites` is undefined, which is why it is called out rather than silently dropped.
3. Keep `/integrations` on the `ai` row (it is no longer redirected, §0).

Active row, per `resolveActiveRow` (longest matching `href` wins):

| URL | Active sidebar row |
|---|---|
| `/sidekick`, `/sidekick?new=1`, `/sidekick?q=` | Ask AI |
| `/sidekick?session=<id>` | the matching CHATS row (its `href` is longer); Ask AI is not active |
| `/sidekick?view=all`, `?pinned=1`, `?archived=1` | Ask AI (the All chats view is a state of the same row) |
| `/agents` | Agents |
| `/automation/workflows`, `/automation/workflows/[id]` | Workflows |
| `/automation/templates` | Templates |
| `/automation/logs` | Logs |
| `/automation/health` | Health |
| `/automation/usage` | Usage |
| `/automation/connections` | Connections |
| `/store` | Marketplace |
| `/integrations` | Integrations |
| `/build` | Build apps |

### 1.2 AI hub sidebar (this unit owns it)

Container: `HubSidebar` with a `SidebarSpec` (shell spec §1.2). Width `--os-side-w` 264, ground `--os-side-bg` N50, rows 36 (`--os-nav-row-h`), labels 15/400 `--os-ink`, active pill `--os-side-pill` N200 with 15/500 and the count in `--os-ink-strong`, icons Lucide 20px 1.5px `--os-ink-2`. No blue, no coloured icons, no transform.

**Header**: the workspace switcher (shell) plus one 32px ghost "+" at its right. `create: [{ label: "New chat", icon: Sparkles, href: "/sidekick?new=1", gate: app "ai" }]` - a single action, so the "+" fires it directly; tooltip "New in AI".

**Search field**: rendered by the shell's rule (total rows > 12), so the threshold is role-dependent and both cases are stated here rather than left to be derived. An Owner or Admin sees 11 fixed rows (Ask AI, Agents, six AUTOMATION rows, three APPS rows), so the field appears at their second chat. A Member sees 9 fixed rows (no Connections, no Build apps), so the field appears at their fourth chat. Placeholder "Search AI…", filters row labels (including chat titles) in place, never navigates.

Sections, in order:

| # | Section | Row | Icon | href | `match` | Gate | Count / dot | Collapsed by default |
|---|---|---|---|---|---|---|---|---|
| 1 | (unlabelled personal block) | **Ask AI** | `Sparkles` | `/sidekick` | prefix | app `ai` | none | n/a |
| 2 | | **Agents** | `Bot` | `/agents` | prefix | app `ai` | count = enabled agents, omitted when 0 | n/a |
| 3 | **CHATS** | one row per chat session, pinned first then newest | `MessageSquare` (pinned rows: `Pin`) | `/sidekick?session=<id>` | exact on the param | app `ai` | none | no |
| 3z | | **See all chats** (ghost row, 13/500 `--os-ink-2`) | none | `/sidekick?view=all` | exact | app `ai`, rendered only when the viewer has more than 15 chats | none | n/a |
| 4 | **AUTOMATION** | **Workflows** | `Workflow` | `/automation/workflows` | prefix | app `automation` | count = active workflows, omitted when 0 | no |
| 5 | | **Templates** | `LayoutTemplate` | `/automation/templates` | prefix | app `automation` | none | |
| 6 | | **Logs** | `ScrollText` | `/automation/logs` | prefix | app `automation` | `Dots unread` when a run failed in the last 24h | |
| 7 | | **Health** | `Activity` | `/automation/health` | prefix | app `automation` | none | |
| 8 | | **Usage** | `GaugeCircle` | `/automation/usage` | prefix | app `automation` | none | |
| 9 | | **Connections** | `Cable` | `/automation/connections` | prefix | app `automation` **and** Owner or Admin (`settings.manageIntegrations`, access §9) | none | |
| 10 | **APPS** | **Marketplace** | `ShoppingBag` | `/store` | prefix | app `store` (every Member browses, access §5.2.1) | none | yes |
| 11 | | **Integrations** | `Plug` | `/integrations` | prefix | app `integrations` (every Member browses, access §5.2.1) | none | |
| 12 | | **Build apps** | `Hammer` | `/build` | prefix | app `build` (Owner and Admin only, access §5.2.1) | none | |

Rows 10 to 12 are declared here because this unit owns the sidebar; their pages belong to the tools-misc unit, which specified these three rows in `spec-tools-misc.md` §1 and flagged them to this unit. Where the two specs named the same thing differently the split is settled row by row, so neither unit has to guess:

- **Section label: APPS**, not "Add ons". The hub owner owns its own sidebar, and this unit owns the AI hub sidebar. The section sits **after** AUTOMATION.
- **Row label: Build apps**, not "Build". `settings-architecture.md` §5.3 prints the footer link "Build apps (`/build`)", and a decided doc outranks a unit spec; the page owner prints the same label, and `naming-canon.md` §2.10 carries **Build apps** as the one label.
- **Icon: `Hammer`**, which this unit already used. `Wrench` belongs to the Teams **Tools** row, and one icon serves one concept app-wide. Connections keeps `Cable` so Integrations keeps `Plug` and no two rows carry the same glyph.

Audiences on these three rows are the access table's, in every case, because `settings-architecture.md` says its §7.1a table "is flagged to the access spec, which owns the final word": **Marketplace** renders for every Member, with a status line in place of the install switch for anyone who cannot install; **Integrations** renders for every Member, who browses and requests while connecting stays Owner and Admin; **Build apps** renders for Owner and Admin only. The section renders only when at least one of its rows renders, so a Member sees a two-row APPS section and an org that hid all three in Settings › Apps sees none.

Section 3's rows load with the counts below; three 36px skeleton rows on first load; `emptyLine` "No chats yet"; error line "Couldn't load chats · Try again". Row hover reveals one 32px "…": **Rename**, **Pin** / **Unpin**, separator, **Archive** (destructive ghost).

**Where the sidebar's live data comes from.** One call, so a hub sidebar never fans out: `GET /api/ai/sidebar` (new), returning

```ts
{
  chats: Array<{ id: string; title: string; pinned: boolean; updatedAt: string }>;  // 15 most recent, pinned first
  chatsTotal: number;                 // drives the "See all chats" ghost row (> 15)
  agentsEnabled: number;              // row 2's count: installed agents with status ENABLED
  workflowsActive: number;            // row 4's count: workflows with status ACTIVE
  runsFailed24h: number;              // row 6's dot: > 0 renders Dots unread
}
```

It reads the same tables as `GET /api/sidekick/sessions`, `GET /api/agents` and `GET /api/automation/runs`, scoped by the same `requireCan` calls, and returns zeros for a field whose app is not visible to the viewer (a Member never learns an org-wide number their sidebar would not show anyway). Refetched on window focus, after any mutation in this unit, and on the chat stream's `done` event. No poller.

**Where the sidebar's per-viewer state lives.** Section collapse persists in `UserPreference.sidebar.collapsedSections[]`, the shell's key (`spec-shell.md` §1.2 rule 11), keyed `ai.chats`, `ai.automation`, `ai.apps` to match the `{hub}.{section}` shape `sidebar.sectionsOrder` already uses. `spec-work-home.md` §1 writes the same mechanism as `sidebar.groups.favorites`; the two namings are flagged to the shell unit, which owns the key, and this spec follows the shell's.

The CHATS section is what replaces the in-content 280px session rail on `/sidekick` (`.os-chat` grid, `os.css:3353`), which had no breakpoint and made the page unusable on a phone. Chats now live where a user already expects a list of conversations, exactly like Talk's channels.

Deleted with this: `AiSidebar` (`apps-catalog.tsx:1021-1048`), the `automation` app's `linksSidebar(...)` (`:1389-1399`), both `requiredAccess` entries, the `/sidekick/history` and `/sidekick/prompts` rows, and the `Sparkles`-for-Agents icon collision.

### 1.3 Naming canon

| The one label | Destination / surface | Labels it replaces |
|---|---|---|
| **Ask AI** | the assistant: `/sidekick` page, the ⌘J panel, the page-header slot, the palette row, the Create-menu row | Sidekick, Brain, AI Engine, Create with AI, Super Agent, "Ask the Brain" |
| **Agents** | `/agents`; one row = an agent, "an AI teammate that does a job on a schedule" | Super Agent · Hot, Hire, Hired, AI teammates |
| **Workflows** | `/automation/workflows`; one row = an automation | Autopilot, Rules, Automations (as a page name), "Manage" |
| **Templates** | `/automation/templates` | starter recipes, Browse recipes |
| **Logs** | `/automation/logs` | Activity, Run log, Execution log |
| **Health** | `/automation/health` | (no drift today) |
| **Usage** | `/automation/usage` | Billing, Limits |
| **Connections** | `/automation/connections`; "where automations send things", today the webhook | Integrations (as a name for this page), Connectors, Providers |
| **Integrations** | `/integrations` (tools-misc unit's page); the catalogue of other people's tools every Member browses and can ask for | Connect apps, Integrations marketplace, App marketplace |
| **Marketplace** | `/store` (tools-misc unit's page) | Store, Product Store |
| **Build apps** | `/build` (tools-misc unit's page); the label `settings-architecture.md` §5.3 and `naming-canon.md` §2.10 print | Build, Vibe, Studio |
| **Automation** | the sidebar section label and the breadcrumb crumb | Automation Hub, Autopilot |
| **New automation** | the blue button on Workflows | New rule, Create workflow, + Automation |
| **Alert level** | the workflow field today called "Severity (for Health)" | Severity |
| **Archive** | what the chat and workflow destructive action actually does | Delete (the word the UI used while the API archived) |

"Sidekick" survives only in the URL and in internals (`ChatSession`, `/api/sidekick/*`, `toolsForSession`). No user-visible string says it. The in-app strings "AI Engine", "Super Agent", "Hot" and "Create with AI" are deleted from `create-menu.tsx`, `dashboard-content.tsx` and `title-bar.tsx`.

### 1.4 Access

Vocabulary is the access spec's only: org roles Owner / Admin / Member / Guest (+ the Agent flag, + the People team), object roles Full access / Can edit / Can comment / Can view.

| Surface | Who reaches it | Rule |
|---|---|---|
| The AI hub itself (`app` key `ai`) | every Member (Owner, Admin, Member, Agent flag included). **Never a Guest.** | access §5.2.1 row `ai` |
| `/sidekick`, the Ask AI panel | every Member. Sessions are the viewer's own (`ChatSession.userId`); nobody, Owner included, reads another person's chats. | access §5.2.1; §2.5 (the run acts as the viewer, cap Can edit) |
| `/agents` read | every Member | `can(viewer, "view", { type: "app", key: "ai" })`; access §5.2.1 row `ai` |
| `/agents` add, enable, pause, schedule, run now, remove | Owner and Admin | `requireCan("manage", { type: "settings", page: "apps" })`, which resolves through the access §9 gate rule `settings.manageIntegrations`. See the note below. |
| `/automation/*` read (workflows list, templates, logs, health, usage) | every Member. Every Member holds **Can view** on the workflow list (access §3.3 "Automation workflow: creator Full access; Admin Full access; every Member Can view the list"). | access §5.2.1 row `automation` |
| Create an automation | every Member, Agent flag included (`org.create_automation`) | access §5.2.1, §5.1 `OrgAction` |
| Edit, publish, activate, deactivate, rename, archive a workflow | its creator (Full access), Owner, Admin | access §3.3, §4 rule 5 and rule 4 |
| Duplicate a workflow | every Member (the copy is a new object they own) | `org.create_automation` |
| Retry a failed run | anyone who can edit that workflow | access §4 rule 13 (`edit`) |
| Connections (read and write) | Owner and Admin, or an Admin holding the `security` scope where a credential is minted | access §9 `settings.manageIntegrations` |
| `/store` | every Member browses; installing is Owner and Admin, and a viewer who cannot install reads a status line where the switch would be | access §5.2.1 (the access table wins over `settings-architecture.md` §7.1, which flags its own row to it) |
| `/integrations` | every Member browses; connecting is Owner and Admin | access §5.2.1 row `integrations` (page owned by tools-misc) |
| `/build` | Owner and Admin only. A Member gets the in-shell 404, not `AppOff`, because `AppOff` would confirm the app exists | access §5.2.1 (the access table wins over `settings-architecture.md` §7.1) |

**Agents have no ObjectType, and do not need one.** `access-model-spec.md` §5.1's `ObjectRef` union has no `agent` member and §5.2.1 has no `agents` row, so this unit does not invent either. An agent is an org-level install, exactly like installing a Marketplace app or connecting an integration, and access §9 already covers that shape: "Owner/Admin to connect or install an integration or Marketplace app (`POST /api/integrations/*`, `/api/products/installations`)". So every agent write is one named call, `requireCan("manage", { type: "settings", page: "apps" })`, and the reads are the `ai` app key. The one thing flagged to the access unit is a wording change, not a new concept: add `/api/agents/*` to that gate rule's list of named call sites, so `POST /api/agents/[slug]/install`, `PATCH /api/agents/[slug]`, `PATCH` and `POST /api/agents/[slug]/schedule` and `DELETE /api/agents/[slug]` sit beside the two routes already named. Until that lands the wrapper delegates to today's `install/route.ts:24` admin check, so behaviour does not change on merge. Nothing in this unit adds an app key, an `ObjectType` or a permission cell.

**`settings.data.aiEnabled` is a feature switch, not an access input, and the conflict is recorded rather than papered over.** An earlier draft made it a hard access gate on the whole AI hub. No rule in the access model supports that: rule 2 short-circuits on modules and the Apps config only, §5.2.1's `ai` row says "every Member" with no qualifier, and `settings-architecture.md` carries `aiEnabled` only as a Retention and privacy row ("AI features for members", default on, §5 Data). Access wins on access, so:

- The flag never appears in a `can()` decision and never changes a `Decision.role`.
- This unit asks the access unit for **one line** inside rule 2, which is where every app-level short-circuit already lives: *the `ai` app key also resolves off when `settings.data.aiEnabled` is false.* That gives one mechanism, one denial component (`<AppOff app="ai">`) and one API body (403 `{ error: "app_off", app: "ai" }`), instead of a second concept.
- If the access unit declines that line, the fallback shipped is smaller and needs nobody's permission: `aiEnabled` off stops the assistant server side, `/sidekick` renders its landing with one 44px `--os-ink-2` row "AI is turned off for this workspace." in place of the composer, the page-header Ask AI slot is empty, and ⌘J does nothing. The automation pages are untouched either way, because automations are not AI.

Every route block below writes "the `ai` app is off or `aiEnabled` is off" as one denial, which is true under either outcome.

`AutomationRole`, `resolveAutomationContext` and `canManageAutomations` (`src/lib/automation/hub-access.ts:39-43`) are **deleted**. Every `/api/automation/*` route calls `requireCan("view" | "edit" | "manage", { type: "automation", id })` or `requireCan("create_automation", org)`; every page calls `gatePage`. The "manager tier" that gates the sidebar today does not exist in the access model and does not survive.

Runs act as a person: an automation run and an agent run carry `Viewer.actingAs = { type: "agent" | "cron", id, cap: EDIT }` and resolve at `min(actingFor's live level, Can edit)` (access §2.5). A workflow therefore never reaches further than its creator, and a demoted creator's workflows quietly stop being able to write. Every automation and agent write logs `ActivityLog.actorType` with `actingForId`.

**Read-only mode** (access §5.4): a control the viewer's role cannot use is **not rendered**, never disabled. Concretely, and this retires audit issue 14 and critic #4:

- Workflows list: a Member who did not create a row sees the row, its status and its stats; the row "…" holds only **Duplicate** and **View logs**. No checkbox on that row, so the bulk bar can never offer an action they lack.
- Builder opened by a Member on someone else's workflow: the sentence renders as text (tokens are plain chips, not buttons), the Details panel is read-only, there is no Save draft, no Publish, no Active switch, no delete. One slim banner under the header: "View only. Ask {creator} for edit access." with **Request access** (access §5.6).
- Templates: "Use this" renders for every Member (it creates their own draft), so nothing is hidden there.
- Connections: for a Member the page does not render at all (the sidebar row is absent; a typed URL gets `LockedPage`) - see the denial rules below.
- Usage: the **Top people** table renders only for Owner and Admin; everything else on the page renders for every Member. See the note under `/automation/usage`.
- Logs: "Retry failed steps" renders only when the viewer can edit that workflow **and** every failed step is `safeToRetry`.
- Agents: for a Member the toolbar's right side is empty, the drawer shows the agent's description, schedule and run history as text, and the Enabled / Autonomous switches are absent.

**Denial, one convention** (access §5.5):

1. Not signed in: `/login?callbackUrl=<current>`. The only redirect.
2. A Guest on any URL in this unit: `notFound()` inside the shell (Guests never discover the AI hub).
3. The `ai` app hidden or floored for this viewer by Settings › Apps & modules (or `aiEnabled` off, under the rule-2 line requested above): **`<AppOff>`**, rendered by the hub layout before any object loads; Owners and Admins get a link to `/settings/apps`, Members get "Ask an admin" with the Owner and Admin avatars. API returns 403 `{ error: "app_off", app: "ai" }`. `<AppOff>` is used here and only here, in its defined meaning: an app key turned off by the Apps config (access rule 2 and §5.5 item 6). It is never used for a role.
4. The `automation` app hidden or floored: the same `<AppOff>`, with `app: "automation"`, from `(dashboard)/automation/layout.tsx`.
5. A Member on `/automation/connections`: this is a role denial, not an app denial, so it is **`LockedPage`** at the same URL (access §5.5 item 3), with the page icon and name, the Owner and Admin avatars, one sentence from `decision.reason` ("Connections are managed by workspace Owners and Admins."), and `BackButton{fallbackHref="/automation/workflows"}`. Request access is not offered, because the answer is a role change, not an object grant, so the primary reads "Ask an admin" and is inert-free: it opens the same Owner and Admin list the avatars show. No redirect, no bounce to `/dashboard`. The settings-shaped variants of this component, `AdminOnly` (an Admin on an Owner-only page without the scope) and the Ask-an-admin strip, belong to `/settings/*` and are not used by this unit, which owns no settings page.
6. Signed in, has a role, but not this action (a stale tab, a direct API call): the API returns 403 with the reason and the client shows one toast "You need Can edit for that. Ask {creator}." with **Request access**.
7. A workflow id from another org: `notFound()`, body identical to a real 404.
8. A Member on `/build` (this unit renders the row, the tools-misc unit renders the page): the **in-shell 404**, with no sidebar row above it. Not `AppOff`, which would confirm the app exists, and not `LockedPage`, because there is no object and so nobody to request from.

So this unit uses exactly three of the family: `<AppOff>` for an app key that is off, `LockedPage` for a role that is not enough on an object the viewer can discover, `notFound()` for a Guest, a cross-org id or an app key the viewer's rule excludes. Nothing else, and no invented variant.

**Which of the three shapes applies, stated once so nobody applies the wrong one** (six units reached three different answers for the same question; all three are correct because they are three different situations, access §5.5):

| Situation | Shape |
|---|---|
| An app key the viewer's rule excludes (here: `/build` for a Member) | the in-shell 404, with no sidebar row. Rule 6: no object, so nobody to request from |
| A **view** of a page the viewer already holds (elsewhere `/planner?calendar=team`, `/timesheets?view=approvals`) | render the default view, strip the parameter with `router.replace`, show one 13/400 notice line. Rule 4 |
| An **object** the viewer can discover but holds no role on (here: someone else's workflow above Can view) | `LockedPage` with **Request access**. Rule 3 |

`AppOff` is only for an app the org hid or floored, and `ModuleOff` only for a premium module switched off. Neither is ever used for a role. `teams-people`'s two app-key `LockedPage`s on `/team` and `/team/workload` are the single sanctioned exception to the first row and are flagged to the access unit by that unit; nothing in this unit copies the exception.

`requireManagerOrRedirect` (`ai/layout.tsx`) goes with the `/ai` page, which is deleted in §0. The other manager-tier gate in this hub's URL space, `src/app/(dashboard)/integrations/layout.tsx`, also calls `requireManagerOrRedirect()` and is deleted by the **tools-misc unit** (`spec-tools-misc.md` §1 denial rules and §4 step "Delete `tools/layout.tsx`, `assets/layout.tsx` and `integrations/layout.tsx`'s `requireManagerOrRedirect`"), because that unit owns the page. It is named here so the sweep is complete: after both units ship, no route under the AI hub redirects a denial anywhere. `/dashboard` as a denial target is deleted.

### 1.5 Back and close

| Surface | Back / close target |
|---|---|
| `/automation/workflows/[id]` | `BackButton{fallbackHref="/automation/workflows"}` in the title row, label "Workflows", 28px ghost with `ArrowLeft`. Real history first, the fallback second. The hard `<Link href="/automation/workflows">` chevron at `[id]/page.tsx:928` goes, so arriving from Logs, Health or a Template returns you there. |
| Version history modal (builder) | ✕, Esc, outside click; returns to the builder. |
| Logs run drawer | ✕, **Esc**, and clicking the dimmed list. Closing drops `?runId` and leaves `/automation/logs` with its filters intact. |
| Agent drawer | ✕, Esc, dimmed-list click. Closing drops `?agent` and returns to `/agents`. |
| Agent run detail (the expanded run inside the agent drawer, `?agent=<slug>&run=<id>`) | its own ✕ and Esc collapse the run back to `?agent=<slug>` with the drawer still open; a second Esc closes the drawer. Arriving straight from a deep link, ✕ and Esc collapse to the drawer, so there is never a dead end. |
| Ask AI panel | ✕ in its own 48px header, **Esc**, or ⌘J. Focus returns to whatever opened it. The session stays alive. |
| All chats view (`/sidekick?view=all`) | `BackButton{fallbackHref="/sidekick"}`, label "Ask AI". |
| Add agent modal, Rename dialogs, Archive confirms, Restore version confirm | Cancel, ✕, Esc, outside click. A dirty form confirms first. |
| Every hub landing (`/sidekick`, `/agents`, the five automation list pages) | no back affordance: they are hub pages reached from the sidebar. The top-bar ‹ › and the breadcrumb are the shell's. |

Esc order on any screen: close the topmost overlay (modal, then drawer, then panel, then popover). Esc never navigates.

**Dirty guard**: `useDirtyGuard(isDirty)` from `src/hooks/use-dirty-guard.ts` (settings spec §8.5) is mounted by the builder with its existing `dirty` flag (`[id]/page.tsx:588`). While dirty it arms `beforeunload` and intercepts the BackButton, the breadcrumb crumbs, every sidebar row, the rail and in-page tab switches with a 400px confirm: title "Save your changes?", body "This automation has changes you have not saved.", buttons **Keep editing** (ghost), **Discard** (destructive ghost), **Save** (primary). A failed save keeps the form dirty and re-arms the guard. This closes audit issue 8 and critic #7.

### 1.6 Mobile and narrow

Breakpoints: 1280, 1024, 900, 640.

- Under 1024 the hub sidebar collapses to the rail (shell rule) and the top bar's breadcrumb shows the last two crumbs.
- The **Ask AI panel** keeps the shell's container rule at every width: 360 at the inline end, it **pushes content and never overlays**, and it never sits on a `--os-scrim` (`spec-shell.md` §2.1 owns the container; `design-system.md` §1.2 reserves `--os-scrim` for modal backdrops, "drawers dim, they do not scrim"). Below 1024 there is not enough width for a 360 panel beside the content, so **the panel does not render**: ⌘J navigates to `/sidekick` instead of toggling, and the page-header Ask AI slot does the same. Nothing overlays, nothing squeezes `<main>` (the `os.css:1217` squeeze goes), and the person lands on the full page, which is the surface designed for a narrow column. This is one row this unit asks the shell unit to add to `spec-shell.md` §1.16's width table, and it is listed in §4 with the other shell dependencies.
- The **builder**'s Details panel stops being `hidden lg:block`: under 1024 it stacks under the "Then" section as a normal section titled "Details", so Description, Alert level, Published, Last run, Versions and Recent runs are always reachable. This is audit issue 16 and critic #10.
- Every list page's `TableCard` scrolls horizontally inside its own `overflow-x: auto`; the page body never scrolls sideways. Under 900 the card drops to the Name, Status and one contextual column; the rest move into the row's drawer or the "…".
- The **templates** grid is 3 columns at 1280, 2 at 900, 1 below (the fixed `repeat(3, 1fr)` at `os.css:3038` goes).
- The **logs drawer** is `min(520px, 100vw)`.
- The Ask AI thread column is `min(720px, 100% - 32px)`; the composer is sticky to the bottom of the viewport on touch.
- No hover-only affordance carries meaning: the row "…" is reachable by keyboard focus and, on touch, is always visible at the row's end.

### 1.7 Per-viewer view state: every visible setting persists

Four surfaces in this unit let a person change how a list looks. Each of those choices is a visible setting, so each has a home, and none is in-memory or `localStorage`. They reuse the shape `settings-architecture.md` §9.2 already defines for `TaskListSurface`, `UserPreference.home.work.surface.{key}` holding `{ columns, sortKey, viewOptions }`, written debounced 400ms through `PATCH /api/preferences` and read on mount:

| Surface | Key | What it holds |
|---|---|---|
| Workflows list | `home.work.surface["automation.workflows"]` | `columns` (Trigger, Last run, Success, Created by, Where), `sortKey` (Last updated, Name, Last run, Success rate), `viewOptions.showArchived` |
| Logs list | `home.work.surface["automation.logs"]` | `columns`, `sortKey` (Newest first, Oldest first), `viewOptions.pageSize` (25, 50, 100) |
| Agents Run history | `home.work.surface["agents.runs"]` | `sortKey`, `viewOptions.pageSize` |
| All chats | `home.work.surface["sidekick.allChats"]` | `columns`, `sortKey` |

Two things are deliberately **not** stored: the status view (`?status=`), the filter chips, the Health window and the Usage month, because those are URL state and a shared link must carry them. The one thing flagged to the settings unit is that the `home.work.surface` namespace, written for the Work unit, now takes keys from other hubs; the schema does not change, only the set of keys that is `.strict()`-valid.

**Coming soon, in this unit.** This unit renders `ComingSoonRow` in exactly zero places. `design-system.md` §5.19 and `spec-shell.md` §1.15 render that component only when `UserPreference.home.ui.showUpcoming` is on, and it is **off by default** (`settings-architecture.md` §4 Personal preferences), so a list of unbuilt things rendered as `ComingSoonRow`s is invisible to almost everyone and cannot be the home of content a person needs. Concretely:

- The catalogue of connectors people want is the `/integrations` page, which is always rendered and always actionable (Request this), not a hidden row list. That is why §0 stopped merging it into Connections.
- In the builder's action `Picker`, an action whose backend is not wired is **absent**. With `showUpcoming` on it renders as a non-selectable row with a neutral "Coming soon" chip and the tooltip "Not built yet", so `send_whatsapp` is either invisible or honest and never a trap.
- The "Not live yet" chip on a trigger that does not emit yet is **not** a Coming-soon control and is not gated by the preference: the trigger is real and selectable, and the chip plus its one explanatory line is telling the truth about a thing the person is allowed to pick.

### 1.8 Reference screens

`phase2-inputs.md` §1.5 asks for a cited reference screen for every new surface. These are the ones this unit designed against. They are references for structure and density, never for colour or chrome, which come from the design system.

| New surface here | Reference | What is taken |
|---|---|---|
| Ask AI landing (`/sidekick`) and the CHATS sidebar section | [Dropbox Dash](https://mobbin.com/screens/824a3c3d-e26f-4916-9df1-963eb0eca8f5) | one headline, one centred composer, a single row of starter actions, and a "Chats" section in the left sidebar rather than a second in-content rail |
| Workflows list (`/automation/workflows`) | [Plain, Workflows](https://mobbin.com/screens/e99c7a44-b742-4c4a-826f-260624189fa9) | a plain bordered table with Name, Created by, Last updated, a pale status chip, Trigger and Last triggered, a row "…" and one button at the top right; no cards, no tiles |
| Agents table and the agent drawer (`/agents`) | [Devin, automation detail](https://mobbin.com/screens/bac9ca94-ae48-472b-8272-b85cec4e9f56) | a single Active switch at the top, the schedule stated in words ("Weekly on weekdays at 3:00 PM"), a plain instructions textarea, and the run history in the same panel |
| Add agent modal | [Magnific, model picker modal](https://mobbin.com/screens/20f7ca1a-83d3-4a7b-85c4-278d0c2d0a88) | a modal of uniform rows, name plus one line, one control per row, a search field at the top; no tiers and no pricing |
| Connections form (`/automation/connections`) | [Basecamp, Add a new webhook](https://mobbin.com/screens/d80a1080-0e78-4348-985c-d475003a6240) and [Canny, API and webhooks](https://mobbin.com/screens/125cbbf9-7d3c-4355-9d6c-0223592f8f34) | a narrow settings column, one Payload URL field with a sentence explaining what gets sent, the secret shown as a field with a copy affordance, and the action under the card |
| Run history and the run detail | [HoneyBook, Automations › Activity](https://mobbin.com/screens/dedf99d2-7e6c-4881-9018-428c77f47911) | run start, what ran, current step and a status chip as columns, with the detail behind the row |

---

## 2. Route specs

---

### `/sidekick`  (`src/app/(dashboard)/sidekick/page.tsx`)

**Purpose.** Ask the assistant to find, summarise or create something in your workspace, and keep the conversation.

**Who sees it.** Every Member (Owner, Admin, Member, Agent flag), per access §5.2.1 row `ai`, with no further qualifier. Never a Guest. The org setting **AI features for members** (`settings.data.aiEnabled`, Settings › Workspace › Data › Retention and privacy) is a feature switch, not an access input: when it is off the assistant does not run, and §1.4 states exactly what the screen shows under each of the two outcomes of the rule-2 line this unit has asked the access unit for.

**Entry points.** Rail AI (the hub `defaultHref`); sidebar row Ask AI; sidebar "+" → `?new=1`; the ⌘J panel's "Open full page" ⤢; the page-header **Ask AI** slot on any page (opens the panel, not this page); the Create menu row "Ask AI"; the command palette row "Ask AI about '{q}'" → `?q=`; the Favorites page's pinned-chat cards → `?pinned=1`; a chat row in the sidebar → `?session=`; an agent's drawer "Open chat" → `?agent=<slug>&new=1`; deep links to any of the above.

**URL states** (all URL-derived, none sticky):

| URL | Content state |
|---|---|
| `/sidekick` | Landing, or the tab's live session if the panel already has one (§2 Ask AI panel) |
| `/sidekick?new=1` | New session, landing composer focused |
| `/sidekick?session=<id>` | That session's thread. **Honoured** (today it is ignored, audit issue 5) |
| `/sidekick?q=<text>` | New session, the text sent immediately. **Honoured** (today it is ignored, audit issue 4) |
| `/sidekick?agent=<slug>` | New session bound to that agent (`POST /api/sidekick/sessions { agentSlug }`); the title row reads "{Agent name}" |
| `/sidekick?view=all` | All chats list |
| `/sidekick?pinned=1` | All chats list filtered to pinned (implies `view=all`) |
| `/sidekick?view=all&archived=1` | All chats list filtered to archived |

**Top bar** (shell). Left: ‹ ›, breadcrumb **AI › Ask AI** (thread state adds the session title as the last, non-clickable crumb, truncated at 160px). Centre: global search. Right: "+", bell, help, avatar. No Ask AI pill on the bar (the shell spec removed it; ⌘J and the page-header slot replace it).

**Secondary sidebar.** AI hub. Active row: Ask AI, or the matching CHATS row in the `?session=` state. Groups expanded: CHATS and AUTOMATION open, APPS collapsed (the §1.2 defaults), each overridden by the viewer's own `sidebar.collapsedSections`.

**Page header stack.**

- **Title row (48)**: title 22/600 = the session title, "Ask AI" in the landing state, "All chats" in the list state (there `BackButton{fallbackHref="/sidekick"}` precedes it). No star, no avatar stack, no description line. Right, ghost only: in the thread state a 32px "…" holding **Rename**, **Pin** / **Unpin**, **Copy link**, separator, **Archive** (destructive ghost). No Share, no Invite, no Ask AI slot (you are on it).
- **Views row**: does not render (one view, no "+ View"), except in the All chats state where three text-tab pills render: **All** · **Pinned** · **Archived** (URL `?view=all`, `&pinned=1`, `&archived=1`).
- **Toolbar row**: does not render in the landing and thread states. In the All chats state it renders with the one blue button **New chat** on the right.

Chrome above the first pixel of content: 48 + 48 = 96 (thread and landing), 48 + 48 + 36 + 44 = 176 (All chats).

**Body layout.**

*Landing state* (no session), centred in a 720 column, 64px top margin:
1. Headline "What can I help with?" 22/600 `--os-ink`. No greeting, no name, no time of day (the hardcoded "Good morning, BigBold." goes).
2. One 13/400 `--os-ink-2` line: "Ask AI can only see the work you already have access to."
3. Six **starter prompts** as 36px secondary buttons in a wrapping two-column grid, each tied to a registered tool so it actually works: "What is due for me this week?" (`search_tasks`), "Summarise what my team finished last week" (`get_team_alignment_rollup`), "Create a task from this note…" (`create_task`), "Where do I stand on my KPIs?" (`list_my_kpi_status`), "Find the SOP for…" (`search_sops`), "Give kudos to…" (`send_kudos`). Clicking one **sends** it (today they only prefill, which is why `/ai`'s templates felt dead).
4. The composer (below).

*Thread state*, 720 column:
- Each user turn: a `--os-surface-1` block, radius 8, padding 12 16, max 560, aligned to the inline end, 14/20. No avatar, no initials (the hardcoded "BB" goes).
- Each assistant turn: plain prose on the canvas at `--os-t-prose` 15/24 via `OsMarkdown`, preceded by a 16px `Sparkles` in `--os-ink-2`. No bubble, no avatar.
- **Tool calls** render as 36px rows above the answer they belong to: the concept's own icon at 16px (`CheckSquare` for a task, `ScrollText` for an SOP, `Trophy` for a goal, `Search` for any search, one icon per concept app-wide), a past-tense sentence with the real subject ("Created task 'Fix invoice PDF'", "Searched 42 tasks"), the created object's name as a link when the tool returned an id, and the duration as 12/500 `--os-ink-2` after a middle dot. A failed call reads "Couldn't create the task" in `--os-danger-text` with the server's message on the second line. Every remaining tool has an entry: the map covers the trimmed registry exactly, and the registry is trimmed to the PPMS set. `src/lib/agents/tools.ts` registers **42** tool names today, not the 40 the inventory states, and **14** of them are CRM, helpdesk or marketing verbs that left the product scope: `create_lead`, `create_opportunity`, `create_ticket`, `create_support_ticket`, `create_campaign`, `search_leads`, `search_opportunities`, `search_tickets`, `update_lead_status`, `update_ticket_status`, `move_opportunity_stage`, `apply_macro`, `search_kb` and **`assign_ticket`**, which the earlier list missed. Removing all 14 leaves **28**: `create_contract`, `create_data_table`, `create_doc`, `create_form`, `create_kpi`, `create_kra`, `create_meeting`, `create_okr`, `create_sop`, `create_sprint`, `create_task`, `create_workspace`, `get_team_alignment_rollup`, `invite_person_with_role`, `list_data_tables`, `list_forms`, `list_my_kpi_status`, `list_my_kras`, `list_my_sops`, `list_my_weekly_reviews`, `search_contracts`, `search_employees`, `search_meetings`, `search_okrs`, `search_sops`, `search_tasks`, `send_kudos`, `update_contract`. `ToolCallRow`'s verb map is typed against that list of 28, so a missing entry is a compile error and a helpdesk verb cannot survive the trim (audit issue 27).
- While streaming: `Dots pending` under the last row, no overlay, input stays live.
- Composer, sticky at the column's bottom: `--os-surface` card, `1px solid var(--os-line-strong)`, radius 8, padding 12; textarea 14/20 auto-growing 1 to 8 rows, placeholder "Ask about your work…"; Enter sends, Shift+Enter newlines. Bottom row inside the card: left 13/400 `--os-ink-2` "Sees only what you can see."; right the **Send** button, 32px square `--os-brand` with a white 16px `ArrowUp`, tooltip "Send · Enter", `aria-label` "Send". While a response streams the Send button becomes a 32px ghost holding the `Dots pending` loader. Send is the page's one blue thing.
- **Removed from the composer**: the Paperclip "Attach" with no handler, the hardcoded "Sonnet 4.6" model label with its green dot, and the kbd hint clutter. The model is an org setting (Settings › Workspace › API & webhooks › AI keys, Enterprise `byok` flag) and is never a per-message control.

*All chats state*: a `TableCard`. Columns: ☐ | **Chat** (title 15/500, link) | **Last message** (relative time) | **Messages** (count, right aligned, `tnum`) | **Pinned** (a 16px `Pin` when pinned) | row "…" (Rename, Pin / Unpin, Archive, or Restore in the Archived tab). Footer "Total records N · 1 to 40" with ‹ ›. Bulk bar at two or more selected: "3 selected", Pin, Archive, ✕.

**Side panel / drawer / modal.** Rename dialog (400, one input, Save). Archive confirm (400, "Archive this chat?", body "You can restore it from All chats › Archived.", Archive destructive). No drawer on this route.

**States.**

| State | Render |
|---|---|
| Loading | Route transition: the rail logo's four dots pulse after 200ms; the content shows three skeleton bars at the thread's rhythm and one 13/400 `--os-ink-2` rotating value line under the first (`ValueLoader`'s new form). The CHATS sidebar section shows three skeleton rows. No spinner, no "Loading messages…" text. |
| Empty | No chats yet: the landing state itself is the empty state (headline + starters); there is no separate illustration. All chats with nothing: four dots in a row + "No chats yet" + text link "Start a chat". |
| Error | Session list fails: the sidebar shows "Couldn't load chats · Try again". Thread fails: an inline 44px row "Couldn't load this chat · Try again" in the column, never a silent "No chats yet" (today the error is swallowed, `page.tsx:99-101`). Stream fails: the assistant turn is replaced by a 36px `--os-danger-text` row "The answer stopped. Try again." with a **Try again** text link, and **the user's message stays in the thread and the draft is restored to the composer** (today both are lost). |
| Read-only | Not applicable: a person only ever sees their own chats. |
| Denied | Guest: 404 in the shell. `ai` app off or floored: `<AppOff>` (§1.4 item 3), Owners and Admins get the link to `/settings/apps`, Members get "Ask an admin". AI features for members off: the same `<AppOff>` under the requested rule-2 line, whose reason sentence reads "AI is turned off for this workspace." and whose link for Owners and Admins is Settings › Workspace › Data; under the fallback it is the in-page 44px row named in §1.4. No third component either way. |
| Offline / session expired | The shell's 32px offline strip disables Send with the strip's own message; the shell's session-expired dialog handles a lapsed token. An in-flight stream that 401s surfaces that dialog rather than an empty thread (critic #11). |

**Keyboard.** ⌘J: when the panel is open it closes; when this page is open ⌘J focuses the composer instead of opening a second thread, so two threads are never on screen. That is a **page-scoped override of the shell's global ⌘J toggle** (`spec-shell.md` §1.8 registry row "⌘J Ask AI panel (toggle)"), so it is one of the shell requests listed in §4, and it registers through the shell's own per-page mechanism, which is what puts it in the ON THIS PAGE group of the shortcuts overlay. Enter send, Shift+Enter newline, Esc blurs the composer then closes any overlay, ⌘K search, ⌘3 jumps to the AI hub, `?` shortcuts overlay.

**Data.** Existing: `GET/POST /api/sidekick/sessions`, `GET/PATCH/DELETE /api/sidekick/sessions/[id]` (PATCH already does rename and pin, DELETE already archives), `POST /api/sidekick/chat/stream` (SSE: `user_message`, `text_delta`, `tool_use`, `tool_result`, `done`, `error`). New: `GET /api/sidekick/sessions?archived=1&cursor=&take=` returning `{ sessions: Array<{ id, title, pinned, archived, messageCount, updatedAt }>, total, nextCursor }` (the All chats table's footer count and pages are real), `PATCH /api/sidekick/sessions/[id] { archived: false }` (restore), and `GET /api/ai/sidebar` (§1.2, shared with every route in this hub). Settings read: `settings.data.aiEnabled` (feature switch, §1.4); `home.work.surface["sidekick.allChats"]` for the All chats columns and sort (§1.7); the BYOK model from `OrgSecret` through `lib/ai-client.ts` (read, never shown as a control).

**Realtime.** The SSE stream is the only live channel. On `done`, the sidebar CHATS section refetches so the new chat's title appears without a reload. No polling is added.

**What changes vs today.**
- The 280px in-content session rail is deleted; chats move to the hub sidebar (fixes the missing mobile layout, audit issue 23).
- `?session=`, `?q=` and `?agent=` are honoured (audit issues 4, 5).
- The hardcoded greeting, the "BB" avatar, the "Sonnet 4.6" label, the dead Attach button and the title bar's dead Ask AI / Share / Invite trio and always-filled star are all deleted (audit issues 11, 12; critic #2).
- Delete becomes **Archive** with a real Archived tab and Restore, so the word matches the behaviour (audit issue 12).
- Rename and Pin exist here, not only on Favorites (audit issue 12).
- Session-list loading and error states exist (audit issue 12; critic #11).
- Starter prompts run instead of prefilling, and they are six real, tool-backed prompts instead of three competing curated lists (audit issues 4, 21).
- The visual system moves from `os.css` gradients and per-category hues to the tokens; `.os-chat__new`'s brand gradient (`os.css:3373`) and the `.os-sk` brand flip (`os.css:31807`) go (audit issue 22; critic #6).
- Both grouping vocabularies (Today / This week / Older on the page, Today / Yesterday / Older in the panel) collapse into one ordering in the sidebar: pinned first, then most recent.

**Open questions.** None for this route.

---

### Ask AI panel (non-route surface, `src/components/layout/os/sidekick-panel.tsx`)

Listed here because it shares this route's session and its content is this unit's, while its container belongs to the shell (spec-shell §2.1: 360px, inline-end, pushes content, own 48px header, `sidekickOpen` per session).

**Purpose.** Ask the assistant without leaving the page you are on.

**Who sees it and entry points.** Every Member. ⌘J; the page-header **Ask AI** slot (design system §4.4, rendered only when the `ai` app is visible and `settings.data.aiEnabled` is on, otherwise the slot is empty, never a disabled button); the palette row "Ask AI about '{q}'"; the Create-menu row **Ask AI**; task detail and board headers' "Ask AI" action; the doc editor's "Ask AI". Below 1024 none of these open the panel; they navigate to `/sidekick` (§1.6).

**Top bar.** None: the panel sits beside the content column under whatever top bar the underlying route renders, and changes nothing on it.

**Secondary sidebar.** None of its own. The underlying route's hub sidebar stays exactly as it was, including its active row, because opening the panel is not a navigation.

**Page header stack.** None: the panel is not a page. Its own 48px header, below, is the whole of its chrome.

**Header (48).** Title "Ask AI" 15/500, then, right, three 32px ghost icon buttons with tooltips: **New chat** (`Plus`), **Open full page** (`Maximize2`, navigates to `/sidekick?session=<id>` and closes the panel), **Close** (`X`). **Removed**: the "Max ▾" model pill, the "More" ••• and the History toggle (history is the hub sidebar).

**Body.** Exactly the `AskAiThread` component the page renders, at 360 width with the 720 column rule replaced by "fill". Landing state: the same headline and the same six starter prompts, in one column. Composer identical, minus the "Sees only what you can see." line (it appears once, in the panel's empty state). **Removed**: the "+" Attach with no handler, the "All sources ▾" `<span>`, and the Suggested / Featured / Search lists that advertised image generation, calendar and web search the backend cannot do (audit issue 7; critic #2).

**The one session rule.** `useAiSession()` (§3) is a single store per tab. The panel and the page render the same store. Consequences, which resolve the "two independent chat UIs" problem (audit issue 12, critic #3):
- Opening `/sidekick` while the panel has a live session shows that same thread; the panel closes itself on arrival so two threads are never visible.
- Closing the panel does not end the session; reopening it resumes.
- "Open full page" navigates to `?session=<id>` and the thread continues mid-scroll.
- Page context (`productContext`, `boardContext`, derived from the first two URL segments at session creation, `sidekick-panel.tsx:56-60`) is kept and now applies to the page too, so a chat started from a board carries that board's context either way.

**States.** Loading: three skeleton bars. Empty: the landing. Error: an inline 36px `--os-danger-text` row with **Try again** (the red bubble at `:488` is restyled to this). Read-only: n/a. Denied: the panel and the ⌘J binding do not exist for a Guest, and the page-header slot is empty. Offline: the shell's strip disables Send.

**Keyboard.** ⌘J toggles; **Esc closes** (new); focus is trapped while open and returns to the trigger on close; `aria-hidden` is accompanied by `inert` so focusable children leave the tab order when closed.

**Data.** The same endpoints as the page, and no others.

**Realtime.** The SSE stream only, shared with the page through `useAiSession()`. On `done` the shell refetches `GET /api/ai/sidebar` so the hub sidebar's CHATS section shows the new chat even though the person never left the page they were on. No polling.

**What changes vs today.** The model pill, the "More" •••, the History toggle, the "+" Attach with no handler, the "All sources ▾" `<span>` and the Suggested / Featured / Search lists that advertised image generation, calendar and web search are all deleted (audit issue 7; critic #2). Esc closes the panel, which it does not today. The panel and the page stop holding separate session state, which is what made the same question answerable twice with two different threads (audit issue 12; critic #3). The red error bubble at `sidekick-panel.tsx:488` becomes the standard inline error row. Below 1024 the panel stops existing rather than squeezing the content column (audit issue 23).

**Open questions.** None.

---

### `/ai`  (`src/app/(dashboard)/ai/page.tsx` + `layout.tsx`) - REMOVED

**Purpose (today).** A prompt playground: a hero input, 7 category chips, 12 template cards and a fake "Recent" list.

**Who sees it.** Nobody: the route ceases to exist. Until the redirect ships it is `requireManagerOrRedirect`-gated, which is itself one of the reasons it goes.

**Top bar / Secondary sidebar / Page header stack / Body layout / Side panel, drawer, modal.** None, for all five: the 308 is served from `next.config.ts` before any shell, sidebar or header renders, so this route paints nothing.

**Disposition.** The page and its layout are deleted; `next.config.ts` gains a permanent `/ai → /sidekick` redirect. Nothing on it was wired: every card linked to `/sidekick?q=` which the target ignored, the four "Recent" rows were hardcoded strings with invented model names, and the `requireManagerOrRedirect` gate bounced employees to `/dashboard` from a page containing only prompt text.

**Where its content lives now.** The prompt idea becomes the six starter prompts on the Ask AI landing state, which run for real; `?q=` is honoured; the manager gate is replaced by the `ai` app rule (every Member); the dashboard header CTA "Ask the AI Engine" is relabelled **Ask AI** and opens the panel instead of navigating.

**Entry points to re-point.** `dashboard-content.tsx:301` (the header CTA), the Marketplace category map (`store/page.tsx`), the `ai` `stubModule` row (`catalog.ts:609`).

**States / keyboard / data / realtime.** None: the route ceases to exist, and the redirect is served before any render.

**What changes vs today.** One AI door instead of three (audit issue 1 in §8 of the inventory, issues 4 and 21; critic #1 and #3).

**Open questions.** None.

---

### `/autopilot`  (`src/app/(dashboard)/autopilot/page.tsx`) - REMOVED

**Purpose (today).** A static list of 8 invented workflow rules with a KPI strip, a dead "New rule" button and cards that look clickable but are not.

**Who sees it.** Nobody: the route ceases to exist. Until the redirect ships it has no gate at all, which is how a Member reaches a fake manager cockpit by typing a URL.

**Top bar / Secondary sidebar / Page header stack / Body layout / Side panel, drawer, modal.** None, for all five: the 308 is served from `next.config.ts` before any render.

**Disposition.** Deleted; `next.config.ts` gains a permanent `/autopilot → /automation/workflows` redirect. The legacy `/api/autopilot/workflows` route and the `Workflow` rows with `kind: "AUTOMATION"` are deleted in the same change (the approval-chain use of the `Workflow` model is untouched). `docs/plans/automation-hub.md` is updated so the "leave alone" note does not mislead a future pass.

**Where its content lives now.** `/automation/workflows` holds the real list, with real triggers, real conditions, real actions, real run stats and a real "New automation" button. The four KPI tiles become the Health page's success card and the Workflows footer count.

**Entry points to re-point.** The Marketplace rows (`store/page.tsx:34,51`), the `autopilot` `stubModule` (`catalog.ts:610`).

**States / keyboard / data / realtime.** None.

**What changes vs today.** The duplicate disappears; a Member can no longer reach a fake manager cockpit by typing a URL (audit issue 6; critic #3).

**Open questions.** None.

---

### `/agents`  (`src/app/(dashboard)/agents/page.tsx`)

**Purpose.** Turn on an AI teammate that does a job for you, on a schedule or on demand.

**Who sees it.** Every Member reads (`can(viewer, "view", { type: "app", key: "ai" })`). Owner and Admin add, enable, pause, schedule, run and remove, each through `requireCan("manage", { type: "settings", page: "apps" })` per §1.4's note. Never a Guest.

**Entry points.** Sidebar row Agents; the Work home "Agent runs" card's **Manage** link (the card at `components/dashboard/autonomous-digest.tsx`, which is real and reads `/api/agents/runs`); an agent's name in a run row; the Marketplace category "AI"; deep link. The Create menu's "Super Agent · Hot" row is deleted.

**Top bar.** Breadcrumb **AI › Agents**. Nothing else route-specific.

**Secondary sidebar.** AI hub, row Agents active. Groups expanded: CHATS and AUTOMATION open, APPS collapsed, each overridden by the viewer's `sidebar.collapsedSections`.

**Page header stack.**
- **Title row (48)**: "Agents" 22/600. Right: ghost 32px "…" with **Run history** (→ `/agents?tab=runs`) only. No star, no avatars, no Share, no Invite.
- **Views row (36)**: two text-tab pills, **Your agents** (`/agents`) and **Run history** (`/agents?tab=runs`). The pills render for every Member.
- **Toolbar row (44)**: left empty on the Your-agents tab; on Run history, **Filter** (Agent, Status, Date range) and **Sort**. Right: the one blue button **Add agent** (36px, `Plus`), rendered only for Owner and Admin. No split chevron.

**Body layout.**

*Your agents tab*: a `TableCard`, rows at `--os-row-h` (44 Comfortable).

| Column | Content |
|---|---|
| Agent | `EntityTile size="sm"` neutral with the agent's initial + name 15/500 + role 13/400 `--os-ink-2` on the same line after a middle dot |
| Status | pale `StatusChip`: **On** (success), **Paused** (neutral), **Needs setup** (warning, when autonomous is on but no schedule is set) |
| Runs on | "Weekdays at 9:00" rendered from `scheduleCron` in the viewer's locale, or "When you ask" when `autonomousEnabled` is false |
| Last run | relative time, linking to the **agent run detail** at `/agents?agent=<slug>&run=<id>` (specified below); "Never" in `--os-ink-2` |
| Next run | relative time, or the words "Not scheduled" in `--os-ink-3`; never a bare dash glyph |
| row "…" | **Open chat**, **Run now**, **Pause** / **Turn on**, separator, **Remove** (destructive ghost). Everything except Open chat renders for Owner and Admin only. |

Row click opens the **agent drawer** (520). Drawer header 48: breadcrumb "Agents › {name}" 13px, right ⤢ (expand is not offered; agents have no full page), copy link, ✕. Body, in order:
1. What it does: the catalogue description, 14/20, read-only.
2. A 36px field strip (label 13/500 `--os-ink-2` in a 120px column, value as a picker trigger): **On** (Switch), **Runs on** (a schedule picker with four presets, Every weekday morning / Every Monday / Every month start / Custom cron, writing `scheduleCron`), **What to do each run** (`autonomousPrompt`, a textarea that auto-grows to 12 rows).
3. **Recent runs**: up to 10 36px rows, each a run status dot + the run's summary + relative time. Clicking one expands the **agent run detail** in place, below (URL `?agent=<slug>&run=<id>`).
4. Footer actions: **Run now** (secondary), **Open chat** (secondary, → `/sidekick?agent=<slug>&new=1`).
For a Member every control in 2 and the footer's Run now are absent; the drawer is the description, the schedule as text and the run history.

**Agent run detail** (not a separate surface: an expanded section inside the agent drawer, so there is one drawer, one close target and no undesigned destination). URL `/agents?agent=<slug>&run=<id>`, which makes it linkable from the Last run column, from Recent runs and from the Run history tab. It pushes the rest of the drawer's body down and scrolls itself into view; its own 36px header reads "Run · {relative time}" 13/500 `--os-ink-2` with a 28px ghost ✕ at the right. Contents, in order: the `RunStatusChip`; a 36px fact strip (Trigger: Scheduled or Manual · Started, absolute time with relative in the tooltip · Took, `tnum`); the run's summary as 14/20 prose; **What it did**, up to 20 `ToolCallRow`s, the same component and the same past-tense sentences the chat thread uses, so one run reads the same wherever you meet it; and, when the run produced a chat, one text link **Open the chat** → `/sidekick?session=<id>`. A failed run adds one 36px `--os-danger-text` row with the server's message. There is no Retry here: an agent run is re-run by **Run now**, which is already in the footer and is gated to Owner and Admin, and this spec does not add a second button that means the same thing.

*Run history tab*: a `TableCard` of `AgentRun` rows: Status chip | Agent | Trigger (Scheduled / Manual) | Started | Duration | Summary. Row click opens the agent's drawer with that run already expanded, at `/agents?agent=<slug>&run=<id>`. Footer (44): "Total records N" left, "1 to 50" right with ‹ › and a page-size select; columns, sort and page size persist per viewer in `home.work.surface["agents.runs"]` (§1.7).

**Add agent modal (560)**: header "Add an agent", a 36px search field under it when the catalogue exceeds 8 rows, body a list of 36px rows from `GET /api/agents` `available` (the real `lib/agents/catalog.ts`): name 15/500, role and one-line description 13/400 `--os-ink-2`, and one 32px secondary **Add** per row, which becomes a 13/400 "Added" line with the row moving to the installed list behind the modal. Footer Cancel. No tiers, no pricing pills, no invented skills. Reference: the Magnific model-picker modal cited in §1.8.

**Side panel / drawer / modal used here.** Three, and no others: the **agent drawer** (520, opened by a row click or `?agent=`, closed by ✕, Esc or a dimmed-list click, which drops `?agent`); the **agent run detail** inside it (a section, not a second layer, opened by `?run=`, closed by its own ✕ or Esc back to `?agent=`); and the **Add agent modal** (560, opened by the toolbar's blue button or the empty state's text link, closed by Cancel, ✕, Esc or an outside click). Remove is a 400px confirm ("Remove {name}?", body "It stops running. Its run history is kept.", Remove destructive).

**States.**

| State | Render |
|---|---|
| Loading | Rail logo pulse; five skeleton rows inside the card. The drawer shows skeleton field rows; an expanding run detail shows three skeleton `ToolCallRow`s. |
| Empty | Four dots in a row + "No agents yet" + for Owner and Admin the text link "See what agents can do" opening the Add agent modal; for a Member the sentence alone, "No agents are turned on yet." |
| Error | Inline 44px row in the card, "Couldn't load agents · Try again". A run detail that fails to load renders its own 36px row "Couldn't load this run · Try again" inside the drawer; a `run` id that is not this agent's or not this org's collapses the section and shows "That run is not available." rather than opening an empty panel. |
| Read-only | Member: no toolbar primary, no row actions but Open chat, no switches in the drawer. |
| Denied | Guest 404; app off `<AppOff>`. |
| Offline / expired | Shell strip; shell session dialog. |

**Keyboard.** ↑↓ move the row focus, Enter opens the drawer, Esc collapses an expanded run then closes the drawer, ⌘K search.

**Data.** Existing: `GET /api/agents` (installed + available), `POST /api/agents/[slug]/install`, `PATCH /api/agents/[slug]/schedule` (`autonomousEnabled`, `scheduleCron`, `autonomousPrompt`), `POST /api/agents/[slug]/schedule` (run now), `GET /api/agents/runs?trigger=&limit=`, `POST /api/sidekick/sessions { agentSlug }`. New:

- `PATCH /api/agents/[slug]` body `{ status: "ENABLED" | "DISABLED" }` → `{ ok: true, agent: { slug, status } }`. Pause and resume, which no endpoint covers today.
- `DELETE /api/agents/[slug]` → `{ ok: true }`. Remove, archiving the row rather than deleting the run history.
- `GET /api/agents/runs?agentSlug=&trigger=&status=&cursor=&take=` → `{ runs: Array<{ id, agentSlug, agentName, status, trigger, startedAt, durationMs, summary, sessionId?, error? }>, total, nextCursor }`. Cursor pagination for the Run history tab's footer.
- `GET /api/agents/runs/[id]` → one run plus `toolCalls: Array<{ tool, input, result, error, durationMs }>`, which is what the agent run detail renders through `ToolCallRow`.

Every write goes through `requireCan("manage", { type: "settings", page: "apps" })` and is audited with `ActivityLog.actorType` and `actingForId`. Settings read: `settings.data.aiEnabled` (feature switch); `home.work.surface["agents.runs"]` (§1.7).

**Realtime.** None. The Run history tab refetches on focus; the cron (`/api/cron/run-due-agents`) is the writer.

**What changes vs today.** The entire page is replaced. The 8 fabricated agents with Salesforce, Jira, Zendesk, QuickBooks and Mailchimp skills, the "156 tasks delegated this month" hero number, the summed "saved per week" strings, the tier pills and the three handler-less Hire / Hired / Chat buttons all go (audit issues 2, 11; critic #2). The real catalogue, install, schedule, run-now, run history and agent-scoped chat, all of which already exist server side, are surfaced for the first time (audit issue 2). The Work home card's "Configure" now leads to controls that exist (audit issue 3). The Sales / Support / Finance / Marketing category chips, which contradict the PPMS scope, are gone (audit issue 2). The fixed 3-column grid becomes a responsive table. A run that is linked to from three places (the Last run column, Recent runs, Run history) now has one designed destination with a URL, a close target and states, instead of being a link with nothing behind it.

**Open questions.** One: should an agent be able to act on a schedule for the **whole org** (acting as its creator, capped at Can edit), or only inside the Spaces its creator holds? This spec assumes the access model's answer, Spaces its creator holds, and no UI implies otherwise.

---

### `/automation`  (new `src/app/(dashboard)/automation/page.tsx`)

**Purpose.** The hub's natural address.

**Who sees it.** Same as `/automation/workflows`.

**Entry points.** Typed URL, old bookmarks, the `automation` rail entry's historic `defaultHref`.

**Behaviour.** A permanent redirect to `/automation/workflows`, served in `next.config.ts` so no shell renders first.

**Top bar / sidebar / header / body / side panel / states / keyboard / data / realtime.** None: the redirect precedes render.

**What changes vs today.** A 404 becomes a redirect (audit issue 24).

**Open questions.** None.

---

### `/automation/workflows`  (`src/app/(dashboard)/automation/workflows/page.tsx`)

**Purpose.** See every automation in the workspace and turn one on or off.

**Who sees it.** Every Member reads the list. Every Member can create. Edit, publish, activate, rename and archive belong to the workflow's creator, Owners and Admins.

**Entry points.** Sidebar row Workflows; the **Automations…** row in a Space, Folder or List "…" menu (design system §5.19), which now arrives with that container preselected as `?listId=` or `?spaceId=`; `/automation` and `/autopilot` redirects; the Health page's failure rows; the builder's BackButton; the Templates page after a draft is created; the usage-limit notification; deep link.

**Top bar.** Breadcrumb **AI › Automation › Workflows**.

**Secondary sidebar.** AI hub, AUTOMATION section, row Workflows active. Groups expanded: AUTOMATION and CHATS open, APPS collapsed, each overridden by the viewer's `sidebar.collapsedSections`.

**Page header stack.**
- **Title row (48)**: "Workflows" 22/600. Right: for Owner and Admin, a ghost "…" with **Automation settings** (→ Settings › Apps and modules › Automations, where "Pause all automations" and the run quota live). For a Member the "…" holds nothing and is therefore **not rendered**: that settings page is Owner and Admin only (`settings-architecture.md` §5.3), and §1.4's read-only rule says a control the viewer's role cannot use is not rendered. The **Ask AI** slot is not rendered on automation pages.
- **Views row (36)**: five text-tab pills, URL `?status=`: **All** · **Active** · **Drafts** · **Paused** · **Errors** (mapping to the API's `ACTIVE`, `DRAFT`, `INACTIVE`, `ERROR`). No "+ View".
- **Toolbar row (44)**: left **Filter** (`Funnel`, opens the 272px `FilterPanel`: Created by, Trigger, Where it runs, Alert level; the chip reads "Filter · 2" when two are active), **Sort** (`ArrowUpDown`: Last updated, Name, Last run, Success rate), a 20px divider, no view-type switcher (this surface has one view type). Right: the one blue button **New automation** (36px, `Plus`) fused to a 36px split chevron whose menu holds **From a template…** (→ `/automation/templates`); then the bordered 36px "…" with **Display** (columns: Trigger, Last run, Success, Created by, Where; and **Show archived**) and, for Owner and Admin only, **Automation settings**. Every choice in the Display menu persists per viewer in `UserPreference.home.work.surface["automation.workflows"]` (§1.7): the column set in `columns`, Show archived in `viewOptions.showArchived`, and the Sort choice in `sortKey`. Nothing here is in-memory and nothing is `localStorage`.

When a `?listId=` or `?spaceId=` param is present the title row gains a 24px `Chip` after the title reading the container's name with a ✕ that clears it, the list is filtered to workflows scoped there, and **New automation** pre-fills the new workflow's scope with that container. This is audit issue 18: the Space, Board and Folder "Automate" links stop dumping you on an unfiltered org-wide list.

**Body layout.** One `TableCard` under the toolbar (8px gap).

Header row (44 at Comfortable, 36 otherwise), labels 13/500 `--os-ink-2` sentence case, checkbox column 44 wide, column-settings `SlidersHorizontal` pinned right:

| Column | Cell |
|---|---|
| ☐ | 18px checkbox; rendered only on rows the viewer can act on |
| Name | 15/500 link to the builder; a 13/400 second value is not allowed by the row budget, so the description is the row's `title` tooltip |
| Status | pale `StatusChip` + 6px dot + word: Active → success, Draft → neutral, Paused → warning, Error → danger, Archived → neutral |
| When | the trigger's display name from the registry ("When a task is created"); a neutral `Chip` "Not live yet" after it when `isEmitting` is false, tooltip "This trigger does not fire yet"; "No trigger" in `--os-ink-3` when unset |
| Where | "Everywhere" or the scope's List or Space name, truncated at 160px |
| Last run | relative time, or "Never" in `--os-ink-2` |
| Success | "98%" with `tnum`, tooltip "118 of 120 runs succeeded"; a workflow with no runs reads "No runs yet" in `--os-ink-3`, never a bare dash glyph |
| Created by | 24px avatar + first name |
| "…" | Edit · Duplicate · Activate (only with a published version) or Deactivate · View logs · Rename · separator · Archive (destructive ghost). For a Member on a workflow they did not create: Duplicate · View logs only. |

Footer row (44): "Total records 12" left 13/500, "1 to 40" right with ‹ › and a page-size select on hover.

Bulk bar (floating bottom-centre, 48px, white, `--os-shadow-pop`, 150ms after the first selection): "3 selected" + Activate · Deactivate · Duplicate · Archive · ✕.

**Workspace-paused strip.** When `settings.work.automationsPaused` is true, a 44px `--os-warning-bg` strip sits between the toolbar and the card: a 16px `CircleAlert`, "Automations are paused for this workspace." and, for Owner and Admin only, a **Turn them back on** text link to Settings › Apps & modules. This is the first time that setting is visible where it matters.

**Side panel / drawer / modal.** `FilterPanel` 272 inside the content (the table narrows with a 220ms tween). New automation: a 400px modal, one input "Name this automation", Create primary (replacing the browser-ish `usePrompt`). Rename: the same modal. Archive confirm: 400, "Archive '{name}'?", body "It stops running. Its run history is kept.", Archive destructive.

**States.**

| State | Render |
|---|---|
| Loading | Rail logo pulse; eight skeleton rows in the card, header row real. No `Loader2`, no "Loading…" text. |
| Empty (no workflows) | Four dots **in a row** (design system §5.8: the row arrangement is the family for lists and tables; the 2×2 grid belongs to boards, kanban, calendar and dashboards) + "No automations yet" + one text link "Start from a template". The blue **New automation** in the toolbar stays the one primary; the empty state adds no second button. |
| Empty (filtered) | An inline 44px row inside the card, "No automations match · Clear filters", 15px `--os-ink-2`, no illustration. |
| Error | Inline 44px row "Couldn't load automations · Try again" wired to the refetch. |
| Read-only | Per row, as §1.4. A Member always keeps the blue New automation button because creating is theirs. |
| Denied | Guest 404; `automation` app off `<AppOff>`. |
| Offline / expired | Shell strip and dialog; mutations are blocked by the strip rather than failing silently. |

**Keyboard.** ↑↓ row focus, Enter opens the builder, Space toggles the checkbox, ⌘A selects the page, Esc clears the selection and closes the filter panel, `/` focuses the filter panel's search when it is open.

**Data.** Existing: `GET /api/automation/workflows?status=&q=&includeArchived=1`, `POST /api/automation/workflows`, `POST /api/automation/workflows/[id]/activate` and `/deactivate`. New:

- `GET /api/automation/workflows` gains `?listId=`, `?spaceId=`, `?cursor=`, `?take=` and returns `{ workflows: [...], total, nextCursor }`, so the footer's count and pages are real.
- `POST /api/automation/workflows/[id]/duplicate` body `{}` → `{ id, name }` of the new draft (today duplication is a client-side re-POST, which loses the version history and the scope). The copy is named "{name} (copy)", is a DRAFT, is owned by the person who duplicated it, and carries the source's `definition` including `scope`.

Settings read: `settings.work.automationsPaused` (org, Settings › Apps and modules › Automations); `home.work.surface["automation.workflows"]` (per viewer, §1.7). Every route swaps `resolveAutomationContext` for `requireCan`.

**Realtime.** None. The list refetches on window focus and after any mutation. Counts in the sidebar refresh on the same events.

**What changes vs today.** The dark zinc-900 pill becomes the one blue button (audit issue 14 and the style split, issue 22). The bespoke `AutomationHeader` is replaced by the design system's header stack, so this page finally looks like every other list page. Status and filter pills become real, URL-backed views over the `?status=` the API already supports (audit issue 7's "no search/filter"). Mutations disappear for viewers who lack the right instead of 403-toasting (audit issue 14). The "Automate" entry points arrive scoped (audit issue 18). Archived rows are a Display option rather than an invisible state. Em dashes in the status copy go (audit issue 26).

**Open questions.** None.

---

### `/automation/workflows/[id]`  (`src/app/(dashboard)/automation/workflows/[id]/page.tsx`)

**Purpose.** Say, in one sentence, what should happen automatically.

**Who sees it.** Every Member can open it. Only the creator, Owners and Admins can change it.

**Entry points.** A row's Name or "…" › Edit; **New automation**; Templates "Use this"; the Logs drawer's workflow link; the builder's own Recent runs; deep link.

**Top bar.** Breadcrumb **AI › Automation › Workflows › {name}** (last crumb 14/500, not clickable, truncated at 160px).

**Secondary sidebar.** AI hub, row Workflows active (prefix match). Groups expanded: AUTOMATION and CHATS open, APPS collapsed, each overridden by the viewer's `sidebar.collapsedSections`.

**Page header stack.**
- **Title row (48)**: `BackButton{fallbackHref="/automation/workflows"}` labelled "Workflows", then the name as an inline-editable 22/600 field (click to edit, Enter commits, Esc reverts, blur commits). Right, ghost: 32px "…" with **Duplicate**, **View logs**, separator, **Archive** (destructive ghost).
- **Views row**: does not render.
- **Toolbar row (44)**: left the pale `StatusChip` (Draft / Active / Paused / Error) and, when dirty, "Unsaved changes" 13/400 `--os-ink-2` after a middle dot. Right: **Save draft** (secondary 36) and **Publish** or **Republish** (the one blue button 36). For a read-only viewer the whole right cluster is absent and the slim view-only banner sits under the toolbar.

**Body layout.** Two columns at ≥1024: the sentence column (fluid, max 720) and the **Details panel** (360, `--os-surface`, `1px solid var(--os-line)`, radius 8, sticky). Below 1024 the Details panel becomes the last section of the single column.

Sentence column sections, in reading order, each a card with a 16/600 title:

1. **When** (the trigger). One token button: 36px, `--os-surface`, `1px solid var(--os-line-strong)`, radius 6, the trigger's display name, or "Choose what starts this" in `--os-ink-3` when unset. Click opens the `Picker` (280): rows 36 grouped by category with 11/600 uppercase section labels, search hidden under 6 items. A trigger with `isEmitting: false` renders with a neutral "Not live yet" chip and is selectable, with one 13/400 line under the token after selection: "This does not fire yet. The automation will start working when it does."
2. **Only if** (conditions, optional). An AND / OR `SegmentedControl` (32px) appears only with two or more rows. Each row: a field `Picker` (from the trigger's fields), an operator `Picker` (`CONDITION_OPERATORS`), and a value control **typed to the field**: a people `Picker` for `user` fields (today a raw text input, audit issue 17), a date `Picker` for `date`, a number input for `number`, a status `Picker` for status, otherwise a 36px text input. Per-row 28px ghost trash. "Add condition" ghost row at the end. An API-authored nested group renders as one 36px row "Advanced condition (edit in the API)" with only a remove action, unchanged.
3. **Then** (actions). One card per action: an action token `Picker` grouped by category (unavailable actions show a neutral "Coming soon" chip and are not selectable, so `send_whatsapp` is honest rather than a trap), then its parameter fields as 36px label / control rows using the same typed controls (`UserParamPicker` with the specials assignee, actor, board owner, admins; a List `Picker`; a status `Picker` with a "Custom…" escape; priority; number; text with `{{field}}` tokens and a 13/400 helper naming the available tokens). Per-card 28px ghost trash and a `grip` drag handle for ordering. "Add another action" ghost row.
4. **Where it runs** (new, fixes audit issue 17). A `SegmentedControl`: **Everywhere** (default) or **Only in chosen Lists**; the second reveals a multi-select `Picker` over `accessibleIds(viewer, "list", VIEW)`. Persists as `definition.scope = { listIds: [] }` and the matcher ANDs it, so no schema change and no more typing a board id into a condition.

Details panel sections:

- **Description**: a textarea auto-growing to 12 rows, placeholder "What is this for?".
- **Alert level** (renamed from Severity): a `SegmentedControl` Critical / Major / Minor with one 13/400 line under it, "Groups failures on the Health page." No jargon (audit issue 17's "Severity (for Health)").
- **Turn it on**: a Switch. Before the first publish the switch is **not rendered**; in its place one 13/400 `--os-ink-2` line, "Publish this automation to turn it on." (no disabled control).
- **Facts**: three 36px label / value rows, Published (relative time or "Not published"), Last run, Versions ("3 versions" with a **View history** text link).
- **Recent runs**: up to 10 36px rows, each a run status dot + the trigger's display name + relative time, linking to `/automation/logs?runId=`; a **See all runs** text link to `/automation/logs?workflowId=`.

**Version history modal (560)**: rows of versions with number, who published, when, and a 32px secondary **Restore** per row; restoring creates a new draft from that version rather than overwriting (reversible by construction). Closes audit issue 17's "versions countable but not viewable".

**Publish semantics, said in the UI.** Publish validates that a trigger is set, at least one action exists and every action is available; failures render inline under the offending section, never as a toast alone. The Republish button carries the tooltip "The live automation keeps running the old version until you republish." (audit issue 17).

**Side panel / drawer / modal.** `Picker` popovers (280, absolute children inside any dialog); version history modal (560); archive confirm (400); the dirty-guard confirm (400).

**States.**

| State | Render |
|---|---|
| Loading | Rail logo pulse; skeleton token rows in each section and skeleton field rows in the Details panel. |
| Empty | A brand-new draft is the empty state: the When token reads "Choose what starts this" and the Then section shows one "Add an action" ghost row. No illustration inside a builder. |
| Error | Load failure: a centred 44px row "Couldn't load this automation · Try again". Save failure: the toast "Not saved · Try again" plus the form stays dirty and the guard stays armed (data-integrity rule). |
| Read-only | The whole sentence renders as text with chips instead of token buttons; no Save, no Publish, no Active switch, no trash; the view-only banner with **Request access**. |
| Denied | Another org's id: 404. `automation` app off: `<AppOff>`. |
| Offline / expired | The shell strip disables Save and Publish and says why; a 401 mid-save opens the shell's session-expired dialog and the draft is preserved in the form. |

**Keyboard.** Esc closes the topmost picker, then prompts the dirty guard if you then try to leave. Tab order is When → Only if → Then → Where → Details. Every token button is a real button with an `aria-label` naming its slot.

**Data.** Existing: `GET/PUT /api/automation/workflows/[id]`, `POST .../publish`, `POST .../activate`, `POST .../deactivate`, `DELETE .../[id]`, `GET /api/automation/triggers`, `GET /api/automation/actions`, `GET /api/boards?all=1` (replaced by the scoped List picker source). New:

- `GET /api/automation/workflows/[id]/versions` → `{ versions: Array<{ number: number; publishedAt: string; publishedBy: { id, name }; isLive: boolean }> }`, newest first, from the existing `AutomationWorkflowVersion` rows. The definition itself is not returned to the list, so the modal stays cheap.
- `POST /api/automation/workflows/[id]/versions/[n]/restore` body `{}` → `{ ok: true, draftUpdated: true }`. It copies that version's definition into the **draft**, never over the live version, so restoring is itself undoable by restoring the previous number. Requires `edit` on the workflow.
- `definition.scope` (`{ listIds: string[] }`) accepted by the PUT and honoured by `runAutomationsForEvent`'s matcher; a missing `scope` reads as "Everywhere", so old rows need no migration.
- `GET /api/automation/runs?workflowId=&take=10` already covers Recent runs.

**No test or dry-run button.** The inventory raises "no test/dry-run button (low)" for the builder and this spec **defers** it, for the reason the rest of the spec is built on: the engine has no simulate mode, so a Test button would either write real records or do nothing, and a button that appears to test something without testing it is the dishonesty this unit is removing. The feedback loop that does exist is stated in the UI instead: Publish validates inline, the Recent runs list in the Details panel shows what actually happened within seconds of the first real trigger, and the Logs run drawer shows every step with its input and output. Connections keeps its own **Send a test**, which is a real request to a real URL.

**Realtime.** None. Recent runs refetch on focus.

**What changes vs today.** The dirty guard exists (audit issue 8, the unit's highest-severity fix). The Details panel is never hidden (issue 16). Conditions on user fields use the people picker (issue 17). A workflow can be scoped to Lists without typing an id (issue 17). Versions can be seen and restored (issue 17). Severity becomes Alert level with an explanation (issue 17). Republish explains itself (issue 17). A read-only viewer no longer edits locally and 403s on save (issue 14). The dark pill becomes the one blue Publish, and native `<select>`s become `Picker`s (issue 22).

**Open questions.** None.

---

### `/automation/templates`  (`src/app/(dashboard)/automation/templates/page.tsx`)

**Purpose.** Start from an automation someone already worked out.

**Who sees it.** Every Member (using a template creates their own draft).

**Entry points.** Sidebar row Templates; the Workflows empty state; the New automation split menu's "From a template…"; deep link.

**Top bar.** Breadcrumb **AI › Automation › Templates**.

**Secondary sidebar.** AI hub, row Templates active. Groups expanded: AUTOMATION and CHATS open, APPS collapsed, each overridden by the viewer's `sidebar.collapsedSections`.

**Page header stack.**
- **Title row (48)**: "Templates" 22/600. Right: nothing.
- **Views row**: does not render (one view).
- **Toolbar row (44)**: left **Filter** only when more than 12 templates exist (today there are four, so it does not render). Right: **empty**. This page deliberately has no page-level primary; the card action is the primary at card level. One blue button per page is a maximum, and the honest primary here is per recipe.

**Body layout.** A card grid, 3 columns at ≥1280, 2 at ≥900, 1 below, gap 16. Each card: `--os-surface`, `1px solid var(--os-line)`, radius 8, padding 16.
- Name 15/500 `--os-ink` (the recipe in plain words, "Tell the assignee when a task lands on them").
- Sentence 13/400 `--os-ink-2` on two lines maximum ("When a task is created, send the assignee a notification.").
- A row of at most two chips: a neutral `Chip` for the category, and a neutral `Chip` "Not live yet" when the trigger is not emitting, with the tooltip "This trigger does not fire yet."
- One 32px **Use this** secondary button at the card's foot. It POSTs the clone, toasts "Draft created" with an **Undo**, and navigates to the builder.

Seeds shipped: four (task created → notify assignee; status Done → notify the List owner; created without an assignee → assign the List owner; KPI recorded → notify admins). The fifth seed, lead created → follow-up task, is **removed**: Leads left the product scope and shipping a recipe for it is the same dishonesty as the `/agents` Salesforce skills (audit issue 15 in §2.9).

**Side panel / drawer / modal.** None.

**States.**

| State | Render |
|---|---|
| Loading | Rail logo pulse; six skeleton cards at the real card height. |
| Empty | Four dots **in a row** (design system §5.8 list family; a grid of recipe cards is a list of recipes, not a board) + "No templates yet" + text link "Create an automation from scratch". |
| Error | A centred 44px row "Couldn't load templates · Try again". |
| Read-only | Not applicable: every Member may use a template. |
| Denied | Guest 404; app off `<AppOff>`. |
| Offline / expired | Shell strip disables Use this; shell dialog on expiry. |

**Keyboard.** Tab moves card to card; Enter on a focused card fires Use this.

**Data.** Existing: `GET /api/automation/templates`, `POST /api/automation/workflows` with the template's definition. No new API for this route; saving a workflow **as** a template is not built and therefore no control offers it.

**Realtime.** None.

**What changes vs today.** The dark pill becomes a secondary button; the card grid becomes responsive (audit issue in §1 Mobile); the off-scope Leads recipe is removed; the "Use template" 403 for read-only Members disappears because using a template is a create, which every Member may do (audit issue in §2.9).

**Open questions.** One for the founder: should a Member be able to **save their automation as a template** for the workspace, and if so who curates the list? Today the template table is global and admin-less. Nothing in this spec pretends the feature exists.

---

### `/automation/connections`  (`src/app/(dashboard)/automation/connections/page.tsx`)

**Purpose.** Give automations somewhere to send things.

**Who sees it.** Owner and Admin only (access §9 `settings.manageIntegrations`; an Admin holding the `security` scope is covered by being an Admin). The sidebar row is absent for a Member, and a typed URL renders `LockedPage` per §1.4 item 5. A Member who wants a connector has a destination of their own: **Integrations** (`/integrations`), one row below in the same sidebar, where every Member browses and asks.

**Entry points.** Sidebar row Connections; the builder's action picker when an action needs a connection ("Set up a connection" text link on that action's helper line, rendered only for Owner and Admin); the Automations card on Settings › Apps and modules, which already links into `/automation/*` (`settings-architecture.md` §5.3). The footer link on Settings › API and webhooks is **not** an entry point here: that one points at `/integrations`, per `settings-architecture.md` §1.17 and §7.1. Deep link. `/integrations` does **not** redirect here (§0).

**Top bar.** Breadcrumb **AI › Automation › Connections**.

**Secondary sidebar.** AI hub, row Connections active. Groups expanded: AUTOMATION and CHATS open, APPS collapsed, each overridden by the viewer's `sidebar.collapsedSections`.

**Page header stack.**
- **Title row (48)**: "Connections" 22/600.
- **Views row**: does not render.
- **Toolbar row**: does not render (there is nothing to filter, sort or switch, and the page's one action lives in its card).

**Body layout.** A 560-wide settings-form column (design system §5.4), two cards.

**Card 1, "Webhook"** (the one connector that works today):
- Title 16/600 "Webhook" with a pale `StatusChip` beside it: **Connected** (success), **Not connected** (neutral), **Expired** or **Error** (danger, with the server's message as a 13/400 `--os-danger-text` helper line).
- Field **URL**: label 13/500 above, 36px input, placeholder `https://`, helper "We POST the run's payload here.", validation error inline.
- Field **Signing secret** (new): when connected, a masked value with a 32px **Copy** secondary and a **Rotate** destructive ghost; on first connect the secret is shown once with the line "Copy this now. You will not see it again."
- Row **Last delivery**: 13/400 `--os-ink-2` relative time, or "No deliveries yet".
- Actions under the card: **Send a test** (secondary 36; posts a sample payload and reports the response code in a toast) and **Save** (the page's one blue button). When connected, a **Disconnect** destructive ghost sits in a Danger-zone-styled foot of the card with `--os-danger-border` (audit issue 15: "no disconnect endpoint yet" stops being true).

**Card 2, "Somewhere else to send things"**: title 16/600, two 13/400 `--os-ink-2` lines, "The webhook is the only connection automations can use today. We build connectors when customers ask for them." and "See which ones people here have asked for." The second line's last clause is a text link to **Integrations** (`/integrations`), where the catalogue lives with a real Request-this action and a real count.

This card holds **no rows at all**, and that is deliberate. A list of unbuilt connectors would have to be `ComingSoonRow`s, and `ComingSoonRow` renders only when `UserPreference.home.ui.showUpcoming` is on, which is **off by default** (design system §5.19, `spec-shell.md` §1.15, `settings-architecture.md` §4). A card whose content is invisible to almost every viewer cannot be the home of anything. So the connectors live on a page that always renders them and always lets a person act, and this card is one honest sentence and one link. Nothing is lost and nothing is hidden behind a preference.

**No Connect buttons anywhere on this page.** The four buttons whose only job was to toast "coming soon" (WhatsApp, Gmail, Google Calendar, Slack) are deleted; those four connectors are Request-this cards on `/integrations` (audit issue 15). `ZAPIER` and `CRM`, which the API accepts but nothing displayed, are listed on neither page: a provider a person cannot use and cannot ask for does not belong in front of anyone.

**Side panel / drawer / modal.** Rotate-secret confirm (400, "Rotate the signing secret?", body "Anything using the old secret stops verifying."). Disconnect confirm (400, "Disconnect the webhook?", body "Automations that send to it will start failing.").

**States.**

| State | Render |
|---|---|
| Loading | Rail logo pulse; two skeleton cards. |
| Empty | Not a state: card 1 renders in its Not-connected form, which is the empty state. |
| Error | Load failure: a 44px row "Couldn't load connections · Try again". Connect failure: inline error under the URL field plus a toast. |
| Read-only | Not applicable: the page only renders for people who can write. |
| Denied | Member or Agent: `LockedPage` (§1.4 item 5), reason "Connections are managed by workspace Owners and Admins.", Owner and Admin avatars, `BackButton{fallbackHref="/automation/workflows"}`, one text link "Browse Integrations" → `/integrations` so the viewer leaves with somewhere to go, URL unchanged. The `automation` app off or floored: `<AppOff>`. Guest: 404. |
| Offline / expired | Shell strip and dialog. |

**Keyboard.** Tab through the fields; ⌘Enter saves; Esc closes a confirm.

**Data.** Existing: `GET /api/automation/connections` (returns `{ connections: Array<{ provider, status, metadata, lastDeliveryAt }> }`), `POST /api/automation/connections/WEBHOOK { url }`. New:

- `DELETE /api/automation/connections/WEBHOOK` → `{ ok: true }`. Disconnect.
- `POST /api/automation/connections/WEBHOOK/test` body `{}` → `{ ok: boolean, httpStatus: number, durationMs: number, message?: string }`. It POSTs one sample payload, signed with the live secret, and the toast reports the status code and the round trip. It writes no run row, because it is not a run.
- `POST /api/automation/connections/WEBHOOK/rotate` body `{}` → `{ secret: string }`, the new signing secret, returned exactly once and never readable again. The secret lives in the existing `metadataJson`, so there is no migration.

Every one of the four requires `settings.manageIntegrations` and is audited. The `[provider]` route keeps returning 501 for every non-webhook provider; no UI calls it any more, so nothing 501s in front of a person.

**Realtime.** None.

**What changes vs today.** Four dead Connect buttons go; disconnect, rotate and test exist; the page is gated to the people who can actually use it instead of rendering Connect for everyone (audit issue 15 and §6 inconsistencies). "Three integrations doors" becomes two with one job each (critic #3): this page is where an Owner or Admin sets up the one place automations send to, `/integrations` is where anyone browses and asks for connectors, and `/settings/integrations` stops existing (the settings unit ships its 308 to `/settings/api`). Neither surviving page repeats the other's rows.

**Open questions.** None. The demand-driven connector strategy (memory `feedback_integrations_strategy`) is what card 2 says out loud and what `/integrations` measures.

---

### `/automation/health`  (`src/app/(dashboard)/automation/health/page.tsx`)

**Purpose.** See whether your automations are working.

**Who sees it.** Every Member (they hold Can view on the workflow list, so they may see how it is going).

**Entry points.** Sidebar row Health; the Logs page's "…" › Health; a failure notification; deep link.

**Top bar.** Breadcrumb **AI › Automation › Health**.

**Secondary sidebar.** AI hub, row Health active. Groups expanded: AUTOMATION and CHATS open, APPS collapsed, each overridden by the viewer's `sidebar.collapsedSections`.

**Page header stack.**
- **Title row (48)**: "Health" 22/600.
- **Views row (36)**: three text-tab pills, **7 days** · **30 days** · **90 days**, URL `?days=`, default 30. This is the fixed-window fix (audit issue in §2.10).
- **Toolbar row**: does not render (nothing to filter, sort or create here).

**Body layout.** A 1080-max content column, sections 32px apart.

1. **How runs went** (card, `--os-surface`, 1px `--os-line`, radius 8, padding 24). A success-rate donut, stroke 6, `--os-brand` arc on `--os-surface-2` track, the percentage 22/600 in the centre and the word "succeeded" 13/400 beneath. Legend to the right as four 36px rows: **Succeeded** (success dot + count), **Failed** (danger), **Partly done** (warning), **Skipped** (neutral). Each row is a link into `/automation/logs?status=…&days=<the current window>`, so the window travels with the click; Logs declares `?days=` as one of its URL parameters for exactly this reason. Semantic colour is used only because these series genuinely mean success, danger and warning (design system §1.4 rule 8).
2. **Failures by alert level** (card). Three 44px rows, Critical / Major / Minor, each with a count and a link to `/automation/logs?status=FAILED&severity=CRITICAL&days=<the current window>`. No coloured tiles, no gradients: the word carries the meaning and the chip is pale.
3. **Recent failures** (`TableCard`). Columns: Status chip | Workflow (link to the builder) | When (the trigger's display name) | Started | Error (truncated, full text in the row tooltip). Row click opens the Logs run drawer at `/automation/logs?runId=`. Footer "Total records N" and a **See all failures** text link.

**Side panel / drawer / modal.** None of its own; rows navigate to Logs.

**States.**

| State | Render |
|---|---|
| Loading | Rail logo pulse; a skeleton donut block and five skeleton rows. |
| Empty | No runs in the window: four dots in a 2×2 grid + "No automations have run in the last 30 days" + one text link "See your workflows". No failures but runs exist: section 3 renders one 44px row "Nothing has failed. Good." in `--os-ink-2`. |
| Error | A 44px row "Couldn't load health · Try again". |
| Read-only | Everyone is read-only here; there are no controls to hide. |
| Denied | Guest 404; app off `<AppOff>`. |
| Offline / expired | Shell strip and dialog. |

**Keyboard.** Arrow keys move between the window pills; Enter follows a legend or failure row.

**Data.** Existing: `GET /api/automation/health?from=&to=` (the window pills map to `from`), `GET /api/automation/runs?status=FAILED&take=8`. New: a `severity` filter on `GET /api/automation/runs` so the alert-level rows can deep-link honestly.

**Realtime.** None; refetch on focus.

**What changes vs today.** The 30-day window becomes selectable (audit §2.10). The page is reachable from the hub sidebar for everyone who can see automations, not only whoever happened to have the Automation rail app (audit issue 10; critic #1). The hand-rolled donut and the three severity cards are restyled to tokens, and the alert-level rows gain a real destination.

**Open questions.** None.

---

### `/automation/usage`  (`src/app/(dashboard)/automation/usage/page.tsx`)

**Purpose.** See how much of this month's automation allowance you have used.

**Who sees it.** Every Member, per access §5.2.1 row `automation`, with one exception stated below: the **Top people** table renders only for Owner and Admin. Only Owners and Admins see the link to change anything.

**Entry points.** Sidebar row Usage; the in-app notification fired when the limit is hit (`lib/automation/usage.ts:112`); Settings › Apps & modules › Automations, where the quota is shown beside the pause switch; deep link.

**Top bar.** Breadcrumb **AI › Automation › Usage**.

**Secondary sidebar.** AI hub, row Usage active. Groups expanded: AUTOMATION and CHATS open, APPS collapsed, each overridden by the viewer's `sidebar.collapsedSections`.

**Page header stack.**
- **Title row (48)**: "Usage" 22/600.
- **Views row (36)**: month navigation as two 32px ghost icon buttons ‹ › around the month name rendered as a text-tab pill, URL `?month=YYYY-MM`, default the current month (audit §2.11's "no month navigation").
- **Toolbar row**: does not render.

**Body layout.** A 1080-max column.

1. **Actions this month** (card). A 4px linear progress bar, `--os-surface-2` track, `--os-brand` fill; when the limit is reached the fill becomes `--os-danger-solid` **and** the words change, never colour alone. Under it, 15/400: "812 of 1,000 actions used". When blocked, one 14/20 line: "Automations are paused until the counter resets on the 1st." (the em dash in today's copy goes, audit issue 26). One 13/400 `--os-ink-2` line always: "Every workspace includes 1,000 actions a month." For Owner and Admin only, one text link **Pause all automations** → Settings › Apps & modules › Automations.
2. **Each day** (card). A bar chart of the month's daily counts, using the dataviz skill's brand-neutral palette (a single series, so one neutral hue; no YBRG). Empty: "No actions have run this month yet." 15/400 `--os-ink-2` in the card, no chart frame.
3. `TableCard`s side by side at ≥1280 and stacked below: **Top automations** (Name link, actions, `tnum`) and **Top actions** (the action's display name, count) for every Member; **Top people** (24px avatar + name, count) **for Owner and Admin only**. Five rows each, each with its own "Total records" footer suppressed (a fixed top-5 list needs no pagination; the card shows "Top 5" as its 13/500 header). A Member sees a two-card row, not a gap and not a locked card.

**Why Top people is gated, said plainly.** The rest of this page is workspace metering: how much of the shared allowance the workspace has spent, and on what. Top people is different in kind, because it is per-person activity, and the inventory (`ai-automation.md` §6) raises exactly that as an access inconsistency. No row in `access-model-spec.md` §5.2.1 or §9 covers "who may see how much automation each colleague triggered", and this unit will not invent one. So the conservative reading ships: the nearest written rule is people data (access §3.5: own, manager chain, People team, Admin), and Owner and Admin is inside it for everyone. The wider question, whether a manager should see this for their reports, is an open question for the founder below and is listed as deferred in §5. Nothing else on the page changes for a Member.

**Side panel / drawer / modal.** None.

**States.**

| State | Render |
|---|---|
| Loading | Rail logo pulse; skeleton bar, skeleton chart block, three skeleton tables. |
| Empty | A month with no actions: the progress card renders at 0 with its sentence; the chart card and the three tables render the one-line empty sentence each. No illustration (the page is never blank). |
| Error | A 44px row "Couldn't load usage · Try again". |
| Read-only | Everyone is read-only; the only gated element is the Pause-all link. |
| Denied | Guest 404; app off `<AppOff>`. |
| Offline / expired | Shell strip and dialog. |

**Keyboard.** ‹ › month buttons are real buttons with `aria-label` "Previous month" / "Next month"; the chart is described by a visually hidden table for screen readers.

**Data.** Existing: `GET /api/automation/usage` (current month). New: `GET /api/automation/usage?month=YYYY-MM` → `{ month, used, limit, blocked, daily: Array<{ date, count }>, topAutomations: Array<{ id, name, count }>, topActions: Array<{ key, label, count }>, topPeople?: Array<{ userId, name, avatarUrl, count }> }`. `topPeople` is **omitted from the response** for a Member, not sent and hidden, so the gate is server side and a stale client cannot leak it. A `month` earlier than the workspace's first run returns zeros rather than a 404, so the ‹ button never dead-ends. Settings read: `settings.work.automationsPaused` (shown as the link's state) and the monthly limit from `lib/automation/usage.ts`.

**Realtime.** None.

**What changes vs today.** Month navigation exists; the blocked copy loses its em dash and gains an honest explanation instead of a dead end; the 1,000-action limit is described as what it is (a fixed allowance) rather than implying a plan that does not exist; the charts move onto the dataviz palette (audit issue 20, partially; the plan linkage is deferred, see §5).

**Open questions.** Two for the founder.

1. Should the monthly action allowance become a plan limit (so Usage can offer an upgrade path), and what are the numbers per plan? Until that is answered the page states the fixed allowance and offers no upgrade button.
2. Who should see **Top people**? This spec ships Owner and Admin, because no access rule covers per-person automation activity. The two other honest answers are "add a manager-chain reading, so a manager sees their own reports" and "nobody, drop the table". Whichever is chosen becomes one new line in the access spec's §9 table, not a setting.

---

### `/automation/logs`  (`src/app/(dashboard)/automation/logs/page.tsx`)

**Purpose.** See exactly what an automation did, and why it failed.

**Who sees it.** Every Member. Retry needs the right to edit that automation.

**Entry points.** Sidebar row Logs; a Workflows row "…" › View logs (`?workflowId=`); the Health legend and alert-level rows (`?status=`, `?severity=`, `?days=`); the builder's Recent runs (`?runId=`) and See all runs (`?workflowId=`); deep link.

**URL parameters, the complete list.** Every filter and the sort are in the URL, so every entry point above arrives correctly filtered, the browser back button works, and a filtered view is shareable: `?status=` (the view pills), `?workflowId=`, `?runId=` (opens the drawer), `?severity=` (alert level), `?days=` (7, 30 or 90, the window Health hands over), `?from=` and `?to=` (an exact range from the Filter panel's date control, which supersedes `?days=` when both are present), `?record=` (record type), `?sort=` (`newest` default, `oldest`), `?cursor=`. Page size is not a URL parameter, because it is a per-viewer preference rather than part of what a link means; it lives in `home.work.surface["automation.logs"].viewOptions.pageSize` (§1.7).

**Top bar.** Breadcrumb **AI › Automation › Logs**.

**Secondary sidebar.** AI hub, row Logs active. Groups expanded: AUTOMATION and CHATS open, APPS collapsed, each overridden by the viewer's `sidebar.collapsedSections`.

**Page header stack.**
- **Title row (48)**: "Logs" 22/600.
- **Views row (36)**: six text-tab pills, URL `?status=`: **All** · **Succeeded** · **Failed** · **Partly done** · **Skipped** · **Running**.
- **Toolbar row (44)**: left **Filter** (272 `FilterPanel`: Automation, Date range, Record type, Alert level) and **Sort** (Newest first, Oldest first). Right: no primary button; the bordered 36px "…" holds **Display** (columns and page size) and links to **Health** and **Usage**.

Filters and the sort write to the URL on every change (today they do not, audit §2.12). The Display menu's two per-viewer choices, the column set and the page size, persist in `UserPreference.home.work.surface["automation.logs"]` as `columns` and `viewOptions.pageSize` (§1.7); the sort is written to both the URL and `sortKey`, so a shared link wins for the person who opens it and their own default returns when they arrive with no `?sort=`.

**Body layout.** One `TableCard`.

| Column | Cell |
|---|---|
| Status | pale `StatusChip` + dot + word: Succeeded, Failed, Partly done, Skipped, Running |
| Automation | 15/500 link to the builder |
| When | the trigger's **display name** ("When a task's status changes"), not the raw key `task.status_changed` (audit §2.12) |
| Record | the triggering object's name as a link (task, KPI record, kudos) resolved server side; when it cannot be resolved the cell reads "Not available" in `--os-ink-3`, never a raw `type · id` fragment |
| Started | absolute time in the viewer's locale, relative in the tooltip |
| Took | duration, `tnum`, right aligned |
| Error | first line of the error, truncated; full text in the drawer |

Footer (44): "Total records 1,284" left; "1 to 50" right with ‹ › and a page-size select (25 / 50 / 100). Real cursor pagination replaces the hard `take=100` (audit issue 19).

**Run drawer (520)**, opened by a row click, URL `/automation/logs?runId=<id>`:
- Header 48: breadcrumb "{Automation} › Run" 13px left; right ⤢ is not offered (a run has no full page), **Copy link**, **✕**. Esc closes (audit §2.12).
- Body: the status chip and the run's one-line summary; a 36px fact strip (Automation link, Trigger display name, Record link, Started, Took); then **Steps** as 36px rows (a 16px type chip, the step name, its duration, a status dot; a failed step adds its error on a second row in `--os-danger-text`); then two collapsible mono blocks, **What went in** and **What came back**, and one for **The event** (the trigger payload), each `JetBrains Mono` 13/18 in a `--os-surface-1` block with a Copy icon button.
- Footer: **Retry failed steps** (secondary 36), rendered only when the run is Failed or Partly done, every failed action step is `safeToRetry`, **and** `can(viewer, "edit", { type: "automation", id })`. When steps are not safe to retry, one 13/400 `--os-warning-text` line explains which step cannot be repeated, with no button.

**States.**

| State | Render |
|---|---|
| Loading | Rail logo pulse; ten skeleton rows under a real header row; the drawer shows skeleton fact rows. |
| Empty | No runs at all: four dots in a row + "Nothing has run yet" + text link "See your workflows". Filtered to nothing: an inline 44px row "No runs match · Clear filters". |
| Error | A 44px row "Couldn't load runs · Try again"; the drawer shows its own inline row with Retry. |
| Read-only | The Retry button is absent for viewers who cannot edit that automation (today it renders and 403s, audit §2.12). |
| Denied | Guest 404; app off `<AppOff>`; a `runId` from another org: the drawer does not open and the page renders a 44px row "That run is not in this workspace". |
| Offline / expired | Shell strip and dialog. |

**Keyboard.** ↑↓ move row focus, Enter opens the drawer, Esc closes it, ← → page through the footer's pages, `/` focuses the filter panel search.

**Data.** Existing: `GET /api/automation/runs?workflowId=&status=&from=&to=&take=`, `GET /api/automation/runs/[id]`, `POST /api/automation/runs/[id]/retry`. New, all on the existing list route: `?cursor=` and a `{ runs, total, nextCursor }` envelope so the footer's count and pages are real; `?severity=`, `?days=`, `?record=` and `?sort=` filters matching the URL list above; and a resolved `record: { type, id, name, url } | null` object on each run row so the Record column can link a task, a KPI record or a kudos by name (today the UI slices the id, and a record that no longer exists reads "Not available" rather than a broken link). Settings read: `home.work.surface["automation.logs"]` (§1.7).

**Realtime.** A run in the **Running** state updates by refetching that row every 10 seconds while the drawer is open, and stops when it reaches a terminal status. No new poller runs when nothing is running.

**What changes vs today.** Real pagination and a date range (issue 19); the trigger reads as words (issue 19); the record links to the thing it happened to (issue 19); filters live in the URL; Esc closes the drawer; Retry only appears for people who can use it.

**Open questions.** One: how long should run logs be kept? There is no retention policy today and the table grows forever. This spec shows a footer count and pagination that work at any size, but the retention number is a founder decision (the settings spec already has a Retention and privacy card that could hold it).

---

## 3. Shared components this unit introduces or requires

| Name | Where it lives | Props summary | Used by |
|---|---|---|---|
| `AskAiThread` | `src/components/ai/ask-ai-thread.tsx` | `{ width: "panel" \| "page" }`; everything else comes from `useAiSession()`. Renders the landing, the turns, the tool rows, the composer and its states. | `/sidekick`, the Ask AI panel |
| `useAiSession` | `src/lib/ai/session-store.ts` | A single per-tab store: `{ sessionId, messages, streaming, error, open(sessionId), start({ q?, agentSlug?, context }), send(text), stop() }`. Backed by the four `/api/sidekick/*` endpoints. This is the one-session rule; nothing else may hold chat state. | `/sidekick`, the Ask AI panel, the page-header Ask AI slot, the palette row |
| `ToolCallRow` | `src/components/ai/tool-call-row.tsx` | `{ tool, input, result, error, durationMs }` → one 36px row with the concept's icon, a past-tense sentence and an optional link. Its verb map is typed against the 28 tools that survive the trim; a tool with no entry is a compile error. | `AskAiThread`, the agent run detail inside the agent drawer |
| `SentenceBuilder` + `TokenButton` | `src/components/automation/sentence-builder.tsx` | `TokenButton{ label, placeholder, onOpen, readOnly }`; `SentenceBuilder` lays out When / Only if / Then / Where and owns the dirty flag. | `/automation/workflows/[id]` |
| `RunStatusChip` | `src/components/automation/run-status-chip.tsx` | `{ status }` → the design system's pale `StatusChip` with this unit's mapping (Succeeded → success, Failed → danger, Partly done → warning, Skipped → neutral, Running → info with a `Dots live`). Replaces `shared.tsx`'s `StatusPill`, `WORKFLOW_STATUS_META`, `RUN_STATUS_COLORS`, `SEVERITY_META`, `DARK_PILL`, `CARD` and `BRAND_BLUE`, which are deleted along with their hardcoded hexes. | every automation route |
| `JsonBlock` | `src/components/ui/json-block.tsx` | `{ value, label, defaultOpen }` → a collapsible `--os-surface-1` block, JetBrains Mono 13/18, with a Copy icon button. | the logs run drawer, the builder's advanced condition row |
| `SchedulePicker` | `src/components/ai/schedule-picker.tsx` | `{ cron, onChange }` with four presets and a Custom cron field, rendering the cron back as words. | the agent drawer |

Required from other units, not introduced here: `HubSidebar`, `SidebarRow`, `AppOff`, `LockedPage`, the offline strip and the session-expired dialog (shell). `ComingSoonRow` is deliberately **not** on this list: §1.7 explains why this unit renders none; `TableCard`, `FilterPanel`, `Picker`, `SegmentedControl`, `StatusChip`, `Chip`, `Button`, `BackButton`, `Dots`, `OsEmptyView`, `Tooltip`, `Drawer`, `Dialog` (design system); `useDirtyGuard` (settings spec §8.5); `useOsToast`.

Deleted by this unit: `AiSidebar`, the `automation` `linksSidebar`, `src/app/(dashboard)/automation/shared.tsx`, `src/app/(dashboard)/ai/page.tsx` **and `src/app/(dashboard)/ai/layout.tsx`** (the `requireManagerOrRedirect` gate goes with the page), `src/app/(dashboard)/autopilot/*`, `src/app/api/autopilot/*`, `src/lib/automation/hub-access.ts`, the `.os-chat`, `.os-mkt`, `.aip`, `.auto` and `.os-sk` BEM families in `os.css` including the `.os-chat__new` gradient (`:3373`) and the `.os-sk` brand flip (`:31807`), and the `sidekick` / `agents` / `ai` / `autopilot` `stubModule` rows and `agents/*` path map entries in `catalog.ts:607-610, 659-662` (this last line is `critic-gaps.json` #14's `ai-automation 3.5` evidence).

**Not deleted here, deleted by the tools-misc unit, listed so the sweep is complete**: `src/app/(dashboard)/integrations/page.tsx` survives and is rebuilt by that unit, and `src/app/(dashboard)/integrations/layout.tsx` (which calls `requireManagerOrRedirect()`, verified in the code) is deleted by that unit alongside `tools/layout.tsx` and `assets/layout.tsx`. Both specs must land for §1.4's "nothing in this hub redirects a denial" to be true, so it is named on both sides rather than assumed.

---

## 4. Migration and build notes

Order of work. Steps 1 to 3 are independent of every other unit; step 4 needs the shell's `HubSidebar`; steps 5 to 8 need the design system's primitives (design-system §8.5 steps 1, 2 and 4).

1. **Delete the mocks and redirect.** Remove `/ai` (page and layout), `/autopilot`, `/api/autopilot/*`, the four `stubModule` rows, the `agents/*` path map entries, the Marketplace INSTALLED entries for them, and the "Super Agent · Hot" and "Create with AI" rows in `create-menu.tsx`. Add the three 308 redirects (`/ai`, `/autopilot`, `/automation`) to `next.config.ts`; `/integrations` is **not** redirected (§0). Re-point `dashboard-content.tsx:301` to open the Ask AI panel. Ships alone, removes the most-reported dishonesty, touches no live data path, and is the whole of this unit's share of `critic-gaps.json` #14.
2. **Access swap.** Replace `resolveAutomationContext` / `canManageAutomations` / `AutomationRole` with `requireCan` in all 15 `/api/automation/*` routes and `gatePage` in the automation layout; add the same to `/agents` and `/sidekick`. Blocked on the access unit's step 1 (`can()` wrappers); until then the wrappers delegate, so behaviour is unchanged on merge. Add `PATCH /api/agents/[slug]`, `DELETE /api/agents/[slug]`, `GET /api/agents/runs/[id]` and the cursor envelope on `GET /api/agents/runs`, each behind `requireCan("manage", { type: "settings", page: "apps" })` for the writes.
3. **Copy and honesty pass.** Remove the dead controls listed in §2 (panel model pill, More, Attach, All sources, Featured and Search fake capabilities, the `OsTitleBar` trio and fake avatars on this unit's four pages, the four Connect buttons, the `/agents` buttons). Remove the em dashes in `sidekick/page.tsx:38`, `usage/page.tsx:149`, `workflows/page.tsx:413`. Trim the tool registry to the PPMS set and complete the tool verb map.
4. **AI hub sidebar.** Author the `SidebarSpec`, delete `AiSidebar` and the `automation` app entry, wire the chat rows and their "…" menu. Blocked on the shell unit's `HubSidebar` and `resolveActiveRow`; this is also what fixes the sticky-sidebar bug for every "Automate" and "Ask AI" link.
5. **One session.** Build `useAiSession` and `AskAiThread`, mount both in the page and the panel, honour `?session=`, `?q=`, `?agent=`, `?new=1`, `?view=all`, `?pinned=1`, `?archived=1`. Add the archived list and restore to the sessions API. No change to the streaming route's persistence behaviour in the same PR (data-integrity rule).
6. **Automation restyle.** `TableCard` + header stack + `FilterPanel` + `Picker` on Workflows, Logs, Health, Usage, Templates, Connections; delete `shared.tsx`. This is where the dark pill becomes the one blue button and the zinc utilities become tokens.
7. **Builder.** Dirty guard, responsive Details panel, typed condition values, the Where-it-runs scope, version history and restore, the Republish tooltip. The scope field needs the matcher change in `src/lib/automation/engine.ts`; ship the writer and the matcher together, behind a read that treats a missing `scope` as "Everywhere".
8. **Agents rebuild.** The table, the drawer, the Add agent modal, the schedule picker, the run history tab.

**Data migrations.** None required. The webhook signing secret lives in the existing `metadataJson`. `definition.scope` lives in the existing `definition` JSON. Version restore writes a new `AutomationWorkflowVersion` row using the existing model. The only destructive step is deleting the legacy `Workflow` rows with `kind: "AUTOMATION"`, which are unreferenced by any UI after step 1; do it as a reported, reversible script, never silently.

**Blocked on other units.** The shell's `HubSidebar`, `ROUTE_HUB`, offline strip, session-expired dialog and page-header `askAi` slot; the access unit's `can()`, `gatePage`, `AppOff`, `LockedPage` and `AccessRequest`; the settings unit's Apps and modules › Automations card (which owns `automationsPaused` and the quota display) and Data › Retention and privacy (`aiEnabled`); the design system's `TableCard`, `FilterPanel`, `Picker`, `SegmentedControl` and `Dots`; the tools-misc unit's `/integrations`, `/store` and `/build` pages, whose three rows this unit renders in the APPS section.

**Requests this unit makes to other specs** (each one is a change to a table another unit owns, so none is made silently):

| To | Request | Why |
|---|---|---|
| shell, `spec-shell.md` §1.1 | Drop `/ai` and `/autopilot` from the `ai` `ROUTE_HUB` row; **move `/favorites` from `ai` to `home`**; keep `/integrations` on `ai` | §1.1. The two pages cease to exist; `/favorites` is `spec-work-home.md`'s page, and while the shell's table and that spec disagree, the URL-derived highlight for the route is undefined |
| shell, `spec-shell.md` §1.16 | Add one row: below 1024 the Ask AI panel does not render, and ⌘J navigates to `/sidekick` | §1.6. The container "pushes content, never overlays" and `--os-scrim` is reserved for modals, so a narrow overlay sheet is not available and the full page is the right answer |
| shell, `spec-shell.md` §1.8 | Register a page-scoped override of ⌘J on `/sidekick` (focus the composer instead of toggling the panel) | §2 `/sidekick` Keyboard. Two threads must never be on screen |
| shell, `spec-shell.md` §1.2 rule 11 | Confirm `sidebar.collapsedSections[]` as the one section-collapse key, keyed `{hub}.{section}`; `spec-work-home.md` writes the same mechanism as `sidebar.groups.favorites` | §1.2. One mechanism, one key |
| access, `access-model-spec.md` §9 | Add `/api/agents/*` to the named call sites of the `settings.manageIntegrations` gate rule | §1.4. Gives agent writes an expressible gate without a new `ObjectType` or app key |
| access, `access-model-spec.md` rule 2 | Add one line: the `ai` app key also resolves off when `settings.data.aiEnabled` is false | §1.4. One denial component instead of two concepts; the fallback if declined is written out |
| access, `access-model-spec.md` §9 | Decide who may see per-person automation activity (Usage › Top people) | §2 `/automation/usage`. This spec ships the conservative reading and records the question |
| settings, `settings-architecture.md` §9.2 | Accept `home.work.surface` keys from hubs other than Work (`automation.workflows`, `automation.logs`, `agents.runs`, `sidekick.allChats`) | §1.7. No schema change, only the `.strict()` key set |
| tools-misc, `spec-tools-misc.md` §4 | Confirm that unit deletes `integrations/layout.tsx`'s `requireManagerOrRedirect` | §1.4 and §3 |
| tools-misc, `spec-tools-misc.md` §0 and §2.6 | Withdraw the 308 from `/integrations` into `/automation/connections`; the page is KEPT and that unit owns it | §0. Both units had 308ed it while each believed it was deferring to the other; access §5.2.1 keeps it reachable by every Member |
| tools-misc, `spec-tools-misc.md` §1 | Section label in the AI hub sidebar is **APPS**, not "Add ons" (the hub owner owns its sidebar); row label is **Build apps**, icon `Hammer` | §1.2. `settings-architecture.md` §5.3 prints "Build apps"; `Wrench` belongs to the Teams Tools row |
| access, `access-model-spec.md` §5.5 | Confirm the three denial shapes as written in §1.4 (app key excluded = in-shell 404; view parameter = default view plus notice; object without a role = `LockedPage` with Request access) | §1.4. Six units reached three different answers for one question; this states which situation takes which shape |

**Ships independently.** Steps 1 and 3 are pure deletions and copy fixes with no dependency. Step 8 depends only on step 2.

---

## 5. Checklist against the audit

`ai-automation.md` §4, all 27:

| # | Resolution |
|---|---|
| 1 | Resolved by §1.2: the `/sidekick/history` and `/sidekick/prompts` rows are deleted; history becomes the CHATS section and `/sidekick?view=all`, prompts become the landing starters. |
| 2 | Resolved by `/agents`: the page is rebuilt on `GET /api/agents`, install, schedule, run-now and runs; every handler-less button and every fabricated metric is deleted. |
| 3 | Resolved by `/agents`: the Work home card's Manage link lands on a page with the schedule, autonomous prompt, Run now and run history. |
| 4 | Resolved by `/sidekick` URL states: `?q=` creates a session and sends the text. |
| 5 | Resolved by `/sidekick` URL states: `?session=` opens that thread; `?pinned=1` is the Favorites target agreed with the Work unit. |
| 6 | Resolved by §0: `/autopilot` and `/api/autopilot/*` are deleted with a 308 to `/automation/workflows`. |
| 7 | Resolved by the Ask AI panel spec: model pill, More, Attach, All sources and the fake Featured and Search capabilities are removed. |
| 8 | Resolved by §1.5: `useDirtyGuard` on the builder, intercepting BackButton, breadcrumb, sidebar, rail and `beforeunload`. |
| 9 | Resolved by §1.1: hub and row come from the URL through the shell's `resolveHub` / `resolveActiveRow`; `activeAppKey` is not read. |
| 10 | Resolved by §1.2: one AI hub sidebar owns all six automation rows; the second `automation` rail app is deleted. |
| 11 | Resolved per route: `OsTitleBar` is replaced by the design system's header, whose props are real (`title`, `back`, `actions`, `askAi` gated on entitlement); the trio, the star and the fake avatars are gone. |
| 12 | Resolved by `/sidekick`: greeting, initials and model label removed; Attach removed; Delete becomes Archive with a real Archived view and Restore; Rename and Pin exist on the route; the session list has loading and error states. |
| 13 | Resolved by §1.3: **Ask AI** is the one label; Sidekick, Brain, AI Engine, Create with AI and Super Agent are retired. |
| 14 | Resolved by §1.4 read-only mode: no mutation control renders for a viewer who lacks the right, on any of the seven automation surfaces. |
| 15 | Resolved by `/automation/connections`: four dead Connect buttons removed, disconnect, rotate and test added, the page gated to Owner and Admin with `LockedPage` for a Member. The "third integrations door" half is resolved by keeping two doors with one job each (Connections for the webhook, `/integrations` for the catalogue) and deleting the third (`/settings/integrations`, 308 shipped by the settings unit), rather than by a merge that would have taken the catalogue away from every Member. |
| 16 | Resolved by §1.6: the Details panel stacks under the sentence below 1024 instead of disappearing. |
| 17 | Resolved by the builder: Where-it-runs scope, typed condition values with the people picker, version history with Restore, Alert level with an explanation, the Republish tooltip. |
| 18 | Resolved by `/automation/workflows`: `?listId=` / `?spaceId=` filters the list and pre-fills the new automation's scope. |
| 19 | Resolved by `/automation/logs`: cursor pagination and a date range, the trigger as words, the record as a link. |
| 20 | Partly resolved by `/automation/usage`: the copy is honest, the em dash is gone, month navigation works, and the Pause-all link exists for Owners and Admins. The plan linkage is **deferred because billing is not wired**; it is the route's open question. |
| 21 | Resolved by §0: `/ai` is deleted, so the manager-gated static page and the employee-bouncing CTA both go; the assistant's one rule is "every Member". |
| 22 | Resolved by §3 and step 6: `shared.tsx`'s hexes and dark pill, the `os.css` gradient families and the pre-OS digest-card tokens are all deleted; one token system remains. |
| 23 | Resolved by §1.6 and by moving the chat list into the hub sidebar; the panel becomes an overlay sheet under 1024; the templates and agents grids become responsive. |
| 24 | Resolved by §0: `/automation` redirects instead of 404ing; `/sidekick/*` dead links are removed. |
| 25 | Resolved by step 1: the legacy API, the four `stubModule` rows, the `agents/*` path map and the Marketplace INSTALLED entries are deleted. |
| 26 | Resolved by step 3: the three named em dashes are replaced with commas or full stops, and every bare dash placeholder in a cell is replaced with words. |
| 27 | Resolved by step 3: the registry is 42 names, not the 40 the inventory states; 14 CRM, helpdesk and marketing verbs are removed (including `assign_ticket`, which an earlier draft of this spec missed) leaving 28, and `ToolCallRow`'s verb map is typed against those 28 so a missing entry is a compile error. |

Also resolved from the inventory, outside the numbered list:

| Where | Resolution |
|---|---|
| §2.8 "no test/dry-run button (low)" | **Deferred**, with the reason written into the builder's Data block: the engine has no simulate mode, so a Test button would either write real records or do nothing. The real feedback loop (inline Publish validation, Recent runs, the Logs run drawer, and Connections' own Send a test) is spelled out instead. |
| §6 "Health/Usage (org-wide metering) readable by any member" | Health stays readable by every Member (it is about the automations, which every Member can already see). Usage's per-person table is gated to Owner and Admin and the wider question is an open question for the founder. |

`critic-gaps.json` `topSystemicIssues` that touch this unit:

| Issue | Resolution |
|---|---|
| #1 nav decoupled from the URL, orphans, dead sidebar links | Resolved by §1.1 and §1.2 for this hub: URL-derived hub and row, all six automation rows present, `/ai` and `/autopilot` orphans removed by redirect, two 404 rows deleted. |
| #2 fabricated and inert chrome | Resolved across §2: `/agents`, `/ai` and `/autopilot` mocks gone; the `OsTitleBar` trio, the star and the fake avatars gone from this unit's pages; the panel's five dead controls gone; the connections page's four dead buttons gone. |
| #3 duplicate surfaces | Resolved: one chat session store for page and panel; `/autopilot` merged into `/automation/workflows`; three integrations doors become two with one job each (Connections = the webhook automations send to, Owner and Admin; Integrations = the connector catalogue, every Member) with the third, `/settings/integrations`, 308ed away by the settings unit. |
| #4 fragmented access, no read-only mode | Resolved by §1.4: one `can()` for nav, page and API; `AutomationRole` deleted; read-only mode on every surface; one denial convention with no redirects. |
| #5 no back convention | Resolved by §1.5: `BackButton{fallbackHref}` on the builder and the All chats view; a named close target for every drawer, panel and modal; Esc everywhere. |
| #6 five visual systems | Resolved by §3 and step 6: this unit lands entirely on the design system's tokens and primitives. |
| #7 settings that do nothing, no dirty guard | Resolved: `automationsPaused` gets a visible strip on Workflows, `aiEnabled` gets a stated effect (§1.4) rather than being a switch nobody reads, the builder gets the dirty guard, and every per-viewer view choice in this unit (columns, Show archived, sort, page size) has a named persistence home in §1.7 instead of being in-memory. |
| #9 naming drift | Resolved by §1.3. |
| #10 desktop-only, hover-only | Resolved by §1.6: breakpoints on the chat, the panel, the builder's Details panel and the card grids; the row "…" is keyboard reachable and always visible on touch. |
| #11 errors swallowed, no session-expiry handling | Resolved per route: every load has an explicit error row with Retry, the chat stream keeps the user's message and restores the draft, and a 401 raises the shell's session-expired dialog instead of an empty state. |
| #12 hard caps and polling | Resolved for logs, agent runs and All chats (cursor pagination replaces `take=100` and the unbounded lists) and the chat (SSE only). The one new poller is scoped to an open drawer showing a Running run and stops at a terminal status. |
| #14 dead code and stale registries (evidence names `ai-automation 3.5`) | Resolved by migration step 1 and §3: the `sidekick`, `agents`, `ai` and `autopilot` `stubModule` rows, the four `agents/*` path map entries (`catalog.ts:607-610, 659-662`), the Marketplace INSTALLED and "suite tier" entries for them, `/api/autopilot/*`, `automation/shared.tsx`, `hub-access.ts` and the five dead `os.css` BEM families are all deleted. The legacy `Workflow` rows with `kind: "AUTOMATION"` go by a reported, reversible script. |
| #15 copy hygiene, "Coming soon" rendered as controls | Resolved: the named em dashes go; this unit renders zero `ComingSoonRow`s (§1.7 says why), the four dead Connect buttons go, and an unavailable action in the builder's picker is absent unless the viewer turned `home.ui.showUpcoming` on, in which case it is a non-selectable row, never a button that toasts. |

Deferred, with the reason:

- **Plan-linked automation limits** (audit 20): deferred because billing checkout is not wired; the page states the fixed allowance and offers no upgrade button rather than implying a plan that does not exist.
- **Save a workflow as a template** (audit §2.9): deferred pending the founder's answer on who curates workspace templates; no control suggests it exists.
- **Stop generating** on a streaming answer: deferred because aborting the client read does not stop the server run, and a button that only appears to stop something is the dishonesty this spec removes. While streaming, Send shows the `Dots pending` loader instead.
- **Run-log retention**: deferred to the founder's answer; the UI paginates correctly at any table size in the meantime.
- **A test or dry run in the builder** (inventory §2.8): deferred because the engine has no simulate mode, so the button could only lie or write. The honest substitutes are named in the builder's Data block.
- **Who may see per-person automation activity** (inventory §6, Usage › Top people): deferred to a founder decision that becomes one line in access §9. Until then the table is Owner and Admin, and `topPeople` is omitted from the API response for everyone else.

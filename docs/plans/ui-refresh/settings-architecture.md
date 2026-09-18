# WorkwrK settings architecture: the definitive spec

Date: 2026-09-11. Status: synthesized from a judged panel of three proposals (Two doors, Admin console, Contextual) against the audit inventories (`settings-pages.md`, `access-model.md`, `critic-gaps.json` #4 and #7), the direction docs (`existing-direction.md`, `phase2-inputs.md`, `zoho-reference.md`), the access track's contract (`access-model-spec.md`) and the code at commit `6187227a` in `/Users/bigboldtechnologies/theywrk`. Every path below is repo-relative unless it starts with `/private/tmp`.

Base: **Two doors** (winner with all three judges; tally 41 / 39 / 42 against 37 / 38 / 38 for the console and 31 / 30 / 30 for contextual). Grafted: every item the three judges flagged from the Admin console and Contextual proposals, with conflicts between grafts, and between grafts and the access model, resolved in section 0.3. Nothing in this document is a proposal; it is the contract the Phase 3 surface specs reference by settings path.

Writing rule honoured: no em dashes, no double hyphens in prose. Code tokens such as `--os-brand` are code.

Reconciliation pass (2026-09-11): every cross-doc contradiction with `access-model-spec.md` is resolved on this document's side in the access spec's vocabulary (Owner / Admin / Member / Guest, Agent flag, People team, Admin scopes, the `AdminOnly` denial family, `src/lib/access/settings.ts` as the rule table, `/organization` as the org chart home, invariant 13's fallback, fixed Member-invite rule). Where the access spec is silent or its claim does not match the code, this document writes the rule and marks it "flagged to the access spec": §3.1 key map, §3.3 settings discoverability, §5.7 the 14 enforced cells, §5.9 what `auth.ts` and `login-throttle.ts` read today and the SCIM / SAML JIT mapping, §7.1a rules for the folded app keys, §9.2a the per-field write table on the person record.

---

## 0. Decision record

### 0.1 Why Two doors is the base

It is the only shape a 20-person firm can explain to itself in one sentence: "your settings" versus "the company's settings". It is also the shape the product already has (`existing-direction.md`: "Settings = two doors: Admin server-gated, Personal `/account/*`"), so it closes the audit's access failures by adding ONE gate to `settings/layout.tsx` (today that file only wraps `SettingsShell`; six per-route layouts plus the inline lock card on Structure are the whole defence) rather than by building a new shell. It reuses fourteen existing pages, needs one additive migration, ships in six independently deployable steps, and every decision that must hold survives it: assignment grants item access, non-guest members write content, Lists and Folders share on their own, the rail is access-derived, Talk and Tables stay module-gated, the Talent 9-box stays reachable.

The Admin console lost on weight (8 sections, 27 pages, a new ConsoleShell, 24 redirects, personal preferences squeezed into a 720px modal that stacks MFA, password and delete dialogs inside it, five weeks by its own count) but it has the best findability story and the most complete inventory; both are grafted below (its corporate read tier is not, because the access spec gives the People team no Workspace door; §0.2, open decision 2). Contextual lost on findability (nine doors, org-wide rail config inside the personal Customize popover, an eight-tab Teams › Manage that is an admin console in disguise, and a generated index page it names as its own deciding risk) but it has the best object-level ideas; those are grafted into the share dialog and the object menus, not used to scatter the admin surface.

### 0.2 The vocabulary bridge to the access model

The judges scored the proposals in today's vocabulary (SUPER_ADMIN, COMPANY_ADMIN, C_LEVEL, HR, the manager / hr-admin / org-admin tiers). The access track's definitive spec (`access-model-spec.md`) retires that ladder: four org roles **Owner / Admin / Member / Guest**, an **Agent** flag on a Member, a **People team** (an org setting, not a rung), two delegable **Admin scopes** (`billing`; `security`) an Owner can switch on per Admin, and four object roles **Full access / Can edit / Can comment / Can view**. This settings spec is written in the new vocabulary and gives the transition mapping in §3.4 so it can ship before the access backfill lands.

Every graft that named a tier is re-expressed:

| Judges said | This spec says |
|---|---|
| "edit tier = SUPER_ADMIN, COMPANY_ADMIN" | Owner and Admin (Owner-only for billing, security policy, API keys, SSO/SCIM, delete workspace, unless the Admin holds the matching scope) |
| "read tier = C_LEVEL, VP, DIRECTOR, HR on Members, Structure, Access levels, Audit" | no read tier. The access spec is canonical here: the People team "cannot open Admin settings pages" (access §2.1), Members and Access are Owner and Admin pages (access §6.2, §6.5). C-suite, directors and the People team are Members whose people reach comes from the org chart or toggle 6, exercised in the Teams hub (`/people/[id]`, `/people/roles`, `/organization`), never in the Workspace door. An Owner who wants them to look makes them Admin. Open decision 2 records the read-tier alternative for a later release. |
| "SUPER_ADMIN is whitelisted out of the Members select" | the Role select offers Owner (Owners only), Admin, Member, Guest; SUPER_ADMIN never appears in any tenant UI (access invariant 22) |
| "who can invite = Admins / Managers and up / Everyone, replacing matrix cell people.create" | Members are invited by Owners and Admins, a fixed gate rule (`org.invite_member`, access §9 and D3); Guests by anyone with Full access on an object (access toggle 5). The ten toggles are the cap (access D10), so no eleventh "who can invite Members" control exists; the Invite rules card carries domain, auto-join, default role, default Spaces and expiry only (§5.5). Open decision 3 is now a flag to the access spec's D3, not a setting here. |
| "manager tree gating" | "has reports" is a computed fact, never a setting; managers and the People team edit people data on the person's profile in Teams (`/people/[id]`, `/organization` edit mode, `/people/roles`), never in Workspace settings. The per-field write table is §9.2a |
| "tiers.ts collapsing 25 tier lists" | `src/lib/access/` is the one authority (access §5.1). The settings page rule table is `src/lib/access/settings.ts` (access §5.1, §6.6); the door imports `viewerFromSession()`, `orgRoleOf(accessLevel)` and `SETTINGS_PAGES` from there and never a tier Set. `tiers.ts` and `src/lib/settings/pages.ts` are not created; the 25 copies die in access step 1 (wrappers) and step 8 (delete). |

### 0.3 Grafts adopted (source in brackets) and where they land

| # | Graft | Lands in |
|---|---|---|
| G1 | Settings registry as a tested contract: one `SettingEntry` per rendered field, unit test that every rendered field id exists, page title = sidebar row = breadcrumb = registry label, powers the door filter, the Overview search field and the ⌘K palette Settings group, hash anchors that scroll and pulse once. [Console, all three judges] | §8.2 |
| G2 | Read tier with disabled-free read-only rendering and one banner, instead of a flat 403 for everyone below Admin. [Console] Not adopted for v1: the access spec gives the People team no Workspace door (§0.2). What survives is the rendering rule (no disabled controls, ever) applied to the `AdminOnly` card and to the Overview cards an Admin without a scope sees. Open decision 2 keeps the read tier as a later option. | §3.2, §14 #2 |
| G3 | Non-admins landing on `/settings` from the rail hub or a deep link never hit a dead end: the rail hub opens My settings for them, and a `/settings/*` deep link renders the access spec's `AdminOnly` card at the same URL, carrying the Owners' and Admins' names and avatars ("Ask an admin") and a "Go to My settings" link. [Console] Re-expressed on the access spec's denial family (access §5.5 rule 3, §6.4). | §2.3, §3.3 |
| G4 | Rail apps page shows "N people lose access" before saving a floor or a hide; a one-time migration report lists orgs whose display-only config would now block someone; two-door's week of logged would-be denials stays as the second net. [Console] | §5.3, §12 step S6 |
| G5 | Sign-in policy depth: Require MFA as Nobody / Admins / Everyone (default Admins; env `ENFORCE_MFA_AT_LOGIN` stays the global floor), lockout threshold and minutes surfaced from `src/lib/login-throttle.ts`, password max age, require symbol, absolute session lifetime, Enforce SSO, and a typed-confirm "Sign everyone out" that bumps `tokenVersion` for every user. [Console] | §5.9 |
| G6 | Invite rules card: allowed email domains (chips seeded from `Organization.domain`), auto-join for allowed domains, default role for invites, "Add new members to these Spaces" applied on accept, invite expiry days. "Who can invite Members" is dropped: it is a fixed rule (Owner and Admin, access §9 `org.invite_member`), and the Invite button renders only for them. [Console] | §5.5 |
| G7 | Offboarding: Remove and Deactivate show where owned Spaces, Lists, Docs and tasks go, preselected per access invariant 13 (their manager, else the first Owner) and changeable by the admin; a Last active column (gear-toggled, off by default); a "No manager" filter so the org chart's "fix in Members" link becomes `?filter=unlinked`; Deactivate kept distinct from Remove. [Console] | §5.5 |
| G8 | Audit log as text tabs All / Access / Security / Data / Settings mapped to server-side type families, `GET /api/audit/types`, server-side `?q=`, actor filter honoured by export, explicit new event names, sampled `access.denied`, consecutive edits by one actor on one key within 60 s collapsed into one row. [Console + Contextual] | §5.12 |
| G9 | Company profile writes as ONE PATCH that rejects an empty name with a field error; no Save-bar form ever renders blank on fetch failure (retry state instead). Shell-level rule. [Console] | §8.6 |
| G10 | Members as a Zoho list page whose row click opens a 520px drawer holding every editable field; Filter side panel narrows the table. [Console] | §5.5, §10.1 |
| G11 | Origin rule through shell state (`lastAppPath` in shell context mirrored to `sessionStorage`) plus an explicit `openSettings(href)` / `closeSettings()` helper used by every entry point; "never `router.push("/today")` from settings chrome"; clickable breadcrumb. [Console + Contextual] | §8.3 |
| G12 | "Who can see this and why" on every share surface, built from the resolver's reason strings. [Contextual] Owned by the access spec's one share dialog (§6.1 there: inherited rows, Check access tab); this spec references it and never duplicates it. | §6.2 |
| G13 | Wire the Space "New members join as" control instead of deleting it; make Folder visibility editable after creation; last-owner guard; explicit Transfer ownership. [Contextual] In the access model these are the EVERYONE row's role, the Restricted switch, the last-Full guard and the Transfer action in the share dialog. | §6.2 |
| G14 | A full-directory picker endpoint for share, Reports-to and Invite pickers, never truncated by the caller's report tree. [Contextual] This is the access spec's `GET /api/people/pick`; the `/api/directory` name is not introduced. | §5.5, §9.4 |
| G15 | Resolver-first sequencing: the unified gate ships first behind a flag that logs old-versus-new disagreements for a week; the must-hold rules are golden tests. [Contextual] This is access steps 0 to 2; the settings door gate lands at access step 3. | §12 |
| G16 | Real Guest tier for Space and List email invites, with the honest interim copy "creates a member account" until it lands. [Contextual] Access §2.3; Members › Guests tab here. | §5.5 |
| G17 | Four-step admin first run (logo and mission, invite, departments, turn on Talk or Tables) plus a seeded "General" org-wide Space with canonical statuses at org creation; every tick derived from data, never "ticks when visited". [Contextual + Console] | §11.2 |
| G18 | `PATCH /api/preferences` and every `/api/settings` section schema reject unknown keys with a 400 that names them (`zod .strict()`), never strip silently. [Contextual] | §9.3 |
| G19 | Trash retention default 60 days, the number the delete confirmations and the catalog comment already promise. [Contextual] | §5.10, §11.1 |
| G20 | Admins flip a premium module from the `ModuleDisabledScreen` itself; the off module's rail icon renders dim with an "Off" dot for Admins only; non-admins never see it. [Contextual] | §5.3 |
| G21 | Keep Build, Store, Marketplace, Trash, Tools and Assets reachable outside the admin door: `/build`, `/store`, `/integrations` as rows in the AI hub sidebar (Owner and Admin, access §9 `settings.manageIntegrations`); `/trash` as a row in the Work hub sidebar for every Member, scoped to what they could delete; `/tools`, `/assets` under Teams with the access §9 audiences (Tools: every Member sees what is shared with them; Assets: own, manager chain, People team and Admin org-wide). [Contextual, lead engineer] The rule for every folded key is §7.1a. | §7.1, §7.1a |
| G22 | New personal keys live inside the existing `UserPreference.home` and `sidebar` JSON columns for the first release; the only `prisma db execute` step in the settings release is `User.weeklyCapacityHours`, `User.presenceStatus`, `User.presenceUntil`. Column promotion later. [Console, lead engineer] | §9.2, §9.5 |
| G23 | Generated "All settings" index (`/settings/all`, `/account/all`) rendered from the registry, grouped by door. [Contextual] | §8.2 |
| G24 | Personal notification depth: quiet hours honoured for email and desktop, a per-object muted list (Spaces, Lists, Docs, muted from the object's "…" menu), mute-all-until; and a List-level default task type (`Board.settings.defaultItemTypeId`) so the board "…" › "Default task type" row sets the List's default and links to the library. [Contextual + Console] | §4.3, §7.1 |
| G25 | Run the tier consolidation and the C_LEVEL / manager write removals behind the same week of logged disagreements so a customer who relied on C_LEVEL editing locale by URL is found in logs, not tickets. [lead engineer] | §12 step S1 |

### 0.4 Conflicts resolved

| Conflict | Resolution |
|---|---|
| Two-door hides the Settings hub from non-admins; the console and the access spec (`Settings = everyone (Personal)`) keep it; memory says `settings` is `alwaysPinned`; graft G3 says "rail hub" for non-admins. | The Settings hub stays on the rail for everyone (`alwaysPinned`, bottom slot). What it opens depends on the viewer: Owner and Admin land on Workspace settings › Overview; everyone else (Member, Agent, Guest, People team included) lands on My settings › Profile. The rail stays access-derived and never has a dead slot. |
| Console's read tier renders every control disabled with a banner; the access spec's read-only mode renders no control the role cannot use (principle 6); the access spec gives the People team no Admin settings page at all (§2.1, §6.2, §6.5). | The access spec wins twice: there is no read tier in the Workspace door, and nothing in either door renders a disabled control. A viewer without door access gets the `AdminOnly` card (§3.3). The People team's editing rights (people data, job titles) are exercised in the Teams hub where the access spec places them. |
| Console: "who can invite = Admins / Managers and up / Everyone". Access spec D3: Members are invited by Owners and Admins only; Guests by Full holders under toggle 5; D10: ten switches is the cap. | The access spec wins: no "who can invite Members" control. Member invites are Owner and Admin (gate rule `org.invite_member`); Guest invites are governed by access toggle 5 on `/settings/access` and the Invite rules card links there. Nothing called "Managers and up" exists any more; revisiting D3 is the access spec's decision. |
| Access spec caps `/settings/access` at ten switches; the console adds a nine-rule Spaces & sharing form. | The ten toggles are the whole object-sharing policy. The console's extra rows either map to a toggle (default visibility = toggle 2; who creates Spaces = toggle 1; object sharing = toggle 4; public links = toggle 10; link expiry = toggle 9), are covered by Can comment (guests can comment), or are dropped (default member role, replaced by the EVERYONE row). |
| Denial-log sampling: 1 in 10 per actor per hour (console graft) vs per viewer per target per 10 minutes (access spec). | Access spec wins: per viewer per target per 10 minutes. |
| Offboarding: console asks the admin where owned objects go; access invariant 13 transfers to the manager, else the first Owner, automatically. | Both, with the access spec's fallback: the Remove / Deactivate dialog preselects invariant 13's transferee (their manager, else the first Owner) and lets the admin pick someone else. When the dialog is not involved (SCIM deprovisioning, §5.9) invariant 13 runs unattended with the same fallback. No object is ever left ownerless. |
| New-org MFA default: two-door off, console "required for Admins". | Admins. `ENFORCE_MFA_AT_LOGIN` (already `true` in prod) remains the global floor; the org value can only narrow the audience the env allows. |
| Retention default: two-door 30 days, contextual 60. | 60 (G19). |
| Personal locale storage: two-door and contextual add columns; lead engineer keeps JSON keys. | JSON keys under `UserPreference.home.locale` for the first release; promotion to columns is a later, optional migration. |
| Two-door's per-page `settingsIndex` vs console's registry with a test. | The registry (G1). `settingsIndex` is not built. |
| Two-door's `document.referrer` + `?from=` origin rule vs console shell state vs contextual's `openSettings()` helper. | Both graft mechanisms, one helper (§8.3). `document.referrer` is not used (it does not update on App Router client navigations). |
| Two-door removes org notification defaults (no reader); console and contextual keep them with locks. | Not shipped in this release: the `notifications` section of `/api/settings` is retired. Re-added as one card on Members when `notify-prefs.ts` reads org defaults and locks (open decision 6). |
| Console navy console header vs two-door light takeover chrome. | Light. The takeover is a white canvas with a slim header, which is Zoho's own settings pattern; the navy chrome belongs to the app rail and top bar if the shell spec adopts it. |
| Phase 2 brief Q8 default (single takeover, four groups) vs two doors. | Two doors. The doors are the gate, not the sidebar; converting to one list is a day of work if the founder answers Q8 the other way (open decision 11). |
| Contextual moves task types, tags, scoring, offices and calendar connections to hub Manage pages. | Not adopted. Task system, Scoring and Structure stay in the Workspace door; calendar connections are personal and go to My settings › Calendar & connections; the object-scoped items (List default task type, Space defaults) stay in the object's "…" menu. |

---

## 1. The whole thing on one screen

```
TWO DOORS                                            ONE GATE
  My settings        /account/*    everyone            settings/layout.tsx -> gatePage("view", { type: "settings", page })
  Workspace settings /settings/*   Owner, Admin         from ONE page table in src/lib/access/settings.ts
                                   (scoped pages:       (the access spec's rule table; keys, labels, hrefs,
                                    Owner or scope)      aliases and rules in one row each)

ONE REGISTRY                                         ONE PERSISTENCE RULE
  src/lib/settings-registry.ts                         If it renders, it persists, and something reads it.
  drives sidebar labels, page titles, breadcrumbs,     No reader -> hidden behind "Show upcoming features".
  the door filter, Overview search, the ⌘K palette,    No read or write path -> not rendered.
  hash anchors, /settings/all and /account/all         localStorage never holds anything shown in a door.

ONE ORIGIN RULE                                      ONE DIRTY RULE
  openSettings(href) records where you came from;     Autosave rows never go dirty (inline Saved tick).
  Back, ×, Esc call closeSettings() -> origin,          Save-bar pages register useDirtyGuard; the bar
  else lastAppPath, else /today. Never a hard-coded     appears only when dirty; Back/×/Esc/rows confirm.
  /today from settings chrome.

OBJECT SETTINGS never enter a door: Space, Folder, List, Doc, Table, Channel settings and sharing live
in the object's "…" menu and the ONE share dialog (access-model-spec §6.1).
```

Sidebars, in full:

```
My settings (flat)                    Workspace settings (grouped)
  Profile         /account/profile      Overview                 /settings
  Preferences     /account/preferences  WORKSPACE
  Notifications   /account/notifications  Identity & culture     /settings/identity
  Security        /account/security       Locale & work week     /settings/locale
  Calendar &      /account/connections    Apps & modules         /settings/apps
   connections                          PEOPLE
  Keyboard        /account/shortcuts      Members                /settings/members
   shortcuts                              Structure              /settings/structure
  All settings    /account/all            Access                 /settings/access
                                        WORK
                                          Task system            /settings/tasks
                                          Scoring & reviews      /settings/scoring
                                        SECURITY & DATA
                                          Security               /settings/security   (Owner or security scope)
                                          Data                   /settings/data
                                          Audit log              /settings/audit
                                          API & webhooks         /settings/api        (Owner or security scope)
                                        BILLING
                                          Plan & billing         /settings/billing    (Owner or billing scope)
                                        All settings             /settings/all
```

Fifteen Workspace pages, six My settings pages, two generated indexes. Every page below is `{ door, key, label, href, group, gate, aliases }` in `src/lib/access/settings.ts` and its fields are registry entries. The access spec's page keys that this spec merges into tabs (`modules`, `tags`, `task-types`, `defaults`, `import-export`, `calendar`, `integrations`, `notifications`, `identity.sso`, `account/appearance`) exist in the same table as aliases of their home page, so "gate by page key" resolves every key the access spec names (§3.1).

---

## 2. Doors and entry points

### 2.1 Door 1: My settings (`/account/*`)

| | |
|---|---|
| Who | every signed-in person: Owner, Admin, Member, Guest, Agent |
| Shell | `SettingsShell door="me"`: header "Back to app" · breadcrumb `{First name} › My settings › {Page}` · × ; 248px flat sidebar; white content |
| Gate | signed-in session (`account/layout.tsx`); no role check |
| Rail | the Settings hub for anyone who is not Owner or Admin (Member, Agent, Guest, People team) |

### 2.2 Door 2: Workspace settings (`/settings/*`)

| | |
|---|---|
| Who | Owner and Admin; Owner-only pages open for an Admin only with the matching scope (`billing`; `security`). Nobody else, including the People team (access §2.1) |
| Shell | `SettingsShell door="workspace"`: header "Back to app" · breadcrumb `{Org} › Workspace settings › {Page}` · × ; 248px grouped sidebar with a filter field; white content |
| Gate | `settings/layout.tsx` (§3.1). A Member, Agent or People team member on any `/settings/*` URL sees the `AdminOnly` card at the same URL (access §5.5 rule 3); a Guest gets the shell's 404 (§3.3); a settings decision never redirects |
| Rail | the Settings hub for Owner and Admin |

### 2.3 What the rail Settings hub does

The `settings` AppEntry stays `alwaysPinned` (it is the escape hatch that keeps the rail non-empty and the page that fixes a bad config reachable). `defaultHref` becomes role-derived at render: `/settings` for Owner and Admin, `/account/profile` for everyone else. `matchPaths` shrink to `["/settings", "/account"]`; `/tools`, `/assets`, `/build`, `/store`, `/trash` are re-parented (§7.1, rules in §7.1a) and `SettingsSidebar` is deleted, which also ends the sticky Settings sidebar leaking onto Space pages (critic missedSurfaces). A Guest sees the hub too; it opens My settings.

### 2.4 Contextual entry points (every inbound link in `settings-pages.md` §0)

| Entry | Today | Now |
|---|---|---|
| Avatar menu "Settings" | `/settings` | "My settings" → `/account/profile` (everyone); a second row "Workspace settings" → `/settings` (Owner and Admin) |
| Avatar menu "Themes" | `/settings?tab=themes` (lands on Overview) | inline Light / Dark / System segmented control in the menu (persists to `theme.appearance`); "More appearance" → `/account/preferences?tab=appearance` |
| Avatar menu "Keyboard shortcuts" | `/settings?tab=shortcuts` (no page) | `/account/shortcuts`; the `?` overlay renders the same table |
| Avatar menu "Notifications" | `/inbox` | `/account/notifications`. The Inbox keeps its own gear for inbox view options, which now writes `home.notifications.inboxView` |
| Avatar menu "My Profile" | `/people/me` | unchanged |
| Avatar menu presence picker, "Mute notifications" | localStorage | write `User.presenceStatus/presenceUntil` and `home.notifications.mutedUntil` |
| Rail bottom "Upgrade" | `/settings` | `/settings/billing`; rendered only for Owners (and Admins with `billing`) on non-Enterprise plans |
| Workspace menu "Upgrade" | `/settings/billing` | unchanged, same visibility rule |
| Workspace menu "Manage members" | `/settings/members` | unchanged |
| Workspace menu "Invite people" | `/settings/members` | `/settings/members?invite=1` opens the invite modal on load; hidden when the viewer cannot invite Members |
| Workspace menu "Delete workspace" | dialog | `/settings/identity?tab=danger` |
| Board "…" › "Default task type" | `/settings/task-types` | a select in the board menu itself writing `Board.settings.defaultItemTypeId` (G24) with a "Manage types" link → `/settings/tasks?tab=types` (Admins) |
| Create-task modal type picker footer | `/settings/task-types` | `/settings/tasks?tab=types` (Admins); hidden otherwise |
| `ModuleDisabledScreen` "Enable in Settings › Modules" | `/settings/modules` | becomes the access spec's `ModuleOff` view (access §6.4): the on/off switch on the screen itself for Owners and Admins (G20); non-admins see "Ask an admin to turn on Talk" with the Owners' and Admins' avatars, no link |
| Org chart "Org settings" | `/settings` | `/settings/structure` (Owner and Admin; hidden otherwise) |
| Org chart "fix in Members" | `/settings/members` | `/settings/members?filter=unlinked` |
| People profile (self) "Edit personal info" | `/account/profile` | unchanged |
| Tools / Assets / Integrations "Settings" nav-link | `/settings` | removed; the hub breadcrumb is the way back |
| Admin setup checklist | `/organization`, `/settings` | the four first-run steps (§11.2) |
| Admin tour steps 1 to 3 | `/organization`, `/settings`, stale copy | `/settings/identity`, `/settings/members?invite=1`, `/settings/access`; copy rewritten to the registry labels |
| Command palette "Settings" | `/settings` | two entries, "My settings" (everyone) and "Workspace settings" (Owner and Admin), plus the Settings group of registry entries (§8.2). The palette filters apps through `visibleApps` (closes `command-palette.tsx:235`) |
| Planner "Connect Google Calendar" success redirect | `/settings/calendar?connected=1` (stub) | `/account/connections?connected=google` |
| Structure page link to bare `/account` | 404 | `/account` redirects to `/account/profile` |
| `g` then `s` chord | dead (`useGoToNav` has no importer) | removed from copy until the hook is mounted |

Every entry goes through `openSettings(href)` (§8.3).

---

## 3. Access to the doors

### 3.1 The one gate

`src/app/(dashboard)/settings/layout.tsx` resolves the page key from the request path and calls `gatePage("view", { type: "settings", page })` (access-model-spec §5.1). The page table it consults is the access spec's `src/lib/access/settings.ts` (access §5.1, §6.6), the one file allowed to hold settings role logic under the ESLint rule that forbids role logic outside `src/lib/access/`. `src/lib/settings/pages.ts` is not created. One row per page: `{ door: "me" | "workspace", key, label, href, group, gate: "everyone" | "admin" | "owner" | "owner-or-scope:billing" | "owner-or-scope:security", aliases: SettingsPageKey[] }`. The nav, the breadcrumb, the registry (`src/lib/settings-registry.ts` imports `SettingsPageKey` and `SETTINGS_PAGES` from `@/lib/access/settings`; it holds field labels and hrefs, never a rule) and the gate are all built from this table, so they cannot drift.

Resolving the page key in a layout: Next 16 layouts do not receive the pathname. `src/proxy.ts` stamps `x-workwrk-path` on every request (it already inspects `req.nextUrl.pathname` at line 124); the layout reads it with `headers()`. As belt and braces, every Owner-only page (`billing`, `security`, `api`) also calls `gateSettingsPage(key)` in its own server component, which renders the same `AdminOnly` card, so a missing header can never widen access.

Outcomes:

| Viewer | Outcome |
|---|---|
| Owner; Admin with the scope the page needs; Admin on an Admin page | full page |
| Admin on an Owner-only page without the scope | `AdminOnly` card at the same URL: "Billing is managed by workspace Owners." with Owner avatars and an "Ask an Owner" mailto (access worked example H) |
| Member, Agent, or People team member on any Workspace page | `AdminOnly` card at the same URL (§3.3); no redirect, no page content, no My settings rendered under a `/settings` URL |
| Guest on any Workspace page | the shell's 404 (`notFound()`): Workspace settings are not discoverable to Guests (§3.3) |
| not signed in | `/login?callbackUrl=…` (the only redirect in the system) |

The six per-route layouts (`apps`, `audit`, `data`, `defaults`, `identity`, `tags`) and the inline lock card on Structure are deleted. `route-guard.ts` is not imported by anything under `settings/` after this change and dies in access step 8.

**Key map.** The access spec (§6.6, §7.2, §15 #18) names page keys this spec merges into tabs or moves to the personal door. Every one of them is a row or an alias in `src/lib/access/settings.ts`, so the access spec's "gate by page key" holds for each:

| Access spec key | Home in this spec | Rule (unchanged from access §6.6) |
|---|---|---|
| `overview`, `identity`, `locale`, `apps`, `members`, `access`, `audit`, `scoring`, `data export` (`data`), `structure` | the same page | Owner and Admin |
| `modules` | alias → `/settings/apps#modules` (§5.3); the switch also renders on `ModuleOff` | Owner and Admin |
| `tags`, `task-types` | aliases → `/settings/tasks?tab=tags`, `?tab=types` (§5.8) | Owner and Admin |
| `defaults` | alias → `/settings/identity?tab=appearance` (§5.2) | Owner and Admin |
| `import-export` | alias → `/settings/data?tab=import` (§5.10) | Owner and Admin |
| `integrations` | alias → `/settings/api` footer and the `/integrations` catalog (§5.4) | Owner and Admin for the catalog; Owner or `security` for API keys and SCIM (access §9 `settings.manageIntegrations`) |
| `organization chart edit` | `/organization` edit mode (Teams hub, access §3.5); Structure links to it (§5.6) | Owner and Admin |
| `calendar` | moved to the personal door: `/account/connections` (§4.5); the backend (`CalendarSubscription`) is per user, so the org page was a stub | Everyone (Personal) |
| `notifications` (org defaults) | retired: no reader exists (open decision 6); the key stays in the table as `retired` and resolves to `/account/notifications` | Everyone (Personal) |
| `security policy` | `/settings/security?tab=signin` (§5.9) | Owner or `security` scope |
| `identity > SSO/SCIM section` | `/settings/security?tab=sso` and `?tab=scim` (§5.9); alias `identity.sso` | Owner or `security` scope |
| `billing`, `api keys`, `delete workspace` | `/settings/billing`, `/settings/api`, `/settings/identity?tab=danger` | Owner or scope; delete workspace Owner only |
| `account/profile`, `account/security`, `account/notifications` | the same pages | Everyone (Personal) |
| `account/appearance` | alias → `/account/preferences?tab=appearance` (§4.2); the URL 308-redirects | Everyone (Personal) |

Flagged to the access spec: §6.6 should list the aliases above so its table and this one are one table; the SSO/SCIM section lives on Security, not Identity, under the same `security` scope rule.

Every org write API uses the same rule: `PATCH /api/settings`, `PATCH /api/org/preferences`, `/api/keys`, `/api/scim-tokens`, `/api/products/installations`, `/api/item-types*`, `/api/tags*`, `/api/offices*`, `/api/webhooks`, `/api/audit-log/export`, `/api/billing/*` call `requireCan("manage", { type: "settings", page })` with the page that owns them. C_LEVEL's stray write to `/api/settings` (`settings/route.ts:123`) ends; `/api/item-types` gains the gate it never had (audit settings #2); `/api/audit` moves from `isManager` to the page rule. `/api/roles*` and `/api/departments*` are people-structure APIs with their own access §9 rules (job titles: Owner/Admin + People team; departments: Owner/Admin) and are called from both the Structure tabs and the Teams hub pages.

### 3.2 No read tier

There is no read-only rendering of a Workspace page for anyone. The access spec places every people-data and job-title right the People team holds in the Teams hub: `/people/[id]` (people data, access §3.5), `/people/roles` (job titles, access §9 `organization.manageRoles`), `/organization` (org chart, read for every Member), `/reviews`, `/talent`, `/analytics`. Structure › Job titles and Structure › Departments render the same components as `/people/roles` and `/people/departments`, so an Owner or Admin edits them from either door and the People team edits job titles from Teams; nothing is duplicated and nothing is rendered disabled. Open decision 2 records the read tier as a later option; if it is ever adopted the rendering rule is the access spec's (§5.4: no disabled controls, values as text, one banner).

### 3.3 The `AdminOnly` card and discoverability

The settings denial view is the access spec's `AdminOnly` card, one member of the `LockedPage` / `ModuleOff` / `AppOff` / `AdminOnly` family in `src/components/access/` (access §6.4), rendered at the same URL inside the My settings shell chrome:

- icon and the page label from the page table; one sentence "Workspace settings are managed by {Owner and Admin names}. Ask them if you need something changed." with up to five avatars and mailto links (the console's "Ask an admin" content, G3);
- `BackButton{fallbackHref="/account/profile"}` labelled "Go to My settings" (the access spec puts `BackButton{fallbackHref}` on every locked view);
- no "Request access" (settings pages are not shareable objects);
- the same card renders for an Admin on an Owner-only page without the scope, with the Owners' names only.

Discoverability, which the access spec's rule 14 defines for Spaces and public channels only, is defined here for settings and flagged to the access spec for §5.3: every Workspace settings page is **discoverable to every Member and Agent of the org** (the door exists for everyone who works there, so the card, not a 404), and **not discoverable to Guests** (access §2.3: "Settings shows only the Personal section"; a Guest on `/settings/*` gets the shell's 404). The four legacy redirect targets (`/dashboard`, `/people/me`, `/team/reviews`, lock card) are gone (access §5.5).

`ModuleOff` for non-admins carries the same "Ask an admin to turn on Talk" sentence and avatars (§2.4).

Every org write API uses the same rule: `PATCH /api/settings`, `PATCH /api/org/preferences`, `/api/keys`, `/api/scim-tokens`, `/api/products/installations`, `/api/item-types*`, `/api/tags*`, `/api/offices*`, `/api/webhooks`, `/api/audit-log/export`, `/api/billing/*` call `requireCan("manage", { type: "settings", page })` with the page that owns them. C_LEVEL's stray write to `/api/settings` (`settings/route.ts:123`) ends; `/api/item-types` gains the gate it never had (audit settings #2); `/api/audit` moves from `isManager` to the page rule.

### 3.4 Transition mapping while `User.accessLevel` still exists

Until access step 4 backfills `orgRole`, `viewerFromSession()` derives it with `orgRoleOf(accessLevel)`: SUPER_ADMIN and the org's earliest-created COMPANY_ADMIN → Owner; other COMPANY_ADMIN → Admin; HR → Member on the People team (`org.access.peopleTeam` seeded with HR users); everyone else → Member; AGENT → Member with `isAgent`. Admin scopes default empty, so during the transition an Admin who is not the first admin cannot open Billing, Security or API keys. The pre-flight report (access step 4.1) lists each org's chosen Owner for the founder's approval before this becomes visible; until it is approved, all COMPANY_ADMIN users are treated as Owners (`SETTINGS_OWNER_SPLIT=false`), so no Owner or Admin loses a page they can open today. HR users, who today open the hr-admin-tier pages, lose the Workspace door by design (access §2.1); S1's logged week names each org where that happens before the gate enforces.

---

## 4. Information architecture: My settings

Legend: **Persists** names the store and writer. **Mode**: A = autosave (writes on change, inline "Saved" tick, toast only on failure with Retry); S = Save bar (sticky bar appears only when dirty). Defaults marked "org" fall back to the org value through `getEffectivePreferences`.

### 4.1 Profile (`/account/profile`) · S

| Field | Default | Persists | Notes |
|---|---|---|---|
| Photo | initials | `User.avatar` via `POST/DELETE /api/users/[id]/avatar` (A) | |
| First name, Last name | from invite | `User.firstName/lastName` via `PATCH /api/users/[id]` (self path) | required |
| Phone | empty | `User.phone` | API already accepts it |
| Date of birth | empty | `User.dateOfBirth` | visible to self, manager chain, People team, Admins |
| Email | from invite | read-only | caption "Managed by your workspace admin" (SSO orgs: "Managed by {IdP}"); no fake change control until an email-change flow exists |
| Job title, Department, Office, Reports to, Role | read-only chips | | placement fields (§9.2a): written by the manager chain, People team and Admin, never by self, exactly as `users/[id]/route.ts:170-178` refuses them for self today. Labels from `src/lib/access/labels.ts`, never a raw enum; chips link to `/people/me`; caption "Ask your manager or the People team to change these" |
| Danger zone: Delete my account | | `POST /api/me/delete` (exists, no UI today) | typed "DELETE"; refused with a message for the last Owner |

### 4.2 Preferences (`/account/preferences`) · A · tabs Appearance | Language & region | Sidebar

Appearance:

| Field | Default | Persists | Notes |
|---|---|---|---|
| Theme | org (Light) | `UserPreference.theme.appearance` | greyed with a lock and "Set by your workspace" when `theme.appearance` is in `OrgPreference.lockedKeys` |
| Accent | workwrk | `UserPreference.theme.accent` | ONE list in `src/lib/accents.ts` shared with Workspace › Identity › Appearance defaults and the Customize panel: `workwrk, black, blue, teal, mint, orange, bronze`; `purple, violet, pink, indigo, grape` are deleted and normalised to `workwrk` on read. If the founder takes Phase 2 Q4 (one blue) the row hides itself when the list has one entry |
| Density | org (Cozy) | `UserPreference.density` | the `workwrk:density` localStorage mirror in `src/lib/density.ts` is removed |
| Reduced motion | follows OS | `UserPreference.home.ui.reducedMotion` | `ThemeApplier` sets `data-reduced-motion` |
| Show upcoming features | off | `UserPreference.home.ui.showUpcoming` | reveals "Coming soon" rows across both doors (Phase 2 Q15 default) |

Language & region (new; no per-user timezone exists today):

| Field | Default | Persists | Read by |
|---|---|---|---|
| Language | org | `UserPreference.home.locale.language` | `src/i18n/request.ts` (the 11 wired catalogs; this makes the setting real) |
| Time zone | detected on first sign-in, else org | `home.locale.timezone` (IANA) | reminders cron, due-date bucketing, calendars, timesheets; searchable IANA list with "Use device time zone" |
| Week starts on | org | `home.locale.weekStart` (`MON` / `SUN`) | Planner, DatePlanner, board calendar, timesheets (today they disagree) |
| Date format, Time format | org | `home.locale.dateFormat` (`DMY` / `MDY` / `YMD`), `.timeFormat` (`12h` / `24h`) | one `formatDate` helper |

Sidebar:

| Field | Default | Persists | Notes |
|---|---|---|---|
| Sidebar width | 260 | `UserPreference.sidebar.width` | replaces `workwrk:os:sidebar-width`; the drag handle writes it, debounced 500 ms |
| Start collapsed | off | `sidebar.collapsed` | replaces `workwrk:os:sidebar-collapsed` |
| Rail labels | Labels | `sidebar.iconsOnly` (exists) | Phase 2 brief drops icons-only; if it is dropped this row and the mirror `workwrk:os:icons-only` go together; lockable |
| Section order, Home cards | catalog, all on | `sidebar.sectionsOrder`, `home.cards` | shown here AND in the Customize panel (memory: the footer stays), both write the same keys. `home.cards` gains its reader (the Work sidebar and Space overview) or the row goes; decision: read it |
| Quick tools in the avatar menu | default set | `sidebar.quickTools` | replaces `workwrk:os:profile-tool-pins:v2` |

### 4.3 Notifications (`/account/notifications`) · A · tabs Inbox | Email | Desktop

| Field | Default | Persists | Notes |
|---|---|---|---|
| Inbox: Task assigned, @Mentions, Comments, Status changes, Due reminders, Kudos | all on | `home.notifications.inbox.{key}` (exists) | keys unchanged from `notify-prefs.ts` |
| Inbox display: group by date, show all in Other, auto-clear read after N days, default tab | as today | `home.notifications.inboxView` | replaces the Inbox gear's top-level `{inbox}` PATCH that the zod schema strips today; the gear writes this key |
| Mute all until | off | `home.notifications.mutedUntil` (ISO or null) | the avatar-menu "Mute notifications" writes here instead of `workwrk:os:muted-notifs`; `shouldNotify` honours it |
| Quiet hours | off | `home.notifications.quietHours { start, end }` in the user's time zone | honoured by `shouldEmail` and desktop; inbox rows still land |
| Muted items | none | `home.notifications.muted[] { kind, id }` | list with unmute; muting happens from a Space, List or Doc "…" › Mute; `filterNotifyUsers` reads it |
| Email: master, Task assigned, Kudos | on | `home.notifications.email.{key}` (Kudos also `EmailPreference.kudosNotifications`) | rows without a sender (Mentions, Comments, Status, Due, Daily digest) render only under "Show upcoming features", disabled, "Coming soon" |
| Email: KRA & KPI updates, Review reminders, SOP updates | on | `EmailPreference` via `PATCH /api/email-preferences` | unchanged |
| Desktop: Browser notifications | off | `home.notifications.desktop` plus the browser permission | replaces `desktop-notifications-pref`; the row shows the permission state and a "Re-request" action; captioned "this device asks for permission separately" |

### 4.4 Security (`/account/security`) · mixed

| Field | Default | Persists | Notes |
|---|---|---|---|
| Email verified | from signup | `User.emailVerifiedAt`; Resend → `/api/auth/request-verify` | |
| Two-factor (TOTP) | off unless required | `User.mfaEnabled/mfaSecret/mfaBackupCodes` via the existing enrol / disable dialogs | when the org policy (`settings.security.mfaRequired`) covers this person's role the row reads "Required by your workspace" and offers no "Turn off"; no disabled control is rendered |
| Password | | `POST /api/me/change-password`, validated with `src/lib/password-policy.ts` against the org policy | the org rules (min length, uppercase, number, symbol, max age) print inline under the new-password field, which is where a Member meets the policy; enforced at change time, not only at signup |
| Sessions | | `POST /api/me/sign-out-everywhere` | a device list appears only once a `Session` table exists (reserved slot, hidden) |
| Recent security activity | | `GET /api/me/security-activity` | unchanged; raw error strings replaced by `OsEmptyView` with Retry |
| Presence | Active | `User.presenceStatus`, `User.presenceUntil` (new columns) | the avatar-menu presence picker writes here instead of `workwrk:os:presence`; Talk and the directory read it |

The read-only "Workspace policy" card is not kept: the access spec's Owner page replaces it (access §6.6, §7.5), and the rules a Member needs surface on the two rows they apply to (Password, Two-factor). Owners and Admins with `security` see one text link under the Password row, "Workspace sign-in policy", to `/settings/security?tab=signin`; nobody else sees a link. The fabricated "security score" is removed. The page title is "Security" (registry label), not "Account · Security".

### 4.5 Calendar & connections (`/account/connections`) · A

| Field | Default | Persists | Notes |
|---|---|---|---|
| Google Calendar | not connected | `CalendarSubscription` rows via `/api/integrations/google-calendar/*` (Connect, choose calendars, Disconnect) | the real backend `time.md` found; the org page at `/settings/calendar` was the stub |
| Personal ICS feed | none | `/api/calendar/ics/token` (create, copy, rotate) | |
| Outlook, iCloud, Fastmail | | none | only under "Show upcoming features", "Coming soon" |

### 4.6 Keyboard shortcuts (`/account/shortcuts`) · read-only

The chords that work today (⌘K, ⌘J, ⌘B, ⌘⇧K, ⌘⇧N quick capture, ⌘1 to 9, doc ⌘L / ⌘D, sheet ⌘F / ⌘H), rendered from one `src/lib/shortcuts.ts` that the `?` overlay also renders. Dead `g` chords are not listed until `useGoToNav` is mounted.

### 4.7 All settings (`/account/all`)

Generated from the registry: every My settings field grouped by page, with its deep link. No controls.

---

## 5. Information architecture: Workspace settings

Legend as in §4. **Who**: O = Owner (or Admin with the named scope); A = Owner and Admin. Nobody else opens a Workspace page (§3.1); where the access spec gives the People team or a manager an edit right on the same data, the row says so and names the Teams-hub page where they exercise it.

### 5.1 Overview (`/settings`) · A

- Title "Workspace settings", subtitle `{Org} · {plan} · {N} members · {M} guests`.
- Search field (480 px, "Search settings") backed by the registry; results grouped by page; Enter opens the deep link.
- The first-run card (§11.2) until done or dismissed (`Organization.settings.console.setupDismissedAt`).
- One card per sidebar page (fourteen), each with two live values and a link to the page; no self-links (`settings/page.tsx:112,123` today); Owner-only pages render for Admins without the scope as a card with the lock glyph and "Owners only". Usage links stay inside the door (Members, Plan & billing), never out to `/people` or `/analytics`.
- Loading: route `ValueLoader`; error: `OsEmptyView` with a wired Retry.

### 5.2 Identity & culture (`/settings/identity`) · A · tabs Profile | Culture | Appearance defaults | Danger zone

Profile (S, one PATCH `section: "profile"`):

| Field | Default | Persists |
|---|---|---|
| Logo | none | `Organization.logo` via `/api/settings/logo` (A) |
| Workspace name | from signup | `Organization.name`; empty rejected with a field error |
| Primary email domain | from the first Owner's email | `Organization.domain` (validated hostname); used by invitations, Invite rules and Security |
| Industry, Business type, Team size | empty | `Organization.settings.industry / businessType / teamSize` (the last two are read on the Overview today and never written) |
| Branding (Enterprise `whiteLabel` flag only) | | the orphan `branding-manager.tsx` fields under `settings.branding`; otherwise one line "Available on Enterprise" |

Culture (S, `section: "culture"`):

| Field | Default | Persists |
|---|---|---|
| Mission, Vision, About (4-row textareas) | empty | `settings.companyProfile.*` |
| Core values (chips) | empty | `companyProfile.values[]`; feeds the loader, the splash and Kudos |
| Welcome splash | Every app open (current behaviour, 10-minute throttle) | `companyProfile.splash` = `every-open` / `first-open-daily` / `off` (open decision 4) |

Appearance defaults (A, absorbs `/settings/defaults`):

| Field | Default | Persists |
|---|---|---|
| Default theme, accent, density | Light, workwrk, Cozy | `OrgPreference.themeDefault`, `densityDefault` via `PATCH /api/org/preferences` |
| Lock theme / density / rail labels / home cards | unlocked | `OrgPreference.lockedKeys` with the dot-paths from one constants file `src/lib/preferences-locks.ts` (`theme.appearance`, `theme.accent`, `density`, `sidebar.iconsOnly`, `home.cards`); locked keys grey the rows in My settings › Preferences AND in the Customize panel (fixes the "not greyed out yet" admission) |

Danger zone (Owner only; the tab renders for Admins as a locked card):

| Action | Persists |
|---|---|
| Transfer ownership | `PATCH /api/users/[id]` role → Owner for another person, optional self-demotion; confirm names the remaining Owners; last-Owner guard |
| Delete workspace | `POST /api/organizations/delete` (exists), typed workspace name, 14-day restore via `/api/organizations/restore` |

### 5.3 Apps & modules (`/settings/apps`) · A · sections Modules | Rail apps | Automations

**Modules** (A): one bordered card per `MODULES` entry (Talk, Tables): name, one line, "competes with", a Switch writing `ProductInstallation` via `POST/DELETE /api/products/installations`, an "Open Talk" link when on, "Included in {plan}" or "Add-on" chip. Turning off confirms with the access spec copy: "Turning this off locks N channels / N tables for everyone until it is turned on again. Nothing is deleted." The same switch renders on the `ModuleDisabledScreen` for Owners and Admins (G20); the off module's rail icon renders dim with an "Off" dot for them only (`visibleRailApps` gains `viewerCanManageModules`), and never for anyone else.

**Rail apps** (A): the existing order / hide / floor table, grouped: "Rail hubs" (the 8) then "Apps inside hubs" (the folded apps under their hub, captioned "in {Hub} sidebar", so hiding Goals is understood as removing a sidebar row). Floor options follow the access model: Everyone · Members with reports · Admins. Persists as `OrgPreference.sidebarDefault.apps` (shape unchanged). **Change**: floors and hides become enforced by access rule 2 (`visibleApps` and `gatePage` share it). Before saving a floor or a hide the page shows "N people lose access to {app}" computed from `accessibleUsers` (G4); the caption "display only" is deleted because it stops being true. "Reset to default order" added. `alwaysPinned` (Work, Settings) rows stay locked. Footer text links: Build apps (`/build`), Marketplace (`/store`), which also live in the AI hub sidebar (§7.1).

**Automations** (A): one card, "Pause all automations" switch writing `settings.work.automationsPaused` (read by the automation runner) with the run quota beside it. Links to Health / Usage / Logs (`/automation/*`), giving those orphan pages a home from settings until the AI hub sidebar lists them.

`/settings/modules` redirects to `/settings/apps#modules`.

### 5.4 (reserved) Integrations

Not a page. The demand-driven marketplace stays at `/integrations` (AI hub sidebar row). `/settings/integrations` and `/settings/calendar` redirect (§7.1). An org-level "Allow members to connect Google Calendar" switch is not shipped until a reader exists in the OAuth route (open decision 12).

### 5.5 Members (`/settings/members`) · A · tabs People | Guests | Teams | Pending invites

Zoho list page: text tabs, toolbar Filter (side panel: Role, Department, Office, Status, No manager, People team, Inactive 30+ days) + Sort, one blue "Invite" (Owner and Admin are the only viewers, so it always renders), bordered table, footer "Total members N · 1 to 50 ‹ ›" with server cursor pagination (`/api/users?scope=all&cursor=`; org-wide for anyone who can open the page, so the silent team-scope coercion at `api/users/route.ts:50-54` can no longer mislabel a team as the org).

**People** columns are the access spec's (§6.2): Person (avatar, name, email; click opens the drawer; "Open profile" link → `/people/[id]`), Role, Agent, Reports to, Department, Teams, People team, Status, row menu. Job title and Last active are gear-toggled optional columns, off by default (the console's Last active graft survives as a column choice and as the "Inactive 30+ days" filter, not as a default column). Count strip: Owners N · Admins N · Members N · Guests N (free).

Row drawer (520 px, every field autosaves per row). The Who column is the Owner/Admin door's right; the last column names where the same field is written by people who never open this door (§9.2a):

| Field | Persists | Who (this door) | Also written from Teams by |
|---|---|---|---|
| Role: Owner (offered only to Owners), Admin, Member, Guest | `User.orgRole` (mirror `accessLevel` during transition) via `PATCH /api/users/[id]` with a value whitelist; to or from Owner and self-demotion confirm naming the remaining Owners; last-Owner guard; the target's `tokenVersion` is bumped so it lands on their next request (no "next sign-in" caveat needed) | Owner (Owner role), A (others) | nobody |
| Admin scopes: Billing · Security and integrations | `User.adminScopes[]`; in the Admin row's menu (access D4), default off | Owner | nobody |
| Agent | `User.isAgent`; Members only | A | nobody |
| People team | `settings.access.peopleTeam` (toggle 6) as a checkbox column so "who is HR here" is answerable on this page | A | nobody |
| Job title | `User.roleId`; the title's `seniority` shows as a hint, never changes the role | A | manager chain, People team (`/people/[id]`) |
| Department, Office | `User.departmentId`, `User.officeId` | A | manager chain, People team (`/people/[id]`) |
| Reports to (picker over `GET /api/people/pick`, cycle check server-side) | `User.managerId` | A | People team (`/people/[id]`, `/organization` edit mode) |
| Dotted-line managers (multi) | `UserDottedLine` rows | A | manager chain, People team (`/people/[id]`, `/organization` edit mode) |
| Weekly capacity hours (blank = org default) | `User.weeklyCapacityHours` (new column) | A | manager chain, People team (`/people/[id]`) |
| Status: Active / Deactivated; Deactivate, Reactivate | `User.status`; Deactivate opens the transfer dialog (G7) | A | nobody (SCIM deprovisioning writes it unattended, §5.9) |
| Remove from workspace | `DELETE /api/users/[id]` (moves from `isManager` to Owner/Admin per access §9), typed confirm, transfer dialog | A | nobody |

Transfer dialog (Deactivate and Remove): lists owned Spaces, Lists, Docs, Tables and open tasks with a transferee picker preselected per access invariant 13 (their manager, else the first Owner; the acting admin is one more option in the picker, never the default); writes one `membership.changed` audit row naming the transferee.

Bulk bar (when rows are checked): change department, deactivate, add to Team.

**Guests** (access §2.3): Guest, Shared objects (count with popover), Added by, Last active, Expires, Convert to Member (Admin only, consumes a seat; the access spec's verb), Remove (revokes every grant). Hidden with a "No guests yet" line until the Guest tier lands (access step 5); until then Space email invites say "creates a member account" (G16).

**Teams** (access G3): Name, `@alias`, Lead, Members, Shared on; create / edit / delete. Ships with access step 4.

**Pending invites**: Email, Role, Invited to (object, for Guest invites), Invited by, Sent, Expires, Status; Resend, Revoke, Copy link. Above the table, the **Invite rules** card (S, `section: "users"`):

| Field | Default | Persists | Enforced by |
|---|---|---|---|
| Allowed email domains (chips) | the org domain | `settings.users.allowedDomains[]` | `POST /api/invitations` (already domain-locks), signup, and Security › Sign-in domains (shown there read-only with a link) |
| Auto-join: anyone with an allowed-domain email joins as Member | off | `settings.users.autoJoin` | signup route |
| (not a field) Who can invite | | | one caption line: "Members are invited by Owners and Admins. Guests can be invited by anyone with Full access on a Space, List or Doc" with a link to access toggle 5 on `/settings/access`. Member invites are the fixed gate rule `org.invite_member` (access §9, D3); there is no eleventh toggle (access D10). The workspace-menu "Invite people" row renders for Owner and Admin only |
| Default role for invites | Member | `settings.users.inviteDefaultRole` | invite modal preselect; outside-domain addresses are always Guest (access invariant 17) |
| Add new members to these Spaces | none | `settings.users.defaultSpaceIds[]` | on accept, one EDIT grant per Space (a `SpaceMember MEMBER` row during the transition) |
| Invitation expiry days | 7 | `settings.users.inviteExpiryDays` | invitation create |

Invite modal fields: emails, role (Admin, Member, Guest), department, reports to, optional job title; domain-mismatch rows flip to Guest with a caption.

### 5.6 Structure (`/settings/structure`) · A · tabs Departments | Job titles | Offices | Org chart

Above the tabs, the **four-role strip** the access spec asks for on this page (§6.2: "the four-role explainer with live head counts and links to Members and Access"): one row of four counters, Owners N · Admins N · Members N · Guests N, plus "People team N", each a link to Members filtered by role, one sentence per role from `src/lib/access/labels.ts`, and a "How access works" link to `/settings/access`. The full prose explainer (access §13) stays on Access card 1 as access §6.5 requires; the strip here is the counts and the one-liners, so the two pages do not duplicate a page of prose.

| Tab | What | Persists | Who |
|---|---|---|---|
| Departments | the existing departments manager component (same one as `/people/departments`), rendered as a Zoho list (Name, Head, Parent, Members) | `Department` via `/api/departments` (gate: Owner/Admin per access §9) | A |
| Job titles | the existing roles list (same component as `/people/roles`); the level pill is relabelled "Seniority" and the copy stops claiming it controls access (access-model Broken #20); create / rename / archive | `Role` via `/api/roles` (gate: Owner/Admin + People team per access §9 `organization.manageRoles`; the People team edits at `/people/roles` in the Teams hub) | A |
| Offices | real CRUD (Name, City, Country, Time zone, Headquarters, Members) replacing the "Coming soon" tile | `Office` via `/api/offices` (exists) | A |
| Org chart | a link card, not an embed: "Open the org chart" → `/organization` (Teams hub, canonical, cycle-safe, "Edit reporting lines" mode for Owner, Admin and People team per §9.2a) plus the "No manager: N people · fix in Members" line → `/settings/members?filter=unlinked`. One chart, one place (settings-pages #14) | `User.managerId`, `UserDottedLine` written at `/organization` and in the Members drawer | A (link) |

`/settings/hierarchy` redirects to `/organization` (access §3.5, §6.2, §10.1). The hand-written ten-rung ladder prose is deleted.

### 5.7 Access (`/settings/access`) · A

Replaces `/settings/permissions`; the page the access spec specifies in §6.5, owned jointly. Three cards, autosave per row, an "Enforced at: {route}" tooltip on every row, no Save bar.

1. **How access works**: the access spec's §13 explainer as prose, live counts (Owners, Admins, Members, Guests, People team), links to Members.
2. **Access** (access toggles 1 to 8, `settings.access.*`, one zod schema owned by `src/lib/access/settings.ts`): Who can create Spaces and Teams (Everyone · Admins only; default Everyone) · New Spaces start as (Open as Can edit · Open as Can view · Private; default Open as Can edit) · Members can find Spaces they're not in and request access (on) · Editors can share (on) · Who can invite Guests (Anyone with Full access · Admins only · Nobody; default Anyone with Full access) · People team (people and/or department picker; empty) · Who can publish SOPs and Policies (Editors · Admins and People team; default Editors) · Who can delete Spaces, Folders, Lists, Docs, Tables (Full access holders · Admins only; default Full access holders).
3. **Guests and links** (toggles 9 and 10): Guest access expires after (Never · 30 · 90 days; default Never) · Public links (Off · View only; default Off).

Plus the **Lock it down** button (access §7.4): confirm listing exactly what changes (toggle 2 Private, 3 off, 5 Admins only, 7 Admins and People team, 8 Admins only, public links off, guest expiry 30 days), reversible row by row, one `access.preset.lockdown` audit row.

The permission matrix page, `PERMISSION_MODULES`, `/api/permissions` and `Organization.settings.permissions` are deleted per access §9 (each org's stored matrix is exported into one `access.matrix_retired` audit row and offered as a one-time download on Data › Export). Until access step 5 lands, `/settings/access` renders card 1 and, under a "Legacy" divider, the enforced-only matrix so nothing configurable disappears before its replacement exists; every other cell goes immediately.

The enforced cells, named, so the transitional grid, the access spec's wrapper and the golden suite agree on one list. A grep of `requirePermission` / `hasPermission` under `src/app/api` at commit `6187227a` (12 files) hits exactly **14** named cells: `people.create` (invitations POST); `sops.create`, `sops.edit`, `sops.publish`, `sops.delete`; `policies.create`; `kras.create`, `kras.edit`, `kras.delete`, `kras.assign`; `assets.create`, `assets.edit`, `assets.delete` (one call site passes the action dynamically and resolves to one of these three); `announcements.create`. The access spec's "18 enforced today" (access §9 count line, §14 `hasPermission` row) is flagged for correction to 14; the `access-model.md` §1.3 list is the source. The Legacy grid renders these 14 rows for the roles that exist in the transition (Owner, Admin, Member, Agent) and nothing else.

### 5.8 Task system (`/settings/tasks`) · A · tabs Task types | Tags | Templates

| Tab | What | Persists |
|---|---|---|
| Task types | the existing page body as a Zoho list (Name singular / plural, Icon, Built-in / Custom, Default, Used by); create on `ui/dialog` (the hand-rolled overlay goes); actions always visible; "Default type" select; Recommended library in a side drawer | `ItemType` via `/api/item-types*`, which gain the settings gate (audit settings #2); org default in `settings.work.defaultItemTypeId` |
| Tags | render the already-correct `settings/tags/tags-manager.tsx` (types, create, rename, colour, archive, delete against the real `type` / `_count.assignments` shape) restyled on `--os-*`; delete `settings/tags/page.tsx` and its fabricated SAMPLE data | `Tag` via `/api/tags*` |
| Templates | link card to the Template Center (`/templates`) filtered to workspace templates; no duplicate UI | |

`/settings/task-types` and `/settings/tags` redirect to the tabs. A List's own default task type is object-scoped: `Board.settings.defaultItemTypeId` set from the board "…" menu (G24) and read by the create-task modal before the org default.

### 5.9 Security (`/settings/security`) · O (`security` scope) · tabs Sign-in policy | Single sign-on | Provisioning (SCIM)

Sign-in policy (S, `section: "security"`; the editor the audit says does not exist). What the code reads today, so nobody mistakes a row for wired: only `src/lib/password-policy.ts` reads `Organization.settings.security` (min length, uppercase, numbers). `src/lib/auth.ts` hard-codes the session (`maxAge: 12h`, `updateAge: 30m`, lines 259 to 266) and gates MFA on `process.env.ENFORCE_MFA_AT_LOGIN` plus the person's own `mfaEnabled` (line 125). `src/lib/login-throttle.ts` is an in-process `Map` keyed by `ip|email` with `MAX_FAILS = 8`, `LOCK_MS = 15 min` and no org lookup. The access spec's §7.5 sentence "which the auth flow already reads" is therefore flagged for correction; every session, MFA and lockout row below is new wiring, built in S5.

| Field | Default | Persists | Enforced by |
|---|---|---|---|
| Minimum password length (8 to 64) | 8 | `settings.security.minPasswordLength` | `src/lib/password-policy.ts` at signup, invite accept, reset and change-password (wired today) |
| Require uppercase / number / symbol | on / on / off | `.requireUppercase`, `.requireNumbers`, `.requireSymbol` | same (`requireSymbol` is a new key in `SecurityPolicy`) |
| Password max age (days, 0 = never) | 0 | `.passwordMaxAgeDays` | the credentials `authorize` compares `User.passwordChangedAt` (new column, set by every password write) with the org value and signs in with a `mustChangePassword` claim; `src/proxy.ts` sends such a session to `/account/security?change=1` and nowhere else until it is cleared |
| Idle session timeout (minutes, 30 to 1440) | 720 | `.sessionIdleMinutes` (replaces the stale `sessionTimeout` display value of 30) | NextAuth `session.maxAge` is a static option, so the org value cannot be passed to it. Wiring: the `jwt` callback stamps `idleUntil = now + org.sessionIdleMinutes` on every refresh (it already re-reads the user; the org row is one join, cached in the token for `updateAge`) and returns `null` (signs out) when `now > idleUntil`; `maxAge` stays 12 h as the env ceiling and the org value can only narrow it |
| Absolute session lifetime (days) | 30 | `.sessionMaxDays` | the same callback compares the token's `iat` with the org value; `maxAge` stays the ceiling |
| Require MFA for: Nobody · Admins · Everyone | Admins | `.mfaRequired` (replaces boolean `twoFactorEnabled`, migrated on read: `true` → `everyone`) | after the password verifies, `authorize` loads the org policy by the user's `organizationId`: if the audience covers `viewer.orgRole` and the person has enrolled, the code is required (today's path); if the audience covers them and they have not enrolled, sign-in succeeds with a `mustEnrolMfa` claim and `src/proxy.ts` allows only `/account/security?enrol=1` and the sign-out route until `mfaEnabled` is true. `env ENFORCE_MFA_AT_LOGIN` stays the floor: `false` turns every audience into "enrolled users only", exactly today's behaviour. The card shows "N of M admins enrolled" |
| Lock out after N failed attempts for N minutes | 8 / 15 (the code's constants, kept as the default so the day-one behaviour does not change) | `.lockoutThreshold`, `.lockoutMinutes` | `recordLoginFailure(key, policy)` and `loginLockRemaining(key, policy)` take the policy as an argument; `authorize` resolves the user row by email before it records a failure, so the org policy is known for every real account and unknown emails use the defaults (no org can be inferred from an email alone, and none is needed). The store stays the per-process `Map`; a shared store (Redis or a `LoginAttempt` table) is the horizontal-scaling step the file already names and is not part of this release |
| Allowed sign-in domains | the org domain | read-only mirror of `settings.users.allowedDomains` with a link to Invite rules | login |
| Sign everyone out (typed confirm) | | new `POST /api/org/sign-out-everyone` bumping `tokenVersion` for every user; audit `security.sign_out_all` | |

The eleven rows extend the access spec's five (§7.5: min length, uppercase, numbers, idle timeout, MFA audience); the six additions (symbol, max age, absolute lifetime, lockout pair, sign-in domains mirror, Sign everyone out) are flagged to the access spec as this spec's additions, each with the reader named above, and the read-only card on `/account/security` is removed as access §6.6 requires (§4.4).

Single sign-on (S): SAML over `IdentityProvider` (enabled, issuer, SSO URL, SLO URL, certificate, attribute map, JIT provisioning) plus `settings.security.ssoEnforced` and a read-only service-provider card (ACS URL, metadata URL, entity ID). **Hidden unless "Show upcoming features"** until the SAML login route is verified end to end (honesty rule; risk 9 of two-door). Enterprise plan chip.

Provisioning (SCIM) (list): Name, Prefix, Created by, Last used, Expires, Revoke; Generate reveals once; base URL card. `ScimToken` via `/api/scim-tokens` (exists). Ships now.

**Provisioned people (SCIM and SAML JIT), in the access spec's terms.** Today `POST /api/scim/v2/Users` creates the row with the schema default for `accessLevel` and no manager, and `DELETE` / `active: false` only flips `status`. The rule:

| Event | Outcome |
|---|---|
| SCIM create, SAML JIT first sign-in | `orgRole = MEMBER`, `isAgent = false`, not on the People team, no Admin scopes. Owner, Admin, Agent and scopes are set only in the product (Members drawer); no IdP attribute or group can grant them. The attribute map carries `firstName`, `lastName`, `department` (matched to a `Department` by name, else ignored), `title` (matched to a `Role`, else ignored) |
| Domain lock | `userName` must end in one of `settings.users.allowedDomains`, else SCIM 400 `invalidValue`; SCIM never mints a Guest (invariant 17 holds because there is no object to share) |
| SCIM Groups push | maps to `Department` membership and `Team` membership (access G3) by display name; never to `orgRole` |
| SCIM `active: false` or `DELETE`; SAML deprovisioning | Deactivate: `User.status = INACTIVE`, `tokenVersion` bumped, and invariant 13 runs unattended (owned objects to their manager, else the first Owner) with one `membership.changed` audit row, `actorType = scim`; reactivation restores the row and nothing is transferred back |
| Last Owner | a SCIM deprovision that would remove the last Owner is refused (SCIM 409) and surfaces in the Audit log; invariant 10 |

### 5.10 Data (`/settings/data`) · A (Danger: Owner) · tabs Export | Import | Retention & privacy | Trash

| Tab | What | Persists |
|---|---|---|
| Export | rows Full workspace ZIP, People CSV, Timesheets CSV, Audit CSV with Last exported by / at and Download; Purchase orders CSV and Invoices CSV stay as two rows under a "Legacy" divider, rendered only when the org holds one or more `PurchaseOrder` or `Invoice` rows (Finance is out of the PPMS scope, but "compact means re-parent, never remove" and an org's own data must stay downloadable; orgs with none never see the rows); each download writes `data.exported`; "Recent exports" table from it; the one-time "previous permission matrix.json" download after access step 8 | existing export routes, `ActivityLog` |
| Import | the `/imports` hub content (People CSV wired to `/api/people/bulk-import` with a staging grid, which has no caller today; competitor importers only under "Show upcoming features"); import history | existing plus an `ImportJob` row or `data.import` audit rows; ships only after a real run of the bulk-import route (console risk 7) |
| Retention & privacy | Trash retention days (60), Audit log retention days (365), Members may export their own data (on), the orphan `privacy-controls.tsx` rows (consent, DSR export), AI features for members (on), BYOK (Enterprise `byok` flag, the orphan `byok-manager.tsx` flow) | `settings.retention.{trashDays, auditDays}`, `settings.data.{selfExport, privacy, aiEnabled}`; retention rows render only together with the purge cron that reads them (one row added to `scripts/CRON-SETUP.md`) |
| Trash | link card to `/trash` (route unchanged; also a Work hub sidebar row) | |

`/settings/import-export` redirects to `/settings/data?tab=import`; `/imports` keeps working and gains the door breadcrumb.

### 5.12 Audit log (`/settings/audit`) · A

Kept, rebuilt to the Zoho list: `OsTitleBar` removed (the shell header is the header; closes the double header), text tabs **All / Access / Security / Data / Settings** mapped to server-side type families, Filter side panel (Type from `GET /api/audit/types`, Actor searchable, Severity, Date range), server-side `?q=`, table Time / Actor / Event / Target / Severity, row click opens a drawer with description, metadata and the `oldValue` → `newValue` diff the API already returns, Export honours every active filter including actor, KPI tiles removed (the "Today" tile counted the loaded page). `/api/audit` tier becomes the page rule.

Events the rebuild writes (so the Access tab has rows): `org_role.changed`, `access.granted / changed / revoked`, `access.request.*`, `access.preset.lockdown`, `membership.changed`, `visibility.changed` (Restricted / Findable), `settings.updated.{section}` (exists), `security.policy.updated`, `security.sign_out_all`, `data.exported`, `data.imported`, `permissions.updated` (transition only), `access.denied` (sampled per viewer per target per 10 minutes, access §5.1), `actorType` on every row. Consecutive edits by the same actor on the same key within 60 s collapse into one row at write time.

### 5.13 API & webhooks (`/settings/api`) · O (`security` scope) · tabs API keys | Webhooks | AI keys (flag)

| Tab | What | API |
|---|---|---|
| API keys | existing list / mint / revoke as a Zoho list; "Hide revoked" on by default; row drawer edits `rateLimitPerMinute/Day`; scopes immutable after creation (stated); BEM nav-link chips and `OsTitleBar` removed | `/api/keys` |
| Webhooks | list / create / test / disable subscriptions; signing secret revealed once | `WebhookSubscription` via `/api/webhooks` (route exists at `src/app/api/webhooks/`); ships only after an end-to-end delivery is verified |
| AI keys | the orphan `byok-manager.tsx`, only for orgs with the Enterprise `byok` flag | `OrgSecret` |

`/settings/integrations` redirects here; the marketplace (`/integrations`) is linked from the tab footer.

### 5.14 Plan & billing (`/settings/billing`) · O (`billing` scope)

Plan card (name, status, renewal), usage bars (members, guests free, storage, AI queries **this billing period**), "Manage billing" (Stripe portal). When Stripe is not configured the button is replaced by "Billing is handled by our team. Email billing@workwrk.com", never a button that 503s. Plan comparison and checkout (`POST /api/billing/checkout`) appear when checkout exists; until then hidden. `useToast` replaced by `useOsToast`. Invoices tab appears when Stripe invoices are reachable, else not rendered.

### 5.15 Locale & work week (`/settings/locale`) · A · S (`section: "locale"`)

| Field | Default | Persists | Read by |
|---|---|---|---|
| Time zone (searchable IANA, "Detect") | detected at org creation, else `Asia/Kolkata` | `settings.timezone` | crons, bucketing, new users' effective locale |
| Currency (full ISO list) | INR | `settings.currency` | money formatting |
| Fiscal year starts in (month 1 to 12) | 4 | `settings.fiscalYearStart` (number; the `"MM-01"` writer is removed and the string form migrated on read) | fiscal periods, review cadences, Overview |
| Week starts on, Date format, Time format | Monday, DMY, 24h | `settings.locale.weekStart / dateFormat / timeFormat` | org defaults under the personal overrides |
| Default language | en | `settings.language` | fallback for `home.locale.language` through `getEffectivePreferences`; any saved value other than `en` in existing orgs is normalised once with an audit note |
| Working days, Default weekly capacity hours | Mon to Fri, 40 | `settings.work.capacity.{workingDays, weeklyHours}` | Workload and Team views; per-person override on the member drawer (replaces `workwrk:team-workload:v1`) |

### 5.16 Scoring & reviews (`/settings/scoring`) · A · S per section

Kept as one page. Changes: brand `Button` (no `bg-zinc-900`); bands become add / remove rows with colours from the semantic set (`success`, `warning`, `danger`, `info`, `neutral`) instead of colour words the input cannot render; the legacy `{kpi, manager, peer, self, sopCompliance}` default is migrated on read to the four keys the page edits; "Reset to defaults" confirms; dirty guard per section; behavioural anchors render only under "Show upcoming features" until the review form reads them; the legacy `reviewFrequency` Overview card is replaced by the cadence summary; a "Talent grid" link to `/talent`. Persists `Organization.settings.{reviewCadences, scoreWeights, scoringBands, behavioralAnchors}` via `PATCH /api/settings {section:"scoring"}`.

### 5.17 All settings (`/settings/all`) · A

Generated from the registry, grouped by page; Owner-only pages marked; no controls.

---

## 6. Access-related settings, exactly as the access model needs them

### 6.1 Ownership map

| Access-model item | Settings home | Owned by |
|---|---|---|
| Four org roles, Agent flag, Admin scopes, People team column | Members › People drawer and columns (§5.5) | this spec renders; `grants.ts` and `/api/users/[id]` (access) write with the Owner guards and `tokenVersion` bump |
| Guests tab, Teams tab, Pending invites with Role and Invited to | Members (§5.5) | this spec |
| Toggles 1 to 10, People team picker, Lock it down, Enforced-at tooltips, four-role explainer | Access (§5.7) | access spec §6.5 and §8 (zod schema in `src/lib/access/settings.ts`); this spec places the page and its look |
| Security policy (password rules, idle timeout, MFA required audience) | Security › Sign-in policy (§5.9) | this spec renders and wires; today only `password-policy.ts` reads `settings.security`; `auth.ts` and `login-throttle.ts` gain their readers in S5 (§5.9 names each) |
| SSO / SCIM section (access §6.6 places it under Identity; this spec places it on Security under the same `security` scope rule, alias `identity.sso`) | Security (§5.9) | this spec |
| Apps floors (Everyone · Members with reports · Admins), hide, order; enforced by rule 2 | Apps & modules › Rail apps (§5.3) | this spec renders; access `visibleApps` enforces |
| Modules on/off; rule 2 | Apps & modules › Modules and the `ModuleDisabledScreen` (§5.3) | this spec |
| Settings page rule table (Owner-only / Owner+Admin / Personal), with the key aliases of §3.1 | `src/lib/access/settings.ts` (§3.1) | access; this spec supplies the labels, hrefs, groups and aliases as columns of the same rows |
| `/settings/permissions` | redirects to `/settings/access` (§5.7) | access §9 |
| `/settings/hierarchy` | redirects to `/organization` (Teams hub org chart with Edit reporting lines); Structure › Org chart is a link card to it (§5.6) | access §3.5, §6.2 |
| Domain-locked invites, `AccessGrant.expiresAt`, default guest expiry | Invite rules (§5.5) and Access › Guests and links (§5.7) | access |
| Deactivation transfers owned objects | Members transfer dialog (§5.5) | access invariant 13 |
| `GET /api/people/pick` | every picker in both doors (Reports to, dotted lines, People team, Invite, Teams) | access |
| Denial views (`AdminOnly`, `LockedPage`, `ModuleOff`, `AppOff`) | §3.1, §3.3 | access §6.4; `AdminOnly` is the settings member of the family and carries the Owner and Admin avatars |
| Per-field write rules on the person record | §9.2a | this spec proposes; flagged to the access spec §3.5 to split the directory card into self-service and placement fields |
| Rules for the folded app keys and the re-parented rows | §7.1a | this spec proposes; flagged to the access spec §5.2 rule table, which today lists the 8 hubs only |

### 6.2 Object-scoped access settings (never in a door)

These are required by the grafts and live in the one share dialog (`src/components/access/share-dialog.tsx`, access §6.1) opened from every object's "…" › Share and the Share button; this spec references them so the Phase 3 object specs know they are covered and where:

- **"Who can see this and why"**: inherited rows ("Can edit · from Space Marketing"), the "Everyone at {org}" row, the Check access tab (pick a person, see `explain()`), the real avatar stack on every content header (replaces the fake `OsTitleBar` avatars).
- **Space "New members join as"** (the dead `Space.settings.defaultPermission`): becomes the role on the Space's "Everyone at {org}" row (Can edit / Can comment / Can view / No access), preselected from access toggle 2 at creation, editable any time in the dialog. The select is removed from `NewSpaceDialog`; the New Space dialog shows the toggle 2 default as one line with "change later in Share".
- **Folder and List visibility after creation**: the Restricted switch in the dialog, both directions (`updateFolder` gains it through the `restrict` action; closes access-model Broken #10).
- **Last-owner guard and Transfer ownership**: the pinned Owner row, the last-Full guard, the Transfer action; Admin bypass audited.
- **List default task type, default assignee, default view**: `Board.settings.{defaultItemTypeId, defaultAssignee, defaultViewId}` in the board "…" menu (G24); the Space equivalents in the Space "…" menu.
- **Mute this Space / List / Doc**: the object's "…" › Mute writes `home.notifications.muted[]` (§4.3).
- **Per-Space channel, Automations entry**: reserved rows in the "…" menu (Phase 2 brief 4.6), not settings.

---

## 7. Disposition table

Verbs: **keep** (same URL, fixed), **move** (new URL, old redirects 308), **merge** (becomes a tab or section; old URL redirects), **wire** (existing control gains persistence or enforcement), **remove** (deleted with reason; every destination stays reachable somewhere).

### 7.1 Routes (`settings-pages.md` §1.1 to §1.31 plus the Settings-hub sidebar rows)

| Today | Disposition | Reason / audit ref |
|---|---|---|
| 1.1 `/settings` Overview | keep, rebuilt: one card per page, no self-links, registry search, first-run card, wired Retry | #4, #20, #31 |
| 1.2 `/settings/identity` | keep as Identity & culture › Profile + Culture; one PATCH; empty-name error; no blank-form overwrite; C_LEVEL removed from page and API | #9, #20, G9 |
| 1.3 `/settings/locale` | keep as Locale & work week; full IANA and ISO lists; numeric fiscal month; language consumed; week/date/time and capacity added | #15 |
| 1.4 `/settings/modules` | merge → `/settings/apps#modules`; switch also on `ModuleDisabledScreen` | two thin pages become one; G20 |
| 1.5 `/settings/apps` | keep; grouped by hub; floors enforced with the "N people lose access" preview; reset order | access #26, §7.8; G4 |
| 1.6 `/settings/tags` (`page.tsx`) | remove page; merge Tags → `/settings/tasks?tab=tags` rendering `tags-manager.tsx` | #1 fabricated SAMPLE data, wrong shape, no-op delete |
| 1.6 `settings/tags/tags-manager.tsx` | wire: the rendered Tags tab, restyled | it is the correct implementation |
| 1.7 `/settings/task-types` | merge → `/settings/tasks?tab=types`; API gains the gate; `ui/dialog`; visible actions | #2, #27 |
| 1.8 `/settings/members` | keep; Zoho list + drawer + filter panel + pagination; Role whitelist; Owner guards; Guests / Teams / Pending tabs; Invite rules; transfer on remove | #16, access #4, G6, G7, G10 |
| 1.9 `/settings/structure` | keep as tabbed Structure with the four-role strip (counts + one-liners, access §6.2); `/account` link fixed; Offices real; ladder prose deleted; Org chart tab is a link card to `/organization` | #18, stub tile |
| 1.10 `/settings/hierarchy` | merge → `/organization` (the Teams-hub org chart with Edit reporting lines; access §3.5, §6.2, §10.1) | #14 duplicate with no cycle handling |
| 1.11 `/settings/permissions` | move → `/settings/access` (§13 explainer + ten toggles + Lock it down); matrix deleted per access §9; transitional grid of the 14 named enforced cells until access step 5 | access §1.3, #7, #22 |
| 1.12 `/settings/audit` | keep; `OsTitleBar` removed; text tabs; server search; drawer with diff; export honours actor; Access family populated | #21, #27, access #19 |
| 1.13 `/settings/data` | keep as Data › Export; PO and Invoice exports re-parented under a Legacy divider, shown only to orgs that hold such rows; export log; Retention & privacy tab; Trash link | 1.13 |
| 1.14 `/settings/defaults` | merge → `/settings/identity?tab=appearance`; one accent vocabulary; locks greyed everywhere | #13 |
| 1.15 `/settings/api` | keep as API & webhooks › API keys; `OsTitleBar` and BEM chips removed; rate limits editable; Owner or `security` scope | 1.15 |
| 1.16 `/settings/calendar` | move → `/account/connections` (per-user Google Calendar + ICS; the backend is per user); `?connected=1` → `/account/connections?connected=google` | stub page, critic contradiction on this route |
| 1.17 `/settings/integrations` | merge → `/settings/api` footer link + `/integrations` marketplace (AI hub sidebar row) | hub of stubs |
| 1.18 `/settings/import-export` | merge → `/settings/data?tab=import` | #12 duplicate of Data |
| 1.19 `/settings/billing` | keep; honest no-Stripe state; period-scoped AI count; one toast system; Owner or `billing` scope | #11 |
| 1.20 `/settings/scoring` | keep; brand button; band rows; anchors behind upcoming; dirty guard; Owner and Admin only (the People team launches cycles at `/reviews`, access §9) | #7 |
| 1.21 `/settings/notifications` | move → `/account/notifications` (the reverse of today's redirect); Inbox view, mute-until, quiet hours, muted list, desktop | 1.21, critic #7 |
| 1.22 `/account/profile` | keep; phone, DOB, danger zone; one input pattern; error state with Retry | 1.22 |
| 1.23 `/account/appearance` | merge → `/account/preferences?tab=appearance` | one Preferences page |
| 1.24 `/account/security` | keep; score removed; presence persisted; the read-only policy card removed (replaced by the Owner page, access §6.6) with the rules inline on the Password and Two-factor rows; title "Security" | 1.24, access #17 |
| 1.25 `/account/notifications` | keep as the real page (was a redirect) | |
| 1.26 `/account` (bare) | wire: redirect → `/account/profile` | 404 inside settings mode |
| 1.27 `/organization` | keep in Teams (canonical org chart); also embedded in Structure › Org chart; "Org settings" link → Structure | |
| 1.28 `/people/me` | keep; Teams sidebar "My Profile" active-state matches `/people/{sessionUserId}` | #29 |
| 1.29 `/me/weekly-review` | keep in Work; not a setting; gets `BackButton fallbackHref="/today"` | out of scope, listed for completeness |
| 1.30 `/me/mentions` | merge → `/inbox?tab=mentions`: the route file goes, the 308 redirect is permanent (not one release), the content (mentions) is the Inbox tab; nothing a person could reach is lost | #28 orphan duplicate |
| `/talent` | keep, unchanged, Teams sidebar row "Talent (9-box)" and a link from Scoring & reviews | hard constraint |
| `/build`, `/store`, `/integrations` | keep; rows in the AI hub sidebar (`AiSidebar`) for Owner and Admin only (access §9 `settings.manageIntegrations`: "Owner/Admin for the integrations catalog"; Build and Store install things into the org and take the same rule) plus footer links on Apps & modules; the earlier "everyone for Store and Marketplace" is withdrawn | G21; re-parented from the deleted `SettingsSidebar`; rules §7.1a |
| `/tools`, `/assets` | keep; rows in a "Resourcing" section of the Teams hub sidebar for every Member; the page and API scope the content by the access §9 rules (Tools: what is shared with the viewer, Admin all; Assets: own, manager chain for their people, People team and Admin org-wide); a Member with nothing shared and no assets sees the empty state, never a lock (today catalog hr-admin vs server manager both go) | G21, access #5; rules §7.1a |
| `/trash` | keep; a row in the Work hub sidebar for every Member (a Member restores the List they deleted; a Guest never sees it) and a link card on Data › Trash; page and API gate on the access §9 rule in §7.1a, replacing today's `isManager` | G21 |
| `SettingsSidebar` (`apps-catalog.tsx:1135-1157`) | remove component; `settings` `matchPaths` shrink to `/settings`, `/account` | #30; also ends the sticky sidebar leak |
| `/settings/{section}` three-level URLs, `?prefs=` aliases (console) | not introduced | one door prefix each |

### 7.1a Rules for the folded app keys (the access spec's §5.2 table, completed)

Access §5.2 deletes `AppEntry.requiredAccess` and says every hub-sidebar row and every `gatePage("view", { type: "app", key })` call use one rule table, but it writes the rule for the 8 hubs only. `apps-catalog.tsx` carries 14 `requiredAccess` entries and 20 folded keys (`FOLDED_INTO_HUB`, line 1422). This is the rule for each, derived from the access §9 gate rules where one exists and proposed here where none does; it is flagged to the access spec as the completion of its §5.2 table, which owns the final word. "Row" = the hub-sidebar row renders; "content" = what the page and API return. Guests never see any of these rows (access §2.3 lists the Guest rail explicitly). The Apps page floor (Everyone · Members with reports · Admins) and hide apply on top (access rule 2) and can only narrow.

| Key | Hub | Row renders for | Content scope and the access §9 rule it comes from |
|---|---|---|---|
| `goals` | Work | every Member | goal audience; `okrs.view` (`GET /api/okrs`) |
| `timesheets` | Planner | every Member | own rows; manager chain, People team and Admin for their people (people data, access §3.5) |
| `library`, `clips` | Docs | every Member | object ladder on the Doc / File (`docAccessible` → `requireCan("view", doc)`) |
| `sops` | Docs | every Member | SOP folder ladder; `sops.view` |
| `policies`, `agreements` | Docs | every Member (published and assigned rows); create for Admin + People team | `policies.view` / `policies.create`; contracts follow the same rule (access §2.1 People team "Full on Policies, Contracts") |
| `reviews` | Teams | Members with reports, People team, Admin | `reviews.view` (subject self on their own review lands from Inbox, not from this row) |
| `candor` | Teams | every Member (respond); results for People team and Admin | proposed: as `surveys.respond` / `surveys.viewResults` (Candor is anonymous feedback, the surveys rule fits it; flagged) |
| `kudos` | Teams | every Member | proposed: every Member reads and gives; delete own or Admin; Guests never (flagged) |
| `surveys` | Teams | every Member (targeted respondents); create for Admin + People team | `surveys.view` / `surveys.create` |
| `talent`, `analytics` | Teams | Members with reports, People team, Admin | `analytics.view`; `/talent` population by `can(viewer, "view", person)` (access §3.5) |
| `tools` | Teams › Resourcing | every Member | `tools.view`: tools shared with the viewer; Admin all |
| `assets` | Teams › Resourcing | every Member | `assets.viewOwn` for everyone; `assets.view` (manager chain, People team, Admin) widens the list |
| `announcements` | Talk | every Member; create for Admin + People team, or Full on a Space | `announcements.view` / `announcements.create` |
| `forms` | Tables | every Member | object ladder on the List the form feeds (a Form is a `View` of type FORM) |
| `automation` | AI | Members with Full access on at least one Space, and Admin | proposed: workflows are scoped to a Space (`automation/hub-access.ts`), so the row follows Full on any Space; Admin all (flagged) |
| `build`, `store` | AI | Owner and Admin | `settings.manageIntegrations` (installs change the org) |
| `trash` | Work | every Member | proposed: rows the viewer could delete, i.e. objects they hold Full access on or created, plus every row for Admin; restore needs the same right on the parent (a Member restores their own List into a Space they still hold; if the parent is gone it restores to their private area); today's `isManager` on `/api/trash*` goes (flagged) |

Step 3 of the access migration ("gatePage the 11 ungated app pages") uses this table for trash, kudos, candor, tools, assets and the rest.

### 7.2 Orphaned settings components (§1.31)

| Component | Disposition |
|---|---|
| `components/settings/branding-manager.tsx` | wire as Identity › Profile › Branding card, Enterprise `whiteLabel` flag only |
| `components/settings/byok-manager.tsx` | wire as API & webhooks › AI keys, Enterprise `byok` flag only |
| `components/settings/privacy-controls.tsx` | wire into Data › Retention & privacy |
| `components/settings/sop-category-manager.tsx` | remove; SOP folders and categories are managed at `/sops/manage` (Docs hub) |
| `settings/tags/tags-manager.tsx` | wire (7.1) |
| `admin-setup-checklist.tsx` | wire: the four-step Overview card with data-derived ticks (§11.2); the localStorage dismissal keys go |
| `tour-content.tsx` steps 1 to 3 | wire: targets and copy from the registry |

### 7.3 Cosmetic, unenforced and localStorage-only settings (critic #7 and `settings-pages.md` §4)

Rule: a value presented as a setting (label, toggle, "remembered" promise) persists server-side. Pure ephemera (dismissed banner, one sheet's zoom, open doc tabs) may stay in localStorage and never render inside a door.

| Setting / state | Today | Disposition |
|---|---|---|
| Inbox display prefs | top-level `{inbox}` stripped by the zod schema | wire → `home.notifications.inboxView`; schema `.strict()` so the bug class cannot recur |
| `home.cards` | saved, never read | wire: Work sidebar and Space overview read it |
| Space "Default permission" | stored, unread | wire as the "Everyone at {org}" row role in the share dialog (§6.2) |
| Wizard-selected views, private / pinned views (`view-create-popover.tsx`) | wizard views and "Private view" already persist (`View` rows; private = `View.isShared = false` + `View.ownerId`); nothing reads `isShared`, so a private view is visible to everyone; "Pin view" is component state only | wire: `GET /api/boards/[id]/views` returns `isShared OR ownerId = viewer` (the enforcement, one `where` clause); "Pin view" is personal and persists as `UserPreference.home.work.pinnedViews[]` of view ids, read by the view tabs to order pinned first. Store, writer and reader named here; the work-OS spec owns the tab UI |
| Behavioural anchors | saved, ignored | behind "Show upcoming features" until read |
| Escalation thresholds (`role-workspace.tsx:1139-1183`) | persisted (`Threshold` rows via `POST/DELETE /api/thresholds`), never read: the escalation cron works off the task's own SLA and `escalatedAt` / `escalatedToId` fields (`schema.prisma:1248-1255`), not `Threshold` | the persistence rule says a stored value with no reader is hidden: the Thresholds card renders only under "Show upcoming features" (caption "Not enforced yet") until the escalation cron joins `Threshold` by `roleId`; the rows are kept, not deleted (data integrity). The Teams spec owns the cron change |
| `TaskListSurface` views and options, pivot results (`task-list-surface.tsx:444-479`) | in memory: views, columns, group, sort, filters, view options reset on reload; pivot results are derived | wire: the surface's own views and options persist per viewer as `UserPreference.home.work.surface.{viewId}` (`{ groupBy, sortKey, filters, filterConnector, viewOptions, columns }`), written debounced 400 ms and read on mount; pivot **results** are never stored (derived from tasks), the pivot **configuration** lives inside the same `viewOptions`. `home.work.savedFilters[]` (this table, saved task filters) is the shared filter store the surface reads |
| Dirty-state guards on the form builder and the automation builder (`automation/workflows/[id]/page.tsx:588` tracks `dirty` and shows "Unsaved changes" but nothing guards navigation; the form builder tracks nothing) | none | wire: `useDirtyGuard` (§8.5) lives in `src/hooks/use-dirty-guard.ts`, not under settings, and both builders mount it with their existing dirty state (the form builder gains a `dirty` flag set by every mutation, the pattern the automation page already has) |
| 55 unenforced matrix cells | saved, no effect | removed now; the 14 named enforced cells (§5.7) become gate rules at their call sites (access §9) |
| Rail hide / floor | display only | wire: enforced by access rule 2; preview + report + logged week |
| Org security policy | no editor | wire: Security › Sign-in policy |
| Org notification defaults (`settings.notifications`) | API section, no UI, no reader | section retired; open decision 6 |
| Default language | saved, unused | wire: org fallback for the personal locale |
| `businessType`, `teamSize` | read, never written | wire: Identity › Profile |
| Presence (`workwrk:os:presence`) | localStorage | wire → `User.presenceStatus/presenceUntil` |
| Mute notifications (`workwrk:os:muted-notifs`) | localStorage | wire → `home.notifications.mutedUntil` |
| Quick-tool pins (`workwrk:os:profile-tool-pins:v2`) | localStorage | wire → `sidebar.quickTools` |
| Sidebar width, collapsed (`workwrk:os:sidebar-width`, `-collapsed`) | localStorage | wire → `sidebar.width`, `sidebar.collapsed` |
| Icons-only mirror (`workwrk:os:icons-only`) | mirror of a persisted key | remove the mirror; read effective prefs |
| Density (`workwrk:density`) | localStorage | remove; `UserPreference.density` is the source |
| Desktop notifications (`desktop-notifications-pref`) | localStorage | wire → `home.notifications.desktop` (the browser permission itself stays per device, captioned) |
| Saved task filters (`workwrk:task-saved-filters`) | localStorage | wire → `home.work.savedFilters[]`; managed from the My Work filter menu, not a door |
| Team workload capacity (`workwrk:team-workload:v1`) | localStorage, per viewer | wire → `User.weeklyCapacityHours` (member drawer) + org default (Locale & work week) |
| AI saved prompts (`workwrk:ai:saved-prompts`) | localStorage | keep in localStorage until the AI hub gets a prompts library; not a setting today (the lead engineer's missing-key note is closed by listing it) |
| `TaskListSurface` views and options, pivot results | in memory | out of this spec; flagged |
| Active app, lens, recents (`workwrk:os:active-app` and friends) | localStorage | keep; re-derived from the URL by the navigation spec; not a setting |
| Sidebar pinned / recent (`lib/sidebar-prefs.ts`) | legacy pinning | remove (pinning is gone and must not return) |
| Doc tabs, split ratio, docs pages-open, sheet zoom, icon recents, create-task last list, Room sections / format bar | localStorage | keep: ephemera, never rendered as settings |
| Dismissed banners (notification, overview customize, planner connect, first-run welcome, tour completed, `twrk-checklist-dismissed`, `workwrk-setup-checklist-dismissed`) | localStorage | org-level setup dismissal → `settings.console.setupDismissedAt`; personal banner dismissals → `home.ui.dismissed[]`; the mission rotation index stays |
| Two accent vocabularies | 10 personal keys incl. banned hues vs 7 org keys | wire: one list in `src/lib/accents.ts` |
| Dirty-state guards | none | wire: `useDirtyGuard` on every Save-bar page (§8.5) |
| Four denial redirects | inconsistent | wire: the settings decision never redirects (§3.1); `route-guard.ts` dies with access step 8 |
| Profile-menu Themes / Shortcuts / Notifications rows | dead or wrong | wire (§2.4) |
| Rail "Upgrade" | Overview | wire → `/settings/billing`, Owners and `billing` Admins only |
| Three back patterns + `OsTitleBar` dead trio on settings pages | inconsistent | remove every in-page breadcrumb, `OsTitleBar`, nav-link chip and "‹ Back to settings" inside both doors; the shell header is the only chrome (§8.3) |
| Two toast systems, hand-rolled Task-types modal, black primaries, `accent-zinc-900` checkboxes, hex icons | inconsistent | `useOsToast`, `ui/dialog`, tokenised `ui/button`, `--os-brand` checked controls only |

---

## 8. Navigation

### 8.1 Shell

`SettingsShell` takes `door: "me" | "workspace"` and renders:

- Header, 48 px, white, 1 px N200 bottom border: `[← Back to app]` · clickable breadcrumb `{Org or first name} › {Door label} › {Page}` (every crumb but the last is a link; the last is the registry label) · spacer · `[×]`.
- Sidebar, 248 px, N50: a filter field on top ("Find a setting", ⌘/ focuses it), rows 32 px with a 16 px Lucide icon, group labels 12/590 N500 uppercase with a rule (Workspace door only), active row N100 pill + 590 weight, never blue. Owner-only rows an Admin cannot open show a lock glyph and still navigate (to the `AdminOnly` card). Nobody but Owner and Admin sees the Workspace sidebar at all (§3.1).
- Content: `<main>` with 24 px padding; 760 px column for forms, 1120 px max for lists.
- Below 900 px the sidebar collapses to a "Pages" select in the header; tables scroll inside their card. The first settings surface with a breakpoint.

The `OsShell` settings-mode fork (`os-shell.tsx:79`) stays: rail, hub sidebar and top bar unmount; `ReminderTicker`, `CallDock`, `IncomingCallWatcher`, `RealtimeClient` stay mounted.

### 8.2 The registry and search (G1, G23)

```ts
// src/lib/settings-registry.ts
export interface SettingEntry {
  id: string;          // "security.signin.mfaRequired"
  label: string;       // "Require two-factor authentication"
  keywords: string[];  // ["2fa", "mfa", "authenticator"]
  door: "me" | "workspace";
  page: SettingsPageKey;   // from src/lib/access/settings.ts (the access spec's rule table)
  tab?: string;
  href: string;        // "/settings/security?tab=signin#mfaRequired"
  // no gate field: the gate is the page's, read from SETTINGS_PAGES[page].gate,
  // so the registry never carries role logic (ESLint rule: none outside src/lib/access/)
}
```

- Every field in §4 and §5 is one entry, registered next to the page's form schema. A vitest unit test renders each page's field list and asserts every rendered field id exists in the registry, that its `href` resolves to a page in the page table, and that a grep-able reader key exists for its store (the persistence rule as a test).
- Page title, sidebar row and breadcrumb all render `SETTINGS_PAGES[key].label`; field labels render `SettingEntry.label`. Label drift (#25) is closed by construction.
- Three search surfaces, one index: the door sidebar filter (filters rows and lists field matches beneath), the Overview search field, and the ⌘K palette "Settings" group (My settings entries for everyone; Workspace entries for Owner and Admin, filtered by the page gate). Inside a door ⌘K opens the door search (the global palette is unmounted in settings mode).
- Arriving with a hash scrolls the card into view and pulses its border once (150 ms, no transform).
- `/settings/all` and `/account/all` render the registry grouped by page.

### 8.3 Back and Close: the origin rule (G11)

- `src/lib/settings-nav.ts` exports `openSettings(href)` and `closeSettings()`. `openSettings` stores `{ returnTo: location.pathname + location.search, at }` in `sessionStorage["workwrk:settings:return"]` and navigates. Every entry point in §2.4 calls it.
- `OsShell` keeps `lastAppPath` (the last pathname outside `/settings` and `/account`) in shell context, mirrored to `sessionStorage["workwrk:shell:last-app-path"]`, so a hard refresh inside a door or a deep link from an email still has a sensible fallback.
- "Back to app", `×` and `Esc` call `closeSettings()`: `returnTo` if it exists and is not a settings route; else `lastAppPath`; else `/today`. Never `history.back()` through settings pages, never a hard-coded `/today` from settings chrome (lint rule: `router.push("/today")` is forbidden under `src/components/layout/os/settings-shell*` and `src/app/(dashboard)/{settings,account}`).
- Inside a door, sidebar rows and tabs are ordinary `router.push`; the browser Back walks settings pages and does not exit the door. Esc closes a drawer or dialog first, then triggers the dirty guard, then leaves.
- No page inside a door renders an in-page breadcrumb, `OsTitleBar`, "Settings" chip or "‹ Back to settings" link. `BackButton{fallbackHref}` stays on every non-settings detail route as the app convention requires and is not used inside the doors.
- `document.referrer` and `?from=` are not used.

### 8.4 Deep links and redirects

- Every page, tab and field is addressable: `/settings/tasks?tab=tags`, `/account/preferences?tab=locale#timezone`. Tabs read `?tab` on load and write it with `router.replace`.
- 308 redirects in `next.config.ts`: `/settings/modules` → `/settings/apps#modules`; `/settings/tags` → `/settings/tasks?tab=tags`; `/settings/task-types` → `/settings/tasks?tab=types`; `/settings/hierarchy` → `/organization`; `/settings/permissions` → `/settings/access`; `/settings/defaults` → `/settings/identity?tab=appearance`; `/settings/calendar` → `/account/connections`; `/settings/integrations` → `/settings/api`; `/settings/import-export` → `/settings/data?tab=import`; `/settings/notifications` → `/account/notifications`; `/account/appearance` → `/account/preferences?tab=appearance`; `/account` → `/account/profile`; `/me/mentions` → `/inbox?tab=mentions`; `/settings?tab=themes` → `/account/preferences?tab=appearance`; `/settings?tab=shortcuts` → `/account/shortcuts`.
- Hard-coded settings paths in `profile-menu`, `workspace-menu`, `click-app-rail`, `command-palette`, `board-more-menu`, `create-task-modal`, `module-disabled`, `org-chart-client`, `admin-setup-checklist`, `tour-content`, the Planner banner and `tools/assets/integrations` pages are updated in the same change; the redirects are the net, not the plan.
- Cross-door links are explicit: My settings › Security's "Workspace sign-in policy" text link → Workspace › Security (Owner and `security` Admins only, §4.4); Identity › Appearance defaults → My settings › Preferences.

### 8.5 Dirty-state guard

- `useDirtyGuard(isDirty)` in `src/hooks/use-dirty-guard.ts` (a shared hook, not settings-specific): while dirty, `beforeunload` prompts; the shell's Back / × / Esc, sidebar rows, breadcrumb crumbs and in-page tab switches open a 400 px confirm "Save your changes?" with Save / Discard / Keep editing. Save failures keep the form dirty and re-arm the guard. Outside the doors the same hook guards the form builder and the automation workflow builder (§7.3), where it intercepts `BackButton`, hub-sidebar rows and the rail.
- Inside the doors only Save-bar pages register: Identity (Profile, Culture), Locale & work week, Invite rules, Security (Sign-in policy, SSO), Retention & privacy, Scoring & reviews (per section), Profile.
- Autosave controls never make a page dirty; they show a 1.5 s inline "Saved" tick, or "Couldn't save · Retry" and revert.
- The sticky Save bar appears only when dirty: `[Unsaved changes]  [Discard] [Save changes]`, brand `Button`, disabled while saving, one request per section.

### 8.6 Fetch-failure rule (G9)

No Save-bar page ever renders an empty form after a failed GET. `GET /api/settings` or `GET /api/me` failure renders `OsEmptyView` with a wired Retry in place of the form, so Save can never overwrite live values with empty strings (Identity does exactly this today, `identity/page.tsx:56,70`). Implemented once in a `useSettingsSection(section)` hook every form page uses.

---

## 9. Persistence rule and API shape

### 9.1 The rule

**If it renders, it persists, and something reads it.** A control renders inside a door only if (1) a read path returns its value, (2) a write path stores it, and (3) at least one consumer reads it. Missing (3): hidden behind "Show upcoming features" and rendered disabled with "Coming soon" (or "Not enforced yet" during the matrix transition). Missing (1) or (2): not rendered. localStorage never holds anything shown in a door. Every org write is audited as `settings.updated.{section}` with the changed keys; personal writes are silent except security events.

### 9.2 Storage classes

| Class | Store | Read | Write | Who |
|---|---|---|---|---|
| Personal identity (name, phone, DOB, avatar) | `User` columns | `GET /api/me` | `PATCH /api/users/[id]` (self path), avatar routes | self |
| Personal security and presence | `User.mfa*`, `tokenVersion`, `emailVerifiedAt`, `presenceStatus`, `presenceUntil` | `GET /api/me`, `/api/me/security-activity` | `/api/me/*`, `PATCH /api/users/[id]` (presence) | self |
| Personal preferences | `UserPreference` JSON columns, namespaced: `theme.{appearance,accent}`, `density`, `sidebar.{iconsOnly,sectionsOrder,width,collapsed,quickTools}`, `home.{cards,order,favorites…,notifications.{inbox,email,inboxView,mutedUntil,quietHours,muted,desktop},locale.{language,timezone,weekStart,dateFormat,timeFormat},ui.{reducedMotion,showUpcoming,dismissed},work.{savedFilters}}` | `GET /api/preferences` (effective) | `PATCH /api/preferences` | self; org `lockedKeys` win |
| Personal email channels | `EmailPreference` | `GET /api/email-preferences` | `PATCH /api/email-preferences` | self (folded into `home.notifications.email` in a follow-up) |
| Personal connections | `CalendarSubscription`, ICS token | `/api/integrations/google-calendar/*`, `/api/calendar/ics/token` | same | self |
| Membership (role, scopes, agent, status) and placement (department, title, office, manager, dotted lines, capacity) | `User` columns, `UserDottedLine` | `GET /api/users` | `PATCH /api/users/[id]` (Owner guards, per-field whitelist from §9.2a, `tokenVersion` bump) | per field, §9.2a |
| Org shell defaults | `OrgPreference` (`sidebarDefault.apps`, `themeDefault`, `densityDefault`, `homeDefault`, `lockedKeys`) | `GET /api/org/preferences` | `PATCH /api/org/preferences` | Admin |
| Org settings | `Organization.name/domain/logo` and `Organization.settings` JSON sections (§9.3) | `GET /api/settings` (door members get everything; everyone else gets `organization` public fields, the `security` summary and `companyProfile` for the loader) | `PATCH /api/settings { section, data }` | Admin; Owner for `security` |
| Access policy | `Organization.settings.access` (toggles 1 to 10, People team) | same | `PATCH /api/settings { section: "access" }` validated by `src/lib/access/settings.ts` | Admin |
| Modules | `ProductInstallation` | `/api/preferences` (`modules.activeAppKeys`) | `POST/DELETE /api/products/installations` | Admin |
| Structure | `Department`, `Role`, `Office` | their APIs | their APIs | Admin; People team for job titles |
| Task system | `ItemType`, `Tag`, `Template` | their APIs | their APIs, settings-gated | Admin |
| Credentials and provisioning | `ApiKey`, `ScimToken`, `WebhookSubscription`, `IdentityProvider`, `OrgSecret` | their APIs | their APIs | Owner or `security` scope |
| Billing | `Subscription`, Stripe | `/api/billing/*` | Stripe portal / checkout | Owner or `billing` scope |
| Audit | `ActivityLog` | `/api/audit`, `/api/audit/types`, `/api/audit-log/export` | `logAuditEvent` | Admin read |
| Object-scoped | `Space/Board.settings`, `AccessGrant`, member tables | object APIs | `grants.ts` and object PATCH routes | object Full holders; never in a door |

### 9.2a Who may write which field on the person record (`PATCH /api/users/[id]`)

Every field the route accepts lands in one table, written in the access spec's vocabulary; the route validates the body against it (unknown keys 400 naming them; a key the caller may not write on this target 403 naming it) so the same rule serves the Profile page, the Members drawer, `/people/[id]`, `/organization` edit mode and any script. Today the route (`users/[id]/route.ts:140-197`) already splits "personal" from "employment" fields for self and lets any manager in the reporting line write `managerId`; this table keeps the first split and narrows the second.

Three field classes reconcile the vocabularies in play. Access §3.5's directory card is split, and the split is flagged to the access spec: **self-service fields** (name, avatar, phone, date of birth, presence: "Self EDIT (own profile)"), **placement fields** (job title, department, office, reports to, dotted lines, weekly capacity: people data that a person never sets for themself, written by the chain that manages them), and **membership fields** (org role, Admin scopes, Agent flag, status, People team: the org's decision, Owner and Admin only). Email is written by nobody on this route.

| Field (body key) | Class | Self | Manager chain (solid or dotted, any depth) | People team | Admin | Owner |
|---|---|---|---|---|---|---|
| `firstName`, `lastName`, `avatar`, `phone`, `dateOfBirth` | self-service | write | read (DOB: read) | read | write | write |
| `presenceStatus`, `presenceUntil` | self-service | write | read | read | read | read |
| `email` | identity | read (change flow later; SSO orgs: IdP) | read | read | read | read |
| `roleId` (job title), `departmentId`, `officeId` | placement | read | write for their chain | write | write | write |
| `weeklyCapacityHours` | placement | read | write for their chain | write | write | write |
| dotted-line managers (`UserDottedLine`, own sub-route) | placement | read | write for their chain | write | write | write |
| `managerId` (reports to) | placement | read | read (moving a person out of, or deeper into, a chain is an org-chart change, not a people-data edit; today's manager write is narrowed and S1's logged week names anyone who relied on it) | write | write | write |
| `orgRole` (`accessLevel` mirror) | membership | read (self-demotion confirms; last-Owner guard) | read | read | write, never to or from Owner | write |
| `adminScopes` | membership | read | read | read | read | write |
| `isAgent` | membership | read | read | read | write | write |
| `status` (Active / Deactivated) | membership | read | read | read | write (transfer dialog) | write |
| People team membership (`settings.access.peopleTeam`, written through `PATCH /api/settings { section: "access" }`, not this route) | membership | read | read | read | write | write |

"Write for their chain" = `can(viewer, "edit", { type: "person", id })` resolves via `manager-chain` (access rule 9). Reads of DOB and phone: self, manager chain, People team, Admin, Owner (§4.1); other Members see the directory card only. The Owner column differs from Admin only on `orgRole = OWNER` and `adminScopes`. Agents can be written to by the same people as Members; an Agent cannot be a manager (access §2.1), so the chain column never applies to an Agent as writer.

Where each writer meets the fields: self on `/account/profile` (§4.1); manager chain and People team on `/people/[id]` and `/organization` edit mode (Teams hub); Admin and Owner in the Members drawer (§5.5) and on `/people/[id]`. The org chart's "Edit reporting lines" mode therefore opens for Owner, Admin and the People team, which is the same right the Members drawer gives `managerId`, closing the two-rights gap between §5.5 and §5.6.

### 9.3 API shape

`PATCH /api/settings { section, data }` keeps its envelope; every section gets a `.strict()` zod schema (today `general`, `security` and `notifications` accept any object) and returns `{ ok, settings }` (the fresh section), 400 `{ issues[] }` naming any unknown key, 403 only for viewers the UI never let try. Sections: `profile` (name, domain, industry, businessType, teamSize, branding), `culture` (companyProfile), `locale` (timezone, currency, fiscalYearStart, locale.*, language), `work` (defaultItemTypeId, capacity, automationsPaused), `users` (invite rules), `security`, `scoring`, `access` (schema owned by the access lib), `retention`, `data` (selfExport, privacy, aiEnabled), `console` (setupDismissedAt, modulesReviewedAt). Retired: `general` (split into `profile` and `locale`; accepted and mapped for one release), `notifications` (no reader), `modules` (ProductInstallation owns it). Every write logs `settings.updated.{section}` with changed keys (exists).

`PATCH /api/preferences` grows `sidebar.{width,collapsed,quickTools}` and `home.{notifications.*, locale.*, ui.*, work.*}`; `.strict()` at every level so a stray top-level `inbox` key is a 400 naming it, never silently stripped. `home.notifications` already lives in the `home` column, so no data copy is needed. `sidebar.pinned` and `sidebar.hidden` stay accepted and ignored for one release. Response `{ effective }`; the client re-renders from it so locks are always reflected.

`getEffectivePreferences` merges `home.locale` the way `theme` merges: defaults → org (`settings.language`, `settings.timezone`, `settings.locale.*`) → user → locked keys re-stamped. Lock dot-paths come from `src/lib/preferences-locks.ts` and are the only strings the Appearance defaults page may write into `lockedKeys`.

New routes: `POST /api/org/sign-out-everyone` (Owner or `security`), `GET /api/audit/types`, `GET /api/people/pick?q=` (access), `PATCH /api/users/[id]` gains `presenceStatus`, `presenceUntil`, `weeklyCapacityHours`, `officeId`, `adminScopes`, `isAgent` and validates every key against the §9.2a table (`.strict()`, per-field 403 naming the field).

Autosave writes debounce 400 ms per key and retry once; failures toast and revert. Save-bar writes are one request per section, never two sequential PATCHes.

### 9.4 Pickers

Every people picker in both doors (Reports to, dotted lines, People team, Invite, Teams, transfer dialogs) reads `GET /api/people/pick` (id, name, avatar, department), which is never scoped by the caller's report tree. `/api/users` stays scoped by `accessibleIds(person)` for full records (G14).

### 9.5 Migration footprint (G22)

One additive SQL file applied with `prisma db execute` on prod (memory: `migrate dev` is broken by drift) and `prisma db pull` to confirm: `User.weeklyCapacityHours Int?`, `User.presenceStatus String?`, `User.presenceUntil DateTime?`. Everything else is JSON keys inside existing columns. Pages that need the three columns (capacity in the member drawer, presence in Security) ship behind the migration; every reader tolerates a missing column. Column promotion for `UserPreference.notifications / locale / ui` is optional and later. The access track's `orgRole`, `isAgent`, `adminScopes`, `AccessGrant` and `Team` columns belong to access step 4, not to this release.

---

## 10. How it looks (Zoho reference applied)

Both doors use the light chrome: white shell, N50 sidebar, grey active pill, hairline borders, one blue primary per page. Tokens are `--os-*` only, values from the Phase 2 ramp (N0 `#FFFFFF`, N50 `#F6F7F9`, N100 `#EEF0F3`, N200 `#E4E7EC`, N300 `#D0D5DD`, N500 `#667085`, N800 `#1F2430`, blue-600 `#0073EA`, blue-700 `#0B5FC2`, blue-50 `#EAF3FE`). Type 20 / 16 / 14 / 13 / 12, no half-pixel sizes, no 11 px inside the doors. Radius 8 cards and buttons, 6 inputs. No hex in components, no `bg-zinc-900` primaries, no `accent-zinc-900` checkboxes, no `Loader2`, no "Loading…" strings: `ValueLoader` for the route transition, N100 skeleton rows inside cards, `OsEmptyView` with a wired Retry for errors.

### 10.1 Settings list page (Members; also Guests, Teams, Pending invites, Departments, Job titles, Offices, Task types, Tags, API keys, Webhooks, SCIM tokens, Audit log)

```
┌ white header 48: ← Back to app   Acme › Workspace settings › Members                          × ┐
│ N50 sidebar 248     │ white canvas, 24 px padding                                                │
│ [Find a setting ⌘/] │ Members                                            20/590 N800             │
│ WORKSPACE           │ People   Guests   Teams   Pending invites          text tabs 14, active =  │
│  Identity & culture │                                                    N100 pill, 590 weight   │
│  Locale & work week │ [⛉ Filter] [⇅ Sort]  ·······················  [Export ▾] [ + Invite ]       │  toolbar 40
│  Apps & modules     │ ┌ filter panel 260 ─┐ ┌ bordered card, 1 px N200, radius 8 ──────────────┐ │
│ PEOPLE              │ │ Filter people      │ │ ☐ Person        Role    Dept   Reports to   ⚙ │ │  header 32 N50, 12/590 N500
│  Members  ●         │ │ [search]           │ │ ○ Priya Nair    Member  Product A. Shah        │ │  rows 36, hairline, no zebra
│  Structure          │ │ ☐ Role ▾           │ │ ○ Arjun Shah    Admin   Product R. Iyer        │ │
│  Access             │ │ ☐ Department ▾     │ │ ○ Sam (guest)   Guest   ·       ·              │ │
│ WORK                │ │ ☐ No manager       │ │ …                                              │ │
│  Task system        │ │ ☐ People team      │ │ Total members 42 · Guests 3      1 to 40 ‹ ›   │ │  footer inside the card
│  Scoring & reviews  │ └────────────────────┘ └────────────────────────────────────────────────┘ │
│ SECURITY & DATA     │                                                                           │
│  Security  🔒       │   (Admin without the security scope: lock glyph, opens the AdminOnly card) │
│  Data · Audit log · API & webhooks 🔒                                                            │
│ BILLING             │                                                                           │
│  Plan & billing 🔒  │                                                                           │
│ All settings        │                                                                           │
```

- Title 20/590; a 13/400 N500 description line only when it adds information.
- Text-tab views are server filter presets, never client state; overflow into "•••".
- Toolbar 40 px: Filter toggles the side panel (pill when active), Sort, a hairline divider, a view switcher only where a list has more than one renderer (Org chart: chart / table). Right: one solid blue primary, then a bordered "•••" square for secondary actions.
- Filter side panel inside the content column (260 px, bordered card, search field, checkbox rows 36 px); the table narrows.
- Table: bordered white card, 32 px N50 header, checkbox column, inline header filter on the first text column, column-settings gear pinned right, 36 px rows, hairline separators, no zebra, hover N50, no hover chrome. Footer inside the card: totals left, range and chevrons right. Row click opens the 520 px drawer, never a second page.
- Bulk bar floats at the bottom when rows are checked.
- Empty state: 96 px four-dot line drawing in N300, one 16/590 sentence, one 13 N500 line, one primary only when wired ("Invite your first teammate").
- No read-only variant of a list page exists (§3.2); a viewer who cannot edit a page cannot open it.

### 10.2 Settings form page (Security › Sign-in policy; also Identity, Locale & work week, Invite rules, Retention, Scoring, Profile, Preferences)

```
Sign-in policy                                                  20/590
How people sign in to Acme. Changes apply at their next sign-in.   13 N500

┌ Passwords ──────────────────────────────────────────────┐   card: white, 1 px N200, radius 8,
│ Minimum length            [ 8   ]                        │   16 px padding, 16/590 card title,
│ Require uppercase   (●  )   Require a number   (●  )     │   at most five fields per card,
│ Require a symbol    (  ○)                                │   labels above, 36 px inputs, radius 6,
│ Password max age (days)   [ 0   ]   0 = never            │   13 N500 helper under the field
└──────────────────────────────────────────────────────────┘
┌ Sessions ───────────────────────────────────────────────┐
│ Idle timeout (minutes)    [ 720 ]                        │
│ Absolute lifetime (days)  [ 30  ]                        │
└──────────────────────────────────────────────────────────┘
┌ Two-factor authentication ──────────────────────────────┐
│ Require MFA for   ( ) Nobody   (●) Admins   ( ) Everyone │
│ 12 of 14 admins enrolled · view                          │
└──────────────────────────────────────────────────────────┘
┌ Failed sign-ins ────────────────────────────────────────┐
│ Lock after [ 8 ] attempts for [ 15 ] minutes             │
└──────────────────────────────────────────────────────────┘
┌ Sign-in domains ────────────────────────────────────────┐
│ acme.com   · Managed in Members › Invite rules →         │
└──────────────────────────────────────────────────────────┘
┌ Danger zone ────────────────────────────────────────────┐   last card, danger-text title,
│ Sign everyone out              [ Sign out all devices ]  │   red outline button, typed confirm
└──────────────────────────────────────────────────────────┘

                        [ Unsaved changes ]   [Discard] [Save changes]   sticky bar, only when dirty
```

- Content column 760 px, 24 px gap between cards. On Form pages every control feeds the one Save bar; on Autosave pages (Apps & modules, Access, Appearance defaults, Preferences, Notifications) rows are `label · helper · control` 44 px tall with a right-aligned Switch or select and a transient "Saved" tick.
- Locked rows (personal side): greyed, lock glyph, "Set by your workspace".
- Danger zone: always the last card; the destructive button is the only red on the page; typed confirmation for org-level actions.
- Dialogs: Radix `ui/dialog` only; pickers inside them are `position:absolute` children (project rule). Toasts: `useOsToast` only, bottom-left, one action.

### 10.3 Overview card and drawer

Overview card: bordered, radius 8, 20 px icon in a blue-50 tile, 16/590 title, 13 N500 line, two live values 14 px, hover N50. Row drawer: 520 px, own header (title, "Open profile ↗", ×), the same bordered cards, autosave per field, Esc closes the drawer first.

---

## 11. New-org defaults and first run

### 11.1 Defaults written at org creation (one `seedOrgDefaults(orgId)` inside the create transaction)

| Setting | Default |
|---|---|
| Roles | creator = Owner; every in-domain invite = Member; `adminScopes` empty; People team empty |
| Modules | Talk off, Tables off (premium, new orgs OFF) |
| Rail | catalog order, nothing hidden, catalog baseline floors |
| Appearance defaults | Light, workwrk, Cozy, no locks |
| Locale & work week | time zone from the signup browser else `Asia/Kolkata`; currency by country (INR for India, else USD); fiscal month 4 for India else 1; Monday; DMY; 24h; language `en`; Mon to Fri; 40 h |
| Invite rules | allowed domain = signup domain; auto-join off; default role Member; no default Spaces; expiry 7 days (Member invites are Owner and Admin by rule, not a default) |
| Sign-in policy | min 8, uppercase and number on, symbol off, no max age, idle 720, lifetime 30 days, MFA required for Admins, lockout 8 / 15 (the code's constants) |
| Provisioned people (SCIM, SAML JIT) | Member, not Agent, no scopes, not on the People team; domain-locked; deprovision = Deactivate with invariant 13 (§5.9) |
| SSO / SCIM | off / no tokens |
| Access toggles | as access §8: anyone creates Spaces; new Spaces open as Can edit and findable; editors share; Full holders invite Guests; editors publish; Full holders delete; guest expiry never; public links off |
| First Space | "General", open to everyone as Can edit, findable, canonical statuses, all tabs on (G17) |
| Task system | built-ins with Task as default; no tags (never SAMPLE) |
| Scoring | existing API defaults (cadences, weights, five bands) |
| Retention & privacy | trash 60 days, audit 365, self-export on, AI on, BYOK off |
| Automations | on |
| Plan | STARTER, status TRIAL (as today) |
| Console | `setupDismissedAt` null |
| Personal (each new user) | theme, density and locale follow the org; time zone from the browser on first sign-in; all inbox notifications on; email master on with Task assigned and Kudos; desktop off; presence Active; showUpcoming off |

### 11.2 First run (admin)

The Overview card "Set up {Org}" shows four steps, each one click into the exact tab and field, each ticked from data (never "when visited"):

1. **Add your logo and mission** → `/settings/identity` (done when `logo` or `companyProfile.mission` or one value exists)
2. **Invite your team** → `/settings/members?invite=1` (done at two or more active members)
3. **Create departments** → `/settings/structure?tab=departments` (done at one or more)
4. **Turn on Talk or Tables** → `/settings/apps#modules` (done when any module is active; the caption says both are optional)

One line under the steps: "Security: MFA is required for admins by default. Review in Security." Dismiss writes `settings.console.setupDismissedAt` (server-side, so it does not reappear on another device); the card collapses to "Setup complete" when all four are done. The admin lands on Work › General (or My work per Phase 2 Q7). Nothing in first run asks for a scoring model, a security policy or access toggles.

### 11.3 First run (member)

Invite → set password → MFA enrolment only if required for their role → the first Space they were added to (or General). A one-time hint on the avatar: "Your profile and preferences are here" (dismissal in `home.ui.dismissed`). No settings step is mandatory; time zone is taken from the browser and the Preferences page shows "Using your device time zone" until changed.

---

## 12. Build order

Ordered so every step ships alone, old URLs redirect, and pages and APIs never disagree during the transition. Dependencies on the access track are named by its step numbers (`access-model-spec.md` §10).

| Step | Ships | Depends on |
|---|---|---|
| **S0 Chassis** | the page table's label, href, group and alias columns added to `src/lib/access/settings.ts` (access step 0 creates the file; if S0 lands first the file is created here with the rule column and access step 0 adopts it); `src/lib/settings-registry.ts` + the registry unit test; `src/hooks/use-dirty-guard.ts`; `SettingsShell door=` with the clickable breadcrumb and filter field; `src/lib/settings-nav.ts` (`openSettings` / `closeSettings`) and `OsShell.lastAppPath`; the lint rule against `router.push("/today")` in settings chrome; `useDirtyGuard`; `useSettingsSection` with the fetch-failure rule; `.strict()` on `/api/preferences` and every `/api/settings` section; `src/lib/accents.ts` and `src/lib/preferences-locks.ts`; the 15 redirects; deletion of `OsTitleBar`, in-page breadcrumbs and nav-link chips inside both doors; `SettingsSidebar` deleted and its rows re-parented (G21). | nothing |
| **S1 Door gate** | `settings/layout.tsx` calling `gatePage({ type: "settings" })` with `viewerFromSession()` and `orgRoleOf(accessLevel)`; the six per-route layouts and the Structure lock card deleted; the `AdminOnly` card (access §6.4 family) with the Guest 404 rule; the rail Settings hub's role-derived `defaultHref`; org write APIs on the page rule; C_LEVEL's `/api/settings` write removed; `PATCH /api/users/[id]` on the §9.2a per-field table; `/api/trash*` and the folded-key rows on the §7.1a rules. Runs the first week with `SETTINGS_GATE_LOG_ONLY=true` logging every would-be denial (G25) before enforcing. | access step 0 (`src/lib/access/` engine over the old tables) and step 1 (wrappers) |
| **S2 My settings on existing columns** | Profile (+ phone, DOB, danger zone), Preferences (Appearance; Language & region and Sidebar on JSON keys), Notifications (inbox view, mute until, quiet hours, muted list, desktop), Security (score removed, policy card links), Calendar & connections, Keyboard shortcuts, `/account/all`; the avatar-menu rows re-pointed; the Inbox gear writes `inboxView`. No migration. | S0 |
| **S3 Workspace re-parents** | Overview (cards, search, first-run card), Identity & culture (tabs, absorbs Defaults), Locale & work week, Apps & modules (Modules section, `ModuleDisabledScreen` switch, dim Off icon, grouped rail list, Automations card), Task system (tags-manager rendered, item-types gated), Structure (four-role strip, tabs, Offices CRUD, org chart link card), Data (tabs, PO/Invoice under Legacy, export log), Audit (tabs, drawer, server search, `/api/audit/types`), API & webhooks (keys tab), Plan & billing (honest state), Scoring (fixes), `/settings/all`; checklist and tour re-pointed; the `access` page in its transitional form (explainer + the 14-cell legacy grid); the §7.3 wiring outside the doors (private views enforced in the views GET, pinned views and `TaskListSurface` options on `home.work.*`, Thresholds card behind upcoming, dirty guards on both builders). | S1 |
| **S4 Migration and Members** | the one SQL file (`weeklyCapacityHours`, `presenceStatus`, `presenceUntil`) via `prisma db execute`; Members as list + drawer + filter panel + pagination with the Role whitelist, Owner guards, `tokenVersion` bump, transfer dialog, Last active, `?filter=unlinked`, Invite rules card; presence in Security; capacity in the drawer and Team workload reading the column; pickers on `GET /api/people/pick`. | S3; access step 3 (pick endpoint, Owner guards) |
| **S5 New editors** | Security › Sign-in policy wired as §5.9 specifies: `password-policy.ts` (symbol, max age with `User.passwordChangedAt`), `login-throttle.ts` (policy argument, per-org threshold and minutes), `auth.ts` (`idleUntil` and `iat` checks in the `jwt` callback, MFA audience with `mustEnrolMfa`, env floor kept, `proxy.ts` enrolment and change-password holds), Sign everyone out; SCIM tab with the provisioning rules (Member by default, domain lock, deprovision = Deactivate + invariant 13); SSO tab hidden behind upcoming; Retention & privacy with the purge cron row; Webhooks and Import tabs only after their routes are verified end to end; Danger zone (transfer ownership, delete workspace); BYOK and Branding behind flags. | S3; Owner / scope gating from S1 |
| **S6 Access surfaces** | `/settings/access` with the ten toggles, Lock it down, Enforced-at tooltips; Members › Guests, Teams tabs, People team column, Admin scopes menu; Owner-only split on (`SETTINGS_OWNER_SPLIT=true`) after the pre-flight report is approved; `/settings/permissions` redirect final; matrix export to `access.matrix_retired` and the Data download. | access steps 4 and 5 |
| **S7 Enforcement flips** | rail floors and hides enforced (access rule 2) with the "N people lose access" preview, the one-time migration report, and a week of logged would-be denials first; unenforced matrix cells gone for good; `route-guard.ts` and the tier Sets deleted with access step 8. | S6; access steps 6 to 8 |

S0, S2 and S3 can proceed in parallel with access steps 0 to 2; S1 is the first step that touches the gate and is the only one that must wait for the wrappers.

---

## 13. Checklist against the audit

`settings-pages.md` §2 (ranked issues):

| # | Resolved by |
|---|---|
| 1 Tags page fabricates data | §5.8 (tags-manager rendered, page deleted) |
| 2 Task types have no authz | §3.1, §5.8 |
| 3 OsTitleBar dead trio on settings pages | §8.3 (removed inside both doors) |
| 4 Overview self-links | §5.1 |
| 5 Security cards send admins to a read-only page | §5.9 editor; the read-only card is gone and §4.4 links Owners to the editor |
| 6 7-of-21 gating patchwork | §3.1 one gate |
| 7 Scoring has no read-only mode | §3.1, §3.2: nobody who cannot edit it can open it (the `AdminOnly` card), so no read-only mode is needed; §5.16 |
| 8 Back / Close always `/today` | §8.3 |
| 9 Identity layout vs page vs API on C_LEVEL | §3.1 (C_LEVEL no longer exists; write removed) |
| 10 Profile-menu dead rows | §2.4 |
| 11 "Upgrade" lands on Overview | §2.4, §5.14 |
| 12 Calendar / Integrations / Import-export stubs | §7.1 |
| 13 Accent vocabulary drift | §4.2, `src/lib/accents.ts` |
| 14 Two org charts | §5.6 |
| 15 Locale lists and fiscal representation | §5.15 |
| 16 Members team-scope mislabel, overflow, no profile links | §5.5 |
| 17 Checklist and tour targets | §11.2, §2.4 |
| 18 Bare `/account` link | §8.4 |
| 19 Loader mix | §10 (ValueLoader + skeletons) |
| 20 Error states without recovery | §8.6 |
| 21 Audit rows not clickable, client-side search | §5.12 |
| 22 h1 size mix | §10 (20/590 everywhere) |
| 23 Primary button colours | §10 |
| 24 Four back patterns | §8.3 |
| 25 Label drift | §8.2 (registry label everywhere) |
| 26 Two toast systems | §10 |
| 27 Task-types hand-rolled modal | §5.8 |
| 28 `/me/mentions` orphan | §7.1 |
| 29 "My Profile" never highlights | §7.1 |
| 30 Dead Settings hub sidebar | §2.3, §7.1 |
| 31 Overview scoring cards show legacy fields | §5.1, §5.16 |
| 32 Matrix modules outside PPMS scope | §5.7 (matrix deleted) |

`critic-gaps.json` topSystemicIssues #4 (access fragmented): one gate for the doors (§3.1) from the access spec's own rule table, every org write API on the page rule, one denial family instead of disabled controls, the per-field write table for the person record (§9.2a), the rules for every folded app key (§7.1a), the full-directory pick endpoint, the settings door never redirecting; the object-level half is the access spec's. #7 (settings that do nothing): every row of §7.3 has a store, a writer and a reader or is hidden behind "Show upcoming features", including the four rows the first draft left to other specs (private and pinned views, escalation thresholds, `TaskListSurface` options, builder dirty guards); `.strict()` schemas (§9.3); the security editor with its real readers named (§5.9); enforced rail floors (§5.3, §12 S7); the wired Space default (§6.2); dirty guards (§8.5). `access-model.md` Broken #4, #14, #15, #17, #18, #24, #25, #26, #27, #31 are closed by §5.5, §3.1, §3.4, §5.9, §5.9, §3.1, §5.1, §5.3, §5.12, §5.5 respectively; the rest belong to the access spec and are listed there.

Decisions that must hold: task assignment grants item access (access rule 9, untouched); non-guest members write content (Can edit, untouched); a List or Folder shares on its own (access rules 6 and 10; the share dialog); the rail is access-derived (§2.3, no pin API anywhere); Talk and Tables are ProductInstallation-gated (§5.3); the Talent 9-box stays at `/talent` in the Teams sidebar with a link from Scoring (§7.1).

---

## 14. Open decisions for the founder (with recommendations)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | The rail Settings hub for people outside the Workspace door | Visible for everyone and opens My settings (this spec) · Hidden for non-admins (two-door as written) | Visible. The rail must never have a dead slot, the memory says `settings` is alwaysPinned, the access spec says Settings is a Personal app for everyone, and a Member who taps it gets My settings. |
| 2 | A read tier on Members, Structure, Access and Scoring | None: Owner and Admin only, as the access spec writes it (this spec) · People team read · People team plus a "can look" Admin scope for C-suite | None for v1. The access spec is explicit that the People team has no Admin settings page, and every right they hold is exercised in Teams. An Owner who wants the CEO or HR head to look makes them Admin. If a real customer asks, the read tier is one `gate` value in the page table and the access spec's §5.4 rendering rule; it is not a fourth role. |
| 3 | "Who can invite Members" | Fixed rule, Owners and Admins only (access D3 and D10; this spec) · An eleventh toggle "Any Member (company domain only)" | Fixed rule. The ten toggles are the access spec's cap and the access spec owns D3; this spec flags to it that a domain-only Member invite is the first candidate if a 20-person pilot shows friction, and that the Invite rules card has room for one caption line, not a control, until then. |
| 4 | Welcome splash as an org setting | Row on Identity › Culture, default "every open" (this spec) · No row, founder-only behaviour | Keep the row with the current behaviour as the default; it preserves the founder's ask and lets Phase 2 Q3 change only the default. |
| 5 | Accent picker | One brand blue (Phase 2 Q4 default; the Accent rows hide themselves) · Keep the seven-key list without the purple family | One blue. Fewer dark-mode permutations and one less thing to explain; the code path for the list stays so reversing is a constant. |
| 6 | Org notification defaults with per-row locks | Defer until `notify-prefs.ts` reads them (this spec) · Ship a "Notification defaults" card on Members now | Defer. Shipping a card with no reader is the exact failure the persistence rule forbids; add it with its reader in one change. |
| 7 | Trash retention default | 60 days (matches the delete confirmations and the catalog comment) · 30 | 60. |
| 8 | New-org MFA default | Required for Admins (this spec) · Nobody · Everyone | Admins. It is what a corporate buyer expects on day one and what a 20-person firm does not notice. |
| 9 | Personal locale storage | JSON keys under `UserPreference.home.locale` now, promote later (this spec) · Typed `User` columns now | JSON now. Zero prod migration for the personal pages; promotion is mechanical later. |
| 10 | SSO tab before the SAML login route is verified | Hidden behind "Show upcoming features" (this spec) · Visible with a "Beta" chip | Hidden. A visible SSO form over an unverified login path recreates the surface-without-backend failure the audit found on `/settings/calendar`. |
| 11 | Phase 2 Q8: one takeover with You / Workspace / Governance / Billing groups, or two doors | Two doors (this spec) · One list | Two doors. The gate and the registry are identical either way; merging the sidebars is a day. Two entrances to one sentence beats one entrance to four groups. |
| 12 | An org-level "Allow members to connect Google Calendar" switch | Not shipped until the OAuth route reads it (this spec) · Ship now | Not shipped. No reader, no row. |
| 13 | Scoring & reviews editing rights | Owner and Admin only (this spec, per access §2.1) · People team edits (they run the reviews) | Owner and Admin for v1; the People team launches cycles already at `/reviews` (access §9) and never opens the Workspace door. If HR asks, the change is an access-spec decision (a People team exception on one page key), not a settings one. |
| 14 | Rail labels versus icons-only | Drop the icons-only option (Phase 2 4.1) and the row with it · Keep the row | Drop it with the shell spec; labels are the zero-training mechanism. Until the shell spec lands the row stays and persists. |

---

## 15. Risks

1. **Owner / Admin split changes who can open Billing, Security and API keys.** Today every COMPANY_ADMIN can. Mitigation: `SETTINGS_OWNER_SPLIT` stays off until the access pre-flight report names each org's Owner and the founder approves; the `AdminOnly` card names the Owners; release note.
2. **C_LEVEL and managers lose settings reach** (C_LEVEL's API-only write, managers' read-only URL access). Both are corrections; S1's log-only week finds the customer who relied on them.
3. **Rail floors become real gates.** Careless configs set while floors were decorative can lock people out. Mitigation: the "N people lose access" preview, the one-time migration report, the logged week, `home` and `settings` exempt.
4. **Auth reads org policy per token refresh, which it does not do today.** Session idle, absolute lifetime, MFA audience and lockout move from hard-coded constants (`auth.ts:259-266`, `:125`; `login-throttle.ts:13-15`) to org values through the `jwt` callback, the credentials `authorize` and a policy argument on the throttle (§5.9); env stays the floor; the lockout default is the code's 8 / 15 so day one changes nothing. The throttle store stays per process, so a second instance would count separately; that is today's behaviour and is named in the file. Verify the MFA-at-login gate with `ENFORCE_MFA_AT_LOGIN=true` and org `mfaRequired = "admins"` against an un-enrolled Admin and an enrolled Member before shipping S5.
5. **Prod migration drift.** Three `User` columns via `prisma db execute`; the pages that need them ship behind the migration; every reader tolerates a missing column.
6. **Hiding unenforced matrix cells looks like feature loss.** Release note plus the "Enforced at" framing; the legacy grid stays only for the 14 named live cells (§5.7) until access step 5; the access spec's "18" is flagged so the golden suite is written against the same 14.
7. **More `/api/preferences` writes** (presence, mute, quick tools, sidebar width). Debounce per key; sidebar drag writes at most twice a second.
8. **Two doors means two places to look** for an ambiguous setting (accent: personal or org default?). Mitigation: cross-links in both places, the registry search covering both doors for door members, `/settings/all` and `/account/all`.
9. **Webhooks, Import and SSO depend on routes not verified end to end.** They ship only after a real run; never stubbed.
10. **Redirect sprawl.** Fifteen redirects plus a dozen hard-coded paths; all updated in S0 with the redirects as the net.
11. **The settings gate depends on the access engine's step 0 and 1.** If access slips, S1 can ship with a temporary `orgRoleOf(accessLevel)` inside `src/lib/access/settings.ts` (still under the lint rule's one allowed directory) and swap to `viewerFromSession()` later; the page table is the same either way.
14. **People team and HR users lose the settings pages they open today.** Intended (access §2.1) and named per org by S1's log-only week; the release note points them to `/people/[id]`, `/people/roles` and `/organization`, where every right they keep now lives.
15. **Narrowing the manager's `managerId` write.** Today any manager in the reporting line can move a report to another manager; §9.2a makes that People team and Admin. The logged week names anyone who used it; the fix for a real case is People team membership, not a new rule.
12. **Audit volume** from autosave rows. Consecutive edits by one actor on one key within 60 s collapse into one row at write time.
13. **Mobile.** The door sidebar collapses below 900 px; drawers go full-screen; nothing else in the shell is responsive yet, so settings must not be the first mobile surface, but the layouts degrade rather than break.

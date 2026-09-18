# Staff back-office spec

Unit: the WorkwrK staff console at `admin.workwrk.com` (companies, staff, analytics, AppSumo codes). Written 2026-09-12 against `main` at `6187227a`, the audit inventories `access-model.md` (§1.8, §1.9, §2.19, §3 #28, §4, §5) and `auth-onboarding.md` (§1.1, §5 sign-in behaviour), `critic-gaps.json`, and the three decided documents (`design-system.md` for look, `access-model-spec.md` for access, `settings-architecture.md` for settings structure). Also read: `docs/plans/subdomain-architecture.md`, `zoho-reference.md`, `phase2-inputs.md`, `existing-direction.md`.

This is not a customer surface. Nobody outside WorkwrK ever sees it. It exists so a WorkwrK person can answer four questions without opening a database client: **who are our customers, what did we sell them, what did we make, and what did we change for them.**

The one sentence: **the staff console shows every customer company, lets a WorkwrK person fix that company's plan, seats and modules, and writes down every change so both sides can see it.**

Three rules run through the whole unit:

1. **No customer content, ever.** The console shows counts, plan, seats, modules and dates. It never shows a task, a document, a message, a name inside a workspace beyond the Owners' contact details, or a file. If a number would require reading a customer's work to compute, it is not on a page here.
2. **No impersonation.** There is no "sign in as", no "view as", no support session. §1 Access states the policy and §2.3 renders it on the company page.
3. **Every change is written down twice.** Once in the staff log (`/admin/audit`, staff only) and, when the change touched a customer's workspace, once in that customer's own audit log at `/settings/audit`, so the customer can see that WorkwrK changed their plan and when.

---

## 0. Scope

### Routes covered

| URL | File under `src/app` | What it is |
|---|---|---|
| `/admin` | `(admin)/admin/page.tsx` | Overview: today's numbers and what needs attention |
| `/admin/companies` | `(admin)/admin/companies/page.tsx` | Companies: every customer company |
| `/admin/companies/[id]` | `(admin)/admin/companies/[id]/page.tsx` | One company: plan, seats, modules, people, staff activity. Opens as a 520 drawer over the list and as a full page from a deep link. Same URL both ways. |
| `/admin/staff` | `(admin)/admin/staff/page.tsx` | Staff: the WorkwrK people who can open this console |
| `/admin/analytics` | `(admin)/admin/analytics/page.tsx` | Analytics: revenue, growth, funnel, retention, cancellations |
| `/admin/appsumo` | `(admin)/admin/appsumo/page.tsx` | AppSumo codes: import, watch them get redeemed, mark refunds |
| `/admin/audit` | `(admin)/admin/audit/page.tsx` (**new file**) | Staff activity: every change staff made, who made it, to which company |
| (shell) | `(admin)/layout.tsx`, `(admin)/admin-shell.tsx` | the staff gate and the reduced shell |
| (overlay, no URL) | `(admin)/staff-search.tsx` (**new file**) | Search (⌘K): find a company, a staff member or a code by typing. Specified in full at §2.8. |

**Routes ADDED by this spec**

- `/admin/audit` ("Staff activity"). Reason: the task requires audit logging of every staff action, and a log nobody can read is not a log. One list page, one new table, no new concepts.

**Routes referenced but owned elsewhere**

- `/login` on the admin host. The proxy already lets `/login` and `/api/auth` through on that host (`proxy.ts:133-140`) and the layout sends an unauthenticated visitor to `/login?callbackUrl=/admin` (`layout.tsx:30`). The page itself belongs to the auth unit. This unit asks that unit for one thing only: when the request host is the admin host, the page reads "Sign in to the WorkwrK staff console", and the Create an account and Continue with Google entries do not render. Nothing else changes.

### Routes in this unit that are REMOVED, REDIRECTED or MERGED

| Today | Disposition | Reason |
|---|---|---|
| Companies list "quick edit" dialog (the Eye button, `companies/page.tsx:218-220, 252-339`) | **Merged** into `/admin/companies/[id]`, which now opens as a drawer on row click. Every field the dialog had (plan, status, counts, slug, domain, joined) is on that page and more. | Two doors to one job. The dialog could change a plan without the confirm and without the seat and module context that makes the change correct. |
| Companies list "Manage" button (`companies/page.tsx:221-223`) | **Merged**: the whole row is the target now; the button goes | one destination, one way in |
| Companies list search input (`companies/page.tsx:139-147`, backed by `search=` at `api/admin/companies/route.ts:13,21-27`) | **Merged** into two places, both specified: **Search (⌘K)** §2.8, which jumps straight to a company by name, slug or sign-in domain, and the Companies `FilterPanel` field **Name or domain** (§2.2), which narrows the list in place. The `search=` parameter is kept on `GET /api/admin/companies` and is what both surfaces call. | one text box floating above a table becomes one palette that searches everything plus one filter field that lives with the other filters, and the URL still carries the state |
| Companies list plan and status selects (`companies/page.tsx:149-166`) | **Merged** into the views row and the `FilterPanel` (§2.2) | the design system's one page pattern |
| Company slug in the detail header (`companies/[id]/page.tsx:85`) and in the quick-edit dialog | **Re-parented** to the company page's **Facts** card (§2.3 card 1), beside Sign-in domain and Company ID, with a copy button | a slug is a lookup key, and the Facts card is where lookup keys live. It leaves the Companies table with the rest of the second lines (§1 One line per row). |
| Sidebar "Log out" button (`admin-shell.tsx:61-70`) | **Re-parented** to the top-bar avatar menu (§2.1) | the design system puts Log out in the avatar menu on every surface; the sidebar is destinations only |
| Avatar-menu "Theme" row (proposed in an earlier draft of this spec) | **Removed**, target named: My settings › Preferences › Appearance (`/account/preferences?tab=appearance`, `UserPreference.theme.appearance`, settings-architecture §4.2) | one setting, one home. The console reads that preference; it never offers a second writer for it. |
| AppSumo "Bulk import" tab (`appsumo/page.tsx:152-202`) | **Merged** into the one primary button "Import codes", which opens a 720 modal | the page is the list of codes; importing is an action on it, not a second page. Today the page opens on the import form and the codes are hidden behind a tab. |
| AppSumo filter buttons All / Unused / Redeemed / Refunded (`appsumo/page.tsx:206-215`) | **Merged** into the views row as text-tab pills with server counts | the design system's one page pattern |
| Per-page "Refresh" buttons (`admin/page.tsx:154`, `analytics/page.tsx:136`, `staff/page.tsx:103`) | **Merged** into the "…" menu as the first row, "Refresh". The pages also refetch when the window regains focus and the data is older than 60 seconds. | a Refresh button in the toolbar competes with the one primary |
| Overview "System Info" card (`admin/page.tsx:255-279`) | **Removed**, no target | "WorkwrK v1.0" is a hard-coded string and "Environment" is `process.env.NODE_ENV` read in a client component. Neither is a fact about the business. |
| Overview "Active Rate" stat and Analytics "Active rate" (`admin/page.tsx:137-144`, `analytics/page.tsx:344`) | **Removed**, no target | it is the share of companies whose billing status is ACTIVE, presented as an activity number. Analytics gains a real one: companies with activity in the last 30 days. |
| Analytics "Trial Conversion Pipeline" card (`analytics/page.tsx:166-172`) | **Renamed** to "On trial" and folded into the Growth card | it is a count of trials, not a pipeline |
| Analytics "Most Active Organizations" (`analytics/page.tsx:302-323`) | **Replaced** by "Busiest workspaces", counted from actions in the selected range | today it sums lifetime tasks, KRAs, SOPs and reviews and calls it activity, so a customer who left three years ago still tops the list |
| Analytics "Projected ARR" tile (`analytics/page.tsx:347-350`) | **Merged** into the Revenue card as one derived line, "Annual run rate" | a hero tile for a number that is another number times twelve |
| Analytics "Avg. Users Per Org" tile (`analytics/page.tsx:159-165`) | **Merged** into the Growth card (§2.5 item 2) as one derived line, "Average people per company {n}", with the same context it carries today ("{n} people across {n} companies") | an average is a derived line, not a hero tile. Nothing is lost: both source numbers are already on Overview. |
| Analytics "Revenue by Plan" card (`analytics/page.tsx:250-276`) | **Removed**, no target | it multiplies a hard-coded price by a count of companies per plan. Revenue now comes from Stripe per subscription, and Stripe knows nothing about our plan names, so the number cannot be rebuilt honestly. The **Plans** card (§2.5 item 7) keeps the company count per plan, which is the part that was true. |
| Company detail "Custom domain" switch (`companies/[id]/page.tsx:184-191`) | **Removed**, no target | nothing reads the flag. `proxy.ts:221` stamps `x-workwrk-host` and no code reads that header; there is no field holding the customer's domain to route. The switch writes a value that changes nothing. It comes back when the routing exists (§4). |
| Company detail Enterprise toggles shown disabled on non-Enterprise plans (`companies/[id]/page.tsx:173, 192-196`) | **Replaced** by rendering the card only on Enterprise, with one line on other plans | a control the plan cannot use is not rendered, per the design system. Today they are switchable in appearance and inert in effect. |
| The dark inline "Restricted" page (`layout.tsx:36-66`) | **Replaced** by the one denial component family from `src/components/access/` | access-model-spec §6.4 names this page explicitly |
| `PATCH /api/admin/companies` (list-level, `companies/route.ts:62-83`) | **Removed**; `PATCH /api/admin/companies/[id]` is the one writer | two writers for one record, and the list-level one writes no audit row |
| `GET /api/admin/stats` (`stats/route.ts`) | **Split** into `GET /api/admin/overview` and `GET /api/admin/analytics` | one 233-line endpoint served two pages and computed revenue from a hard-coded price list |

Nothing a staff member can do today becomes impossible. Every field, filter and action above has a named home in §2.

### Audit inventories consulted

`access-model.md` §1.8 (route gates table), §1.9 (platform admin), §2.19 (`/admin` back-office), §3 #28, §4 (back navigation, style consistency), §5 (who can do what). `auth-onboarding.md` §1.1 (file map), §5 (sign-in: lockout, INACTIVE users, CANCELLED and SUSPENDED orgs). `critic-gaps.json` (`missedRoutes` names `/admin/analytics` and `/admin/appsumo` as never audited; this spec covers both). `route-list.txt`.

### Audit issue IDs this unit resolves

From `access-model.md`: §2.19 Issues (no support view, no way to reset a tenant's last Owner, suspended-org enforcement unstated), §3 **#28** (back-office is a different design system), §1.9 (the `ADMIN_HOST` split is opt-in and the layout gate is not the security boundary).

From `critic-gaps.json` `topSystemicIssues`: **#1** (nav highlight not URL-derived), **#2** (fabricated chrome: hard-coded version string, revenue from a price list, page-local counts presented as totals), **#3** (duplicate surfaces: quick-edit dialog vs company page), **#4** (denial page outside the one family; no gate vocabulary), **#5** (no back convention: `router.push` instead of `BackButton{fallbackHref}`), **#6** (five visual systems: this console is the shadcn `ui/*` set with the lime `#d4ff2e` and a red accent), **#7** (settings that do not persist: the Custom domain switch), **#9** (naming drift: Dashboard / Admin Dashboard / Platform overview / Subscriber Companies), **#10** (zero breakpoints), **#11** (errors swallowed into empty states; no session-expiry handling), **#15** (em dashes in UI strings).

From `critic-gaps.json` `missedRoutes`: `/admin/analytics` and `/admin/appsumo` are specified here for the first time.

---

## 1. Unit-level rules

### Hub and sidebar

There is no rail here. The staff console is a **reduced shell**: the 48px navy top bar and one 264px sidebar from the design system, with the 64px hub rail removed. Reason: the rail exists to switch between eight product hubs; this console has seven destinations and one level of navigation, and `zoho-reference.md` rejects stacking navigation layers. Every token, height, radius and type size is the design system's, unchanged. The absence of the rail is also what tells a staff member at a glance that they are not inside a customer's workspace.

| Route | Sidebar row active |
|---|---|
| `/admin` | Overview |
| `/admin/companies`, `/admin/companies/[id]` | Companies |
| `/admin/analytics` | Analytics |
| `/admin/appsumo` | AppSumo codes |
| `/admin/staff` | Staff |
| `/admin/audit` | Staff activity |

The active row is derived from the URL on every render by longest-prefix segment match, never from stored state and never from `pathname === href`. Today `admin-shell.tsx:43` uses exact equality, so `/admin/companies/<id>` highlights nothing and `/admin` would highlight on every path if the order changed. `aria-current="page"` sits on the active row.

### Sidebar contents (this unit owns this sidebar)

264px, `--os-side-bg` (N50), `border-inline-end: 1px solid var(--os-line)`, rows 36 (`.os-row`), inset 8px, icons 20px Lucide at 1.5px in `--os-ink-2`, labels 15/400 `--os-ink`, active = `--os-side-pill` (N200) radius 8 with the label at 15/500 and the icon at `--os-ink`. No blue, no left bar, no transform. Collapsible to zero with the circular chevron at the outer edge bottom and `⌘\`; the state persists per staff member in the console preference store below, never in `localStorage`.

**Header (56px)**: the four-dot logo mark (28px, brand hexes, the one saturated object here) then "WorkwrK Staff" 15/500 `--os-ink`. Not a switcher, not a menu, not clickable. There is no hub search: six rows never exceeds twelve.

**Rows, in order:**

| Label | Icon | Href | Gating | Count or badge |
|---|---|---|---|---|
| Overview | `LayoutDashboard` | `/admin` | Platform staff | none |
| Companies | `Building2` | `/admin/companies` | Platform staff | none |
| Analytics | `BarChart3` | `/admin/analytics` | Platform staff | none |
| AppSumo codes | `KeyRound` | `/admin/appsumo` | Platform staff | none |

Then a section label **CONSOLE** (11/600 uppercase, +0.06em, `--os-ink-2`, 1px `--os-line` rule to the right edge, 24 above, 8 below). **The section is not collapsible and is always expanded.** It holds two rows and never grows, so a chevron would be a control with nothing to do; there is no collapsed-by-default state and no stored state for it.

| Label | Icon | Href | Gating | Count or badge |
|---|---|---|---|---|
| Staff | `ShieldCheck` | `/admin/staff` | Platform staff | none |
| Staff activity | `ScrollText` | `/admin/audit` | Platform staff | none |

The four rows above the CONSOLE label sit in an unlabelled first section that is likewise always expanded.

No create action in the sidebar header: nothing in this console is created from the sidebar. No footer button (there is no Customize Sidebar here; there is nothing to customize). No counts on any row: a number that only staff can act on belongs on the Overview page's "Needs attention" card, not as a badge that nags.

### Console preferences: every visible setting and where it persists

The console has no preferences page, and it never invents a second home for a setting that already has one. Three rules cover everything a staff member can change here.

**1. Person preferences belong to the product, not to this console.** Theme (Light / Dark / System) and Density (Comfortable / Cozy / Compact) have one home each: My settings › Preferences › Appearance (`/account/preferences?tab=appearance`), stored on `UserPreference.theme.appearance` and `UserPreference.density` (settings-architecture §4.2). The console **reads** both through the same `ThemeApplier` the product uses and offers no control for either. There is no Theme row in the avatar menu, and `AdminShell` does **not** stamp `html[data-density="cozy"]`: it stamps the person's own density, so a staff member who works at Comfortable gets 44px rows here too. Every table in this unit is designed to hold at all three tiers, which is why no cell in this unit carries two lines (see "One line per row" below). `html[data-chrome="navy"]` is stamped unconditionally, because the navy frame is this console's identity and not a preference.

The one link: the avatar menu's **My settings** row opens `/account/preferences?tab=appearance` on the app host, as an absolute `NEXT_PUBLIC_APP_URL` link in a new tab, because the admin host does not serve product routes.

**2. Console-local layout state persists on the server, per staff member.** Three things are genuinely local to this console and have no product home: the sidebar collapsed state, the company drawer width, and per-table column visibility. They persist in a new `PlatformAdmin.consolePrefs` JSON column, read by `GET /api/admin/me` and written by `PATCH /api/admin/me/console` (debounced 500ms). Keys, all of them optional with the stated default:

| Key | Default | Written by |
|---|---|---|
| `sidebar.collapsed` | `false` | the sidebar chevron and `⌘\` |
| `companies.drawerWidth` | `520` | the company drawer's resize handle (clamped 480 to 720) |
| `companies.columns` | all eight on | the Companies column-settings button (§2.2) |
| `audit.columns` | all six on | the Staff activity column-settings button (§2.7) |

They live here rather than in `UserPreference` for one reason: the proxy serves only `/admin`, `/login`, `/api/auth` and `/api/admin/*` on the admin host (`proxy.ts:133-153`), so `PATCH /api/preferences` is not reachable from this console. They are not `localStorage`, because a staff member who opens the console on a second machine should find their columns where they left them, and because the hard rule is that every visible setting persists.

**3. Nothing else in this console is a setting.** Views, filters, sort and range are URL state, not preferences: they live in the query string and are restored from it, so a link carries them and the back arrow undoes them.

### One line per row

No table cell in this unit carries two lines of text. Design system §3.2 states it plainly: two-line content is not allowed in a data row, it goes to the drawer, and the content-height budget is the row height minus 12 (32px at Comfortable, 24 at Cozy, 20 at Compact). Two 15/22 and 12/16 lines are 38px and do not fit any tier.

So a second fact gets its own column, or it moves to the detail surface:

| Where a second line was proposed | Where it goes |
|---|---|
| Companies › Company (name over slug and domain) | the cell is the name alone; **Sign-in domain** becomes its own column (off by default in column settings); the **slug** moves to the company page's Facts card (§2.3 card 1) |
| Overview › Newest companies › Company (name over slug) | the name alone |
| Staff › Person (name over email) | two columns, **Name** and **Email** |
| Staff activity › Who (name over email) | two columns, **Who** and **Email** (Email off by default) |

Where a name is missing, the cell falls back to the email at 15/400 in the Name column and the Email column repeats it; nothing renders blank.

### One placement for the "…" menu

Design system §4.4 gives the title row ghost page actions and the toolbar row right a bordered 36px "…" square. One rule for this unit, applied everywhere:

- A page **with** a toolbar row (Companies, Staff, Analytics, AppSumo codes, Staff activity) carries the bordered 36px "…" at the **toolbar row right**, after the primary button where there is one. It never also appears in the title row.
- A page **without** a toolbar row (Overview, the company page) carries a **28px ghost "…"** in the title row right, per §4.4's title-row rule. There is no bordered square on a page with no toolbar.

Every "…" menu in this unit ends with the same last row, **About this page**, which opens a 400 modal titled with the page name and holding the one or two sentences that explain the page. That is the sanctioned home for a page explanation: the design system deletes the description line under the title, and §0 deletes today's subtitles for the same reason.

### Naming canon

One label per destination. Old labels it replaces are in brackets.

| The one label | Replaces |
|---|---|
| **Staff console** (the product name of this surface) | "WorkwrK Admin", "WorkwrK Staff · Platform back-office", "the back-office", "admin panel" |
| **Overview** | "Dashboard", "Admin Dashboard", "Platform overview and subscriber management" |
| **Companies** | "Subscriber Companies", "Manage all subscriber organizations", "orgs", "tenants" |
| **a company** (one row) | "organization", "org", "subscriber", "tenant" |
| **their workspace** (what a company uses inside the product) | "their org", "their account", "their instance" |
| **Analytics** | "Platform Analytics", "Revenue, usage, and growth metrics" |
| **AppSumo codes** | "AppSumo Codes", "Lifetime deals", "AppSumo redemption codes" |
| **Staff** | "Platform Staff", "the platform-staff allowlist", "WorkwrK employees" |
| **Staff activity** | new |
| **Plan** | "tier", "plan level" |
| **Seats** | "user cap", "licence count" |
| **Modules** | "premium modules", "products", "installations", "ClickApps" |
| **Enterprise add-ons** | "enterprise feature flags", "paid add-ons" |

Elsewhere in the product the tenant is a **workspace** (Workspace settings, delete workspace). Here the row is a **company**, because staff sell to companies, and the thing that company uses is **their workspace**. Those two words are the whole vocabulary; "org", "tenant", "subscriber" and "account" do not appear on screen.

**The breadcrumb applies the canon.** The first crumb is **"Staff console"** on every route in this unit and links to `/admin`; the second crumb is the page's one label. So the routes read "Staff console › Overview", "Staff console › Companies", "Staff console › Companies › {name}", "Staff console › Analytics", "Staff console › AppSumo codes", "Staff console › Staff", "Staff console › Staff activity". One label never names two destinations, so "Staff › Staff" does not occur.

**Settings pages are named in the customer's words, which are settings-architecture's words.** When this console points a staff member at a page inside a customer's workspace it uses that page's canonical name and its route, never a paraphrase:

| The one label | Route | Home |
|---|---|---|
| Settings › Apps & modules | `/settings/apps` | settings-architecture §5.3 |
| Settings › Plan & billing | `/settings/billing` | settings-architecture §5.14 |
| Settings › Identity & culture › Danger zone | `/settings/identity?tab=danger` | settings-architecture §5.2 |
| Settings › Audit log | `/settings/audit` | settings-architecture §5.12 |
| My settings › Preferences › Appearance | `/account/preferences?tab=appearance` | settings-architecture §4.2 |

### Access

The only role in this unit is **Platform staff** (`access-model-spec.md` §2.6: the `PlatformAdmin` allowlist, never a tenant role). There is no second rung, no read-only tier and no per-page gate. A person is Platform staff and can do everything here, or they are not and can reach nothing. The Open questions section carries the question about a read-only support tier.

| Who | What they get |
|---|---|
| Platform staff (an email in `PlatformAdmin`) | every route and every action in this unit |
| A signed-in person who is not Platform staff | the denial view below. Their tenant role is irrelevant: a customer's Owner has no standing here. |
| Not signed in | `/login?callbackUrl=<current>` on the admin host |
| Anyone on the customer host or the marketing host | `/admin` and `/api/admin/*` are rewritten to `/404` by `proxy.ts:149-153`. The console is not discoverable from the product: no rail entry, no avatar-menu row, no command-palette result, no link in any email. |

**Read-only viewer:** none. There is no read-only staff role, so no page in this unit has a read-only mode. Where the template asks for it, each route says "none".

**Denial, one convention** (`access-model-spec.md` §5.5 and §6.4): the inline lime page at `layout.tsx:36-66` is deleted. `(admin)/layout.tsx` renders `<LockedPage>` from `src/components/access/`, the same component family the product uses, with staff copy:

- icon: `ShieldCheck` 40px `--os-ink-3`
- title 16/600 "This console is for WorkwrK staff"
- one sentence 15/400 `--os-ink-2`: "You are signed in as {email}. That account is not on the WorkwrK staff list."
- **no** Request access button: there is nobody inside this console to ask, and the staff list is the thing being protected.
- `BackButton{fallbackHref="<NEXT_PUBLIC_APP_URL>"}` with the label "WorkwrK", exactly as `access-model-spec.md` §6.4 requires of every member of the denial family. It is the standard 28px ghost with `ArrowLeft`; the only thing unusual about it is that the href is absolute, because the proxy bounces relative paths back to `/admin` on this host. `BackButton` accepts an absolute href today and needs no change; the prop note is repeated in §3 so nobody forks a text link for this case. **This is not a deviation from the convention** and the earlier draft's plain text link is withdrawn.
- The denial writes one `StaffAction` row, `admin.access.denied`, with the email and IP, so a repeated probe is visible on `/admin/audit`. **Sampled to one row per email per ten minutes**, the access model's denial-log rule (`access-model-spec.md` §5.1, graft G11): the target is always the same (this console), so the rule reads as one row per would-be viewer per ten minutes. A person who hits the wall once is recorded; a script hammering the host cannot flood the log. Rows carry a `hits` count so a burst is still visible as a number, and the ten-minute window is the row's lifetime, not a fixed clock bucket.

**Session ended, one convention**: any fetch in this unit that returns 401 replaces the page body with a centred card, 400 wide: "Your session ended" 16/600, "Sign in again to keep working." 15/400 `--os-ink-2`, one primary "Sign in" → `/login?callbackUrl=<current>`. It never renders an empty table, and it never renders a zero. This is the console's answer to `critic-gaps` #11, which found no 401 handling anywhere in the app.

**Audit, one convention.** Every write in this unit calls `logStaffAction()` (§3), which writes one `StaffAction` row: who (staff user id and email), what (the action key), the target company, a one-sentence summary in plain words, the before and after values, the IP, the time. Reads are not logged, and the reason is stated on the company page: no customer content is ever shown here, so opening a company page reveals nothing that needs a record. `StaffAction` rows are kept for ever.

**The customer's half, specified.** Writes that change a customer's workspace additionally write that workspace's own `ActivityLog` through the existing `logAuditEvent()`, so the customer sees the change at **Settings › Audit log** (`/settings/audit`, settings-architecture §5.12). That page renders tabs All / Access / Security / Data / Settings, a Time / Actor / Event / Target / Severity table and a searchable Actor filter, so this unit must name three things or the customer's rows break.

*The event keys and the tab each lands in.* Six keys, one per staff write that touches a workspace. The tab is decided by the type family the audit page already maps.

| Staff action | Customer event key | Tab | Event text the customer reads | Severity |
|---|---|---|---|---|
| Plan changed | `staff.plan.changed` | Settings | "WorkwrK Support changed the plan from Growth to Scale" | info |
| Status changed (Active / Trial / Suspended / Cancelled) | `staff.status.changed` | Settings | "WorkwrK Support suspended this workspace" | warning, or danger for Cancelled |
| Seats changed | `staff.seats.changed` | Settings | "WorkwrK Support changed seats from 25 to 50" | info |
| Module turned on or off | `staff.module.changed` | Settings | "WorkwrK Support turned Talk on" | info |
| Enterprise add-on toggled | `staff.feature.changed` | Settings | "WorkwrK Support turned White label on" | info |
| Set workspace Owner | `staff.owner.set` | **Access** | "WorkwrK Support gave Maya Owner access" | warning |

`staff.owner.set` is the one that is not a settings change: it is an org-role change, so it lands in the Access tab and is written **alongside** the workspace's own `org_role.changed` row that the access model already specifies (`access-model-spec.md` §5.1), so the Access tab tells the whole story whether the reader filters by actor or by event. The other five are settings changes and sit in the Settings tab beside the workspace's own `settings.updated.{section}` rows. The 60-second same-actor-same-key collapse that `/settings/audit` applies at write time is **not** applied to `staff.*` rows: two staff changes a minute apart are two facts, and collapsing them would hide one.

*How a staff actor renders.* The actor is a WorkwrK person, not a member of that workspace, so an `actorId` pointing at a user of a different organisation is meaningless to the customer's page and is what `api/admin/companies/[id]/route.ts:61,72,99` writes today. It is replaced by a named non-person actor:

- `actorId: null`
- `actorType: "platform_staff"` (the `actorType` column the access model already puts on every audit row, `access-model-spec.md` §5.1)
- `actorLabel: "WorkwrK Support"`

The Actor column renders a 24px `EntityTile size="xs"` neutral with `ShieldCheck` and the words **WorkwrK Support** at 15/400, with no email and no avatar. The individual staff member's name, email and IP are **never** written into the customer's log: the customer is entitled to know that WorkwrK changed their plan, and is not entitled to the name of the employee who did it. That name is on the staff side, in the `StaffAction` row, for ever.

The searchable **Actor** filter on `/settings/audit` carries one fixed entry, "WorkwrK Support", pinned above the workspace's own people, so a customer can filter their log down to exactly what WorkwrK did. This is a small addition to that page and is listed in §4 as a dependency on the settings and workspace unit.

### Back and close

| Surface | Back or close target |
|---|---|
| `/admin/companies/[id]` as a **full page** | `BackButton{fallbackHref="/admin/companies"}` in the title row: a 28px ghost with `ArrowLeft` and the label "Companies". Bare `router.back()` is forbidden; today `companies/[id]/page.tsx:76` uses `router.push`. |
| `/admin/companies/[id]` as a **drawer** | ✕ and Esc return to `/admin/companies` with the list's filters and scroll position intact. ⤢ Expand animates the drawer into the full page in place (240ms) at the same URL. |
| Every list page (`/admin`, `/admin/companies`, `/admin/staff`, `/admin/analytics`, `/admin/appsumo`, `/admin/audit`) | no back button. They are top-level. The top bar's ‹ › browser arrows are the only history control. |
| Add staff modal (560), Import codes modal (720), Set workspace Owner modal (560), See details modal (560) | Cancel (ghost, left of the primary), ✕, Esc, outside click. A dirty form confirms before discarding. |
| Confirm modals (400) | Cancel and Esc. Esc never confirms. |
| About this page modal (400, the last row of every "…") | one ghost "Close", ✕, Esc, outside click. It holds text only, so there is nothing to discard. |
| Search (⌘K) overlay (640, §2.8) | Esc, ✕ in the field, outside click. It closes itself before it opens anything, so nothing ever stacks on it. |

Esc closes the topmost layer only: the search overlay before a modal, a modal before a drawer, a drawer before nothing. Esc on a bare page does nothing.

### Mobile and narrow

The console is used on a laptop. It must not break below that, and today it has zero breakpoints.

- **Below 1280**: the top-bar search shrinks to 240. The two side-by-side Analytics cards stack.
- **Below 1024**: the sidebar collapses to zero and a 32px `Menu` icon button appears at the far left of the top bar, opening the sidebar as a 264px slide-over with a scrim. The breadcrumb shows the last two crumbs. Every `TableCard` scrolls horizontally inside its own `overflow-x: auto`; the page body never scrolls sideways. The company drawer becomes full width.
- **Below 768**: not supported and not designed for. The layout still renders (tables scroll, cards stack) and nothing is clipped or unreachable, but no work is done to make it comfortable.
- No hover-only affordance anywhere in this unit: every row menu is a visible 28px "…" at the row's right edge at all widths, and the table header's column filters are always rendered.

---

## 2. Route specs

### 2.1 `/admin` (`(admin)/admin/page.tsx`)

- **Purpose.** The first screen of the morning: how many customers there are, what we made, and what needs a person today.
- **Who sees it and entry points.** Platform staff only. Arrived at by: typing the admin host (the proxy sends every unknown path here, `proxy.ts:141-145`), the sidebar row Overview, the four-dot logo is **not** a link here, `/login?callbackUrl=/admin` after signing in, the breadcrumb crumb "Staff console". No deep-link parameters. No notification ever points here.
- **Top bar.** Left: ‹ › history buttons (32px, `--os-chrome-fg-2`, 40% opacity with no history), then the breadcrumb "Staff console › Overview" (14/400 `--os-chrome-fg-2`, last crumb 14/500 `--os-chrome-fg`, not clickable; "Staff console" links to `/admin`). Centre: the search field, 400px, placeholder "Search companies, staff or a code…", `⌘K`; it is a button styled as a field and opens the overlay at §2.8, so typing never happens in the bar. Right: Help "?" (32px ghost, opens the internal runbook link in a new tab; rendered only when `STAFF_RUNBOOK_URL` is set, otherwise the slot is empty, never a disabled button), then the avatar 28px with the menu, three entries and no more: "Signed in as {email}" (a label, not a row), **My settings** (opens `/account/preferences?tab=appearance` on the app host in a new tab, absolute `NEXT_PUBLIC_APP_URL`, because theme and density live there and nowhere else, §1 Console preferences), **Log out** (`signOut({ callbackUrl: "/login" })`, re-parented from the sidebar). No Theme row, no "+", no bell: nothing in this console notifies anyone.
- **Secondary sidebar.** This unit's sidebar, Overview active, both sections expanded (neither is collapsible).
- **Page header stack.** Title row 48: "Overview" 22/600; right, in the same row: the meta "Updated {relative}" 12/500 `--os-ink-2` (a label, not a control) then a **28px ghost "…"** holding **Refresh** and **About this page**. This page has no toolbar row, so the "…" is the title row's ghost and not a bordered square, per §1 One placement for the "…" menu. Views row: does not render (one view). Toolbar row: does not render (no filters, no sort, no create). This is the design system's rule that the views row never renders on a single-view surface, applied to the toolbar as well because there is nothing in it. Chrome above the first pixel of content: 48 + 48 = 96.
- **Body layout**, in reading order, 24px page padding, cards radius 8 (`--os-r-md`, the design system's card radius; 12 is for modals, drawers and Home widget cards), `--os-line` border, no shadow:

  1. **Numbers.** Four cards in a row (two columns below 1024), each: label 13/500 `--os-ink-2`, number 22/600 `--os-ink` with `tnum`, one 13/400 `--os-ink-2` line of context. No icons in coloured tiles, no green or amber numbers.
     - **Companies**: total. Context "+{n} in the last 30 days".
     - **People**: total users across every company. Context "+{n} in the last 30 days".
     - **Paying**: companies with an active subscription. Context "of {total} companies".
     - **Monthly revenue**: the amount with its currency written out; context "from {n} Stripe subscriptions". When billing is not connected the number is replaced by the words "Not connected" at 15/400 `--os-ink-2` and the context reads "Billing is not connected yet." followed by the text link "How to connect it" when `STAFF_RUNBOOK_URL` is set, and nothing more when it is not. No environment-variable name is ever printed on screen: the runbook is where a variable name belongs. A zero is never shown in place of a missing number.
  2. **Needs attention.** One card, title 16/600, then 36px rows. A row renders only when its count is above zero. Each row: 16px glyph `--os-ink-2`, the sentence 15/400 `--os-ink`, and the count 15/500 right-aligned; the whole row is a link.
     - "{n} trials end in the next 7 days" → `/admin/companies?view=trials`
     - "{n} subscriptions are past due" → `/admin/companies?view=paying&subscription=past_due`. **Past due is a Subscription value, not a Status value**, and the link says so: `status=` carries only Active, Trial, Suspended and Cancelled, and `subscription=` carries Stripe, Lifetime deal, None and Past due (§2.2 FilterPanel and Data). The list opens with the Paying pill active, the Filter panel open and the Subscription row checked at "Past due", so the filtered state is visible and clearable.
     - "{n} workspaces have nobody with Owner access" → `/admin/companies?view=all&owners=0`
     - "{n} workspaces are suspended" → `/admin/companies?view=suspended`
     - "{n} AppSumo codes were redeemed this week" → `/admin/appsumo?view=redeemed`
     When every count is zero the card body is one line 15/400 `--os-ink-2`: "Nothing needs attention."
  3. **Newest companies.** A `TableCard` with the 8 most recent, columns **Company** (name 15/500, one line, no slug beneath, per §1 One line per row; the slug is on the company page's Facts card), **Plan** (`Chip`, neutral), **Status** (`StatusChip`, pale), **People** (right-aligned, `tnum`), **Signed up** (date). Row click opens the company drawer at `/admin/companies/[id]`. The card's 44px footer holds one text link at the left, "See all companies" → `/admin/companies`, and no record count (this card is a sample of eight, not a paged list, so a "Total records" number would be a lie). It is a text link, not a second blue button.
- **Side panel, drawer or modal used here.** The company drawer (520, §2.3), opened by a row in Newest companies, closed by ✕, Esc or the browser back arrow. About this page (400), from the "…": "Today's numbers and what needs a person. Everything here counts companies, plans and dates; no customer's work is ever read to make a number on this page." The search overlay (640, §2.8).
- **States.**
  - *loading*: skeleton bars (`--os-skeleton`, radius 4) at the exact height of each card and row, 60/40/80% widths, one 1.6s opacity pulse. The rail logo does not pulse here because there is no rail; the four dots in the sidebar header carry the route pulse instead, after 200ms of pending.
  - *empty*: no companies at all (a fresh install). Four-dot row line art in `--os-line-strong`, one sentence "No companies yet", no action link (there is nothing staff can do; a company appears when somebody signs up). The Numbers cards still render with zeros because a zero is the true answer.
  - *error*: the card that failed shows an inline row, 15/400 `--os-ink-2`: "Could not load this. Retry" with Retry as a text link. Never an empty state in place of a failure, never a silent `console.error` (`admin/page.tsx:93-95` today).
  - *read-only*: none.
  - *denied*: `<LockedPage>` from the layout gate; the page never renders.
  - *offline or session expired*: the "Your session ended" card from §1. On a network failure with a live session, each card keeps its last value and shows "Updated {relative}" in `--os-danger-text` with a Retry link.
- **Keyboard.** `⌘K` search, `⌘\` sidebar, `Esc` closes the drawer, `↑ ↓` move between rows of the Newest companies table, `Enter` opens the focused row.
- **Data.** New: `GET /api/admin/overview` → `{ companies: { total, newIn30 }, people: { total, newIn30 }, paying: { count, of }, revenue: { source: "stripe" | "unavailable", currency, monthly }, attention: { trialsEndingIn7, pastDue, withoutOwner, suspended, codesRedeemedIn7 }, newest: Company[8] }`. Replaces the overview half of `GET /api/admin/stats`. Reads no setting.
- **Realtime.** Nothing live. The page refetches when the window regains focus and the payload is older than 60 seconds, and on the "…" › Refresh row. No poller, no SSE.
- **What changes vs today.** The four stat cards lose their coloured icon tiles and the lime `#d4ff2e`. "Total Companies / Total Users / Monthly Revenue / Active Rate" become Companies / People / Paying / Monthly revenue; Active Rate is deleted (it measured billing status, not activity). The Plan Distribution card moves to Analytics, where the rest of the trend data lives. The "Subscriber Companies" table becomes "Newest companies", drops the Usage column (four lifetime counts crammed into one cell) and gains Seats context on the company page instead. The System Info card is deleted: "WorkwrK v1.0" was a hard-coded string. "Needs attention" is new and is the reason this page exists separately from Analytics. Revenue stops being a plan-count multiplication and says "Not connected" when it cannot be known. The em dash in "Platform overview and subscriber management" goes with the subtitle.
- **Open questions.** None for this route.

### 2.2 `/admin/companies` (`(admin)/admin/companies/page.tsx`)

- **Purpose.** Every company that has a WorkwrK workspace, so a staff member can find one and see at a glance what it is paying for.
- **Who sees it and entry points.** Platform staff only. Sidebar row Companies; Overview "See all companies"; every "Needs attention" row (with `?view=` and a filter pre-applied); `⌘K` search results; the breadcrumb crumb "Companies" from a company page; a deep link with `?view=` and filter parameters, which the page restores exactly.
- **Top bar.** As §2.1; breadcrumb "Staff console › Companies".
- **Secondary sidebar.** Companies active.
- **Page header stack.**
  - **Title row 48**: "Companies" 22/600. Right: meta "Updated {relative}" 12/500 `--os-ink-2` and nothing else. No "…" here: this page has a toolbar row, so the "…" is a bordered square at the toolbar right (§1 One placement for the "…" menu).
  - **Views row 36**, text-tab pills, 15/400 `--os-ink-2`, active `--os-surface-2` + 15/500 `--os-ink`, each with its count: **All**, **Paying**, **Trials**, **Lifetime**, **Suspended**. The pill writes `?view=` so the URL is the state. There is no "+ View": these five are fixed, and a staff console does not need saved views.
  - **Toolbar row 44**: left = **Filter** (`Funnel` 16px + "Filter", a 36px toggle chip that turns `--os-surface-2` and reads "Filter · 2" when the panel is open), **Sort** (`ArrowUpDown` + "Sort": Newest, Oldest, Most people, Name A to Z). No Group, no view-type switcher: there is one way to look at this list. Right: **no primary button** (a company is created when somebody signs up for WorkwrK; staff never create one, so there is nothing blue on this page), then the **bordered 36px "…"** square holding **Refresh**, **Export CSV** (downloads the current view with its filters applied) and **About this page**.
- **Body layout.**
  - With Filter open, the **272px `FilterPanel`** sits at the left of the content with a 16px gap and the table narrows over 220ms. Heading "Filter companies by" 16/600 with "Clear all" as a text link when anything is active; its own 36px search input filters the field list; then 36px checkbox rows: **Name or domain** (a text input matching the company name, the slug or the sign-in domain, case-insensitive, debounced 250ms; writes `search=`), **Plan** (Starter, Growth, Scale, Enterprise), **Status** (Active, Trial, Suspended, Cancelled), **Subscription** (Stripe, Lifetime deal, None, Past due), **Modules** (Talk, Tables), **Owners** (Has an Owner, Has nobody), **People** (a min and max number pair), **Signed up** (a date range). Checking a row expands its value control beneath it and increments the Filter count; **Name or domain** counts like any other field, so "Filter · 1" is shown whenever a name is being matched and "Clear all" clears it. Bottom: no "Save as view" link, because there are no saved views here. This is where today's loose search box above the table lands, and the other half of that job is Search (⌘K), §2.8.
  - **`TableCard`**, `.os-row`, `--os-row-h` at the staff member's own density (Comfortable 44 / Cozy 36 / Compact 32, set in My settings › Preferences › Appearance, §1 Console preferences). The console does not force a density. The table is designed to hold at all three, which is why no cell in it carries two lines. The header row follows the design system: 44 at Comfortable, 36 otherwise.
  - The card renders **without the checkbox column**: there is no bulk action in this console, and a checkbox with nothing to do is a control without a handler.
  - Columns, left to right, eight in all: **Company** (`EntityTile size="sm"` neutral + the name at 15/500 `--os-ink`, one line, ellipsised), **Sign-in domain** (`Organization.domain` at 15/400, or the word "None"; **off by default** in column settings, because most support questions do not need it), **Plan** (`Chip` neutral, inline header filter "All ▾"), **Status** (`StatusChip` pale: Active success, Trial warning, Suspended danger, Cancelled neutral; inline header filter "All ▾"), **People** (right-aligned `tnum`), **Seats** ("12 of 25", or "Unlimited", or the word "None" when there is no subscription), **Modules** (up to two neutral chips, "Talk" and "Tables", at the density's chip size of 24 / 20 / 18, only those installed; nothing when none), **Signed up** (date, right-aligned), then the 28px "…" row menu. The slug is not a column: it is a lookup key, it lives on the company page's Facts card, and Search (⌘K) matches it, so nobody has to read it off a list.
  - Column settings pinned at the far right of the header (`SlidersHorizontal` 16px) toggling which of those **eight** data columns show; Company cannot be turned off. The choice persists per staff member as `companies.columns` in the console preference store (§1), not in `localStorage`.
  - Row menu, in order: **Open** (the drawer), **Copy company ID**, **Copy slug**, **Staff activity** → `/admin/audit?company=<id>`. Four rows, no destructive action: nothing in this console deletes a company.
  - Clicking anywhere else in the row opens the **company drawer** at `/admin/companies/[id]`; the list underneath dims to 92% opacity, keeps its scroll and stays scrollable.
  - **Footer row 44** inside the card, the design system's fixed footer height (§5.1: the footer is not one of the density-varying rows; only the header row follows density): "Total records {n}" 13/500 `--os-ink` at the left, "1 to 40" 13/400 `--os-ink-2` at the right with ‹ › 32px icon buttons and a page-size select on hover. Today's pagination sits outside the card and reads "Page 1 of 4 (58 companies)"; it moves inside and matches the reference.
- **Side panel, drawer or modal.** `FilterPanel` 272 (toolbar Filter opens and closes it; Esc closes it). Company drawer 520 (§2.3). About this page (400): "Every company that has a WorkwrK workspace. To find one by name, press ⌘K or open Filter and type into Name or domain." The search overlay (640, §2.8).
- **States.**
  - *loading*: the card renders its header and eight skeleton rows at the exact row height; the views row shows its labels without counts.
  - *empty, no companies at all*: four-dot row line art, "No companies yet", no action link.
  - *empty, filters applied*: an inline 36px row inside the card, "No companies match these filters · Clear filters" 15/400 `--os-ink-2` with the clear as a text link. No illustration inside a card.
  - *error*: an inline row inside the card, "Could not load companies. Retry". Today the fetch failure path (`companies/page.tsx:90-92`) logs to the console and renders "No companies found", which reads as an empty database.
  - *read-only*: none.
  - *denied*: the layout's `<LockedPage>`.
  - *offline or session expired*: §1's card.
- **Keyboard.** `⌘K` search, `⌘\` sidebar, `↑ ↓` move the focused row, `Enter` opens the drawer, `Esc` closes the drawer then the filter panel, `←  →` page through the footer pagination when the table has focus.
- **Data.** `GET /api/admin/companies?search=&view=&plan=&status=&subscription=&modules=&owners=&people_min=&people_max=&signed_from=&signed_to=&sort=&page=&limit=` (existing path, extended). `search=` is **kept**, unchanged in behaviour: it already matches name, slug and domain case-insensitively (`api/admin/companies/route.ts:13,21-27`) and it now backs both the Filter panel's "Name or domain" field and the Companies section of Search (⌘K). `status=` carries only `ACTIVE`, `TRIAL`, `SUSPENDED`, `CANCELLED`; `subscription=` carries `stripe`, `lifetime`, `none`, `past_due`; the two never overlap. The response gains `subscription: { source: "stripe" | "lifetime" | "none", status, seats, trialEndsAt } | null`, `modules: string[]` (from `ProductInstallation` joined to `MODULES`), `ownerCount: number`, `domain: string | null`. `&format=csv` returns the same rows as a download (new). The list-level `PATCH` is deleted. Reads the staff member's `UserPreference.density` through the shell, and `PlatformAdmin.consolePrefs.companies.columns` for the column choice.
- **Realtime.** None. Refetch on focus after 60 seconds and on "…" › Refresh.
- **What changes vs today.** The ad-hoc search input and the two plan and status selects above the table become the views row plus the `FilterPanel`; the search itself is not lost, it becomes the panel's "Name or domain" field and the Companies section of Search (⌘K), and both call the same `search=` parameter that exists today. Two doors to a company (Eye quick-edit and Manage) become one: the row. The table moves into a bordered card with hairline rows, a 44px records footer and inline header filters. The Activity column, which crammed four lifetime counts into one cell, is replaced by Seats and Modules, which are what a support question is actually about. The slug leaves the table for the company page's Facts card, so every cell is one line and the table holds at every density. The lime `#d4ff2e` company icon and the per-plan text colours go; Plan is a neutral chip, Status is a pale status chip. The subtitle that pairs "Manage all subscriber organizations" with a dash and a total is deleted; the count lives in the card footer and the explanation lives in "…" › About this page. The error path stops pretending to be an empty list.
- **Open questions.** None for this route.

### 2.3 `/admin/companies/[id]` (`(admin)/admin/companies/[id]/page.tsx`)

- **Purpose.** One company: what they are paying for, what they have turned on, who runs their workspace, and what WorkwrK changed for them.
- **Who sees it and entry points.** Platform staff only. A row on `/admin/companies` or on Overview's Newest companies (opens as a **drawer**); `⌘K` search; a link from `/admin/appsumo` (the company that redeemed a code); a link from `/admin/audit` (the company an action touched); a pasted or bookmarked URL (opens as a **full page**); `⤢ Expand` from the drawer (becomes the full page in place, same URL). Drawer and page are the same route and the same URL, so Copy link always works.
- **Top bar.** As §2.1; breadcrumb "Staff console › Companies › {company name}", the last crumb truncating at 160px and not clickable.
- **Secondary sidebar.** Companies active, including while the drawer is open.
- **Page header stack.**
  - **As a drawer (520, resizable 480 to 720):** the drawer's own 48px header per the design system: "Companies › {name}" 13px at the left, then ⤢ Expand, Copy link and ✕ as 32px ghost icons at the right. No page header stack inside a drawer. The width persists per staff member as `companies.drawerWidth` in the console preference store (§1).
  - **As a full page:** title row 48 with `BackButton{fallbackHref="/admin/companies"}` (28px ghost, `ArrowLeft`, label "Companies"), 8px, `EntityTile size="lg"` neutral with `Building2`, then the company name 22/600 ellipsised. Right: the Plan chip and the Status chip as read-only display, then a **28px ghost "…"** holding **Refresh**, **Copy company ID**, **Copy slug**, **Staff activity** and **About this page**. This page has no toolbar row, so the "…" is the title row's ghost and not a bordered square (§1 One placement for the "…" menu). No views row. No toolbar row. Content column 760 max, 24px page padding.
  - **There is no primary button on this page.** Every control autosaves per the design system's settings-card rule, with an inline "Saved ✓" 12/500 `--os-success-text` that fades after 2 seconds. A failed save shows the row's control returning to its previous value plus a toast with Retry; it is never silent.
- **Body layout**, in reading order. In the drawer the same cards stack at 20px padding and scroll; nothing is dropped.

  1. **Facts.** One card, no title, a definition list at 13/500 `--os-ink-2` labels over 15/400 `--os-ink` values, three per row: **Signed up** (full date), **Sign-in domain** (`Organization.domain`, or "Not set"), **Slug** (`Organization.slug`, JetBrains Mono 13, with a 28px ghost copy button; this is where the slug lives now that it is off the Companies table and the quick-edit dialog is gone, and it is the one thing a support conversation quotes when a URL is involved), **Company ID** (JetBrains Mono 13, with a 28px ghost copy button). Four facts, so the list wraps to a second row of one.
  2. **Plan and billing.** Card, title 16/600.
     - **Plan**: a `Picker` select of Starter, Growth, Scale, Enterprise. Autosaves. Changing it writes `admin.org.plan_changed`. A change that lowers the plan below what the company is using shows one line beneath before it saves: "They have 34 people and Growth allows 50." (from `PLAN_LIMITS`), and if the new plan's limit is already exceeded, a 400 confirm modal: "Growth allows 50 people. {name} has 212. They keep their people; new invitations will be blocked. Change the plan anyway?" with a destructive primary "Change plan".
     - **Status**: a `Picker` select of Active, Trial, Suspended, Cancelled. Autosaves for Active and Trial. Suspended and Cancelled open a **400 confirm modal with a typed confirmation**, and the copy says exactly what the build does, no more:

       > **Suspend {name}?**
       > Nobody there can sign in, and everyone signed in now is signed out within five minutes. Nothing is deleted, and you can set this back to Active at any time.
       > *Anyone who also belongs to another WorkwrK workspace keeps working in that one.*
       > Type the company name to confirm.

       Destructive primary "Suspend". Cancelled uses the same shape with "scheduled for deletion" in place of "suspended" and keeps the 30-day restore sentence the sign-in path already tells people (`lib/auth.ts:181-184`). Today the same change is one `window.confirm` (`companies/[id]/page.tsx:131-134`).

       **What makes that copy true.** Suspension blocks sign-in today (`lib/auth.ts:165-185`) but does nothing to a session that already exists: the JWT callback re-reads the **person** every five minutes (`deletedAt`, `status`, `accessLevel`, `tokenVersion`, `auth.ts:330-345`) and never looks at the organisation, so without a change here every live session at that company would keep working for the rest of its life. Two things close that, and both are part of this action, not a follow-up:

       1. **The write bumps every member's `tokenVersion`.** In the same transaction that sets `Organization.status`, `PATCH /api/admin/companies/[id]` increments `tokenVersion` on every `User` whose `organizationId` is this company and on every user reachable through `OrganizationMembership` for it. The existing revalidation already revokes a token whose `tokenVersion` no longer matches, so every live session dies at its next check, which is at most five minutes away. This is the same mechanism "Sign out everywhere" and Set workspace Owner use, so nothing new is invented.
       2. **The session check learns about the workspace.** The JWT callback's select gains the person's organisation `status`, and a person whose current organisation is SUSPENDED or CANCELLED is revoked, with the same fallback the sign-in path already performs: if they belong to a healthy workspace they are moved into it rather than locked out. Without this, a session created between the write and the next revalidation would survive.

       Both are listed in §4 as work this unit owns and as the one change it asks of the auth unit's file. Until step 2 of §4 lands, the confirm copy reads "Nobody there can sign in from now on. People already signed in keep their session until it expires." and the action is still allowed: the console never promises what the build does not do.
     - **Seats**: a 36px number input with the helper "{n} people are using {seats} seats." Empty means unlimited. Autosaves on blur. Writes `admin.org.seats_changed`. New: today seats can only be set by an AppSumo redemption or a Stripe checkout, so a mis-sold seat count has no fix in the product.
     - **Subscription**: read only, one line: "Stripe · active · renews {date}", or "Stripe · past due since {date}" in `--os-danger-text` with the word "past due", or "Lifetime deal · AppSumo Tier {n}" with a text link "See the code" → `/admin/appsumo?code=<code>`, or "No subscription. On the {plan} plan by default."
     - **Trial ends**: read only, rendered only when `trialEndsAt` is set: "{date} ({n} days)".
  3. **Modules.** Card, title 16/600, one line beneath: "This is the same switch an Owner sees in Settings › Apps & modules." (the page's canonical name and its route `/settings/apps`, settings-architecture §5.3). Then one 48px row per entry in `MODULES`: label 14/500 ("Talk", "Tables"), the module's own `competesWith` and `blurb` at 13/400 `--os-ink-2`, and a 36×20 `Switch` at the right. Autosaves, writes `admin.org.module_changed`, and creates or pauses the `ProductInstallation` row. Turning one off shows the product's own warning first, in a 400 confirm: "Turning Talk off locks {n} channels for everyone at {name} until it is turned on again. Nothing is deleted."
  4. **Enterprise add-ons.** Card, **rendered only when the plan is Enterprise**. On every other plan the card renders with its title and one line 15/400 `--os-ink-2`: "Add-ons come with the Enterprise plan. Change the plan above to turn them on." and no switches. On Enterprise, two 48px rows with switches, each autosaving and writing `admin.org.feature_changed`:
     - **Bring your own AI key**: "They add their own Anthropic key in Settings. Without it, AI runs on the WorkwrK key." (enforced at `lib/ai-client.ts:34` and `api/organization/byok/route.ts`).
     - **White label**: "Their logo and colour replace the WorkwrK mark in the app and in emails." (enforced at `api/organization/branding/route.ts:31,50`).
     - **Custom domain is gone.** Nothing reads the flag, so the switch did nothing. It returns when the routing exists (§4).
  5. **People and support access.** Card, title 16/600.
     - Two counts on one line: "{n} people · {n} with Owner access".
     - The Owner list: up to five 36px rows, 24px avatar, name 15/400, email 13/400 `--os-ink-2` as a `mailto:` link. When there are none, one line in `--os-danger-text`: "Nobody here has Owner access."
     - A secondary button "Set workspace Owner" (36px, bordered). Opens a **560 modal**. **It adds an Owner. It never removes one, and it never demotes anyone.** That is the whole semantic, and it is what makes the action safe to ship: `access-model-spec.md` §2.1 allows one or more Owners with at least one always, guarded by the last-Owner rule, so an action that only ever adds can never trip that guard and can never be the thing that leaves a company with nobody.
       - **Modal contents.** A `Picker` of that workspace's people showing name, email and current role; a required "Why" text field (one line, stored on the audit row and shown in See details); a typed confirmation of the company name. Primary "Set as Owner", secondary Cancel.
       - **Who the picker lists.** Members and Admins of that workspace, and nobody else. Guests are absent, because a Guest never holds an org role (`access-model-spec.md` §2.1). People with a status of INACTIVE are absent, because promoting a deactivated account hands ownership to somebody who cannot sign in. An existing Owner is absent, because there is nothing to do to them.
       - **When the company still has a live Owner.** The action stays available and the modal opens with one line above the picker, 13/400 `--os-ink-2`: "{name} already has {n} people with Owner access: {names}. This adds one more and removes nobody." The reason field is still required. A company can have several Owners and the case this exists for (a bought-out company whose senior people have all left, a founder who lost their laptop) does not always mean zero Owners.
       - **When the company has no Owner.** The same modal, with the line in `--os-danger-text`: "Nobody here has Owner access."
       - **What happens to the promoted person's previous role.** Their org role becomes Owner, replacing Member or Admin. Nothing else about them changes: every object role they hold (`AccessGrant` rows, Space and List membership, Team membership) is left exactly as it was, because an Owner already has full access everywhere and rewriting their grants would be a change nobody asked for and nobody could see. Their Admin scopes are cleared, because an Owner holds Billing and Security implicitly (`access-model-spec.md` §2.1).
       - **After the write.** `admin.org.owner_set` on the staff side; `staff.owner.set` plus the workspace's own `org_role.changed` on the customer side, in the Access tab of `/settings/audit` (§1 Audit); the promoted person's `tokenVersion` is bumped so the new role lands on their next request rather than at the next revalidation; the Owner list on this card refreshes; a toast "Maya now has Owner access at {name}".
       - This is the action `access-model-spec.md` §2.6 asks for and the gap `access-model.md` §2.19 names.
     - The support-access policy, as a bordered inset at the bottom of the card, 13/400 `--os-ink-2`: "WorkwrK staff cannot sign in to this workspace. There is no impersonation and no view-as. To help this customer, ask an Owner to invite you: the invitation appears in their Members list and they can remove you at any time."
  6. **What they use.** Card, title 16/600, one line beneath: "Counts only. No customer content is ever shown in this console." Then a two-column definition list: People, Spaces, Lists, Tasks, Docs, SOPs, KRAs, KPIs, Tables, Talk channels. Numbers at 15/400 `tnum`, dashes where a module is off.
  7. **Staff activity.** Card, title 16/600. The last five `StaffAction` rows for this company as 36px rows: time 12/500 `--os-ink-2`, then the plain sentence 15/400 ("Priya changed the plan from Growth to Scale"). Footer text link "See all" → `/admin/audit?company=<id>`. Empty: one line "No staff changes yet."
  8. **The last line on the page**, 13/400 `--os-ink-2`, not a card and not a danger zone: "There is no delete here. A workspace is deleted by its own Owner in Settings › Identity & culture › Danger zone." (the page's canonical name and its route `/settings/identity?tab=danger`, settings-architecture §5.2, where Delete workspace is Owner-only with a typed workspace name and a 14-day restore).
- **Side panel, drawer or modal used here.** The page itself in drawer form (520). Set workspace Owner (560). Plan-limit confirm, suspend confirm and module-off confirm (400 each, destructive primary, typed confirmation on suspend and cancel). About this page (400), from the "…": "What this company pays for, what they have turned on, and who runs their workspace. Counts only; no customer content is ever shown here, and WorkwrK staff cannot sign in to a customer's workspace."
- **States.**
  - *loading*: skeletons at the exact height of each card; the title row shows the name as soon as the list already had it (a drawer opened from the list knows the name before the fetch returns).
  - *empty*: not applicable; a company always has facts. Individual cards say "None" rather than rendering an empty list.
  - *error*: the whole page shows the inline failure card "Could not load this company. Retry"; a single card that fails shows its own Retry row. A save that fails reverts the control and raises a toast with Retry.
  - *read-only*: none.
  - *denied*: the layout's `<LockedPage>`. A company ID that does not exist renders the standard 404 inside the console shell, with `BackButton{fallbackHref="/admin/companies"}`.
  - *offline or session expired*: §1's card. An autosave attempted offline queues once, retries, and on final failure shows "Not saved" with a Retry text link beside the control. It never shows "Saved".
- **Keyboard.** `Esc` closes the drawer or the topmost modal, `⌘K` search, `Tab` order follows the reading order of the cards, `Enter` on a focused switch toggles it.
- **Data.** `GET /api/admin/companies/[id]` (existing, extended with `slug`, `subscription`, `modules`, `owners`, `counts`, `staffActions[5]`). `PATCH /api/admin/companies/[id]` (existing) accepts `plan`, `status`, `seats` (new), `module` + `enabled` (new), `feature` + `enabled` (kept, minus `customDomain`), each branch writing a `StaffAction` row and, where the customer's workspace changed, a tenant `ActivityLog` row through the existing `logAuditEvent` with the `staff.*` key, `actorType: "platform_staff"` and `actorLabel: "WorkwrK Support"` from §1 Audit, never a foreign `actorId` (today `companies/[id]/route.ts:61,72,99`). The `status` branch additionally bumps `tokenVersion` on every member of the company inside the same transaction when the new status is SUSPENDED or CANCELLED. New: `GET /api/admin/companies/[id]/people?role=member,admin` for the Set workspace Owner picker, and `POST /api/admin/companies/[id]/owner` with `{ userId, reason }`, which adds the Owner role, clears that person's Admin scopes, bumps their `tokenVersion`, and never removes an existing Owner. Reads the org's `settings.features`, its `ProductInstallation` rows and `PLAN_LIMITS`; reads the staff member's `UserPreference.density` through the shell and `PlatformAdmin.consolePrefs.companies.drawerWidth`.
- **Realtime.** None. Refetches after every successful save so the counts and the staff-activity card stay true.
- **What changes vs today.** The lime `#d4ff2e` icons and the hand-rolled switch become tokens and the design system's `Switch`. `router.push("/admin/companies")` becomes `BackButton{fallbackHref}`. The five big-number stat cards across the top become the "What they use" definition list, because a count of KRAs is reference data, not a headline. The Enterprise toggles stop rendering as switchable-but-inert on non-Enterprise plans. Custom domain is removed. The slug, which today sits under the company name in the header (`companies/[id]/page.tsx:85`) and in the quick-edit dialog, gains a labelled home in the Facts card with a copy button. Seats, Modules, Owners, the support-access policy, Set workspace Owner and Staff activity are new. Suspension gains a typed confirmation, an honest sentence about what it does, and the `tokenVersion` bump that makes the sentence true. Every write gains an audit row, including the feature toggles, which write none today (`companies/[id]/route.ts:83-87`), and the customer-side rows gain a real actor instead of a user id from another organisation. The three add-on labels that pair a name with a dash and a restatement become plain names, and the "Org isn't on Enterprise yet" line goes with the card.
- **Open questions.** Whether staff may set seats directly or only through the plan (Open questions, 3). Whether the Set workspace Owner picker may list Members or only existing Admins (Open questions, 4; everything else about that action is decided above and is not an open question: it adds, never removes, and never demotes).

### 2.4 `/admin/staff` (`(admin)/admin/staff/page.tsx`)

- **Purpose.** The list of WorkwrK people who can open this console, and the two actions that change it.
- **Who sees it and entry points.** Platform staff only. Sidebar row Staff; `⌘K` search by email; `/admin/audit` rows about staff link here.
- **Top bar.** As §2.1; breadcrumb "Staff console › Staff". The first crumb is the console's one label from §1 Naming canon, so no label names two destinations.
- **Secondary sidebar.** Staff active, the CONSOLE section expanded (it is not collapsible).
- **Page header stack.** Title row 48: "Staff" 22/600; right: meta "Updated {relative}". Views row: does not render. Toolbar row 44: left empty (five rows need no filter and no sort); right: **the one primary button, "Add staff"** (36px, `--os-brand`, white 14/500, 16px `Plus`, radius 6), then the bordered 36px "…" with **Refresh** and **About this page**. No description line under the title: the design system deletes it and the explanation has a home below.
- **Body layout.**
  - **`TableCard`** at `--os-row-h` (the staff member's own density), no checkbox column. Columns: **Name** (15/500; when the person has no name the cell renders their email at 15/400 so nothing is blank), **Email** (15/400 `--os-ink-2`, a `mailto:` link), **Added by** (staff name), **Added** (date), **Last opened the console** (relative, or "Never"), then the 28px "…" row menu with one row, **Remove** (destructive ghost, `--os-danger-text`). Name and email are two columns, not two lines in one cell: design system §3.2 does not allow two lines in a data row at any density.
  - **Footer row 44** (the design system's fixed footer height): "Total records {n}" at the left, and at the right one line 13/400 `--os-ink-2`: "Anyone on this list can open the staff console and change any customer's plan." That sentence is where the old page subtitle goes: it belongs to this card, it is read at the moment somebody is looking at the list, and the fuller version is in "…" › About this page and in the Add staff modal's helper.
  - **Remove** opens a 400 confirm: "Remove {email}? They lose the staff console immediately. Their WorkwrK login is not touched." Destructive primary "Remove". Removing yourself changes the body to "You are removing yourself. You will lose this console as soon as you confirm." When the person is the only staff member the row menu has **no Remove row at all** (the control is not rendered, not disabled) and the footer's right-hand line is replaced for as long as that is true by: "You cannot remove the last staff member." This is the existing last-staff guard (`platform-staff/route.ts:74-77`) made visible instead of a disabled button with a `title` attribute.
  - **Add staff** opens a **560 modal**: header "Add staff", body with **Email** (36px input, required, the one autofocused field) and **Name** (optional), helper 13/400 `--os-ink-2` "They also need a WorkwrK login with this email. Matching is case-insensitive."; footer Cancel (ghost) and the primary "Add staff". On success: the modal closes, the row appears, a toast "Added {email}", and **every existing staff member gets one email** saying who was added and by whom. Adding staff is the one privilege escalation in this console, so it is never quiet.
  - Duplicate email: the field shows the inline error "That email is already on the staff list" in `--os-danger-text` with a 16px `CircleAlert`. Invalid email: "Enter a valid email address". Neither is a toast.
- **Side panel, drawer or modal.** Add staff (560). Remove confirm (400). About this page (400), from the "…": "The WorkwrK people who can open this console. Anyone on this list can open it and change any customer's plan, seats and modules. They also need a WorkwrK login with the same email. Every add and every remove is recorded on Staff activity and emailed to everyone already on the list." No drawer: a staff row has five fields and no detail worth a page.
- **States.**
  - *loading*: the card header and four skeleton rows.
  - *empty*: cannot happen while the last-staff guard holds; if the table is somehow empty the card shows one row, "No staff yet", and the Add staff button stays the way in.
  - *error*: an inline row in the card, "Could not load staff. Retry". Today a failure raises a toast and leaves an empty list (`staff/page.tsx:32-34`).
  - *read-only*: none.
  - *denied*: the layout's `<LockedPage>`.
  - *offline or session expired*: §1's card.
- **Keyboard.** `⌘K`, `↑ ↓` rows, `Enter` opens the row menu, `Esc` closes the modal, `Enter` inside the Add staff modal submits when the email is valid.
- **Data.** `GET /api/admin/platform-staff` (existing; the response gains `addedByEmail` and `lastOpenedAt`, the latter from the newest `StaffAction` row for that email). `POST` and `DELETE` (existing; both now write a `StaffAction` row and send the notification email). Reads no setting.
- **Realtime.** None.
- **What changes vs today.** The two loose cards ("Add staff member" as a permanently open form, "Current staff" as a `<ul>`) become one table and one modal. The red `ShieldCheck` heading icon and the `text-red-400` remove button become tokens; destructive stays `--os-danger-text` but nothing else on the page is red. Added by, Added and Last opened the console are new and are what makes the list auditable. The name and the email become two columns rather than two lines in one cell, so the table holds at every density. The notification email is new. The disabled Remove button with a tooltip becomes an absent row. The blurb that pairs "Gated by email" with a dash and a restatement is rewritten and moves to the card footer and "…" › About this page; there is no description line under the title.
- **Open questions.** Whether there should be a second staff rung that cannot add or remove staff (Open questions, 2).

### 2.5 `/admin/analytics` (`(admin)/admin/analytics/page.tsx`)

- **Purpose.** Whether the business is growing, in numbers that are true.
- **Who sees it and entry points.** Platform staff only. Sidebar row Analytics. No deep links beyond `?range=`.
- **Top bar.** As §2.1; breadcrumb "Staff console › Analytics".
- **Secondary sidebar.** Analytics active.
- **Page header stack.** Title row 48: "Analytics" 22/600; right: meta "Updated {relative}". Views row: does not render. Toolbar row 44: left = a **`SegmentedControl`** labelled Range with three options, **30 days**, **3 months**, **12 months** (32px, `--os-surface-1` track, active segment `--os-surface` with a 1px `--os-line` border); it writes `?range=` so the URL is the state. Right: no primary button; the bordered 36px "…" with **Refresh**, **Export CSV** (the current range) and **About this page**.
- **Body layout**, in reading order. Cards are radius 8 (`--os-r-md`, the design system's card radius). Charts follow the dataviz rules: one series in `--os-brand`, axis labels 12/400 `--os-ink-2`, grid lines `--os-line-soft`, no fills, no second hue, tooltips on `--os-surface` with a `--os-line` border. Recharts is already installed; no new library.

  1. **Revenue.** Card. A line chart of monthly revenue over the range, height 224. Beneath it three lines at 13/400 `--os-ink-2`: "Monthly revenue {amount}", "Annual run rate {amount} (monthly × 12)", "Average per paying company {amount}". Then the honesty line, 13/400 `--os-ink-2`: "From Stripe subscriptions only. Lifetime deals and companies on manual invoices are not counted." When billing is not connected, the chart is replaced by the quiet empty block (four-dot 2×2 line art, one sentence "Billing is not connected yet", one text link "How to connect it" when `STAFF_RUNBOOK_URL` is set) and no number is shown anywhere on the card. No environment-variable name appears on screen.
  2. **Growth.** Card. Two numbers on one line, "New companies {n}" and "New people {n}", then a bar per month across the range, then two lines at 13/400 `--os-ink-2`: "{n} companies are on trial." and "**Average people per company {n}**, {n} people across {n} companies." The second line is where today's "Avg. Users Per Org" tile lands (§0): the number and its context both survive, as a derived line rather than a hero tile.
  3. **Signup funnel.** Card, titled "Signup funnel · last {n} days". Four steps as 36px rows, each with its label, the definition at 13/400 `--os-ink-2`, the count right-aligned at 15/500, the conversion from the step above at 13/400, and a 4px linear progress bar in `--os-brand`:
     - **Signed up**: "A company was created"
     - **Finished setup**: "They completed the setup wizard"
     - **Created something**: "At least one SOP, KRA or task"
     - **Paying**: "An active subscription"
     The definitions are on screen because a funnel whose steps are undefined is a decoration.
  4. **Retention.** Card. The cohort table: Cohort (month), Size, Still active, Paying, Cancelled, Retention (a 4px bar plus the percentage). Beneath it two definition lines at 13/400 `--os-ink-2`: "Still active means somebody in that workspace did something in the last 30 days." and "Paying means an active subscription today." Today the "Active" column reads `Organization.status === "ACTIVE"`, which is a billing flag a staff member sets, so a cohort could show 100% retention with nobody using the product.
  5. **Cancellations.** Card. The last ten, as 36px rows: company name (a link to its page), plan chip, date right-aligned. Empty: "No cancellations in this range."
  6. **Biggest workspaces** and **Busiest workspaces**, two cards side by side at 1280 and above, stacked below. Biggest is the top five by people. Busiest is the top five by recorded actions in the range, from `ActivityLog`, with the line "Actions recorded in the last {range}". Each row: rank 13/500 `--os-ink-2`, company name (a link), the number right-aligned, and a 4px bar relative to the top row.
  7. **Plans.** Card, moved here from Overview: one 36px row per plan with the plan chip, the count of companies, and a 4px bar. **No revenue per plan.** Today's "Revenue by Plan" card (`analytics/page.tsx:250-276`) is deleted with no target and is listed as such in §0, because it multiplies a hard-coded price by a count of companies per plan; revenue now comes from Stripe per subscription and Stripe does not know our plan names, so the number cannot be rebuilt honestly. The count per plan, which was the true half of that card, is this card.
- **Side panel, drawer or modal.** About this page (400), from the "…": "Whether the business is growing. Revenue is what Stripe charged; everything else is counted from companies, people and recorded activity in the range you pick."
- **States.**
  - *loading*: a skeleton block at each card's height; charts render their frame with a skeleton plot area, never a spinner in the middle of the page.
  - *empty*: a brand-new install with no companies. Each card shows the quiet block for its own family (four-dot 2×2 for charts, row for lists) and one sentence, "Nothing to measure yet".
  - *error*: per card, the inline "Could not load this. Retry" row. A failed revenue call does not blank the whole page.
  - *read-only*: none.
  - *denied*: the layout's `<LockedPage>`.
  - *offline or session expired*: §1's card.
- **Keyboard.** `⌘K`, `← →` move the Range segmented control when it has focus, `Esc` does nothing here.
- **Data.** New: `GET /api/admin/analytics?range=30d|3m|12m` → `{ revenue: { source, currency, monthly, series[], arr, arpu, stripeSubscriptions }, growth: { newCompanies, newPeople, onTrial, byMonth[], avgPeoplePerCompany, totalPeople, totalCompanies }, funnel: { signedUp, finishedSetup, createdSomething, paying, windowDays }, retention: { cohorts[] }, cancellations[], biggest[], busiest[], plans[] }`. Replaces the analytics half of `GET /api/admin/stats`. Revenue amounts come from Stripe's own price objects for the four price IDs in `services/billing.ts` (`priceCatalog`), cached for an hour; there is no price list in the codebase any more, so the two hard-coded `PLAN_PRICES` maps (`stats/route.ts:10-15` and `analytics/page.tsx:59-64`) are deleted. Reads no setting; reads the env `STRIPE_SECRET_KEY` only through `isBillingLive`.
- **Realtime.** None. Refetch on focus after 60 seconds and on Refresh.
- **What changes vs today.** Revenue stops being `plan price × number of companies`, which counted trials, suspended companies and lifetime AppSumo customers as monthly recurring revenue in rupees that appear nowhere else in the product. The currency stops being hard-coded `en-IN`. Active rate, the ARPU hero tile and the projected-ARR tile are folded into the Revenue card as derived lines, and the "Avg. Users Per Org" tile into the Growth card as one. "Revenue by Plan" is deleted, named in §0 rather than only in prose, and the Plans card keeps the count per plan. "Most Active Organizations" becomes "Busiest workspaces" over a real window. The cohort "Active" column gets a real definition. The funnel gains its definitions on screen. The lime series colour, the dark `#0f0f0f` tooltip and the four hard-coded plan colours become tokens. The Range control is new: today every number is a fixed window with no way to ask a different question.
- **Open questions.** Which currency the console reports in, and what to do when customers are billed in more than one (Open questions, 1).

### 2.6 `/admin/appsumo` (`(admin)/admin/appsumo/page.tsx`)

- **Purpose.** Import the lifetime-deal codes AppSumo gives us, watch them get redeemed, and mark the refunds.
- **Who sees it and entry points.** Platform staff only. Sidebar row AppSumo codes; Overview's "codes redeemed this week" row; the company page's "See the code" link, which arrives as `?code=<code>` and opens the list filtered to that one code; `⌘K` search by exact code.
- **Top bar.** As §2.1; breadcrumb "Staff console › AppSumo codes".
- **Secondary sidebar.** AppSumo codes active.
- **Page header stack.**
  - **Title row 48**: "AppSumo codes" 22/600; right: meta "Updated {relative}".
  - **Views row 36**, text-tab pills with server counts: **All**, **Unused**, **Redeemed**, **Refunded**. Writes `?view=`.
  - **Toolbar row 44**: left = **Filter** (**Code**, Tier, Plan, Imported date, Redeemed date, Redeemed by) and **Sort** (Newest, Oldest, Code A to Z). Right: **the one primary button, "Import codes"**, then the bordered 36px "…" with **Refresh**, **Export CSV** and **About this page**. No description line under the title.
- **Body layout.**
  - **`FilterPanel` 272**, heading "Filter codes by". Its first row is **Code**: a text input, exact or prefix match, case-insensitive, writing `?code=`. It is a filter field like any other, so it counts toward the Filter chip ("Filter · 1"), it is cleared by "Clear all" and by the card's "Clear filters" link, and the panel opens showing it filled when the page is reached from the company page's "See the code" link. Without it, arriving at `?code=<code>` would show one row and no visible reason.
  - **`TableCard`** at `--os-row-h` (the staff member's own density), no checkbox column. Columns: **Code** (JetBrains Mono 15/400 with a `KeyRound` 16px glyph), **What it gives** ("Tier 2 · Scale · 25 seats"; "Unlimited" instead of a seat number when the tier is unlimited, never the ∞ glyph), **Status** (`StatusChip` pale: Unused neutral, Redeemed success, Refunded warning), **Redeemed by** (the company name as a link to `/admin/companies/[id]`, or the word "None"), **Redeemed** (date, or the word "None"), then the 28px "…" row menu.
  - Row menu: **Copy code**; **Mark refunded** (destructive ghost, rendered only on a redeemed row that is not already refunded). No Open: a code has no detail page.
  - **Mark refunded** opens a 400 confirm: "Mark {code} refunded? This is bookkeeping. {company} keeps their plan until you change it on their company page." Destructive primary "Mark refunded". After it saves, a toast with a text link "Open {company}" so the staff member can finish the job in one move. Writes `admin.code.refunded`.
  - **Footer row 44** (the design system's fixed footer height): "Total records {n}" at the left, "1 to 100" with ‹ › at the right.
  - **Import codes** opens a **720 modal**: header "Import codes"; body with **Default tier** (a `Picker` select: "Tier 1 · Growth · 5 seats", "Tier 2 · Scale · 25 seats", "Tier 3 · Enterprise · unlimited") and **Codes** (a mono textarea, 10 rows, growing to 12, placeholder showing one code per line), helper 13/400 `--os-ink-2`: "One code per line. To override a line: code, tier, plan, seats. Codes already imported are skipped, so it is safe to paste the whole file again. Customers redeem a code in Settings › Plan & billing; a code works once, for one company."; footer Cancel and the primary "Import". While it runs the primary keeps its label and its icon becomes the 16px four-dot pending loader. On success the modal closes and a toast reads "Imported {n} of {m} codes. {k} were already here." The list refreshes. On a validation failure the modal stays open with the offending line named in an inline error: "Line 14: plan PRO is not a plan."
- **Side panel, drawer or modal.** Import codes (720). Mark refunded confirm (400). `FilterPanel` (272). About this page (400), from the "…": "The lifetime-deal codes AppSumo gives us. Customers redeem one in Settings › Plan & billing (`/settings/billing`). A code works once, for one company. Marking a code refunded is bookkeeping: it does not change what that company can use."
- **States.**
  - *loading*: card header and eight skeleton rows; the views row shows labels without counts.
  - *empty, no codes at all*: four-dot row line art, "No codes yet", and one text link "Import codes" which opens the same modal. The toolbar's blue button remains the one primary.
  - *empty, a view or filter*: an inline card row, "No codes match · Clear filters".
  - *error*: an inline card row, "Could not load codes. Retry".
  - *read-only*: none.
  - *denied*: the layout's `<LockedPage>`.
  - *offline or session expired*: §1's card.
- **Keyboard.** `⌘K`, `↑ ↓` rows, `Enter` opens the row menu, `Esc` closes the modal or panel, `⌘Enter` submits the import modal.
- **Data.** `GET /api/admin/appsumo?view=&code=&tier=&plan=&imported_from=&imported_to=&redeemed_from=&redeemed_to=&redeemed_by=&page=&limit=` (existing, extended): `code=` is the Filter panel's Code field and the target of the company page's "See the code" link; the response joins the redeeming company so the table can show a name and a link instead of a raw org id, and returns the four view counts from the server instead of the page computing them from the rows it happens to hold. `&format=csv` is new. `POST` (bulk import) and `PATCH` (refund) keep their shapes and both now write a `StaffAction` row. The customer-facing `POST /api/appsumo/redeem` is not part of this console; it is named here only because this page is the other half of that story, and its gate moves from `isOrgAdmin` to the access model's `can(viewer, "manage", { type: "settings", page: "billing" })`, which is the Billing page's rule (Owner, or an Admin with the `billing` scope). That change belongs to the settings and billing unit; this unit only records the dependency.
- **Realtime.** None.
- **What changes vs today.** The page opens on the codes, not on the import form. The four filter buttons become the views row; the four stat cards become the counts on those pills, which also fixes a wrong number: today "On the page (unused)" counts only the rows currently loaded and is labelled as if it were the total (`appsumo/page.tsx:126-131`). Redeemed rows gain a company name and a link. The lime `#d4ff2e` sparkle, the `text-green-400` and `text-amber-400` stat numbers and the mono uppercase header row become tokens and the standard `TableCard` header. The ∞ glyph becomes the word "Unlimited". The tier labels that pair a tier number with a dash and a plan name become the dot-separated form, and the import blurb is rewritten and moves into the Import codes modal and "…" › About this page rather than sitting as a description line under the title. Arriving from a company page at `?code=<code>` now opens the Filter panel with the Code field filled, so the one-row state is visible, counted on the Filter chip and clearable. The refund confirm stops saying "you'll need to handle that separately" and instead offers the link that does it.
- **Open questions.** Whether a refund should downgrade the company automatically, and whether the three tier presets stay hard-coded (Open questions, 5 and 6).

### 2.7 `/admin/audit` (`(admin)/admin/audit/page.tsx`, **new**)

- **Purpose.** Everything WorkwrK staff changed, who changed it, and for which customer.
- **Who sees it and entry points.** Platform staff only. Sidebar row Staff activity; the company page's "See all" link and its "…" › Staff activity row (both arrive as `?company=<id>`); the staff page's row menu is not a link here, but a staff row's actions are findable by `?who=<email>`.
- **Top bar.** As §2.1; breadcrumb "Staff console › Staff activity".
- **Secondary sidebar.** Staff activity active, the CONSOLE section expanded (it is not collapsible).
- **Page header stack.** Title row 48: "Staff activity" 22/600; right: meta "Updated {relative}". Views row 36: **All**, **Companies**, **Staff**, **Codes** (grouping the action keys; writes `?view=`). Toolbar row 44: left = **Filter** (Who, Company, Action, When) and **Sort** (Newest first is the default and the only other option is Oldest first). Right: no primary button; the bordered 36px "…" with **Refresh**, **Export CSV** and **About this page**. No description line under the title.
- **Body layout.**
  - **`TableCard`** at `--os-row-h` (the staff member's own density), no checkbox column. Six data columns: **When** (date and time, `tnum`, right-aligned in its own 160 column), **Who** (the staff member's name at 15/400; their email at 15/400 when they have no name), **Email** (15/400 `--os-ink-2`; **off by default** in column settings, because Who is usually enough), **What** (the plain sentence, 15/400, ellipsised at the column width: "Changed the plan from Growth to Scale", "Suspended the workspace", "Added dev@bigboldtech.com to staff", "Imported 500 codes"), **Company** (name as a link, or the word "None" for staff and code actions), **Source** (the word "Console" for every row today; it exists because a future scripted write should be distinguishable from a person, and it is off by default until there is a second value). Then the 28px "…" row menu with **See details** and **Copy details**. Who and Email are two columns, not two lines in one cell (§1 One line per row). The column choice persists as `audit.columns` in the console preference store (§1).
  - **See details** opens a **560 modal**: the sentence at 16/600, then a two-column list, Before and After, rendering the stored values as plain words (plan names, status words, true and false as "On" and "Off"), then the footer facts at 13/400 `--os-ink-2`: who, when, IP, the reason text when the action carried one (Set workspace Owner does), and, for a denial row, the `hits` count from the ten-minute sampling window (§1 Denial).
  - **Footer row 44** (the design system's fixed footer height): "Total records {n}" at the left, "1 to 40" with ‹ › at the right. Paging is cursor-based; the footer shows the range, not a page count.
  - Rows are never editable and never deletable. One line at the bottom of the page, 13/400 `--os-ink-2`: "Staff activity is kept for ever."
- **Side panel, drawer or modal.** See details (560). `FilterPanel` (272). About this page (400), from the "…": "Every change WorkwrK staff made, who made it and for which customer. A change to a customer's workspace also appears in that customer's own audit log at Settings › Audit log, shown there as WorkwrK Support with no individual's name. Nothing here can be edited or deleted."
- **States.**
  - *loading*: card header and eight skeleton rows.
  - *empty*: four-dot row line art and one sentence, "No staff changes yet". No action link: this list fills itself.
  - *empty with filters*: the inline "No activity matches · Clear filters" row.
  - *error*: the inline "Could not load activity. Retry" row.
  - *read-only*: the whole page is read only by nature, and that is not a role state: there is no control here that any staff member is missing.
  - *denied*: the layout's `<LockedPage>`.
  - *offline or session expired*: §1's card.
- **Keyboard.** `⌘K`, `↑ ↓` rows, `Enter` opens See details, `Esc` closes the modal.
- **Data.** New: `GET /api/admin/staff-actions?view=&who=&company=&action=&from=&to=&cursor=&limit=` and `&format=csv`. Backed by the new `StaffAction` model (§3). Reads no setting.
- **Realtime.** None.
- **What changes vs today.** The whole page is new. Today four of the seven staff write paths produce no record at all (feature toggles, code import, code refund, staff add and remove), and the three that do write into the target company's `ActivityLog`, where no staff member can read them without opening that customer's workspace, which staff cannot do.
- **Open questions.** None for this route.

### 2.8 Search (no URL; overlay; `(admin)/staff-search.tsx`, **new**)

- **Purpose.** Find a company, a staff member or a code by typing its name, and go straight to it.
- **Who sees it and entry points.** Platform staff only, on every route in this unit. The top bar's 400px search field (a button styled as a field; typing never happens in the bar), and `⌘K` from anywhere in the console including inside a drawer or a modal, which closes first. There is no other entry: no empty-state link, no row action.
- **Top bar.** Not applicable: the overlay covers the page and the bar keeps whatever it was showing underneath.
- **Secondary sidebar.** Unchanged underneath; the overlay does not move the active row, because opening search is not navigation.
- **Page header stack.** Not applicable. The overlay's own anatomy: Radix Dialog, **640px** wide, top 12vh, `--os-surface`, radius 12 (`--os-r-lg`, the modal radius), `--os-shadow-modal`, `--os-scrim`. 640 is the search-only width the shell unit already asks the design system for as `--os-modal-search` (spec-shell §2.9) and this surface reuses it rather than inventing a second one; if the design system refuses that token, this overlay takes 720 exactly as the product palette does, and nothing else changes. Header: one 44px input, 16px magnifier, placeholder "Search companies, staff or a code…", 14/400, ✕ clears, kbd "esc" at the right. No chip row: there are three kinds of thing here and the sections already separate them. Footer 36px: "↑↓ move · ↵ open · esc close" 12/500 `--os-ink-3`, real hints only.
- **Body layout.** Sections with 11/600 uppercase labels, rows 36 in `MenuList`, 16px glyph, label 14/400, secondary 13/400 `--os-ink-2` at the right of the row (never a second line).

  **Empty query.** Two sections. **RECENT**: the last five companies this staff member opened, from `PlatformAdmin.consolePrefs.recent` (server-stored like every other console preference, so it follows them between machines; capped at five, oldest dropped). **GO TO**: the six sidebar destinations in sidebar order, each with its icon, so the palette is also the keyboard route to every page.

  **Typing (2 characters or more, 180ms debounce).** Three sections, each capped at eight rows with a "See all {n} in Companies" text row at the bottom of the section when there are more:

  | Section | Rows match on | Row shows | Enter opens |
  |---|---|---|---|
  | **COMPANIES** | name, slug, sign-in domain (the existing `search=` behaviour at `api/admin/companies/route.ts:21-27`, unchanged) | `EntityTile size="xs"` neutral, the company name 14/400, and at the right the plan and status as one 13/400 `--os-ink-2` line: "Scale · Active" | the company drawer over Companies, or the company page when the console is not already on Companies |
  | **STAFF** | name, email | 20px avatar, the name 14/400, the email 13/400 `--os-ink-2` at the right | `/admin/staff` with that row focused |
  | **CODES** | the code, exact or prefix, case-insensitive | `KeyRound` 16px, the code in JetBrains Mono 14, and at the right "Redeemed by {company}" or "Unused" | `/admin/appsumo?code=<code>`, which opens the list filtered with the Filter panel's Code field filled (§2.6) |

  A staff member on page 4 of the Companies list types "acme" and is on Acme's page in two keystrokes and a return. That is the replacement for the search box this spec removed from above the table, and the Filter panel's "Name or domain" field (§2.2) is the other half, for narrowing a list rather than jumping to one row.

  **There is no customer content in these results, ever.** The three things searched are a company's name, a staff member's name and a code. No task, document, message, channel or file is searchable from this console, and the endpoint has no parameter that could ask for one.
- **Side panel, drawer or modal used here.** None. The overlay closes itself before it opens anything, so nothing stacks on it.
- **States.**
  - *loading*: three skeleton rows under the section that is fetching; the empty-query sections stay put because they need no network.
  - *empty*: one line "No matches for '{q}'" 15/400 `--os-ink-2`, and the GO TO section stays below it, so the dead end always offers a next step. No illustration inside an overlay.
  - *error*: one line "Search isn't available right now · Try again" with Try again wired to the same call.
  - *read-only*: none (there is no read-only staff role).
  - *denied*: not applicable as a view. A person who is not Platform staff never reaches a page that can open this overlay, and the endpoint carries the same `requirePlatformAdminApi` gate as every other route under `/api/admin/`.
  - *offline or session expired*: on 401 the overlay closes and §1's "Your session ended" card takes the page. Offline, the empty-query sections still render from the console preference payload and the results area shows one line "You're offline. Search needs a connection."
- **Keyboard.** `⌘K` opens from anywhere (it is the one shortcut that works while a field has focus); `↑ ↓` move; `↵` opens the focused row; `Esc` closes and returns focus to the top bar field; typing replaces the query with no mode switch.
- **Data.** New: `GET /api/admin/search?q=&types=companies,staff,codes&limit=8`, returning `{ companies: [{ id, name, slug, plan, status }], staff: [{ email, name }], codes: [{ code, status, companyId, companyName }], counts: { companies, staff, codes } }`. It calls the same query the three list endpoints call, so a result can never show something a list would not. Recents come from `GET /api/admin/me` and are written by `PATCH /api/admin/me/console` (§1 Console preferences).
- **Realtime.** None.
- **What changes vs today.** The console has no search of any kind today: the only way to find a company is the list's own text box (`companies/page.tsx:139-147`), which cannot find a staff member or a code and does not exist on any other page. This overlay is where the top bar's `⌘K` finally points, and it is why §2.2's toolbar has no search box of its own.
- **Open questions.** None for this route.

---

## 3. Shared components this unit introduces or requires

Everything visual here is the design system's. This unit adds no new visual primitive. It requires these, and must not ship its own copies:

| Component | Where it lives | Required by |
|---|---|---|
| `TableCard` | design system §5.1 | Companies, Staff, AppSumo, Staff activity, Overview's newest list |
| `FilterPanel` | design system §5.2 | Companies, AppSumo, Staff activity |
| `Picker` | design system §5.6 | plan, status, tier, people pickers |
| `SegmentedControl` | design system §5.12 | the Analytics Range control |
| `StatusChip`, `Chip` | design system §5.9 | status and plan cells |
| `Switch` | design system §5.11 | modules and Enterprise add-ons |
| `BackButton{fallbackHref}` | design system §5.18 | company page; **and the `LockedPage` in the layout gate**, where `fallbackHref` is the absolute `NEXT_PUBLIC_APP_URL` with the label "WorkwrK". The prop already accepts an absolute href and needs no change; this note exists so nobody forks a plain text link for the one case where the target is off this host. |
| `MenuList` | design system §5.6 (the `Picker` popover's row list) | the search overlay's sections, every "…" menu |
| `Drawer` with the page's URL and the 92% list dim | design system §4.5 | company drawer |
| `LockedPage` and the denial family | `src/components/access/` (access-model-spec §6.4) | the layout gate |
| `OsEmptyView` restyled, four-dot line art | design system §5.8 | every empty state here |
| `Dots` (`pending`, `steps-n` unused here) | design system §5.16 | the import button in flight |
| toast (`useOsToast`) | design system §5.7 | every save result |

Five things this unit does introduce, none of them visual:

1. **`AdminShell`** (`src/app/(admin)/admin-shell.tsx`, rewritten). Props: `{ staff: { name, email }, prefs: ConsolePrefs, density: "comfortable" | "cozy" | "compact", children }`. Renders the 48px navy top bar (history arrows, breadcrumb derived from the pathname, the 400px search button that opens §2.8, Help, avatar menu with its three entries), the 264px sidebar from §1, and the content area with 24px padding. Stamps `html[data-chrome="navy"]` unconditionally (the frame is this console's identity, not a preference) and `html[data-density]` from the staff member's own `UserPreference.density`; **it never forces `cozy`**, because Density has one home, My settings › Preferences › Appearance, and this console does not own it. Derives the active sidebar row (longest-prefix segment match) and the breadcrumb from `usePathname()` on every render, with "Staff console" as the fixed first crumb; holds no navigation state. Owns the global `keydown` listener for `⌘K` and `⌘\`.

2. **`StaffSearch`** (`src/app/(admin)/staff-search.tsx`, new). Props: `{ open, onOpenChange, recents }`. The 640px overlay specified at §2.8. Uses `MenuList` rows and the design system's dialog; adds no visual primitive.

3. **Console preferences** (`PlatformAdmin.consolePrefs` Json column, plus `GET /api/admin/me` and `PATCH /api/admin/me/console`). The four layout keys and the recents list from §1 Console preferences. It exists because the admin host proxies only `/api/admin/*`, so `PATCH /api/preferences` is unreachable here, and because the hard rule is that every visible setting persists somewhere named. It holds no product preference: theme and density are read from `UserPreference` through the session, never copied into this column.

4. **`logStaffAction()`** (`src/lib/staff-audit.ts`, new). Signature: `logStaffAction({ action, actor, targetCompanyId?, targetLabel?, summary, before?, after?, reason?, request })`. Writes one `StaffAction` row and, when `targetCompanyId` is present, one tenant `ActivityLog` row through the existing `logAuditEvent` using the mapping in §1 Audit: the `staff.*` event key, the tab family it belongs to, `actorId: null`, `actorType: "platform_staff"`, `actorLabel: "WorkwrK Support"`, and a customer-facing sentence that never names the individual staff member. The staff member's name, email and IP stay on the `StaffAction` row. The 60-second same-actor-same-key collapse that `/settings/audit` applies at write time is suppressed for `staff.*` rows. Fire and forget with a logged failure; a write must never fail because its audit row failed, and an audit row must never be skipped silently. For `admin.access.denied` it applies the sampling rule from §1 Denial: within ten minutes of an existing row for the same email it increments that row's `hits` instead of writing a new one.

5. **`StaffAction`** (new Prisma model). Fields: `id`, `action` (string key: `admin.org.plan_changed`, `admin.org.status_changed`, `admin.org.seats_changed`, `admin.org.module_changed`, `admin.org.feature_changed`, `admin.org.owner_set`, `admin.staff.added`, `admin.staff.removed`, `admin.codes.imported`, `admin.code.refunded`, `admin.access.denied`), `actorUserId` (nullable: a denied probe may not resolve to a user), `actorEmail`, `targetCompanyId` (nullable, indexed), `targetLabel` (nullable: a code, an email), `summary` (the plain sentence), `before` (Json, nullable), `after` (Json, nullable), `reason` (nullable), `ip`, `hits` (Int, default 1; only `admin.access.denied` ever exceeds 1, per the sampling rule), `createdAt`, `updatedAt`. Indexes on `createdAt`, `targetCompanyId, createdAt` and `actorEmail, createdAt`. Nothing cascades: removing a staff member never removes their history, and deleting a company sets `targetCompanyId` to null rather than deleting the rows.

**Two things this unit asks of other units, both small and both named in §4:** the `ActivityLog` row needs `actorType` and `actorLabel` (the access model already puts `actorType` on every row, `access-model-spec.md` §5.1), and `/settings/audit`'s searchable Actor filter needs one pinned entry, "WorkwrK Support", above the workspace's own people.

---

## 4. Migration / build notes

Order of work. Each step ships on its own and leaves the console working.

1. **Audit first, invisibly.** Add the `StaffAction` model and `logStaffAction()`, including the `staff.*` customer-event mapping and the `platform_staff` actor from §1 Audit. Call it from every existing write: the two paths in `companies/[id]/route.ts` that already log (fixing the foreign `actorId` they pass at lines 61, 72 and 99), the feature toggle that does not, the two `platform-staff` writes, and the two `appsumo` writes. No UI change. Shipping this first means the rebuild itself is recorded. Needs `ActivityLog.actorType` and `actorLabel` from the settings and workspace unit; until those land, `logStaffAction` writes the `StaffAction` row and holds the tenant row behind a flag rather than writing a row with a broken actor.
2. **Close the gate properly.** Replace the inline lime Restricted page with `<LockedPage>` from the access family, with `BackButton{fallbackHref}` pointing at the absolute app URL and the denial sampled at one row per email per ten minutes. Confirm every `/api/admin/*` route calls `requirePlatformAdminApi` (they all do today; add a test that asserts it for every file under `src/app/api/admin/`). Require `ADMIN_HOST` in production: when it is unset the console still works but the split does not, and `/admin` answers on the app host, which is the security note in `docs/plans/subdomain-architecture.md` and `access-model.md` §1.9. This step is blocked on the access unit delivering `src/components/access/LockedPage`; until then it keeps the inline page but on tokens.
2a. **Make suspension true.** Two changes, both small, shipped together and before the company page's Status picker gets its new confirm copy. (a) The `status` branch of `PATCH /api/admin/companies/[id]` bumps `tokenVersion` on every member of the company inside the same transaction when the new status is SUSPENDED or CANCELLED. (b) The JWT callback's five-minute revalidation (`lib/auth.ts:330-345`) adds the person's organisation `status` to its select and revokes, with the existing healthy-workspace fallback, when that status is SUSPENDED or CANCELLED. (b) is the one change this unit asks of the auth unit's file and is the only cross-unit code change in the whole spec. Until both land the confirm copy says only what is true, per §2.3 card 2.
3. **The shell.** Rewrite `AdminShell` on the design system: navy top bar 48, sidebar 264 N50 with the four-dot header and the N200 active pill, URL-derived highlight and breadcrumb with "Staff console" as the fixed first crumb, the avatar menu (three entries, no Theme row), `data-chrome="navy"` plus `data-density` from the person's own preference, breakpoints at 1280 and 1024. Add `PlatformAdmin.consolePrefs` with `GET /api/admin/me` and `PATCH /api/admin/me/console` so the sidebar collapse, drawer width, column choices and recents persist per staff member rather than in `localStorage`. Delete every `#d4ff2e`, every `text-red-400` that is not a destructive action, and every `bg-background` / `text-muted` class in this route group.
3a. **Search (⌘K).** `GET /api/admin/search` and the `StaffSearch` overlay (§2.8). It ships with the shell and **before** the Companies rebuild, because the Companies rebuild is what removes today's search box: the replacement must exist first, or there is a release in which nobody can find a company by name.
4. **Companies, the support surface.** The list (views, filter panel, `TableCard`) then the company page and its drawer, in that order. The list-level `PATCH` is deleted in the same change as the quick-edit dialog. Then the new writes: seats, modules, Set workspace Owner. Blocked on the design-system step 4 delivering `TableCard`, `FilterPanel`, `Picker` and `SegmentedControl`; this unit must not fork them.
5. **Staff**, then **AppSumo codes**, then **Staff activity**. Staff activity needs step 1 to have been running for a while to be worth opening, which is why it is late.
6. **The numbers.** Split `/api/admin/stats` into `/api/admin/overview` and `/api/admin/analytics`, wire revenue to Stripe's own prices, delete both hard-coded `PLAN_PRICES` maps, then rebuild Overview and Analytics on the new payloads. Last, because it is the only step that can change a number the founder already trusts, and it should land with a note explaining why the old MRR was wrong.

**Data migrations.** Two additive migrations. One for `StaffAction`. One adding `consolePrefs Json?` to `PlatformAdmin`, defaulting to null and read as an empty object, so nothing breaks for a staff member who has never set a preference. No backfill for either: no staff history exists to recover, and there is no `localStorage` state worth migrating. No change to `Organization`, `Subscription` or `AppsumoCode`. `Organization.settings.features.customDomain` values are left in place, unread, so the flag can come back without a data loss; nothing reads them today either.

**Blocked on other units.** The denial component family (access unit). `TableCard`, `FilterPanel`, `Picker`, `SegmentedControl`, `Switch`, `StatusChip`, `Drawer`, `MenuList`, the restyled `OsEmptyView` and the token re-point (design-system steps 1 to 4). The `--os-modal-search: 640` token, or the fallback to 720 (design system; spec-shell §2.9 asks for the same one). The login page's staff copy on the admin host (auth unit). The JWT callback's organisation-status check, step 2a(b) (auth unit). `ActivityLog.actorType` and `actorLabel`, plus the pinned "WorkwrK Support" entry in `/settings/audit`'s Actor filter (settings and workspace unit). The `POST /api/appsumo/redeem` gate moving to the access model's Billing page rule (settings and billing unit).

**Ships independently.** Steps 1 and 2 have no dependency on any other unit and are worth doing before the visual work, because one is an audit gap and the other is a security boundary.

**Custom domain returns when**: there is a field holding a customer's domain, the proxy resolves that domain to a company, and something reads the flag. Until then the switch stays deleted.

---

## 5. Checklist against the audit

| Issue | Disposition |
|---|---|
| `access-model.md` §2.19: no impersonation or support view | **Resolved by** §1 (the policy) and §2.3 card 5, which states the policy on the company page and gives the Owners' contact details, which is the real support path. No impersonation is built. |
| `access-model.md` §2.19: no way to reset a tenant's last Owner | **Resolved by** §2.3 card 5, "Set workspace Owner" (`POST /api/admin/companies/[id]/owner`), audited both sides. This is the one new back-office action `access-model-spec.md` §2.6 asks for. |
| `access-model.md` §2.19: suspended-org enforcement unstated | **Resolved by** §2.3 card 2 and §4 step 2a: suspension bumps every member's `tokenVersion` in the same transaction and the session revalidation learns the organisation's status, so live sessions end within five minutes; the confirm copy says exactly that and nothing more, and says less until both land. |
| `access-model-spec.md` §2.6: Set workspace Owner is under-specified | **Resolved by** §2.3 card 5: it adds an Owner and never removes or demotes one, so the last-Owner guard is never touched; the picker lists Members and Admins of that workspace only; the promoted person's org role becomes Owner, their Admin scopes clear, their object roles are untouched; the modal names the existing Owners when there are any. |
| `access-model-spec.md` §5.1 / G11: denial-log sampling | **Resolved by** §1 Denial: one `admin.access.denied` row per email per ten minutes with a `hits` count, which is the access model's rule applied to a target that is always the same console. |
| `access-model-spec.md` §6.4: `BackButton{fallbackHref}` on every denial view | **Resolved by** §1 Denial: the `LockedPage` carries the standard `BackButton` with an absolute `fallbackHref`; the earlier draft's plain text link is withdrawn and there is no deviation left to declare. |
| The customer's half of "written down twice" | **Resolved by** §1 Audit: six named `staff.*` event keys, the `/settings/audit` tab each lands in, `actorType: "platform_staff"` with the label "WorkwrK Support" instead of a foreign `actorId`, a pinned entry in that page's Actor filter, and no individual staff member's name in a customer's log. |
| `access-model.md` §2.19: rough UI, pre-OS `ui/` set | **Resolved by** §1 (the reduced shell) and every §2 block. |
| `access-model.md` §3 #28: back-office is a different design system | **Resolved by** the whole spec: one token set, one table, one empty state, one denial page. |
| `access-model.md` §1.9: the host split is opt-in and the layout gate is not the boundary | **Resolved by** §4 step 2: every API route keeps its own gate, a test asserts it, and `ADMIN_HOST` is required in production. |
| `critic-gaps` #1: nav highlight not URL-derived | **Resolved by** §1 and §3's `AdminShell`: longest-prefix match on every render, so `/admin/companies/[id]` highlights Companies. |
| `critic-gaps` #2: fabricated chrome | **Resolved by** §2.1 (System Info deleted, revenue says "Not connected" rather than showing a computed fiction), §2.5 (revenue from Stripe, real definitions under the funnel and the cohorts), §2.6 (server counts replace page-local counts), §2.3 (the Custom domain switch deleted, the Enterprise switches not rendered where they cannot work). |
| `critic-gaps` #3: duplicate surfaces | **Resolved by** §0 and §2.2: the quick-edit dialog and the Manage button merge into one destination. |
| `critic-gaps` #4: access fragmentation and denial redirects | **Resolved by** §1 Access: one role word, one gate, one denial component, one sign-in redirect. |
| `critic-gaps` #5: no back convention | **Resolved by** §1 Back and close and §2.3: `BackButton{fallbackHref="/admin/companies"}` replaces `router.push`. |
| `critic-gaps` #6: five visual systems | **Resolved by** §4 step 3: the lime, the red accent, the shadcn `ui/*` set and the `bg-background` tokens leave this route group. |
| `critic-gaps` #7: settings that do not persist | **Resolved by** §2.3 (the Custom domain switch is deleted; every remaining control autosaves with a visible result and a real failure state) and §1 Console preferences (theme and density have one home in My settings and this console offers no second writer; sidebar collapse, drawer width, column choices and recents persist server-side per staff member in `PlatformAdmin.consolePrefs`, not `localStorage`). |
| `critic-gaps` #9: naming drift | **Resolved by** §1 Naming canon, including the fixed first breadcrumb "Staff console" so no label names two destinations, and the settings-page names taken verbatim from `settings-architecture.md` with their routes. |
| Finding one company by name | **Resolved by** §2.8 (Search, ⌘K, fully specified: anatomy, three result sections, API, states and keyboard) and §2.2's `FilterPanel` field "Name or domain"; both call the `search=` parameter that exists today, which §0 keeps rather than drops, and §4 step 3a ships search before the list's own box is removed. |
| Two-line cells in a fixed-height data row | **Resolved by** §1 One line per row: the four proposed two-line cells become single-line cells, an extra column, or a field on the company page, so every table holds at Comfortable 44, Cozy 36 and Compact 32 and the console stops forcing a density on the person. |
| Table-card footer height | **Resolved by** §2.2, §2.4, §2.6 and §2.7: every footer is the design system's fixed 44, and the one card that is a sample rather than a paged list (Overview's Newest companies) carries a link instead of a record count. |
| One placement for the "…" and no description line | **Resolved by** §1 One placement for the "…" menu: the bordered square at the toolbar right on the five pages with a toolbar, the 28px ghost in the title row on the two without, and every page explanation in "…" › About this page or in the card it belongs to. |
| Card radius | **Resolved by** §2.1 and §2.5: cards are radius 8 (`--os-r-md`); 12 stays with modals, drawers and Home widget cards. |
| The past-due deep link | **Resolved by** §2.1: the link is `?view=paying&subscription=past_due`, because Past due is a Subscription value and `status=` carries only the four workspace statuses. |
| A filtered state that cannot be seen or cleared | **Resolved by** §2.6: Code is the `FilterPanel`'s first field, so `?code=` counts on the Filter chip, shows its value and clears with everything else. |
| An environment-variable name as on-screen copy | **Resolved by** §2.1 and §2.5: "Billing is not connected yet" plus the runbook link; variable names live in the runbook. |
| `critic-gaps` #10: desktop-only, zero breakpoints | **Resolved by** §1 Mobile and narrow: 1280 and 1024 behaviours, no hover-only affordance. |
| `critic-gaps` #11: errors swallowed, no session-expiry handling | **Resolved by** §1 (the one 401 convention) and every §2 States block: a failure renders a failure, never an empty list. |
| `critic-gaps` #15: em dashes in UI strings | **Resolved by** the copy in §2.1 to §2.7; the five offending strings are named in the What-changes rows. |
| `critic-gaps` `missedRoutes`: `/admin/analytics` never audited | **Resolved by** §2.5. |
| `critic-gaps` `missedRoutes`: `/admin/appsumo` never audited | **Resolved by** §2.6. |
| `critic-gaps` #12: silent list caps | **Partly resolved**: the Companies, codes and activity tables page through a footer that names the range and the total. **Deferred**: Analytics still reads a bounded window per query by design, and each card names its window on screen rather than paging. |
| `critic-gaps` #8: broken end-to-end flows | **Not this unit.** The one flow that touches it, `POST /api/appsumo/redeem`, is named in §2.6 Data and handed to the settings and billing unit. |
| `critic-gaps` #13: time, locale and money per surface | **Resolved**: money has one source (Stripe) and its currency is written out. Dates and times render through the product's one `formatDate` helper against the staff member's own `home.locale.timezone`, `dateFormat` and `timeFormat` from My settings › Preferences › Language & region (settings-architecture §4.2), read from the session like theme and density. This console still has no preferences page of its own, and it does not need one: it reads the person's, it never writes them. |
| `critic-gaps` #14: dead code | **Resolved for this unit**: the quick-edit dialog, the System Info card, the Custom domain switch, the list-level `PATCH` and `GET /api/admin/stats` are deleted rather than left behind. |

---

## Open questions for the founder (with the recommendation this spec assumes)

Each has a default so nothing blocks.

1. **Currency.** The old console reported monthly revenue in rupees from a hard-coded per-company price list; the marketing pricing page says 8 dollars per user per month. This spec takes the amount from Stripe and writes the currency out. If customers are ever billed in more than one currency, the Revenue card shows one line per currency and no grand total. Default: report exactly what Stripe charged, never convert.
2. **A read-only staff tier.** Today every person on the staff list can change any customer's plan and can add or remove staff. `access-model-spec.md` §2.6 keeps the allowlist as one flat list, and this spec follows it. Should there be a second kind of staff member who can look but not change, and who cannot add staff? Default: no, one list, and every add notifies everyone.
3. **Seats.** This spec lets staff set a seat count directly, because a mis-sold seat count has no other fix. Should that stay, or should seats only ever come from a Stripe checkout or a redeemed code? Default: staff can set it, and every change is audited.
4. **Set workspace Owner.** The action itself is decided in §2.3 card 5: it **adds** an Owner, never removes or demotes one, so the last-Owner guard is never in play; the promoted person's org role becomes Owner and their Admin scopes clear; their object roles are untouched; it works whether or not the company still has a live Owner. The one open question is the picker's reach: may staff promote any Member of that workspace, or only somebody who is already an Admin there? Guests and deactivated people are excluded either way. Default: any Member or Admin, with a required reason and a typed confirmation, because the case this exists for is a company where everybody senior has left and the only person still there may never have been made an Admin.
5. **AppSumo tiers.** The three presets (Tier 1 Growth 5 seats, Tier 2 Scale 25 seats, Tier 3 Enterprise unlimited) are hard-coded in the page. Should they move into a small editable table, or stay as code? Default: stay as code, and the per-line override in the import handles the exceptions.
6. **Refunds.** Marking a code refunded is bookkeeping only: the company keeps its plan until a staff member changes it. Should a refund downgrade the company automatically? Default: no, because an automatic downgrade would lock a paying customer out of their own work without anyone looking; the refund toast links straight to the company page instead.

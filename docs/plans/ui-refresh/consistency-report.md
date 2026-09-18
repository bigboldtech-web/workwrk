# Consistency report: conflicts between units, resolved

Cross-unit canon, Phase 3. Compiled 2026-09-12 by reading all 17 unit specs against each other and against the three decided documents.

**The tie-breaks, applied in this order:**

1. `design-system.md` wins on **look**: tokens, sizes, components, motion, the page header stack, the takeover chrome.
2. `access-model-spec.md` wins on **access**: org roles, object roles, precedence, the share dialog, the denial convention, the `APP_RULES` table.
3. `settings-architecture.md` wins on **settings structure**: which settings exist, where each lives, persistence, the two doors, the redirect targets.
4. Where none of the three decides, the **hub owner** owns its own sidebar, the **page owner** owns its own page, and the **mechanism owner** owns the mechanism (the shell owns navigation and the keyboard map; task-detail owns how a task opens).
5. A **decided document outranks a unit spec** on any point it actually states.

Conflicts are numbered C1 onward. Each row names the units, the disagreement, the resolution and the doc or rule that settles it. Nothing below is left for an engineer to re-derive.

---

## A. Route claimed by two units

### C1 · `/templates`: Work hub or Docs hub, and who owns the page

**Units:** spaces-lists, docs-knowledge, work-home, shell.

spaces-lists §0 covers `/templates` and rebuilds it as the Template Center. docs-knowledge §0 also covers `/templates`, rebuilds it as the Template Center, and raises change request **S1** asking the shell to move the `/templates` prefix from the `home` row of `ROUTE_HUB` to the `docs` row. work-home §1 places a **Templates** row in the Work sidebar's personal block and names spaces-lists as the page owner. shell §1.1 lists `/templates` under `home`.

**Resolution: `/templates` stays in the Work hub; the page is owned by spaces-lists.** Shell change request S1 is **declined**. Three reasons, in the order the tie-breaks give them: the shell owns `ROUTE_HUB` and has not accepted the move; three specs place the row in Work against one that moves it; and the Template Center serves six kinds (Doc, Canvas, Starter kit, Task, List, Space), four of which are Work objects, so Docs is the narrower home, not the wider one.

**What each unit changes:** docs-knowledge drops row 9 ("Templates") from its CONTENT section and withdraws S1. Its doc templates stay reachable by name: the Docs header "+" gains **Browse templates** → `/templates?kind=doc`, and the three hardcoded doc-template cards on `/docs` are deleted into the Template Center as that spec already intended. Settings › Task system › Templates keeps its link card at `/templates?kind=task` (settings-architecture §5.8, unchanged). Nothing docs-knowledge specified about the page's contents is lost; spaces-lists builds it and adopts that spec's fix for the live defect (starter kits seeding Forms and Tables for orgs without the Tables module).

### C2 · `/analytics`: which Teams sidebar row it is

**Units:** work-home, teams-people.

work-home §1 writes the row into the Teams sidebar as **row 4**, in the personal block after Workload, and says "PEOPLE and everything below shift down by one, so the sidebar runs 1 to 21". teams-people §1, the hub owner, places **Analytics at row 15**, in PERFORMANCE, in a 20-row sidebar.

**Resolution: row 15, PERFORMANCE, as teams-people writes it.** The hub owner owns row placement (tie-break 4); work-home owns the page, its label, its icon and its gate, all of which teams-people adopts verbatim (`BarChart3`, `/analytics`, `app: analytics`). work-home's row-4 proposal is superseded and its "1 to 21" renumbering does not happen. The reason work-home gave (Analytics answers the same question about the same people as My team and Workload, and carries the same gate) is honoured differently and better: PERFORMANCE collapses entirely for a plain Member, so the row still appears and disappears with its siblings.

### C3 · `/integrations`: kept, or merged into `/automation/connections`

**Units:** tools-misc, ai-automation, settings-workspace.

tools-misc §0 **removes** `/integrations` with a 308 to `/automation/connections`, calling the collision "resolved in favour of `spec-ai-automation.md`". ai-automation §0 **keeps** `/integrations` and records that its own earlier draft deleted it, withdrawing that deletion. The two specs each believe they are deferring to the other.

**Resolution: `/integrations` is KEPT.** Access wins on access, and `access-model-spec` §5.2.1 carries an `integrations` row in the AI hub reading "every Member browses the catalog; connecting an integration needs `settings.manageIntegrations`". `/automation/connections` is Owner and Admin only, so a 308 into it would take a destination away from every Member, which the hard rule forbids. `settings-architecture` §5.4 and §7.1 also name `/integrations` as the surviving marketplace and the target of the `/settings/integrations` merge.

**Who builds what:** the **row** is ai-automation's (AI hub, APPS section, `Plug`); the **page** is tools-misc's (its §2.6 content, the Request-this cards). tools-misc deletes its 308 and its "the AI spec wins" paragraph; ai-automation keeps `/integrations` on the `ai` row of `ROUTE_HUB` and keeps row 11. The four providers the old Connections page faked (WhatsApp, Gmail, Google Calendar, Slack) leave Connections and become real Request-this cards on `/integrations`, so nothing is said twice. `integrations/layout.tsx`'s `requireManagerOrRedirect` is still deleted, by tools-misc.

### C4 · `/imports`: a Tables page, a settings page, or both

**Units:** tables-forms, settings-workspace, shell.

**Resolution: no conflict; the two-phase plan is already identical in all three, and it is recorded here so nobody re-opens it.** Phase 1 (through S4): `/imports` keeps its URL and renders inside the settings takeover, because `SETTINGS_ROUTES = ["/settings", "/account", "/imports"]` in `src/lib/nav/route-hub.ts` makes `OsShell` render the takeover there; the Data row declares `alsoActiveOn: ["/imports"]`; the page gates on the `data` settings page rule from its own layout. Phase 2 (S5, when the Import tab ships): `/imports` 308s to `/settings/data?tab=import`, and the `SETTINGS_ROUTES`, `alsoActiveOn` and `ROUTE_HUB` entries are deleted in the same commit. The 308 is the **settings unit's** to ship. The CSV-into-a-table path stays reachable for a plain Member throughout, as an in-place dialog on `/tables` and `/tables/[id]`, because Settings › Data is Owner and Admin only.

---

## B. Naming drift between units

### C5 · The Work landing: "Home" and "My work", or one "My work"

**Units:** shell, work-home.

shell §1.3 canonises `/today` as **My work** and states outright: "There is no row labelled Home... the block is exactly two rows: My work (`/today`) and Inbox (`/inbox`)". work-home creates two separate destinations: `/home` (**Home**, the Work landing, a quiet page of widgets) and `/my-work` (**My work**, the full list of everything assigned to you), and 308s `/today` and `/dashboard` into `/home`.

**Resolution: work-home wins; two destinations, two labels.** The shell's rule was written against a world where `/today` was the only landing and was itself a redirect to the first Space; work-home creates the page that never existed and splits a genuine pair of jobs ("what is my day" versus "everything assigned to me"). The one-label-per-destination rule is not violated, because these are two URLs.

**What the shell changes:** §1.3's row "Work hub landing (`/today`) → My work" becomes two rows, **Home** (`/home`) and **My work** (`/my-work`); the "there is no row labelled Home" paragraph is deleted; `ROUTE_HUB`'s `home` row gains `/home` and `/my-work` and loses `/today`, `/dashboard` and `/tasks` (all 308s now); the Work hub `defaultHref` becomes `/home`; `G H` opens `/home`; the palette's JUMP TO rows are **Home** and **My work**. Everything else in the shell's canon table stands, including the deletion of `MyWorkPanel` (whose job is now literally the `/my-work` page).

### C6 · AI hub section label and the Build row

**Units:** ai-automation, tools-misc, settings-workspace.

ai-automation §1.2 names the section **APPS** and the row **Build**, saying it carries tools-misc's rows "verbatim". tools-misc §1 names the section **ADD ONS** and the row **Build apps**, and says the icon must be `Hammer`.

**Resolution, split:**

- **Section label: APPS.** The hub owner owns its own sidebar (tie-break 4), and ai-automation owns the AI hub sidebar.
- **Row label: Build apps.** `settings-architecture` §5.3 prints the footer text link "Build apps (`/build`)" on Apps & modules, and a decided document outranks a unit spec (tie-break 5). tools-misc, which owns the page, prints the same. Canonising "Build" would cost two cross-unit renames to save one word.
- **Icon: `Hammer`**, which is what ai-automation's table already uses. `Wrench` belongs to the Teams Tools row and design system §5.14 allows one icon per concept app-wide. tools-misc's request is therefore already satisfied.
- **Connections keeps `Cable`**, so Integrations keeps `Plug` and no two rows in one visible set share a glyph.

### C7 · Teams hub `defaultHref`

**Units:** shell, teams-people.

shell §1.1 hard-codes "Teams: `/team`". teams-people §1 sets it to **`/people`**, because `/team` is gated on reports and would land a plain Member on a denial as the first screen after clicking a rail icon.

**Resolution: `/people`.** One URL for everyone; the Directory is the one Teams page access §5.2.1 gives every Member ("Directory, Org chart, My profile always"), so the pill can never land anyone on a locked page and the rail stays a static table. Managers lose nothing: My team is row 2 of the hub sidebar, and every notification that belongs on `/team` links straight there. One word changes in the shell's table.

### C8 · Talk hub `defaultHref` when the module is off

**Units:** shell, talk.

shell §1.1 gives Talk a single `defaultHref` of `/tlk`. talk §1 makes it conditional: `/announcements` when the Talk module is off, because Announcements is not module-gated and the hub must stay reachable.

**Resolution: the conditional stands**, and it is the one conditional `defaultHref` in the table. Two shell changes come with it: `visibleRailApps` keeps the `chat` hub when the Talk module is on **or** when the viewer can see the folded `announcements` app; and with the module off the Talk sidebar renders the Announcements row alone. `ROUTE_HUB` itself does not branch: it stays a pure static table mapping both `/tlk` and `/announcements` to `chat`.

### C9 · The Work sidebar personal block order

**Units:** work-home, spaces-lists.

spaces-lists §1 writes the personal group as "Home · My work · Inbox · Templates · Trash", with Templates and Trash under a 1px rule after Inbox. work-home §1, the hub owner, also carries Activity and Goals, so its block reads "Home · My work (› Personal list) · Inbox · Activity · Goals · [rule] · Templates · Trash".

**Resolution: work-home's order, with spaces-lists' row specs.** The hub owner owns the order; the row labels, icons, hrefs, gating ("every Member, never Guests") and the absence of counts are spaces-lists' and are kept exactly. Engineers follow work-home's table for position only.

### C10 · The SPACES section label as a link

**Units:** spaces-lists, work-home, design-system.

spaces-lists §1 makes the SPACES section label "a link to `/spaces`". work-home §1 states that a section label is a collapse control only and asks spaces-lists to drop it, having already applied the same rule to its own FAVORITES label.

**Resolution: the label collapses only; it is never a link.** Design system §4.2 describes section labels as collapsible with a chevron on hover and gives them no navigation behaviour, and one click target never carries two meanings. `/spaces` is reached from the section "…" menu's **Browse all Spaces** row, which spaces-lists already lists as an entry point, plus the palette and search. On `/spaces` **no sidebar row is active**; the section label renders in `--os-ink` without a pill, which is the legal "exactly one row is active or none" state.

### C11 · The Docs sidebar's section labels

**Units:** design-system, docs-knowledge, process.

design-system §4.2 sketches the Docs hub as "LIBRARY, SOPS, POLICIES, CONTRACTS, CLIPS" section labels. docs-knowledge renders a personal block, FAVORITES, CONTENT, PROCESS and DOCS; process contributes eight rows to the one PROCESS section.

**Resolution: docs-knowledge's sections.** The design system's line is an illustration inside a shell sketch, not a component standard, and three of the five labels it proposes ("SOPS" over a row "SOPs") would break the one-label-per-destination rule, while "LIBRARY" is a word the naming canon retires. The design system's **row, pill, label and rule styling** is unchanged and is exactly what those sections use.

### C12 · The Weekly reviews icon

**Units:** teams-people, teams-performance, goals.

teams-performance §1 gives Weekly reviews `ClipboardCheck`; goals §1 gives KPI reviews the same glyph, and the two rows sit six apart in one sidebar for the same viewer.

**Resolution: Weekly reviews takes `CalendarCheck`** (the weekly heartbeat), KPI reviews keeps `ClipboardCheck`. The hub owner broke the tie and teams-performance has already adopted it; recorded here so it cannot drift back. The same rule settles Workload (`Scale`, not `Gauge`, which is KRAs & KPIs) and Build apps (`Hammer`, not `Wrench`, which is Tools).

### C13 · The Candor and Surveys row audiences

**Units:** teams-performance, teams-people, access.

An earlier reading rendered Candor and Surveys for "every Member". `access-model-spec` §5.2.1 gives Candor to managers, the People team, Admins and "every Member as a participant when invited to a session", and Surveys to Admin and the People team plus "every targeted Member".

**Resolution: the access table, exactly.** Both specs now print it. The consequence is the point: the row appears for an invited or targeted Member (that is the employee door the audit asked for) and stays absent for a Member with nothing to answer, so neither row ever opens an empty "To answer" list.

---

## C. One component specified two ways

### C14 · How a list opens a task

**Units:** task-detail, spaces-lists, work-home, planner, goals.

spaces-lists and its peers describe a row click as opening the drawer with `?item=<id>` on the list's URL. task-detail owns the task-open mechanism and specifies a Next intercepting route at `/item/[id]`.

**Resolution: task-detail's mechanism.** Row click calls `router.push('/item/<id>')`; because the host mounts the `@drawer` slot, Next renders the intercepted drawer over the list and the URL becomes `/item/<id>`. Closing returns to the host URL with its view and scroll intact. Expand keeps the same URL and widens the drawer into the page. `?item=` survives one release as a 308 for stale bookmarks. One URL per task, so Copy link always works (design system §4.5). spaces-lists, work-home, planner and goals re-point the sentence wherever they print it.

### C15 · The task body inside the Inbox

**Units:** task-detail, work-home.

work-home mounts `BoardItemDetail` with `layout="panel"`; task-detail specifies the prop as `host="panel"`.

**Resolution: `host="panel"`**, one prop name across all three hosts (page, drawer, panel). A second prop would be a second contract for one component. work-home's call site changes one word.

### C16 · The task row "…" menu

**Units:** task-detail, spaces-lists.

Both print an ordered menu for a task row.

**Resolution: one ordered list in `ItemMoreMenu` with a `host` prop, published by task-detail.** spaces-lists imports it and does not re-type it. The merged canon: Open · Copy link · Copy ID · Open in new tab · separator · Rename · **Move to list…** (wired to `PATCH /api/items/[id] { boardId }`, today a toast stub) · Duplicate · Task type · Remind me · Start timer / Stop timer (when the Space's Time tracking feature is on) · separator · Archive · Delete (destructive). **"Favorite" is removed**: a task is not a favourite kind.

### C17 · The Filter panel's side, and the "popover 360"

**Units:** design-system, process.

design-system §5.2 places the 272px `FilterPanel` at the **left** of the content. process renders the same primitive on the **right** of `/agreements/[id]` in Place-fields mode, and an earlier draft called a 360px panel a "popover".

**Resolution: both named deviations are accepted as written, and they are the only two.** On `/agreements/[id]` the document is the content and the party and field tools must sit beside the page they are dropped onto, exactly as the Filter panel sits beside a table: same width, border, radius, padding, rows and scroll behaviour, only the side differs. The "popover 360" wording is retired: the Audience panel on `/policies/[id]` and the Evidence panel on `/policies/[id]/compliance` are the design system's **360 right info panel** (§4.5 "Person / channel / Space info: right panel, never modal"). The one popover primitive stays `Picker` at 280.

### C18 · Where quick search lives on a list page

**Units:** design-system, process, tools-misc, tables-forms, admin-backoffice.

The header stack in design system §4.4 has no search slot, but several pages carry a per-page search input today.

**Resolution: the capability moves into the `FilterPanel`'s first row and is never dropped.** The 36px input design system §5.2 already puts at the top of the panel filters the **rows**, writes `?q=` to the URL (debounced 300ms), and counts as one toward the Filter chip's "Filter · N". `/` opens the panel and focuses it; Esc clears focus, a second Esc closes the panel. Every list route's Data block names what `q=` matches, and it is always server-side. The one page with no row search is `/store`, where the whole inventory is two modules plus two link cards. The staff console applies the same rule and additionally keeps Search (⌘K) as the jump-to-a-company door.

### C19 · Selection chrome on the Tables grid

**Units:** design-system, tables-forms.

design system §5.1 makes the checkbox the first cell of a `TableCard`, visible at rest at Comfortable.

**Resolution: `TableCard`'s rule holds on `/tables` and `/forms` (list pages) and does not apply to the grid on `/tables/[id]`.** The design system already carves this out ("Tables module keeps its own rules... no selection chrome"), and `existing-direction.md` §3.5 states it as a founder rule. Nothing is lost: the gutter number selects a row, shift extends, the header letter selects a column, `⌘A` selects the sheet, and every action the checkboxes fed lives in the row and column menus, which gain visible chevrons for touch and keyboard.

### C20 · One primary per page, when a drawer is open

**Units:** design-system, talk, teams-performance.

design system §5.10 says one primary button per page. Talk and teams-performance both hit the case where a drawer or modal over a list carries its own primary.

**Resolution: one blue button on screen, not one per layer, and the rule is stated once here.** While a drawer or modal with a primary is open, the page's toolbar or title-row primary is **not rendered** (removed, not greyed, which matches how every other unusable control behaves); it returns on close, computed fresh, and may legitimately come back as a different action. Talk's softer version (the list's button becomes secondary) is superseded by the harder one, because "removed, not greyed" is already the product-wide rule for a control you cannot use.

**Shell overlays are exempt from the page count**: the call dock, the incoming call card and toasts belong to the shell, float over every route including the settings takeover, and no page can know about them. At most one shell overlay primary exists at a time, so the screen never shows more than two blue buttons and never two on the same plane.

**A confirm opened from inside a drawer** is the one stacked-modal case the design system forbids: it renders as an inline confirm strip in the drawer footer (the question at 13/400, then Cancel and the danger action in place of the footer's usual pair).

### C21 · The settings takeover's ✕

**Units:** design-system, settings-architecture, settings-workspace, account-auth, shell.

settings-architecture §8.1 draws the takeover header as "← Back to app · breadcrumb · ×". design-system §4.6 puts a ghost "← Back to app" at the left of the 48px bar and **nothing at the right**.

**Resolution: no ✕.** The design system wins on look. One exit affordance plus Esc, which is also what the settings audit's issue #24 (four back patterns on one screen family) asks for. A **modal** header still carries a ✕ (design system §5.5); the takeover bar is a different object.

### C22 · Settings takeover measurements

**Units:** design-system, settings-architecture, account-auth, settings-workspace.

settings-architecture §8.1 gives the door sidebar 248px with 16px icons and §10.2 gives settings rows 44px.

**Resolution: design system figures, everywhere.** Door sidebar **264px** with **20px** icons (§4.2, §5.14); settings row minimum **48px** (§5.4); form card **560px** left-aligned inside a **760px** content column, list pages up to **1120px** (the one structural figure settings-architecture keeps, because column width is layout structure rather than a token). A card that would hold six fields is split into two named cards.

### C23 · Where `ErrorState` comes from

**Units:** shell, account-auth.

shell §1.7 specifies one error primitive, `<ErrorState what onRetry reference />`. account-auth §"Layout constants" says no new `ErrorState` component exists in either decided doc and renders `OsEmptyView` in its error form instead.

**Resolution: they are the same thing and the shell's line already says so.** `ErrorState` **is** `OsEmptyView variant="error"`: four dots in a row, the sentence "Couldn't load {what}", a wired "Try again" text link, and a 12px reference id when present. `OsEmptyView` is retained and restyled (design system §5.8; 44 importers); `ui/empty-state.tsx` is deleted. No new component is created, and `ErrorState` is the exported alias. Its `action` prop is typed so a CTA can never be silently hidden.

---

## D. Access rules that differ

### C24 · Does the People team get a read tier in Workspace settings

**Units:** settings-architecture, access-model-spec, settings-workspace.

settings-architecture §3.2 says "no read tier". access-model-spec §2.1 and §6.6 give the People team read on four pages (`members`, `structure`, `access`, `scoring`) via the `peopleTeamRead` flag, plus edit on the people-data fields.

**Resolution: the access model.** Access wins on access. The People team sees those four rows and no others, in read-only mode (values rendered as text at the same position and size the control would occupy, one slim banner, no disabled controls), and edits exactly the §3.5 Membership (P) fields: job title, department, office, reports to, dotted lines and weekly capacity.

### C25 · Where the Settings hub lands for the People team

**Units:** access-model-spec (internally), settings-workspace.

access §5.2.1's `settings` row lands the People team on Workspace › **Overview**, but access rule 14 in the same document makes Overview not discoverable for them (`peopleTeamRead` covers four pages and Overview is not one).

**Resolution: `/settings/members`.** settings-workspace follows rule 14, which is the rule the gate is built from, and lands them on the first Workspace page their flag opens. This keeps §5.2.1's intent (a Workspace landing, not the personal door). One value in `SETTINGS_PAGES` reverses it if the access unit prefers to widen `peopleTeamRead` to Overview instead. Flagged to the access unit.

### C26 · `/settings/hierarchy`'s redirect target

**Units:** access-model-spec, settings-architecture, settings-workspace.

access §6.2 sends `/settings/hierarchy` to `/settings/structure?tab=chart`. settings-architecture §7.1 and §8.4 send it to `/organization`.

**Resolution: `/organization`.** settings-architecture wins on settings structure, and redirect targets are settings structure. Structure › Org chart becomes a link card to `/organization`, and `?tab=chart` resolves to that tab, so the access spec's URL still lands somewhere real. One org chart, in Teams, with the "Edit reporting lines" mode teams-people builds. Flagged to the access unit.

### C27 · The Tools and Assets row audiences

**Units:** settings-architecture §7.1a, access-model-spec §5.2.1, teams-people, tools-misc.

settings-architecture §7.1a proposes rules for the folded app keys and itself says the table "is flagged to the access spec as the completion of its §5.2 table, which owns the final word".

**Resolution: the access table.** **Tools** renders for every Member (the tools shared with them; Admin sees all), which widens settings-architecture's "Admin + People team". **Assets** renders for anyone with reports, the People team and Admin; a Member without reports has **no row** and gets the in-shell 404 on a typed URL, and reads their own kit on the Assets tab of My profile. Both specs now print the narrow and the wide version respectively; recorded so neither drifts.

### C28 · Marketplace and Build apps: Owner and Admin, or every Member

**Units:** settings-architecture §7.1, access-model-spec §5.2.1, tools-misc, ai-automation.

settings-architecture §7.1 renders the AI rows for "Owner and Admin only... the earlier 'everyone for Store and Marketplace' is withdrawn". access §5.2.1 says `store` is "every Member browses; installing needs the `settings.apps` page rule".

**Resolution: Marketplace renders for every Member; Build apps renders for Owner and Admin.** Access wins on access, and settings-architecture defers its own §7.1a table to the access spec. Every write on both pages stays Owner and Admin. A Member on `/store` sees each card's real state and, instead of the switch, a 13/400 status line ("On" with a presence dot, or "Off · ask an admin"), plus "Suggest an app". A Member on `/build` gets the in-shell 404, never `<AppOff>`, because `<AppOff>` would confirm that Build apps exists.

### C29 · Which denial view a manager-scoped page renders

**Units:** teams-people, teams-performance, planner, goals, process, ai-automation.

Five units gate a page on an app key whose rule the viewer fails, and they reached three different answers: the in-shell 404 (teams-performance, goals, process), `LockedPage` (teams-people, for `/team` and `/team/workload`), and a stripped view pill plus a notice line (planner, for `?calendar=team` and `?view=approvals`).

**Resolution: all three are correct, because they are three different situations, and access §5.5 already distinguishes them.** Stated once so nobody applies the wrong one:

| Situation | View | Why |
|---|---|---|
| An **app key** the viewer's rule excludes (`/reviews`, `/team/reviews`, `/talent`, `/team/alignment`, `/team/rollup`, `/team/kpi-reviews`, `/kra-kpi` for a Guest, `/candor`, `/surveys`, `/assets`, `/build`, `/sops/compliance`, `/policies/compliance`, `/sops/manage`) | the **in-shell 404**, with no sidebar row | access §5.5 rule 6. There is no object, so there is nobody to request access from, and naming the page would confirm it exists |
| A **view of a page the viewer already holds** (`/planner?calendar=team`, `/timesheets?view=approvals`, `/timesheets?view=team`) | the pill is not rendered; a typed URL renders the page's default view and `router.replace` strips the parameter; one 13/400 notice line under the toolbar for that page load only | access §5.5 rule 4: has a role, not this action. Never a `LockedPage` |
| An **object** the viewer can discover but holds no role on (a findable Space, a public channel, a container above something they hold, a workflow) | **`LockedPage`** at the same URL with one primary **Request access** (or **Join channel** for a public channel; **Ask an admin** for `/automation/connections`, where the answer is a role change rather than a grant) | access §5.5 rule 3 |

**teams-people's two `LockedPage`s on `/team` and `/team/workload` are the one exception, and they are kept**, because that unit supplies those two `APP_RULES` rows itself and writes them with an explanatory sentence and no Request access ("My team shows the people who report to you. Nobody reports to you yet."). Flagged to the access unit as the single sanctioned app-key `LockedPage`; if it declines, both fall back to the in-shell 404 and nothing else in that unit changes.

**No unit invents a fourth shape.** teams-performance's earlier "LockedPage without Request access" variant is deleted; process renders only the 404; ai-automation uses exactly three of the family (`<AppOff>` for an app the Apps config turned off, `LockedPage` for a role that is not enough, `notFound()` for a Guest or a cross-org id).

### C30 · `<AppOff>` versus the in-shell 404

**Units:** tools-misc, ai-automation, tables-forms, access.

**Resolution, stated once because three units had to reason it out separately:** `<AppOff>` is **only** for a viewer who would otherwise hold the app but whose org **hid or floored it** in Settings › Apps & modules (access §5.5 rule 6, rule 2). A viewer **outside an app key's audience in `APP_RULES`** gets the in-shell 404, because `<AppOff>` would confirm that an app they are not entitled to know about exists. `<ModuleOff>` is only for a premium module switched off (Talk, Tables), and it carries the switch itself for Owners and Admins, "Ask an admin" with real avatars for Members, and a 404 for Guests.

### C31 · Task-level discoverability

**Units:** task-detail, access.

access rule 14 has no branch that makes an `Item` discoverable.

**Resolution: a task is never discoverable, so "role none" and "not discoverable" are the same state and the answer is the in-shell 404.** An `Item` has no `findable` flag, no descendants a person can be granted on, and is not a container. task-detail therefore builds **no** task-level `LockedPage`, no task-level Request access and no back target on one; a person who needs access asks at the List or the Space. Raised as an open question to the access spec in case an item-level branch is wanted later; until it is answered, 404.

### C32 · The `/tables` role select and the `/canvas` role select

**Units:** access §6.1, docs-knowledge (A3), tables-forms (T-A1).

access §6.1 defines one role select with four rungs and no per-object-type variant. Two units ask to drop **Can comment** where nothing accepts a comment.

**Resolution: the four-rung select ships as the access spec defines it; both requests are recorded as change requests to the access unit, which owns any per-type rung policy.** If it accepts them, `{ type: "whiteboard" }`, `{ type: "file_folder" }` and `{ type: "table" }` offer Full access · Can edit · Can view, and an inherited COMMENT grant still renders as "Can comment" in the People with access list, so the vocabulary never changes and no stored grant is rewritten. A third request of the same shape (Can comment on a Tool) is recorded by tools-misc. No unit changes the dialog on its own.

### C33 · What a form is anchored to

**Units:** access §3.3, settings-architecture §7.1a, tables-forms (T2).

access §3.3 anchors a Form to a **Table**; settings-architecture §7.1a says "object ladder on the **List** the form feeds"; in the product a form's destination is usually a List.

**Resolution: tables-forms builds the extension and flags it rather than asserting it.** The requested clause, in the access spec's own vocabulary: *"Form: anchored to the Table or the List it feeds; inherits the anchor; creator FULL; a form with no destination yet inherits nothing and is creator FULL plus Admin FULL until one is set."* The creator keeps Full access for the life of the form whatever it is anchored to, so pointing a form at a List you hold only Can comment on costs you nothing. A form has no `GrantObject` of its own and is never shared directly: its Share opens the dialog on its anchor with the header line "Access to {form} comes from {anchor}".

### C34 · Is Forms Core or gated on the Tables module

**Units:** access §5.2.1, existing-direction.

access §5.2.1 gates `forms` on the Tables module. `existing-direction.md` line 31 (the 2026-08-28 modular packaging decision) lists **Forms under Core** and Tables under Premium. Because new orgs ship with Tables **off**, the two readings produce opposite products.

**Resolution: build the access spec's version, and raise it as a genuine founder question** (it is in the Open questions of `spec-tables-forms`). If the founder confirms Forms is Core, the change is **one cell**: the `forms` row's gate moves from "module on" to "every Member", §3.3 gains the List anchor from C33, and the hub renders for every Member with the FORMS section alone while the TABLES section, the "All tables" row, "New table" and "Import a CSV…" remain module-gated. No other line in any spec changes.

### C35 · Can a stranger without an account submit a public form

**Units:** tables-forms, access (§8 toggle 10, §11 invariant 19).

Today's product intends yes (`FormDefinition.isPublic` is documented as "anyone with the link can submit, no login needed" and the API already honours anonymous writes). The decided access model does not allow it: an anonymous submission is a write, toggle 10 has two values (Off, View only), and invariant 19 makes "public links never exceed VIEW" a golden-tested security invariant.

**Resolution: ship the larger half now and put the smaller half to the founder.** The responder leaves `(dashboard)` for `(public)`, so anyone with the link **reaches and reads** the form instead of bouncing to `/login`; **Submit requires sign-in** (the visitor goes to `/login?callbackUrl=` with their typed answers preserved). If the founder says strangers must submit, the access unit adds **one named exception**, not a third value on toggle 10: a per-form switch "Accept responses from people without an account" (default off, Full access to turn on, confirm, audit row), rendered only when the org's public links are "View only", granting exactly `respond` on that one form and never `view` on the anchor, the destination List or any row already in it.

### C36 · `/reviews/[id]` and peer feedback

**Units:** teams-performance, access §3.3.

The Review cycle relationship rule has no clause for the peers a cycle asks for feedback.

**Resolution: requested wording, flagged to the access unit:** "a person asked for peer feedback on a subject in this cycle holds COMMENT on their own feedback form for that subject, and nothing else in the cycle." COMMENT is already the role the model uses for "respond but do not read the rest" (a targeted survey respondent holds it), so this adds a relationship, not a concept. Until it lands, `/reviews/[id]` renders the Peer feedback section only for people the server marks as peer respondents on the cycle GET, which is the same fact stated locally.

### C37 · Two units both write a weekly-review decision

**Units:** goals, teams-performance.

An earlier draft of teams-performance called `/team/reviews` "the one decision surface" and said the Alignment board "stops trying to approve inline", while goals keeps an Approve column on the Alignment board.

**Resolution: two entry points, one route, one payload, one rule.** The audit finding (PO-1) was a wrong verb, not a second surface: the board `POST`ed to a `PATCH`-only route, so every inline approval failed silently. Both surfaces call `PATCH /api/weekly-reviews/[id]/manager-review` with `{ decision, notes }`, gated by `requireCan("edit", { type: "person", id: subjectId })`. The Alignment board is the **one-click** surface; `/team/reviews` is the **reading** surface (the whole review in a drawer, with the notes field). Neither renders the other's content. A decision written from either place flips the same field, refreshes the same badge and writes the same Inbox row, and both apply the same rule that a "Request changes" without a note is not sendable.

### C38 · `settings.data.aiEnabled` as an access input

**Units:** ai-automation, access, settings-architecture.

An earlier draft made the flag a hard access gate on the whole AI hub. No rule supports that: rule 2 short-circuits on modules and the Apps config only, §5.2.1's `ai` row says "every Member" unqualified, and settings-architecture carries `aiEnabled` as a Retention and privacy row.

**Resolution: it is a feature switch, not an access input.** The flag never appears in a `can()` decision and never changes a `Decision.role`. ai-automation asks the access unit for **one line inside rule 2** ("the `ai` app key also resolves off when `settings.data.aiEnabled` is false"), which gives one mechanism, one denial component and one API body. If declined, the fallback needs nobody's permission: the assistant stops server-side, `/sidekick` renders its landing with one 44px line "AI is turned off for this workspace." in place of the composer, the page-header Ask AI slot is empty, and ⌘J does nothing. Automations are untouched either way, because automations are not AI.

### C39 · The `UserStatus` enum and "Active"

**Units:** shell, access.

access precedence rule 1 reads "status not ACTIVE or PROBATION", which would lock out a person on leave. The enum carries six values, four of which are employment states rather than access states.

**Resolution: the access model has exactly two words, Active and Deactivated, and rule 1 should read "not Active".** The mapping the frame uses: `ACTIVE`, `PROBATION`, `ON_LEAVE`, `PIP` and `NOTICE_PERIOD` are all **Active** (a person on leave or on notice still opens the app); `INACTIVE` is **Deactivated**. Nothing in the shell reads the enum: `/api/boot` returns `viewer.active: boolean`. Flagged to the access unit as a one-line correction.

---

## E. A setting placed in two homes

### C40 · The accent picker

**Units:** design-system, settings-architecture, shell.

design system §1.4 rule 1 and §10 decision 6 make one blue the whole system and delete the ten `data-accent` CSS blocks. settings-architecture §4.2 keeps an **Accent** row on `/account/preferences` reading seven keys from `src/lib/accents.ts`.

**Resolution: the Accent row is deleted in the same PR as the token sweep, not hidden.** The design system wins on look, and the token PR is load-bearing: once the `data-accent` blocks are gone, the row would be decorative, and a decorative setting is exactly what the persistence rule forbids. Both accent pickers (`customize-panel.tsx` and `/account/preferences`) go. Settings open decision 5 and Phase 2 Q4 are answered by the deletion. If the founder keeps accents, the deletion of the two pickers still stands and the accent lives only on `/account/preferences` against a restored `data-accent` block.

### C41 · Density default for a new org

**Units:** design-system, settings-architecture, shell.

design system §3.2 and open decision 2 make **Comfortable 44** the default; settings-architecture §5.2's Appearance-defaults row ships the org default as Cozy.

**Resolution: Comfortable 44.** Density is a look value and the design system is the deciding doc on look. The settings row's default changes to Comfortable in the same PR. The three-step preference means the founder can flip the org default from Settings › Identity › Appearance defaults without a token change, so nothing is one-way. `src/lib/density.ts` and the `workwrk:density` key are deleted; density comes from `/api/boot` before first paint, which also ends the boot flash.

### C42 · Where a surface's own view options persist

**Units:** settings-architecture §7.3, work-home, ai-automation, teams-performance.

settings-architecture defines `UserPreference.home.work.surface.{viewId}` for `TaskListSurface`. Three other units need the same shape for their own lists.

**Resolution: one shape, one namespace per hub, and the `.strict()` schema learns all of them in one migration.** `home.work.surface.{viewId}` (Work), `home.work.surface["automation.workflows" | "automation.logs" | "agents.runs" | "sidekick.allChats"]` (AI, which reuses the `home.work` namespace by that unit's own choice, flagged to the settings unit) and `home.teams.surface.{reviews|review-cycle|weekly-reviews|talent|candor|kudos|surveys}` (Teams). All hold `{ columns, sortKey, groupBy, filters, filterConnector, viewOptions }`, written debounced 400ms through `PATCH /api/preferences` and read on mount. **Pivot results are never stored** (they are derived from tasks); the pivot **configuration** lives inside `viewOptions`. URL state (view pill, filters, sort, page, an open drawer's id, the Health window, the Usage month) is never a preference, because a shared link must carry it.

### C43 · Sidebar collapse keys

**Units:** shell, work-home, spaces-lists, ai-automation, docs-knowledge, talk.

Four different key shapes appeared: `sidebar.collapsedSections[]` (shell), `sidebar.groups.{myWork|goals|favorites}` (work-home), `sidebar.sectionsCollapsed[]` (spaces-lists) and `workwrk:talk:sections` (talk, localStorage).

**Resolution: the shell owns the key and its shape.** `sidebar.collapsedSections[]`, keyed `{hub}.{section}`, is the one store for section collapse; `sidebar.groups.{key}` is the one store for a **group row** inside a section (My work, Goals), which is a different thing; `sidebar.expanded[]` holds the Spaces tree; `sidebar.docsFoldersOpen` holds the drive-folder tree. `sidebar.sectionsCollapsed[]` is renamed to the shell's key. **Talk's `workwrk:talk:sections` is the one declared exception** and stays per-device ephemera, exactly as settings-architecture §7.3 rules for "Room sections"; it is never rendered as a setting, so the persistence rule is not broken. `sidebar.iconsOnly` is dropped with the icons-only option.

### C44 · `home.cards`

**Units:** settings-architecture §7.3, work-home.

settings-architecture assigns the reader of `home.cards` to "the Work sidebar and Space overview" without saying what it holds.

**Resolution, from the reader:** `home.cards` is the list of **optional Work-sidebar rows and sections that are switched on**, edited in My settings › Preferences › Sidebar and in the CustomizePanel, both writing the same key. Optional keys: `activity`, `goals`, `templates`, `trash`, `favorites`, `spaces`. Fixed and never hideable: Home, My work, Inbox. A key the viewer's role does not grant is ignored rather than rendered. Home's **widgets** are a surface option on a different key, so the two can never fight over one array.

### C45 · Escalation thresholds

**Units:** settings-architecture §7.3, teams-people.

`Threshold` rows persist via `POST/DELETE /api/thresholds` and nothing reads them: the escalation cron works off the task's own SLA fields.

**Resolution: the persistence rule applies as written.** The Thresholds card on the Job title page renders **only under "Show upcoming features"** (off by default), captioned "Not enforced yet", until the escalation cron joins `Threshold` by `roleId`. The rows are kept, never deleted (data integrity). teams-people owns the reader when the cron changes.

---

## F. Keyboard and shell mechanics

### C46 · The quick-task chord

**Units:** design-system §4.3 and §4.7, shell §1.8, task-detail, work-home, spaces-lists, goals.

The design system advertises `⌘T`; the shell registers `⌘⇧K` and marks `⌘T` reserved.

**Resolution: `⌘⇧K`.** `⌘T` opens a new tab in Chrome, Safari, Firefox and Edge on both platforms and is not deliverable to the page, so advertising it would break the "advertised equals working" rule that the whole keyboard section exists to enforce. The shell owns the keyboard registry (`src/lib/shortcuts.ts`), which is the single source for the window listener, every tooltip's kbd hint, the `?` overlay and `/account/shortcuts`. Design system §4.3 and §4.7, work-home, spaces-lists, goals and task-detail all print `⌘⇧K`. The button label stays "Create task".

### C47 · Hub jump chords

**Units:** design-system §4.7, shell §1.8.

`⌘1..8` versus `G 1..8`.

**Resolution: `G` then `1`…`8`** (1.5s window, not in inputs). Chrome and Safari on macOS switch tabs on ⌘digit. Same reason, same owner, same rule. `⌘\` replaces `⌘B` for the sidebar (⌘B is bold in editors), and `⌘⇧N` (today's quick capture) goes because it opens a private window on Windows; its job is the Create menu's Notepad row.

### C48 · Single-letter shortcuts inside inputs

**Units:** planner, talk, teams-performance, shell.

Several units register single-letter chords (`A` to acknowledge, `M` and `V` for mic and camera, `/` to open the filter search).

**Resolution: one suppression rule, owned by the shell's registry.** A single-letter shortcut never fires while focus is inside a text input, a textarea, a contenteditable editor, a picker's search field, a timesheet add row or any open modal; in those places only chords and Esc work, and Esc returns focus to the surface behind before a single letter is live again. Design system §4.7 defines chords only, so this rule lives in `src/lib/shortcuts.ts` and every unit's Keyboard block is read under it.

### C49 · The Ask AI panel below 1024

**Units:** ai-automation, shell §1.16.

**Resolution: the panel does not render below 1024; ⌘J and the page-header slot navigate to `/sidekick` instead.** It keeps the shell's container rule at every width above that: 360 at the inline end, pushing content, never overlaying, never on a scrim (drawers dim, they do not scrim). One row is added to the shell's width table. Nothing squeezes `<main>`; the person lands on the full page, which is the surface designed for a narrow column.

### C50 · Who renders the Reminder, Notepad and Voice note surfaces

**Units:** shell, planner.

**Resolution: the shell mounts all three as `LayerStack` overlays opened from the one Create menu and the palette's CREATE section; planner owns what the Reminders bell and the reminder create panel *show*.** The top bar "+" keeps exactly the design system §4.3 menu (Task, Doc, List, Reminder, Notepad, Voice note, then the AI entries when entitled), and the Planner unit adds nothing to it: Event, Meeting and Time entry live on the **Planner sidebar's** header "+", which is the only place they are created from chrome.

---

## G. Cross-unit contracts that must land together

Not conflicts, but places where one unit cannot ship until another does. Listed so the build order is not discovered late.

| Contract | Owner | Consumer | What breaks without it |
|---|---|---|---|
| `/api/boot` `counts` widened to `{ inboxUnread, remindersDue, talkUnread, weeklyReviews, reviewForms, candorOpen, surveysOpen }` | shell | teams-performance | four Teams badges render with **no badge** rather than a fifth poller; the rows themselves work from day one |
| Five Inbox row kinds (`review_open`, `manager_reviews_due`, `candor_open`, `survey_open`, `kudos_received`) in `src/lib/inbox-kinds.ts` | work-home | teams-performance | the employee doors to review cycles, candor, surveys and kudos have no notification path |
| `GET /api/people/pick` unscoped by report tree | access | every people picker in the product | share and assignee pickers stay truncated by the caller's org-chart position (audit Broken #3) |
| Nine new `APP_RULES` rows (`templates`, `team`, `workload`, `weekly-reviews`, `kra-kpi`, `alignment`, `kpi-reviews`, `meetings`, `clock`) | access (migration step 3) | spaces-lists, teams-people, teams-performance, goals, planner | "a key with no row does not render and its route 404s", so nine live routes 404 |
| `Form` added to the `/trash` Type filter; `Contract` likewise | spaces-lists | tables-forms, process | deleted forms and archived contracts have no page that lists them |
| `useDirtyGuard` in `src/hooks/use-dirty-guard.ts` (not under settings) | settings-workspace | ai-automation (the builder), tables-forms (the form builder), goals, teams-performance | two builders keep losing work on navigation |
| The `.strict()` preferences schema learning every new key (C42, C43, C44) | settings-workspace | shell, work-home, spaces-lists, docs-knowledge, ai-automation, teams-performance | every "remembered" option in six units is a silent 400 |
| `User.presenceStatus`, `presenceUntil`, `weeklyCapacityHours` columns (step S4) | settings-workspace | teams-people (presence dots), planner, talk | the helper returns null and no dot is drawn, which is the designed fallback, so nothing breaks visibly |
| Behavioural anchors taken out from behind "Show upcoming features" on `/settings/scoring` | settings-workspace | teams-performance (build step 6 is the form reading them) | a setting the review form depends on stays invisible |
| `useAiSession().start({ context })` gaining `entityType` and `entityId` | ai-automation | task-detail (the task's Ask AI slot) | Ask AI from a task opens with no context chip |
| `visibleRailApps` keeping the `chat` hub on the `announcements` condition | shell | talk | Announcements becomes unreachable in any org with the Talk module off |
| `ROUTE_HUB` edits: add `/home` and `/my-work`; drop `/today`, `/dashboard`, `/tasks`, `/ai`, `/autopilot`, `/marketing`; move `/favorites` from `ai` to `home`; keep `/integrations` on `ai`; keep `/templates` on `home` | shell | work-home, ai-automation, tools-misc, docs-knowledge | the URL-derived highlight is undefined for those prefixes |
| `SETTINGS_ROUTES` and the Data row's `alsoActiveOn: ["/imports"]`, deleted together with the `/imports` 308 at S5 | shell (mechanism), settings-workspace (the 308) | tables-forms | either the only working importer is unreachable, or two import surfaces coexist |
| `x-workwrk-path` stamped by `src/proxy.ts` so `settings/layout.tsx` can resolve the page key | settings-workspace | the one settings gate | every Owner-only page falls back to its own `gateSettingsPage(key)` call, which is the designed belt and braces |
| `APP_PREFIXES` and `AUTH_PUBLIC_PREFIXES` gaining `signup` and `join` | account-auth | marketing (Phase 4) | "Start free" on the marketing host lands on the chrome-less root 404, and an invitation link bounces to `/login` |

---

## H. What every unit agreed on without being asked

Recorded because agreement is worth as much as a resolved conflict, and because these are the lines a reviewer should check every PR against.

1. **Nothing is sticky.** `activeAppKey`, `previewAppKey`, `lens` and `workwrk:os:active-app` are deleted in all 17 specs; hub and row are pure functions of `pathname + search`. `AppEntry.matchPaths`, `findAppForPath` and `AppEntry.requiredAccess` go with them.
2. **A control the role cannot use is not rendered, never disabled.** Every unit states it; no unit ships a greyed control.
3. **No control without a handler.** The `OsTitleBar` Ask AI / Share / Invite trio, the always-filled star and the hard-coded `PEOPLE` avatar stacks are deleted from every page in every unit; `OsTitleBar` becomes `OsPageHeader` and takes only real props.
4. **One loader vocabulary.** Skeletons in content, the rail logo pulse for route transitions, `Dots pending` in buttons, `AutosaveIndicator` for saves. `Loader2` and the string "Loading…" are lint errors.
5. **No swallowed fetch.** Every read goes through `apiFetch`; `catch(() => setRows([]))` is a lint error; every failed read renders `ErrorState` with a wired Retry in place, and every failed write raises one toast with Retry.
6. **One date helper.** No file calls `toLocaleDateString` directly; `formatDate(value, prefs)` reads `home.locale.{timezone, dateFormat, timeFormat, weekStart}` over the org's values. "Smart date" is defined once.
7. **Server pagination, no client caps.** The 500-row member cap, the 500-row Everything cap, the 50-row inbox, kudos, candor and survey caps, the 200-row doc and canvas caps, the 100-row log and audit caps and the client-side filtering behind them are all replaced by cursors and real totals.
8. **Drag always has a keyboard and menu alternative**, and no affordance is hover-only or right-click-only: every row "…" is in the tab order, revealed by `:focus-visible`, and rendered at rest on coarse pointers.
9. **Desktop and tablet are in scope (1024 and 768); phones are not**, except the four surfaces that genuinely are phone-first: `/meet/[code]`, `/clock`, the public token pages and the auth pages.
10. **No em dashes and no double hyphens** in any string a person reads, and no developer instructions in product copy.

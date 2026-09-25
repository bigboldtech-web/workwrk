# Sidebar map: all eight hubs, every row, in order

Cross-unit canon, Phase 3. Compiled 2026-09-12 from the hub-owning unit specs. Chrome is `design-system.md` §4.1 and §4.2; the container rules are `spec-shell` §1.2; gating is `can(viewer, "view", { type: "app", key })` through `visibleApps` from the one `APP_RULES` table (`access-model-spec` §5.2.1).

---

## 0. The rules every row obeys

**Container.** 264px (`--os-side-w`, resizable 240 to 320), `--os-side-bg` (N50) in both chrome variants, `border-inline-end: 1px solid var(--os-line)`, its own scroll, collapsible to zero with the circular chevron at the outer edge bottom and `⌘\`.

**Header (56px).** The workspace switcher (`EntityTile size="sm"` neutral + org name 15/500 + chevron) and one 32px ghost "+" at its right, tooltip "New in {Hub}". The hub search field renders under it **only when the rendered tree exceeds 12 rows**, placeholder "Search {Hub}…"; it filters rows in place and never navigates. It is not the global Search.

**Rows (36px, `.os-row`).** `padding-inline: 12px`, gap 12, inset 8px from the sidebar edges, radius 8. One 20px Lucide icon at 1.5px stroke in `--os-ink-2` or an `EntityTile size="sm"` neutral; label 15/400 `--os-ink`; optional count right-aligned 12/500 `--os-ink-2`. Hover `--os-surface-hov`. **Active** = `--os-side-pill` (N200) pill, label 15/500 `--os-ink`, icon `--os-ink`, count `--os-ink-strong`. No blue, no left bar, no coloured icons, no transform.

**Section labels.** 11/600 uppercase +0.06em `--os-ink-2` with a 1px `--os-line` rule from the label to the right edge, 24px top margin, 8px bottom. A section label is a **collapse control only, never a link**: one click target never carries two meanings. A section renders only when at least one row inside it renders.

**Order inside a hub.** The unlabelled personal block first, then FAVORITES when non-empty, then the labelled sections.

**Hover.** One 32px ghost "…" (`MoreHorizontal`) at the row's right. Star, "+", Rename, Share and Mute live inside it; there are no three-icon hover clusters. It is always in the tab order, revealed at full opacity by `:focus-visible`, and rendered at rest under `@media (hover: none)`.

**Counts and dots.** A count is 12/500 right-aligned and is hidden at zero. An unread dot is the `Dots unread` variant at the row's right when a count is absent. Counts come from the row's loader and are refreshed by the SSE events in `spec-shell` §1.11, never by per-row polling.

**Section states.** Loading: three 36px skeleton rows, never a spinner. Empty: one quiet 36px line (`emptyLine`), no card, no illustration. Error: one 36px line "Couldn't load {section} · Try again" with the link wired to the loader. A sidebar section never renders empty on a failed fetch.

**Footer (44px).** The one "Customize Sidebar" button, ghost, 13/500 `--os-ink-2`, 16px `SlidersHorizontal`, with a top border. It opens the CustomizePanel (Theme, Chrome, Density, section visibility and order). It is present in all seven app hubs and **absent in the settings takeover** (there is nothing to customize there).

**Persistence.** `sidebar.width`, `sidebar.collapsed`, `sidebar.sectionsOrder` (keyed `{hub}.{section}`), `sidebar.collapsedSections[]`, `sidebar.expanded[]` (the Spaces tree), `sidebar.hiddenSpaceIds[]`, `sidebar.docsFoldersOpen`, `sidebar.groups.{myWork|goals|favorites}` and `home.cards` (which optional Work rows are on). All through `PATCH /api/preferences`, never localStorage. The one exception, declared: Talk's section collapse is per-device ephemera in `workwrk:talk:sections`.

**Locked rows.** A findable Space the viewer holds nothing on renders with its label in `--os-ink-3` and a 16px `Lock`; the click opens `LockedPage` at the Space URL. Folders and Lists render only as container labels above something the viewer holds.

**The pill for an open object (2026-09-24).** When a Doc, Table, Canvas, SOP or form is open in Work, the pill follows what the sidebar actually rendered, for the object actually mounted (src/lib/nav/open-object.ts): the object's **own tree row** if it is rendered; else its **FAVORITES row** if that is rendered; else its **nearest rendered ancestor** (the List of a List or task doc, the anchored doc of a sub-page, then its Folders nearest first, then its Space); else nothing. Exactly one row carries it, and a row that takes it for a newly opened object scrolls into view once. It stays on the object while the task drawer's `/item/[id]` URL shows over it, because the mounted page publishes it, not the URL. The tree opens the object's branch once per placement (its Space and the folders its route's gate computed with the tree's own rules), and never opens a folder the viewer's tree would not render.

---

## 1. Work hub (`home`): owned by work-home; the Spaces tree by spaces-lists

`defaultHref: /home`. Header "+" = the global Create menu (`create: "global"`), whose first row is Task (`⌘⇧K`).

### Personal block (no section label)

| # | Label | Icon | href | Gating | Count / badge | Collapsed |
|---|---|---|---|---|---|---|
| 1 | **Home** | `House` | `/home` | everyone signed in, Guests included | none | n/a |
| 2 | **My work** (group) | `CheckSquare` | `/my-work` | everyone signed in | Overdue + Today when > 0 | expanded when the child is active; `sidebar.groups.myWork` |
| 2a | **Personal list** (child, indent 20) | `Lock` 16px as a right glyph | `/my-work/personal` | Owner, Admin, Member, Agent; never a Guest | none | |
| 3 | **Inbox** | `Inbox` | `/inbox` | everyone signed in | unread from `GET /api/inbox/count` (99+ cap) plus a 6px `Dots unread` on the icon | n/a |
| 4 | **Activity** | `Activity` | `/activity` | Owner, Admin, Member, Agent; never a Guest | none | n/a |
| 5 | **Goals** (group) | `Target` | `/okrs` | `app: goals`, every Member; never a Guest | none | expanded while the path starts `/okrs`; `sidebar.groups.goals` |
| 5a | My goals | `Trophy` | `/okrs` | every Member | none | |
| 5b | Team goals | `Users` | `/okrs?view=team` | anyone with reports, People team, Owner, Admin | none | |
| 5c | Company goals | `Building2` | `/okrs?view=company` | every Member | none | |
| 5d | My KRAs & KPIs (a jump out of the hub: 12px `ArrowUpRight` at the right, never active) | `Gauge` | `/people/me?tab=kras` | every Member | KPIs awaiting my number this month; hidden at 0 | |
| | *1px `--os-line` rule* | | | | | |
| 6 | **Templates** | `LayoutTemplate` | `/templates` | `app: templates`, every Member; never a Guest | none | n/a |
| 7 | **Trash** | `Trash2` | `/trash` | `app: trash`, every Member; never a Guest | none | n/a |

The personal block reads **Home · My work (› Personal list) · Inbox · Activity · Goals · [rule] · Templates · Trash**. `home.cards` decides which of `activity`, `goals`, `templates`, `trash`, `favorites`, `spaces` are on; Home, My work and Inbox are fixed and never hideable.

### FAVORITES

Renders only when the viewer has at least one starred object; never for a Guest. The label collapses only.

| Row | href | Notes |
|---|---|---|
| one row per starred object, `EntityTile size="sm"` neutral + name, newest starred first, kinds mixed (Space, Folder, List, Doc, Table, Canvas, File) | the object's URL. Doc, Table, Canvas and Form favourites link the Work door (`/work/docs/[id]` and siblings), which places the object in its own Space before its editor mounts, or the address it is already mounted at when it is the open object; Files open their URL | sub-labels by kind only past 6 rows; unreadable favorites are dropped silently. Hover "…": Open in new tab · Copy link · Remove from favorites. A favourite carries the pill only when its object's own tree row is not on screen (section 0) |
| **See all favorites** (ghost row, 13/500 `--os-ink-2`, always last) | `/favorites` | rendered whenever the section renders; it is the row that goes active on `/favorites` |

Data: one `GET /api/me/favorites` for all seven kinds. Collapse state `sidebar.groups.favorites`.

### SPACES

Label collapses only. Hover on the label reveals two 28px ghost buttons: "…" (Collapse all · Expand all · Show hidden Spaces (N) · **Browse all Spaces** → `/spaces`) and "+" (New Space, only when `can(viewer, "create_space", org)`; never Agents or Guests).

| Row | Glyph | href | Notes |
|---|---|---|---|
| **Everything** | `Layers` | `/everything` | first in the section; every Member, never a Guest |
| **Space** | `EntityTile size="sm"` neutral (flips to a chevron on hover when it has children) | `/spaces/[slug]` | 12px globe after the name when it has an "Everyone at {org}" row. Children: Folders, Lists, anchored Docs / Canvases / Tables |
| Space (container label or findable, no role) | 20px `Lock` `--os-ink-3` | `/spaces/[slug]` | opens `LockedPage`. Findable Spaces are **not** listed by default; they live on `/spaces`, reached from the section "…" |
| **Folder** (indent 20 per level, max 6) | `Folder` | `/folders/[id]` | 12px lock after the name when Restricted |
| **List** | `ListChecks` (sprint Lists `IterationCw`) | `/boards/[slug]` | children = saved views, only when the List has 2 or more; collapsed by default |
| **View** (child of a List) | a 6px `--os-ink-3` bullet in the glyph slot | `/boards/[slug]?view=<id>` | 14/400 `--os-ink-2` |
| **Doc / Canvas / Table** (anchored) | `FileText` / `Brush` / `Table2` | `/spaces/[slug]/docs/[id]` · `/spaces/[slug]/canvas/[id]` · `/spaces/[slug]/tables/[id]` | Links to the item's Work address, so it **opens in place**: the Work sidebar stays, the item opens beside it, and the rail stays on Work (src/lib/nav/object-href.ts). Cmd-click and "Copy link address" give the same Work address. The row is lit by the pill rule in section 0. The canonical `/docs/[id]`, `/canvas/[id]` and `/tables/[id]` stay valid and are what the Docs and Tables hubs open |

No counts on tree rows. Expand state `sidebar.expanded[]`; hidden Spaces `sidebar.hiddenSpaceIds[]`.

**A Guest's Work sidebar, in full:** Home, My work (no Personal list), Inbox. Nothing else.

---

## 2. Planner hub (`planner`): owned by planner

`defaultHref: /planner`. Six rows, so no hub search field. Header "+" opens: **Event** · **Meeting** · **Reminder** · **Time entry** (`/timesheets?week=<current>&add=today`). This is the only place Event and Meeting are created from chrome; the top bar "+" gains nothing from this unit.

| # | Section | Label | Icon | href | Gating | Count / badge |
|---|---|---|---|---|---|---|
| 1 | (none) | **Calendar** | `Calendar` | `/planner` | `app: planner`, every Member; never a Guest | none |
| 2 | (none) | **Meetings** | `Video` | `/meetings` | `app: meetings` (new key; fallback `planner`) | my meetings still to come today; hidden at 0 |
| 3 | (none) | **Timesheets** | `Clock` | `/timesheets` | `app: timesheets`, every Member | none |
| 4 | (none) | **Clock in/out** | `Timer` | `/clock` | `app: clock` (new key; fallback `planner`), every Member, Agents included | when clocked in: a 6px `Dots live` then "since 9:02" |
| 5 | TEAM | **Team calendar** | `Users` | `/planner?calendar=team` | anyone with at least one report, People team, Owner, Admin | none |
| 6 | TEAM | **Approvals** | `ClipboardCheck` | `/timesheets?view=approvals` | same audience as row 5 | SUBMITTED weeks awaiting me; hidden at 0 |

No section is collapsed by default. No FAVORITES here (favorites are a Work-hub concept). `/timesheets?view=team` keeps the **Timesheets** row active: Team is a view on the page, not a row.

---

## 3. AI hub (`ai`): owned by ai-automation

`defaultHref: /sidekick`. Header "+" is a single action, so it fires directly: **New chat** → `/sidekick?new=1`. Search field: an Owner or Admin sees 11 fixed rows (so it appears at their second chat); a Member sees 9 (so it appears at their fourth).

| # | Section | Label | Icon | href | `match` | Gating | Count / dot | Collapsed |
|---|---|---|---|---|---|---|---|---|
| 1 | (personal) | **Ask AI** | `Sparkles` | `/sidekick` | prefix | `app: ai`, every Member; never a Guest | none | n/a |
| 2 | (personal) | **Agents** | `Bot` | `/agents` | prefix | `app: ai` | enabled agents; hidden at 0 | n/a |
| 3 | CHATS | one row per chat session, pinned first then newest | `MessageSquare` (`Pin` when pinned) | `/sidekick?session=<id>` | exact on the param | `app: ai` | none | no |
| 3z | CHATS | **See all chats** (ghost row, 13/500) | none | `/sidekick?view=all` | exact | rendered only past 15 chats | none | n/a |
| 4 | AUTOMATION | **Workflows** | `Workflow` | `/automation/workflows` | prefix | `app: automation`, every Member | active workflows; hidden at 0 | no |
| 5 | AUTOMATION | **Templates** | `LayoutTemplate` | `/automation/templates` | prefix | `app: automation` | none | no |
| 6 | AUTOMATION | **Logs** | `ScrollText` | `/automation/logs` | prefix | `app: automation` | `Dots unread` when a run failed in the last 24h | no |
| 7 | AUTOMATION | **Health** | `Activity` | `/automation/health` | prefix | `app: automation` | none | no |
| 8 | AUTOMATION | **Usage** | `GaugeCircle` | `/automation/usage` | prefix | `app: automation` | none | no |
| 9 | AUTOMATION | **Connections** | `Cable` | `/automation/connections` | prefix | `app: automation` **and** Owner or Admin (`settings.manageIntegrations`) | none | no |
| 10 | APPS | **Marketplace** | `ShoppingBag` | `/store` | prefix | `app: store`, every Member browses | none | yes |
| 11 | APPS | **Integrations** | `Plug` | `/integrations` | prefix | `app: integrations`, every Member browses | none | yes |
| 12 | APPS | **Build apps** | `Hammer` | `/build` | prefix | `app: build`, Owner and Admin | none | yes |

Rows 10 to 12 are pages owned by tools-misc and rendered here. Section label is **APPS** (the hub owner owns its sidebar); the Build row's label is **Build apps** (settings-architecture §5.3 and the page owner both print it). Connections takes `Cable` so it does not share `Plug` with Integrations, and Build apps takes `Hammer` so it does not share `Wrench` with the Teams Tools row.

Chat row hover "…": Rename · Pin / Unpin · separator · Archive (destructive ghost). Section 3 `emptyLine` "No chats yet"; error line "Couldn't load chats · Try again". All four live numbers come from one `GET /api/ai/sidebar`; no poller. Collapse state `sidebar.collapsedSections[]` keyed `ai.chats`, `ai.automation`, `ai.apps`.

This section replaces the in-content 280px session rail on `/sidekick`, which had no breakpoint.

---

## 4. Talk hub (`chat`): owned by talk

`defaultHref: /tlk`, or `/announcements` when the Talk module is off. The hub renders when the module is on **or** when the viewer can see the folded `announcements` app, so Announcements never becomes unreachable. Header "+": **New message** (every Member and any Guest, whose picker lists only people sharing an object with them) · **New channel** (every Member, never a Guest) · **New announcement** (Owner, Admin, People team, or Full access on any Space). The "+" itself does not render when none of the three applies.

| # | Section | Row | Icon | href | Who sees it | Badge |
|---|---|---|---|---|---|---|
| 1 | (none) | **Unread** | `Inbox` | `/tlk` | every Member; Guests holding a channel | conversations with unread |
| 2 | (none) | **Threads** | `MessagesSquare` | `/tlk?view=threads` | same | threads with unread replies |
| 3 | (none) | **Mentions** | `AtSign` | `/tlk?view=mentions` | same | unread mentions |
| 4 | (none) | **Announcements** | `Megaphone` | `/announcements` | every Member **and** `app: announcements`; never a Guest | announcements awaiting my acknowledgment |
| 5+ | STARRED | starred channels, groups and DMs, by name | `Hash` / `EntityTile` with `Users` / 20px avatar with a presence dot | `/tlk/[id]` | members | as below |
| | CHANNELS | one row per channel I am in, `#general` first then by name | `Hash`; a 16px `Lock` on private channels | `/tlk/[id]` | members | unread: label 15/500 + 6px `Dots unread`; unread mentions: the count instead; live call: 16px `Phone` + `Dots live` + participants |
| | CHANNELS | **Browse channels** (ghost row, 13/500) | `Compass` | opens the Browse channels dialog | every Member; never a Guest | last row of the section |
| | DIRECT MESSAGES | one row per DM or group, newest activity first, closed rows omitted | 20px avatar with an 8px presence dot; groups `EntityTile` with `Users` | `/tlk/[id]` | members | unread label 15/500 + count; live call as above |

Row "…": **Open** · **Start call** · **Star / Remove star** · **Notifications ▸** (All messages · Mentions only · Muted) · separator · **Close** (DMs, "History is kept") / **Leave channel** / **Leave group** (destructive ghost; never on `#general`). Rows are single line: the message preview is gone.

Empty sidebar: CHANNELS shows `#general` (which always exists); DIRECT MESSAGES shows one quiet line "No direct messages yet". No dashed buttons, no hero card.

**With the Talk module off**, the sidebar renders the Announcements row alone: no Unread, Threads, Mentions, STARRED, CHANNELS or DIRECT MESSAGES, and no message or channel entries in the "+".

Section collapse is per-device ephemera in `workwrk:talk:sections` (the one declared exception to the preferences rule).

---

## 5. Teams hub (`teams`): owned by teams-people

`defaultHref: /people` (one URL for everyone: the Directory is the one Teams page every Member holds, so the pill can never land on a locked page). Guests never see this hub at all.

Header "+" (`TeamsCreateMenu`, 288px): **Invite person** → `/settings/members?invite=1` (when `can(viewer, "invite_member", org)`) · **New job title** → `/people/roles?new=1` (Owner, Admin, People team) · **New department** → `/people/departments?new=1` (Owner, Admin) · **New KRA** → `/kra-kpi?new=kra` and **New KPI** → `/kra-kpi?new=kpi` (Owner, Admin, People team) · **Start review cycle** → `/reviews?new=1` (anyone with reports, People team, Admin) · **Give kudos** → `/kudos?new=1` (every Member). A section with no renderable row is not rendered.

Search field: a manager or Admin sees all 20 rows and gets it; a plain Member sees 10 and does not.

| # | Section | Label | Icon | href | Gating | Count / badge | Owner |
|---|---|---|---|---|---|---|---|
| 1 | (personal) | **My profile** | `CircleUser` | `/people/me` | every Member | none | teams-people |
| 2 | (personal) | **My team** | `Users` | `/team` | `app: team`: anyone with reports (solid or dotted, any depth); People team, Owner, Admin | items awaiting the viewer (weekly reviews + KPI sign-offs); hidden at 0 | teams-people |
| 3 | (personal) | **Workload** | `Scale` | `/team/workload` | `app: workload`, same rule as row 2 | none | teams-people |
| 4 | PEOPLE | **Directory** | `BookUser` | `/people` | every Member | none | teams-people |
| 5 | PEOPLE | **Org chart** | `Network` | `/organization` | every Member | none | teams-people |
| 6 | PEOPLE | **Departments** | `Building2` | `/people/departments` | every Member reads; Owner and Admin write | none | teams-people |
| 7 | PEOPLE | **Job titles** | `Briefcase` | `/people/roles` | every Member reads; Owner, Admin, People team write | none | teams-people |
| 8 | PEOPLE | **Skills** | `Zap` | `/people/skills` | every Member | none | teams-people |
| 9 | ALIGNMENT | **KRAs & KPIs** | `Gauge` | `/kra-kpi` | `app: kra-kpi`: every Member reads; Owner, Admin, People team edit | none | goals |
| 10 | ALIGNMENT | **Alignment** | `Target` | `/team/alignment` (also active on `/team/rollup`) | `app: alignment`: anyone with reports, People team, Owner, Admin | none | goals |
| 11 | ALIGNMENT | **KPI reviews** | `ClipboardCheck` | `/team/kpi-reviews` | `app: kpi-reviews`, same rule as row 10 | KPI numbers awaiting my approval this month; hidden at 0 | goals |
| 12 | PERFORMANCE | **Weekly reviews** | `CalendarCheck` | `/team/reviews` | `app: weekly-reviews`: anyone with reports, People team, Owner, Admin | weekly reviews awaiting my decision; hidden at 0 | teams-performance |
| 13 | PERFORMANCE | **Review cycles** | `ClipboardList` | `/reviews` | `app: reviews`: anyone with reports, People team, Owner, Admin | review forms awaiting me; hidden at 0 | teams-performance |
| 14 | PERFORMANCE | **Talent (9-box)** | `Grid3x3` | `/talent` | `app: talent`, same rule | none | teams-performance |
| 15 | PERFORMANCE | **Analytics** | `BarChart3` | `/analytics` | `app: analytics`: anyone with reports over their chain, People team, Admin | none | page: work-home; row: teams-people |
| 16 | CULTURE | **Kudos** | `Heart` | `/kudos` | `app: kudos`, every Member. Guests never | none | teams-performance |
| 17 | CULTURE | **Candor** | `MessageSquare` | `/candor` | `app: candor`: anyone with reports, People team, Admin, plus any Member invited to a session | open sessions I have not answered; hidden at 0 | teams-performance |
| 18 | CULTURE | **Surveys** | `ListChecks` | `/surveys` | `app: surveys`: Admin and People team (create, results); every **targeted** Member (respond) | open surveys I have not answered; hidden at 0 | teams-performance |
| 19 | RESOURCING | **Tools** | `Wrench` | `/tools` | `app: tools`, every Member (the tools shared with them) | none | tools-misc |
| 20 | RESOURCING | **Assets** | `Boxes` | `/assets` | `app: assets`: anyone with reports, People team, Admin. A Member without reports has no row; their own kit is the Assets tab of My profile | none | tools-misc |

RESOURCING is collapsed by default when both its rows are empty for the viewer. PERFORMANCE and RESOURCING collapse entirely for a plain Member; ALIGNMENT renders for every Member on row 9 alone; CULTURE renders for every Member on Kudos alone, which is the change that finally gives employees a door to the culture rituals.

**A plain Member sees ten rows**: 1, 4, 5, 6, 7, 8, 9, 16, 18 (when targeted), 19. **An Agent sees the same** and never rows 2, 3, 10 to 15 or 20, because every one of those needs reports, the People team or Admin and an Agent can be none of those.

Two icon tie-breaks the hub owner settled: row 3 takes `Scale` so it is not mistaken for row 9's `Gauge`; row 12 takes `CalendarCheck` so it is not mistaken for row 11's `ClipboardCheck`.

---

## 6. Docs hub (`docs`): owned by docs-knowledge; the PROCESS section by process

`defaultHref: /docs`. Header "+": **New doc** · **New canvas** · **Upload file** · **Paste a transcript** (→ `/notetaker`) · separator · **New SOP** (the kind chooser; every Member, Agents included) · **New policy** (Owner, Admin, People team) · **New contract** (Owner, Admin, People team). Guests never see this menu. Search field appears once the tree exceeds 12 rows; it filters the personal block, FAVORITES, CONTENT and the DOCS tree, and **never** the PROCESS rows.

| # | Section | Label | Icon | href | Gating | Count | Notes |
|---|---|---|---|---|---|---|---|
| 1 | (personal) | **All docs** | `FileText` | `/docs` | `app: docs`, every Member; a Guest only when a doc is shared | none | `match: "exact"` |
| 2 | (personal) | **Recent** | `Clock` | `/docs?view=recent` | as above | none | opened in the last 30 days |
| 3 | (personal) | **Mine** | `User` | `/docs?view=my` | as above | docs owned by the viewer | |
| 4 | (personal) | **Shared with me** | `Users` | `/docs?view=shared` | as above | count | access via a direct or group share, never ownership or Everyone |
| 5 | FAVORITES | one row per starred Doc / Canvas / File | the doc emoji or `FileText` / `Frame` / `Folder` | `/docs/[id]`, `/canvas/[id]`, `/files?file=[id]` | the object's own `can(view)` | none | renders only when non-empty; hover "…": Remove from favorites, Copy link |
| 6 | CONTENT | **Canvases** | `Frame` | `/canvas` | `app: docs` | none | |
| 7 | CONTENT | **Files** | `Folder` | `/files` | `app: library` | none | chevron on hover expands the drive-folder tree (rows 36, indent 20, file count 12/500). Active row = the folder in `?folder=`. Row "…": Rename · New folder inside · Share · Move to Trash (Full only; never Agents). Expansion in `sidebar.docsFoldersOpen` |
| 8 | CONTENT | **Notetaker** | `Mic` | `/notetaker` | `app: clips` **and** the AI module on | none | one label; Clips, All Clips, My Clips and AI Notetaker retire |
| 9 | PROCESS | **SOPs** | `ScrollText` | `/sops` | every Member; Guests never | none | process unit |
| 10 | PROCESS | **My SOPs** | `ListChecks` | `/sops/my-sops` | every Member; a Guest with at least one assignment | open assignments (to do + overdue) | process unit |
| 11 | PROCESS | **Run history** | `Workflow` | `/process-runs` | every Member | none | the page scopes to "My runs" for people without reports |
| 12 | PROCESS | **SOP compliance** | `ShieldCheck` | `/sops/compliance` | anyone with reports, People team, Owner, Admin | none | |
| 13 | PROCESS | **Policies** | `BookOpenCheck` | `/policies` | every Member | policies awaiting my acknowledgement | |
| 14 | PROCESS | **Policy compliance** | `BarChart3` | `/policies/compliance` | anyone with reports, People team, Owner, Admin | none | |
| 15 | PROCESS | **Contracts** | `FileSignature` | `/agreements` | Owner, Admin, People team | none | a Member who is a party reaches their own from `/people/me` and the signing email |
| 16 | PROCESS | **Contract templates** | `LayoutTemplate` | `/agreements?view=templates` | Owner, Admin, People team | none | |
| 17 | DOCS | the doc tree: root docs the viewer can read, expandable to sub-docs | the doc emoji in a 20px slot, else `FileText` | `/docs/[id]` | per doc | sub-doc count on hover only | sorted by title, indent 20 per level, max depth 6 rendered; collapse state `sidebar.docsTreeOpen`. Hover "…" is the doc row menu ("New doc inside" lives inside it). Last row: "+ New doc" ghost |
| | *1px `--os-line` rule* | | | | | | |
| 18 | (no label) | **Trash** | `Trash2` | `/trash?type=doc` | `app: trash`, every Member; Guests never | none | the Work hub's one `/trash`, pre-filtered |

PROCESS renders only the rows the viewer passes and collapses entirely when that is none (a Guest with no SOP assignment sees no PROCESS label at all). One PROCESS section, not the five the design system sketched: three section labels that repeat their own row labels ("SOPS" over "SOPs") would break the one-label-per-destination rule.

There is **no "Templates" row in this sidebar**: `/templates` lives in the Work hub. The Docs header "+" reaches doc templates through "Browse templates" → `/templates?kind=doc`.

Deleted from today's sidebar: the "Popular Wikis" stub card, the "Favorites: Star a Doc" empty card, "Library, all", "Private", "Meeting Notes", "Archived", the hover "+" on tree rows, and the `EmptyCard` component.

---

## 7. Tables hub (`tables`): owned by tables-forms

`defaultHref: /tables` (`/forms` while the spreadsheets module is off). **Founder decision D15 made Forms core**, which overturns the original "whole hub is gated" wording. As built in Phase 5: with the module off, the rail hub **stays** because Forms lives in it (rail-apps `MODULE_HUB_SURVIVES_ON`), its default link falls back to `/forms` (route-hub `hubDefaultHref`), rows 1 and 4 (All tables, TABLES) and the "+" rows New table and Import a CSV… are hidden (apps-catalog `requiredModules: ["tables"]`), and `/tables` and `/tables/[id]` render `ModuleOff` (Owners and Admins get the switch, Members "Ask an admin", Guests the shell 404). `/forms`, `/forms/[id]`, the responder and form search in the command palette work with the module off.

Header "+": **New table** · **New form** · separator · **Import a CSV…**. Guests never see it. Every create door calls the API first and lands on the new object's own URL with `?new=1`; `/tables?new=1` and `/forms?new=1` are not URLs this product produces.

| # | Section | Label | Icon | href | Gating | Count | Notes |
|---|---|---|---|---|---|---|---|
| 1 | (no label) | **All tables** | `LayoutGrid` | `/tables` | `app: tables`, every Member; a Guest only when a table is shared | none | active on `/tables` |
| 2 | (no label) | **All forms** | `ClipboardList` | `/forms` | `app: forms`, every Member; a Guest only when a form's anchor is shared | none | active on `/forms` with no or unknown `?view` |
| 3 | FAVORITES | one row per starred Table or Form | `Table2` / `ClipboardList` | `/tables/[id]`, `/forms/[id]` | the object's own `can(view)` | none | renders only when non-empty; most recently starred first; hover "…": Remove from favorites, Copy link |
| 4 | TABLES | one row per readable table, `updatedAt` descending | `Table2` | `/tables/[id]` | per table | none | hover **and focus** reveal one "…" = the table row menu. Last row: "+ New table" ghost. Collapses past 20 rows into "Show all (N)" → `/tables` |
| 5 | FORMS | one row per readable form, `updatedAt` descending | `ClipboardList` | `/forms/[id]` | per form | responses when > 0 | hover and focus reveal one "…" = the form row menu. Last row: "+ New form" ghost. Collapses past 20 rows into "Show all (N)" → `/forms` |

Search field appears once the tree exceeds 12 rows; placeholder "Search Tables…", filtering TABLES and FORMS in place.

**There is no Trash row in this sidebar.** `/trash` is the Work hub's one row. The two doors here are menu rows: the `/tables` toolbar "…" › **Trash** → `/trash?type=table` and the `/forms` toolbar "…" › **Trash** → `/trash?type=form`. Deleted rows *inside* a table stay in that table's own Data › Trash dialog and never enter app Trash.

Deleted from today's sidebar: the plain-text "Loading…" body (three skeleton rows replace it), the right-click-only Rename and Delete (now a visible "…"), the "New sheet" ghost row at the top, and the word "sheet" everywhere.

---

## 8. Settings hub (`settings`): the takeover, two doors

The rail and the navy top bar stay mounted; the hub sidebar and the content are replaced. A 48px takeover bar carries "← Back to app" (ghost, `ArrowLeft` + label) at the left and **nothing at the right** (no ✕: the design system wins on look). The top-bar breadcrumb reads `Settings › Workspace settings › {Page}` or `{First name} › My settings › {Page}`.

Where the rail pill lands, per viewer: Owner and Admin → `/settings`; a People team Member → `/settings/members`; Member, Agent and Guest → `/account/profile`.

**No "Customize Sidebar" footer in either door**, and no workspace switcher in either header (the takeover is already scoped to one workspace). Both headers carry one 36px filter input, "Find a setting", focused by `⌘/` and `⌘K`, which filters rows by label and registry keyword and lists matching **fields** beneath their page row as 32px secondary rows that deep-link to the field anchor.

### 8a. Workspace settings (`/settings/*`): owned by settings-workspace

Group labels are not collapsible (the list is 15 rows). A 16px `Lock` in `--os-ink-3` sits at the right of a row an Admin cannot open for want of a scope; the row still navigates and lands on the `AdminOnly` card. A lock is never a disabled row.

| # | Group | Label | Icon | href | Gate | Lock glyph when |
|---|---|---|---|---|---|---|
| 1 | (none) | **Overview** | `LayoutGrid` | `/settings` | Owner, Admin | never |
| 2 | WORKSPACE | **Identity & culture** | `Building2` | `/settings/identity` | Owner, Admin | never |
| 3 | WORKSPACE | **Locale & work week** | `Globe` | `/settings/locale` | Owner, Admin | never |
| 4 | WORKSPACE | **Apps & modules** | `Boxes` | `/settings/apps` | Owner, Admin | never |
| 5 | PEOPLE | **Members** | `Users` | `/settings/members` | Owner, Admin, People team (read + people fields) | never |
| 6 | PEOPLE | **Structure** | `Network` | `/settings/structure` | Owner, Admin, People team (read + job titles) | never |
| 7 | PEOPLE | **Access** | `ShieldCheck` | `/settings/access` | Owner, Admin, People team (read) | never |
| 8 | WORK | **Task system** | `Shapes` | `/settings/tasks` | Owner, Admin | never |
| 9 | WORK | **Scoring & reviews** | `BarChart3` | `/settings/scoring` | Owner, Admin, People team (read) | never |
| 10 | SECURITY & DATA | **Security** | `Shield` | `/settings/security` | Owner, or Admin with `security` | Admin without `security` |
| 11 | SECURITY & DATA | **Data** | `Database` | `/settings/data` | Owner, Admin (Retention purge and Danger rows: Owner) | never |
| 12 | SECURITY & DATA | **Audit log** | `FileCheck` | `/settings/audit` | Owner, Admin | never |
| 13 | SECURITY & DATA | **API & webhooks** | `Key` | `/settings/api` | Owner, or Admin with `security` | Admin without `security` |
| 14 | BILLING | **Plan & billing** | `CreditCard` | `/settings/billing` | Owner, or Admin with `billing` | Admin without `billing` |
| 15 | (none, last) | **All settings** | `List` | `/settings/all` | Owner, Admin | never |

The **People team** sees rows 5, 6, 7 and 9 only, with the PEOPLE and WORK labels, plus a first row "My settings" → `/account/profile` so their list is never a four-row orphan. Nobody else ever sees this sidebar: a Member, Agent or Guest on a `/settings/*` URL sees the **My settings** sidebar beside My settings › Profile with the Ask-an-admin strip above it, at the URL they typed.

The Data row declares `alsoActiveOn: ["/imports"]` until `/imports` 308s into `/settings/data?tab=import`.

### 8b. My settings (`/account/*`): owned by account-auth

Flat, no group labels.

| # | Label | Icon | href | Gating | Badge |
|---|---|---|---|---|---|
| 1 | **Profile** | `CircleUser` | `/account/profile` | every signed-in person | none |
| 2 | **Preferences** | `SlidersHorizontal` | `/account/preferences` | every signed-in person | none |
| 3 | **Notifications** | `Bell` | `/account/notifications` | every signed-in person | a "Muted" chip 12/500 when `home.notifications.mutedUntil` is in the future |
| 4 | **Security** | `ShieldCheck` | `/account/security` | every signed-in person | a 6px `Dots unread` when the org requires two step verification for this person's role and they are not enrolled |
| 5 | **Calendar & connections** | `CalendarCheck` | `/account/connections` | every signed-in person | none |
| 6 | **Keyboard shortcuts** | `Keyboard` | `/account/shortcuts` | every signed-in person | none |
| 7 | **All settings** | `List` | `/account/all` | every signed-in person | none |
| | *1px `--os-line` separator* | | | | |
| 8 | **Workspace settings** | `Building2` | `/settings` | Owner and Admin only | none |

Below 900px, in both doors, the 264px list is replaced by a 36px "Pages" select in the takeover bar, between "← Back to app" and the content, listing the same rows in the same order with the group labels as `optgroup`s and lock glyphs as a trailing "· Owners only".

---

## 9. Staff console sidebar (`admin.workwrk.com`): owned by admin-backoffice

Not a hub: a **reduced shell** with no rail. The 264px sidebar and the 48px navy top bar carry everything. Header (56px): the four-dot logo mark (28px, brand hexes, the one saturated object here) then "WorkwrK Staff" 15/500. Not a switcher, not clickable. No search (six rows never exceeds twelve), no create action, no footer.

| Section | Label | Icon | href | Gating | Count |
|---|---|---|---|---|---|
| (none) | **Overview** | `LayoutDashboard` | `/admin` | Platform staff | none |
| (none) | **Companies** | `Building2` | `/admin/companies` | Platform staff | none |
| (none) | **Analytics** | `BarChart3` | `/admin/analytics` | Platform staff | none |
| (none) | **AppSumo codes** | `KeyRound` | `/admin/appsumo` | Platform staff | none |
| CONSOLE | **Staff** | `ShieldCheck` | `/admin/staff` | Platform staff | none |
| CONSOLE | **Staff activity** | `ScrollText` | `/admin/audit` | Platform staff | none |

Both sections are always expanded and carry no chevron (a control with nothing to do). No counts on any row: a number only staff can act on belongs on Overview's "Needs attention" card, not as a badge that nags. The active row is longest-prefix segment match, so `/admin/companies/<id>` highlights **Companies** (today's exact equality highlights nothing).

---

## 10. The More launcher: what replaced it

The rail's ⊞ "More" tile (`apps-more-popover.tsx`) is **deleted** with the component. It excluded every folded app from its own list (`rail-apps.ts:156`), which is why 17 apps were unreachable. Its job now lives in two places, and both list the same set:

1. **Search (⌘K) › the "Apps" group**, which lists **every hub and every folded app the viewer may open**, computed from `visibleApps(viewer)`. Nothing appears there that the viewer cannot open, and nothing they can open is missing.
2. **A hub-sidebar row for every folded app.** This is the structural fix: a folded app is a section or a row inside its hub, never a separate sidebar, and never launcher-only.

**Apps group contents, in rail order** (each row shows the hub as its second line, so "Kudos · Teams"):

Work · Planner · AI · Talk · Teams · Docs · Tables · Settings · Goals (Work) · Templates (Work) · Trash (Work) · Timesheets (Planner) · Meetings (Planner) · Clock in/out (Planner) · Workflows (AI) · Marketplace (AI) · Integrations (AI) · Build apps (AI) · Announcements (Talk) · Review cycles (Teams) · Weekly reviews (Teams) · Talent (9-box) (Teams) · Analytics (Teams) · Kudos (Teams) · Candor (Teams) · Surveys (Teams) · Tools (Teams) · Assets (Teams) · SOPs (Docs) · Policies (Docs) · Contracts (Docs) · Notetaker (Docs) · Files (Docs) · Canvases (Docs) · Forms (Tables).

The palette's other groups are unchanged in kind: JUMP TO (recent and favourite objects, "My work", "Inbox"), CREATE (Task, Doc, List, Reminder, Notepad, Voice note, then the AI entries when entitled), SETTINGS (two entries, "My settings" for everyone and "Workspace settings" for Owner and Admin, plus the registry rows), and "Ask AI about…". The palette filters apps through `visibleApps`, so a hidden or floored app never appears.

---

## 11. Coverage check: every folded app and rail-consolidation destination

`FOLDED_INTO_HUB` holds exactly **19** keys. Each one, and its row:

| Key | Hub | Row |
|---|---|---|
| `goals` | Work | Goals group (My goals · Team goals · Company goals · My KRAs & KPIs) |
| `trash` | Work | Trash (personal block tail) |
| `timesheets` | Planner | Timesheets, plus Approvals in the TEAM section |
| `automation` | AI | AUTOMATION section: Workflows · Templates · Logs · Health · Usage · Connections |
| `build` | AI | APPS › Build apps |
| `store` | AI | APPS › Marketplace |
| `announcements` | Talk | Announcements (row 4, present even when the module is off) |
| `reviews` | Teams | PERFORMANCE › Review cycles |
| `candor` | Teams | CULTURE › Candor |
| `kudos` | Teams | CULTURE › Kudos |
| `surveys` | Teams | CULTURE › Surveys |
| `tools` | Teams | RESOURCING › Tools |
| `assets` | Teams | RESOURCING › Assets |
| `library` | Docs | the key survives only as the gate for **Files** (CONTENT row 7); the Library page and sidebar are gone |
| `clips` | Docs | CONTENT › Notetaker |
| `sops` | Docs | PROCESS › SOPs (+ My SOPs, Run history, SOP compliance) |
| `policies` | Docs | PROCESS › Policies (+ Policy compliance) |
| `agreements` | Docs | PROCESS › Contracts (+ Contract templates) |
| `forms` | Tables | All forms + the FORMS section |

Four more destinations behave like folded apps but are routes rather than catalog keys, so they are **not** counted against the 19: `/talent` (Teams row 14), `/analytics` (Teams row 15), `/team/rollup` (the Sub-teams view of Teams row 10) and `/integrations` (AI row 11).

Every destination the task list names, confirmed present:

| Destination | Where |
|---|---|
| Talent 9-box | Teams row 14 |
| SOP run history | Docs PROCESS row 11 (`/process-runs`) |
| SOP compliance | Docs PROCESS row 12 |
| Policy compliance | Docs PROCESS row 14 |
| Contract templates | Docs PROCESS row 16 |
| Contract trash | Work › Trash, reached at `/trash?type=contract` |
| Automation health / usage / logs | AI rows 6, 7, 8 |
| All Goals views | Work rows 5a to 5d |
| My Clips | Docs CONTENT row 8, relabelled **Notetaker** |
| Library | retired as a word; its four tabs are Docs (row 1), Canvases (row 6), Files (row 7) and the Tables hub |
| My Forms | Tables row 2 (**All forms**) plus the FORMS section; the `?mine=1` filter the page never read is gone |
| Announcements | Talk row 4 |
| Timesheets | Planner row 3, plus Approvals row 6 |
| Review cycles | Teams row 13 |
| Culture | Teams CULTURE section (Kudos, Candor, Surveys) |
| Tools | Teams row 19 |
| Assets | Teams row 20 |
| Build | AI row 12 (**Build apps**) |
| Store | AI row 10 (**Marketplace**) |
| Trash | Work personal block tail, one page at `/trash` |

Deleted sidebars, all of them unreachable code today: `LibrarySidebar`, `FormsSidebar`, `ClipsSidebar`, `GoalsSidebar`, `TimesheetsSidebar`, `SettingsSidebar`, `AiSidebar`'s dead rows and the `automation` `linksSidebar`. `AppEntry.matchPaths`, `findAppForPath`, `AppEntry.requiredAccess` and the persisted `activeAppKey` go with them.

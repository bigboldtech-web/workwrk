# Tools and folded utility apps spec

Unit: `tools-misc`. Covers the folded utility apps that no hub owns today: Tools, Assets, Build apps, Marketplace, Integrations, the internal Marketing module, Trash (by reference), and the dev loader preview.

Written against `design-system.md` (look), `access-model-spec.md` (access), `settings-architecture.md` (settings structure), `zoho-reference.md`, `critic-gaps.json`, `phase2-inputs.md`, `existing-direction.md`, `route-list.txt`, and the audit inventories `misc-apps.md` and `settings-pages.md`. Code read at `21a21623`.

One line: **nothing in this unit invents a surface; each page either does a real job with a real button, or it redirects to the place that does.**

---

## 0. Scope

### Routes covered (URL, file under `src/app`)

| URL | Page file today | Page file after | Disposition |
|---|---|---|---|
| `/tools` | `(dashboard)/tools/page.tsx`, `tools/layout.tsx` | same path, rebuilt; `layout.tsx` deleted | KEEP, re-parented to the **Teams** hub, RESOURCING section |
| `/assets` | `(dashboard)/assets/page.tsx`, `assets/layout.tsx`, `asset-form-dialog.tsx`, `assign-dialog.tsx`, `asset-row-menu.tsx`, `types.ts` | same path, rebuilt; `layout.tsx` deleted | KEEP, re-parented to the **Teams** hub, RESOURCING section |
| `/build` | `(dashboard)/build/page.tsx` | same path, rebuilt | KEEP as **Build apps**, re-parented to the **AI** hub, APPS section (row owned by `spec-ai-automation.md` §1 row 11) |
| `/build/[slug]` | `(dashboard)/build/[slug]/page.tsx` | same path, rebuilt | KEEP, detail route of `/build` |
| `/store` | `(dashboard)/store/page.tsx` | same path, rebuilt on the real module registry | KEEP as **Marketplace**, AI hub, APPS section (row owned by `spec-ai-automation.md` §1 row 10). The path stays `/store`; see §1 Naming canon |
| `/integrations` | `(dashboard)/integrations/page.tsx`, `integrations/layout.tsx` | same path, rebuilt; `layout.tsx` deleted | KEEP as **Integrations**, AI hub, APPS section (row owned by `spec-ai-automation.md` §1). The page content is this unit's §2.6; the earlier 308 to `/automation/connections` is withdrawn, for the reason under the Routes REMOVED table below |
| `/marketing` | `(dashboard)/marketing/page.tsx` | `(dashboard)/marketing/[[...slug]]/page.tsx` (one redirect resolver) | REMOVED, redirect (below) |
| `/marketing/[id]` | `(dashboard)/marketing/[id]/page.tsx` | folded into the resolver | REMOVED, redirect |
| `/marketing/campaigns` | `(dashboard)/marketing/campaigns/page.tsx` | folded into the resolver | REMOVED, redirect |
| `/marketing/content` | `(dashboard)/marketing/content/page.tsx` | folded into the resolver | REMOVED, redirect |
| `/marketing/events` | `(dashboard)/marketing/events/page.tsx` | folded into the resolver | REMOVED, redirect |
| `/trash` | `(dashboard)/trash/page.tsx` | same path, rebuilt by the spaces-lists unit | KEEP, **owned by spaces-lists §2 `/trash`**; this unit only feeds it (§2.12) |
| `/loader-preview` | `app/loader-preview/page.tsx` | none | REMOVED, deleted (agrees with spec-shell §2.7) |

Discovered in the code and belonging here (not in the brief's list): `src/components/products/catalog-stub-page.tsx` (the `/studio` dead end reachable from Marketplace), `src/components/layout/os/catalog.ts`'s `getAllModules()` fixture set and `PEOPLE` avatar fixtures (consumed by `/store` and `/marketing`), `src/lib/dept-home.ts` (routes to `/crm`, `/itsm`, `/legal`), and the product-catalog entries `workwrk-assets` and `workwrk-campaigns`. All four are deleted here (§4).

Audited in `misc-apps.md` but owned elsewhere, listed so nobody drops them: `/kudos`, `/candor*`, `/surveys*` (teams-performance unit), `/ideas`, `/analytics`, `/me/*`, `/dashboard`, `/docs/trash` (work-home, teams-people and docs units), `/imports` (settings unit, Data › Import), `/meetings*` (planner unit), `/settings/integrations` (settings unit, 308 to `/settings/api`).

### Routes REMOVED / REDIRECTED / MERGED

| Route | Target | Reason |
|---|---|---|
| `/marketing` | 308 → `/spaces/{slug}` of the Space the importer created, found by the marker `Space.metadata.legacySource = "marketing"`; before the import has run, 307 → `/settings/data?tab=import&legacy=marketing` for Owner and Admin, and the in-shell 404 for everyone else | Marketing was removed from the product scope on 2026-06-03 (PPMS: People and Project Management; CRM, Marketing, Helpdesk, ITSM and Finance left the rail). The five pages have no nav entry at all today (misc-apps 1.19 to 1.23), cannot set budget, spend, channel, dates, type or capacity from any screen (so every scoreboard reads zero forever), gate on nothing but a session, and collide by name with the public `(marketing)` route group. The job becomes a Space built from Lists, which is the stated Lego rule. |
| `/marketing/campaigns` | same resolver → the migrated Space's **Campaigns** List (`/boards/{slug}`) | as above |
| `/marketing/content` | same resolver → the migrated Space's **Content** List | as above |
| `/marketing/events` | same resolver → the migrated Space's **Events** List | as above |
| `/marketing/[id]` | same resolver → `/item/{Campaign.customFields.migratedItemId}` when migrated, else as `/marketing` | as above |
| `/loader-preview` | none; deleted | A public dev gallery. Loader states are specified in design-system §5.15 and §5.16; a gallery, if wanted, is a Storybook story, not a route users can reach in production. spec-shell §0 and §2.7 already delete it; this spec agrees rather than re-litigating. |
| `/trash` | not removed; **merged into by others** | One trash for the whole app (critic #3). `/docs/trash` (docs unit), the Contracts "Trash" view, the Docs "Archived" view and this unit's Tool, Asset and Build-app deletes all land on `/trash` (§2.12). |

Nothing else in this unit is removed. Every destination that exists today is reachable after the change: Tools, Assets, Build apps, Marketplace, Integrations and Trash all gain a permanent hub-sidebar row (they had none or an admin-only one); Marketing's data is reachable as a Space, as a CSV export, and as a 308 from its old URLs.

**`/integrations` is kept, and the earlier 308 is withdrawn.** Two specs had disposed of this route in opposite directions, each believing it was deferring to the other: this spec 308'd it to `/automation/connections` saying the AI spec won, while `spec-ai-automation.md` kept it and recorded that its own deletion was withdrawn. The route survives, on access grounds. `access-model-spec.md` §5.2.1 carries an `integrations` row in the AI hub reading "every Member browses the catalogue"; `/automation/connections` is Owner and Admin only, so a 308 would take a destination away from every Member and give them a denial in its place. `settings-architecture.md` §5.4 and §7.1 also name `/integrations` as the surviving marketplace for other people's tools. Ownership splits cleanly and neither unit owns the whole thing: the **sidebar row is the AI unit's** (AI hub, APPS section, `Plug`, `spec-ai-automation.md` §1), the **page is this unit's** (§2.6). The two pages do not repeat each other's rows: Connections is where automations send things, and the four providers it faked (WhatsApp, Gmail, Google Calendar, Slack) leave it and become real **Request this** cards on `/integrations` (§2.6).

### Audit inventories consulted

`misc-apps.md` (primary), `settings-pages.md`, plus the decided docs `design-system.md`, `access-model-spec.md`, `settings-architecture.md`, `zoho-reference.md`, `phase2-inputs.md`, `existing-direction.md`, `critic-gaps.json`, `route-list.txt`, and the sibling specs `spec-shell.md` (ROUTE_HUB, breakpoints, profile menu), `spec-teams-people.md` (Teams sidebar rows 19 and 20), `spec-spaces-lists.md` (`/trash`, Template Center), `spec-ai-automation.md` (AI hub sidebar APPS rows, `/automation/connections`), `spec-settings-workspace.md` (Apps and modules, the module card), `spec-planner.md` (`/account/connections`).

### Audit issue IDs this unit resolves

From `misc-apps.md` §3:

- High **#3** (Marketplace Install buttons do nothing; catalog and "installed" set are demo fixtures), **#4** (the `OsTitleBar` dead Ask AI / Share / Invite trio, on the seven pages in this unit), **#5** (orphaned routes, the `/marketing/*` half), **#7** (cosmetic controls that 403, the Tools and Assets half).
- Medium **#9** (access-gate inconsistency for Tools, Assets, Build, Store, Integrations), **#10** (Build "Generate app" only toasts; "Show archived" is dead), **#11** (Marketing suite has no edit path anywhere), **#12** (Tools: no category, description, delete or share control; three labels; chained prompt dialogs), **#13** (fake `PEOPLE` avatar fixtures, the Store and Marketing instances), **#14** (empty and error CTAs hidden, the Build, Tools, Assets and Marketing instances), **#16** (multiple trash and archive surfaces: `/trash`, `/docs/trash`, the Docs "Archived" view, the Contracts "Trash" view; this unit resolves its own half in §2.12 and the rest is resolved jointly with spaces-lists and docs), **#17** (three overlapping integration doors), **#18** (`/build/[slug]` dynamic Tailwind classes that never compile), **#19** is the settings unit's.
- Low **#21** (loader inconsistency: `ValueLoader` vs `Loader2` vs plain text, on every page here), **#22** (currency hard-coded USD on Assets and `₹` on Marketing), **#23** (label drift: Tools and SaaS / Tools and subscriptions / Tools; Assets / Assets and equipment / Asset register; Marketplace / Store), **#24** (`CatalogStubPage` links to the missing `/studio`, violet palette, disabled "Notify me"), **#27** (the Assets page injects a `<style>` block to override shared CSS).
- `misc-apps.md` §5 access table rows for `/integrations`, `/store`, `/build`, `/build/[slug]`, `/tools`, `/assets`, `/marketing/*`, and the `/trash` row's "employees hit 403" half.
- `misc-apps.md` §6 "should be configurable but isn't": org currency, Tools categories, who may view credentials, Assets types and warranty window, Store install state.

From `settings-pages.md`: **1.17** (`/settings/integrations` is a hub of stubs whose "App marketplace" card points at the wrong page) is resolved jointly with the settings unit, which ships the 308; this unit fixes what the two destinations say.

From `critic-gaps.json` topSystemicIssues: **#1** (nav decoupled from the URL, folded apps unreachable), **#2** (fabricated and inert chrome), **#3** (duplicate surfaces: three Integrations doors, Marketplace vs Settings › Modules, four trash surfaces), **#4** (fragmented access), **#5** (no back convention), **#6** (five visual systems), **#7** (settings that do nothing: rail floors, store install state, org currency), **#9** (naming drift), **#10** (desktop-only), **#11** (errors swallowed, no Retry), **#13** (currency and locale per surface), **#14** (dead code and stale registries), **#15** (copy hygiene, "Coming soon" rows rendered as controls).

---

## 1. Unit-level rules

### Hub and sidebar

The rail hub and the active sidebar row are derived from the URL on every render, never from a stored `activeAppKey` (critic #1). The shell unit owns `ROUTE_HUB`; this unit registers these prefixes:

| Route | Rail hub active | Secondary sidebar | Active row |
|---|---|---|---|
| `/tools` | **Teams** | Teams hub sidebar (teams-people unit) | RESOURCING › **Tools** (row 19) |
| `/assets` | **Teams** | Teams hub sidebar | RESOURCING › **Assets** (row 20) |
| `/build`, `/build/[slug]` | **AI** | AI hub sidebar (AI and automation unit) | APPS › **Build apps** (spec-ai-automation §1 row 11) |
| `/store` | **AI** | AI hub sidebar | APPS › **Marketplace** (spec-ai-automation §1 row 10) |
| `/integrations` | **AI** | AI hub sidebar | APPS › **Integrations** (spec-ai-automation §1) |
| `/trash` | **Work** | Work hub sidebar (work-home unit) | personal group › **Trash** (spaces-lists §1) |
| `/marketing/*` | never rendered (redirect or 404 before paint) | n/a | n/a |

Cross-unit deltas this requires:

1. spec-shell §1.1 `ROUTE_HUB`: delete the `/marketing` prefix from the `home` row (its disposition is now decided). `/build`, `/store` and `/integrations` stay under `ai` and are registered by `spec-ai-automation.md` §1, not here, so the two specs cannot register the same prefix twice; `/tools`, `/assets` stay under `teams`; `/trash` stays under `home`.
2. `SettingsSidebar` (`apps-catalog.tsx:1208-1229`) is deleted by the settings unit; its five "Operations" rows are exactly the rows re-parented here and in spaces-lists. Nothing in this unit links to `/settings` as a way back; the top-bar breadcrumb is the way back (settings-architecture §2.4).
3. `AppEntry.matchPaths`, `findAppForPath` and `AppEntry.requiredAccess` are deleted by the shell and access units; the gating below is `can(viewer, "view", { type: "app", key })` through `visibleApps`, from the one `APP_RULES` table (access §5.2.1).

### Hub sidebar contents

This unit owns **no hub sidebar**. It contributes rows to two:

**Teams hub sidebar, RESOURCING section** (owned by `spec-teams-people.md` §1, rows 19 and 20; restated here so the two specs agree word for word):

| # | Section | Label | Icon | Href | Gating | Count | Collapsed by default |
|---|---|---|---|---|---|---|---|
| 19 | RESOURCING | Tools | `Wrench` | `/tools` | every Member (`app:tools`, access §5.2.1) | none | the section is collapsed when both rows are empty for the viewer |
| 20 | RESOURCING | Assets | `Boxes` | `/assets` | anyone with reports, the People team and Admin (`app:assets`, access §5.2.1). **A Member without reports does not get this row**; their own kit is on their profile's Assets tab (`/people/me`, teams-people §2) | none | same |

Row 20's gating is narrowed from an earlier draft that read "every Member". `access-model-spec.md` §5.2.1 `assets` reads "anyone with reports (their people's assets); People team and Admin (org). A Member without reports sees their own assets on `/people/me`, not here", and the access spec wins on access. The consequences are carried through the whole unit: the row is absent for a Member without reports, `/assets` has no "Mine" view, the page never renders a lone Member's own rows, and a Member without reports who types the URL gets the in-shell 404 (§1 Access). **Ask on the teams-people unit:** its §1 row 20 currently restates the old, wider gating and must be narrowed to match this line, so the two specs agree word for word (§4).

**AI hub sidebar, APPS section**: owned and rendered by `spec-ai-automation.md` §1. This unit contributes no sidebar rows of its own there and restates theirs only by reference:

| # | Section | Label | Icon | Href | Gating | Count | Collapsed by default | Owner |
|---|---|---|---|---|---|---|---|---|
| 10 | APPS | **Marketplace** | `ShoppingBag` | `/store` | every Member browses (`app:store`, access §5.2.1); the on and off switch needs Owner or Admin | none | yes | spec-ai-automation §1 |
| 11 | APPS | **Build apps** | `Hammer` | `/build` | Owner and Admin (`app:build`, access §5.2.1) | none | yes | spec-ai-automation §1 |
| 12 | APPS | **Integrations** | `Plug` | `/integrations` | every Member browses (`app:integrations`, access §5.2.1); connecting needs Owner or Admin | none | yes | spec-ai-automation §1 |

The **Connections** row (`/automation/connections`, `Cable`, Owner and Admin) sits in the AI sidebar's AUTOMATION section, not here. Three glyphs, three concepts, no reuse: `Plug` is Integrations, `Cable` is Connections, `Hammer` is Build apps.

**The section label is APPS, not "ADD ONS".** An earlier draft of this spec called it ADD ONS. The hub owner owns its own sidebar, `spec-ai-automation.md` §1 prints APPS, and every reference in this file now reads APPS.

**Two hand-offs to the AI unit** (both in §4, both one-line changes in their file):

1. **The icon.** `spec-ai-automation.md` §1 row 11 uses `Wrench` for Build apps. `Wrench` is already the Tools glyph in the Teams sidebar (teams-people §1 row 19), in the Tools row menus and in the Trash type filter, and design §5.14 allows one icon per concept app-wide. Build apps moves to `Hammer`, which that spec already uses elsewhere and which this spec, the Trash type filter and the empty-state family use for a built app. Tools keeps `Wrench` because two other specs already name it. Connections keeps `Cable` and Integrations keeps `Plug`, so no other row moves.
2. **The label.** The row label is **Build apps**, not "Build". `settings-architecture.md` §5.3 prints the footer link "Build apps (`/build`)", and a decided doc outranks a unit spec; the page owner prints the same word. See Naming canon below.

Row geometry, wherever these rows render, follows design §4.2 exactly: 36px, `.os-row`, `padding-inline: 12px`, 20px Lucide icon at 1.5px in `--os-ink-2`, label 15/400 `--os-ink`, hover `--os-surface-hov` radius 8, active `--os-side-pill` (N200) radius 8 with the label at 15/500 and the icon in `--os-ink`. No blue, no left bar, no icon scale.

**Folded-app row audiences: the access table wins, in every case.** `settings-architecture.md` §7.1a and `access-model-spec.md` §5.2.1 disagree on four rows, and the tie-break is not a judgement call: settings-architecture itself says its §7.1a table "is flagged to the access spec as the completion of its §5.2 table, which owns the final word". The four rows settle as follows, and every surface in this unit follows them without a local exception:

| Row | settings-architecture §7.1 / 7.1a said | An earlier draft elsewhere said | **Settled (access §5.2.1)** |
|---|---|---|---|
| **Tools** (`/tools`) | "Admin + People team" | | **every Member**, showing the tools shared with them. A Member with nothing shared gets the empty state, never a lock |
| **Assets** (`/assets`) | | teams-people draft: "every Member" | **anyone with reports, the People team and Admin.** A Member without reports has no row and no page; their own kit is on the **Assets** tab of My profile (`/people/me`) |
| **Marketplace** (`/store`) | "Owner and Admin only ... the earlier 'everyone for Store and Marketplace' is withdrawn" | | **every Member browses.** A Member gets a status line where the switch would be, not a disabled switch; the switch itself stays Owner and Admin |
| **Build apps** (`/build`) | "Owner and Admin only" | | **Owner and Admin only.** A Member gets the in-shell 404, **not** `<AppOff>`, because AppOff would confirm the app exists |

`Integrations` (`/integrations`) is the fifth row and the two docs agree on it: every Member browses, connecting needs Owner or Admin. The write actions on Marketplace, Build apps and Integrations all stay Owner and Admin. The footer text links on Settings › Apps and modules (settings §5.3) stay as they are, with the labels that page already uses.

### Naming canon

One label per destination, used in the sidebar row, the page title, the top-bar breadcrumb, the command palette, search results and every inbound link:

| Canon label | Destination | Replaces |
|---|---|---|
| **Tools** | `/tools` | "Tools and SaaS" (Settings sidebar `apps-catalog.tsx:1223`), "Tools and subscriptions" (catalog label), "Tools and credentials" (file header), "Tools" (page title) |
| **Assets** | `/assets` | "Assets" (Settings sidebar), "Assets and equipment" (catalog label), "Asset register" (page title), "Asset register, finance lens" (file header) |
| **Build apps** | `/build` | "Build" (page title and an earlier draft of this spec), "Vibe" (the "Built with Vibe" pill on `/build/[slug]`), "Studio" (the `CatalogStubPage` link target, which does not exist) |
| **Marketplace** | `/store` | "Store" (the route), "Marketplace" (Settings sidebar and the command palette), "Product Store" (`CatalogStubPage` back link), "App marketplace" (the `/settings/integrations` card, which pointed at `/integrations`) |
| **Integrations** | `/integrations`, the catalogue of other people's tools that every Member browses and can request | "Connect apps" (command palette), "Integrations marketplace" (file header), "App marketplace" (the `/settings/integrations` card). The page is this unit's §2.6; the sidebar row is `spec-ai-automation.md`'s |
| **Connections** | `/automation/connections`, where automations send things, today the webhook | "Integrations" as a name for this page, "Connectors", "Providers", "Calendar integrations" and "Calendar feeds" (the header link; the planner unit canonises the personal destination as "Calendar and connections"). The destination and its label are owned by `spec-ai-automation.md`; this unit only retires the labels its own pages used |
| **Login** | the `Tool.credentials` block | "creds", "shared creds", "credentials", "shared access" |
| **Trash** | `/trash` | "Trash" (org), "Trash" (notes, at `/docs/trash`), "Archived" (Docs view), "Trash" (Contracts view). One page, one label; the type filter separates them (spaces-lists §2) |

The word "install" leaves the product. A module is **turned on** or **turned off**; a connector is **connected**; an app you built is **published**. "Install" survives only in the API path `/api/products/installations`, which is not user-facing.

**Why "Build apps" and not "Build".** Three places already say "Build apps": the footer text link on Settings › Apps and modules (settings-architecture §5.3, which wins on settings structure), the AI hub sidebar row (spec-ai-automation §1 row 11), and the old Settings sidebar. Canonising "Build" would have cost two cross-unit renames to save one word; canonising "Build apps" costs nothing and leaves no retired label alive anywhere. Every surface in this unit follows it: the page title on `/build` reads "Build apps", the breadcrumb reads "AI › Build apps", `BackButton` on `/build/[slug]` is labelled "Build apps", and the command palette entry is "Build apps".

**Why `/store` keeps its path.** The canon label is Marketplace, the URL stays `/store`, and there is no redirect. A URL is not a label: no chrome shows it, `spec-ai-automation.md` §1 and §0 already register `/store` in the AI sidebar and in `ROUTE_HUB`, and every bookmark and shared link in the wild points at it. The sibling redirects (`/settings/modules`, `/settings/integrations`, `/me/mentions`) all exist because two pages merged into one, which is not the case here. Renaming the path is a one-line 308 in `next.config.ts` if the founder ever wants the URL to read like the label; it is not needed to close the naming-drift issue, which is about what people see.

### Access

Every route here calls `gatePage("view", { type: "app", key })` in its layout or page, and every API calls `requireCan(...)`. No `accessLevel` read, no tier Set, no `requireManagerOrRedirect`.

| Route | App key | Who reaches it | Who can write | Read-only viewer sees | Denied |
|---|---|---|---|---|---|
| `/tools` | `tools` | every Member; content is `accessibleIds(viewer, "tool", VIEW)`, Owner and Admin see all | FULL on the tool (grant or Owner/Admin) shares, deletes and transfers; EDIT changes the fields and the saved login | the table of tools shared with them, the saved login on each, no Add, no bulk bar, no row menu, no editable fields; in the drawer, a "Can view" chip where Share would be (click opens Who has access, read only) **and** the access §5.4 banner under the drawer header | Guests: `notFound()` (no Guest row in `APP_RULES`). A Member with nothing shared sees the empty state, never a lock |
| `/assets` | `assets` | anyone with reports (their chain's assets); the People team and Admin (the org's). **A Member without reports has no role on this app key** and reads their own kit on their profile's Assets tab | Owner, Admin and People team add, edit, assign and delete; a manager reads their chain and assigns within it | a manager sees their chain's rows with no Add, no row menu, no bulk bar | Member without reports, Agent and Guest: `notFound()` (access §5.3 "role none, not discoverable"). The row is absent from the sidebar, so nothing confirms the page exists |
| `/build`, `/build/[slug]` | `build` | Owner and Admin | Owner and Admin | n/a (there is no read tier) | Member, Agent and Guest: `notFound()` (access §5.3 "role none, not discoverable"). `<AppOff app="build">` is **not** used for them: access §5.5 item 6 is only the Apps-config case below, and rendering AppOff to a Member would confirm that Build apps exists, which is exactly the leak the not-discoverable case prevents |
| `/store` | `store` | every Member | Owner and Admin turn modules on and off | every card with its real state and, instead of the switch, a 13/400 status line "On" with a `--os-presence` dot or "Off · ask an admin"; "Suggest an app" stays available to every Member | Guests: `notFound()` |
| `/integrations` | `integrations` | every Member browses the catalogue | Owner and Admin connect and request on the org's behalf | every card with its real state and, instead of Connect, a **Request this** button that counts demand; a connected row reads "Connected" with a `--os-presence` dot | Guests: `notFound()` |
| `/marketing/*` | none | nobody; there is no `APP_RULES` row | nobody | n/a | Owner and Admin: 307 to the legacy import. Everyone else: `notFound()` |
| `/trash` | `trash` | spaces-lists §2 | spaces-lists §2 | spaces-lists §2 | spaces-lists §2 |

**Object roles.** A Tool is a first-class object in the access ladder: `GrantObject.TOOL` already exists in the access spec's schema (§3.2). The Tool share dialog is the one share dialog with the **one unchanged ladder**: Full access, Can edit, Can comment, Can view, in that order, with the verbatim blurbs from access §3.1. An earlier draft of this spec offered only two of the four rungs on a Tool; that is a change to the access model rather than a use of it, so it is withdrawn. What each rung means on a Tool: **Can view** reads the tool and its saved login; **Can comment** adds nothing on a Tool today and is listed in §4 as an ask on the access unit, which owns any per-type rung policy; **Can edit** changes the tool's fields and its saved login; **Full access** adds share, delete and transfer. Sharing a Tool is the one share dialog (access §6.1) opened from the Tool drawer's Share button, from the row "…" menu and from the bulk bar. Assets and Build apps are **not** ladder objects: an Asset's reach is the people-data rule (manager chain, People team, Admin, and self on the profile tab) and a Build app's reach is the org rule (Owner and Admin), so neither shows a Share button.

**Denial: three situations, three screens, stated once so nobody applies the wrong one.** Six units independently reached three different answers for what looks like one question, and all three answers are correct because they are answers to three different questions. The deciding question is always *what is the viewer missing*:

| Situation | What the viewer is missing | Screen | Rule |
|---|---|---|---|
| 1. An **app key** whose `APP_RULES` audience excludes the viewer (`/build` for a Member, `/assets` for a Member without reports, any of these for a Guest) | the whole app | the **in-shell 404**, and **no sidebar row** | access §5.5 rule 6: there is no object here, so there is nobody to request access from. A LockedPage would name a page the viewer is not supposed to know exists |
| 2. A **view of a page the viewer already holds** (`/planner?calendar=team`, `/timesheets?view=approvals`, and in this unit `/assets?scope=all` for a manager) | one slice of a page they can open | the page's **default view**, the parameter stripped with `router.replace`, and one **13/400 `--os-ink-2` notice line** under the header | access §5.5 rule 4. Never a 404 and never a lock: the viewer asked for a door they do have, through a query string they do not |
| 3. An **object the viewer can discover but holds no role on** (a Tool named in an Inbox row, a Space in search) | a role on one object | **`LockedPage`** at the same URL, with **Request access** | access §5.5 rule 3. There is an object and an owner, so there is somebody to ask |

Two screens are narrower than they read and neither is a general denial: **`<AppOff>`** is only for an app the org **hid or floored** in Settings › Apps, for a viewer who would otherwise have it, with a `/settings/apps` link for Admins and "Ask an admin" with Owner and Admin avatars for everyone else; **`<ModuleOff>`** is only for a premium module switched off. Not signed in goes to `/login?callbackUrl=` and nothing else.

**The one sanctioned exception** is `spec-teams-people.md`'s two app-key LockedPages on `/team` and `/team/workload`, which are situation 1 by the table above. It is kept because that unit supplies those `APP_RULES` rows itself and writes them as an explanatory sentence with **no Request access** link, so it leaks no object and offers no dead ask. It is flagged to the access unit (§4); if that unit declines, both fall back to the in-shell 404. No other unit may copy it, and this unit takes no such exception.

Nothing in this unit redirects a denial to `/dashboard`, `/today` or anywhere else. `integrations/layout.tsx` and `tools/layout.tsx`'s `requireManagerOrRedirect` and `assets/layout.tsx`'s copy are all deleted.

**Read-only means fewer controls, never disabled ones** (access §5.4). A control the viewer's role cannot use is not rendered.

### Back and close

| Surface | Back or close target | Esc |
|---|---|---|
| `/tools`, `/assets`, `/store`, `/build`, `/integrations` | list pages: no back button in the title row; the top-bar breadcrumb and the ‹ › history buttons are the way back | closes an open drawer, then the filter panel, then nothing |
| `/build/[slug]` | `BackButton{fallbackHref="/build"}` in the title row, label "Build apps", 28px ghost with `ArrowLeft` | closes a modal, then the drawer, then nothing; never navigates |
| Tool drawer (`/tools?tool={id}`) | ✕ in the drawer header clears the query param and returns to `/tools` with the row still selected | closes the drawer |
| Asset drawer (`/assets?asset={id}`) | same shape, returns to `/assets` | closes the drawer |
| Add tool modal, Add asset modal, New app modal, Suggest an app modal, Request this confirm | Cancel (ghost, left of the primary) and ✕; outside click closes, a dirty form confirms first | closes the modal, dirty guard first |
| Share dialog on a Tool | ✕; changes autosave per row, so there is no Save and no dirty guard | closes the dialog |
| `/marketing/*` | no page renders; the redirect resolves before paint | n/a |

`BackButton{fallbackHref}` is the only back pattern. Every hand-rolled variant in this unit is deleted: `<Link href="/build">← All apps</Link>` (`build/[slug]/page.tsx:130`), `router.push("/marketing")` (`marketing/[id]/page.tsx:216`), the bare `history.back()` buttons (`marketing/campaigns/page.tsx:205`, `marketing/events/page.tsx:249`), and the `Settings` and `Calendar` header nav links on Tools, Assets, Build apps and the old Integrations page.

### Finding one row on a long page

Every page in this unit carries a per-page search today (`/tools` page.tsx:164-166 "Search tools, URLs, descriptions…", and the same control on `/assets`, `/store` and `/build`). The header stack in design §4.4 has no search slot, so the capability moves rather than disappearing; it is never simply dropped.

- The **first row of the `FilterPanel` is the row search**: the 36px input design §5.2 already puts at the top of the panel, labelled by the panel heading, with the placeholder "Search {objects}". On these pages it filters the **rows**, not the panel's own field list, because each panel here has at most five field rows and searching five labels would be pointless. It writes `?q=` and the count on the Filter chip includes it.
- **`/` opens it.** Pressing `/` anywhere on a list page in this unit opens the filter panel if it is closed and focuses that input; `Esc` clears it, and a second `Esc` closes the panel. The shortcut is listed in the `?` overlay on every route here, so the fast path costs one key and no learning.
- The matching `?q=` parameter exists on every list API in the unit: `GET /api/tools`, `GET /api/assets`, `GET /api/build/apps` and `GET /api/products`. It is server-side and cursor-safe, which is the second reason for the move: today's inputs filter only the page of rows already loaded.
- The one page with no row search is `/store`, where the whole inventory is two modules plus two link cards; a search over four cards would be chrome for its own sake. If the registry ever passes a dozen entries the panel gains the same row. `/integrations` **does** carry one, because its catalogue runs to a dozen-plus connectors: the same filter-panel row, the same `/` shortcut, and a real `?q=` on `GET /api/integrations` (§2.6).

### Mobile and narrow

`spec-shell.md` §1.16 owns every breakpoint and all top-bar behaviour (the 400px search shrinking to 240 between 1024 and 1279, the 32px magnifier and last-two-crumbs breadcrumb between 768 and 1023, the rail, the sidebar drawer). None of it is restated here; if the two files ever disagree, spec-shell wins. What follows is only this unit's content behaviour inside those breakpoints.

- Under 1024 the filter panel becomes a 320px drawer from the left (design §5.2, spec-shell §1.16) instead of narrowing the table.
- Under 1024 the drawer (Tool, Asset) goes full width with its own 48px header.
- `TableCard` scrolls horizontally inside its own `overflow-x: auto`; the page body never scrolls sideways. Column priority when a narrow viewport forces a cut, highest first: Tools = Name, Login, Category; Assets = Asset, Assigned to, Status; Build = App, Status, Updated. Lower-priority columns move into the drawer, they are never truncated to nothing.
- The Marketplace card grid is `grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))` with a 16px gap, so it reflows to one column without a breakpoint.
- Every row menu and every hover-only control has a keyboard path: `↑ ↓` moves the row, `Enter` opens the drawer, `Space` toggles the checkbox, the row "…" is a real button in the tab order (critic #10). The Assets page's single-column collapse at 1100px with no row redesign (misc-apps 1.16 issue 3) is replaced by the column-priority rule above.

---

## 2. Route specs

### 2.1 `/tools`  (`src/app/(dashboard)/tools/page.tsx`)

- **Purpose**: see every app the company pays for, and get the login for the ones you are allowed to use.
- **Who sees it and entry points**: every Member. A Member sees the tools shared with them; Owner and Admin see all. Guests never. Entry: Teams sidebar RESOURCING › **Tools**; `⌘K` "Tools" (the command palette filters apps through `visibleApps`, so it no longer offers a page that bounces); global search on a tool name; the Inbox row "Anita shared Figma with you" linking to `/tools?tool={id}`; a copied drawer link. The old launcher entry and the Settings sidebar row are gone with `SettingsSidebar`.
- **Top bar**: left ‹ › then the breadcrumb "Teams › Tools" (last crumb 14/500 `--os-chrome-fg`, not clickable); centre the 400px global search; right "+", bell, "?", avatar. No page action on the bar.
- **Secondary sidebar**: Teams hub sidebar; RESOURCING › Tools active; the PEOPLE section stays expanded, RESOURCING expands because the active row is in it.
- **Page header stack**:
  - Title row 48: **Tools** 22/600 `--os-ink`. Right: nothing (no Share, no star, no "…" in the title row, no Ask AI slot because this page has no AI action).
  - Views row 36: text-tab pills **All tools · Shared with me**. Rendered only for Owner and Admin, who have both. A Member has one view, so the row does not render and the page is 140 tall above the first data pixel (design §4.4).
  - Toolbar row 44: left **Filter** (`Funnel` 16px + "Filter", 36px toggle chip, reads "Filter · 2" when active), **Sort** (`ArrowUpDown` + "Sort": Name A to Z, Recently added, Category); no Group, no view-type switcher (one view type, so the run is absent, not disabled). Right: the one primary **"Add tool"** (36px `--os-brand`, white 14/500, 16px `Plus`, radius 6), rendered only for Owner and Admin; then the bordered 36px "…" square with, in order: **Display** (Density, Columns), a divider, **Export CSV** (Owner and Admin; absent for Agents, access rule 13 `export`). For a Member the toolbar right holds the "…" square alone with Display only.
- **Body layout**, in reading order:
  1. When Filter is open, the 272px `FilterPanel` at the left of the content with a 16px gap; the table narrows over 220ms. Heading "Filter tools by" 16/600 with "Clear all" when anything is active; then the 36px **row search** (placeholder "Search tools", writes `?q=`, focused by `/`, per §1 "Finding one row on a long page"); then 36px checkbox rows: **Category** (picker of the org's categories), **Has a login** (Yes / No), **Shared with** (people picker), **Added by** (people picker). Footer text link "Save as view" is hidden here (this page has no saved views to create).
  2. One `TableCard`, 8px under the toolbar, `--os-surface`, 1px `--os-line`, radius 8, carrying `.os-row`. Header row 44 at Comfortable (36 at Cozy and Compact), `--os-table-head-bg`, labels 13/500 `--os-ink-2` sentence case, a visible 18px checkbox in the 44px first cell at Comfortable, an inline "All ▾" value picker on Category, and a pinned 44px column-settings icon (`SlidersHorizontal` 16px) at the far right.

     | Column | Content | Width |
     |---|---|---|
     | checkbox | 18px square, `--os-line-strong` at rest, `--os-brand` fill when checked | 44 |
     | Name | `EntityTile size="sm"` neutral carrying the tool's emoji when `Tool.icon` is set, else the first letter; then the name 15/500 `--os-ink`. The whole cell opens the drawer | fluid, min 220 |
     | Category | neutral `Chip` 24px, 12/500, `--os-surface-hov` fill; "Uncategorized" reads **"No category"** in `--os-ink-2` with no chip | 160 |
     | Login | 12px `KeyRound` + "Saved" 13/400, or "None" 13/400 `--os-ink-2`. Colour never travels alone; the glyph carries the meaning | 120 |
     | Shared with | `AvatarStack` size 20, max 3, then "+N"; "Not shared" 13/400 `--os-ink-2` when empty | 140 |
     | Added | relative date 13/400 `--os-ink-2` ("4 Sep") with a tooltip carrying the full date and the person | 120 |

     Body rows `--os-row-h` (44 default), `border-bottom: 1px solid var(--os-line-soft)`, no zebra, hover `--os-surface-hov`. A row-hover 28px ghost `ExternalLink` "Open website" sits at the right, rendered only when `Tool.url` is set; it opens in a new tab and does not open the drawer. At most one chip and one avatar group per row, per the content-height budget (design §3.2).
     Group headers appear only when Sort is Category: 44px `--os-surface-1` row, chevron 16px + category name 15/500 + count 12/500 `--os-ink-2`. Never a coloured bar.
     Footer row 44 inside the card: left "Total records 18" 13/500, right "1 to 18" 13/400 with ‹ › 32px icon buttons and a page-size select on hover.
  3. Bulk bar (Owner and Admin only): 150ms after the first selection, floating bottom-centre, 48px, white, bordered, radius 8, `--os-shadow-pop`: "3 selected" 14/500, then ghost actions **Share**, **Change category**, **Delete** (destructive ghost), then ✕.
- **Side panel, drawer, modal**:
  - **Tool drawer**, 520 wide (resizable 480 to 720, remembered), right, full height under the top bar, `--os-surface`, `border-inline-start: 1px solid var(--os-line)` plus `--os-shadow-modal`. The list under it dims to 92% opacity and stays scrollable, no scrim. URL: `/tools?tool={id}`, so copy link always works. Opened by a row click, by `Enter` on a focused row, and by a deep link. Header 48: "Tools › {name}" 13px left; right, 32px ghost icons: copy link, **Share** (opens the one `ShareDialog` for `{ type: "tool", id }` with the unchanged four-rung ladder; rendered for FULL, and for EDIT in "add at Can edit or below" mode when access toggle 4 is on; below that the "Can view" chip takes its place), ✕. **No expand affordance**, because there is no full page for a tool and a dead control is worse than a missing one. `AutosaveIndicator` (design §5.17) sits left of the icons because fields autosave.
    - **Fields strip**: 36px label and value rows, label 13/500 `--os-ink-2` in a 120px column, value as a picker trigger or an inline input. **Name** (text), **Website** (url, with a 28px ghost "Open"), **Category** (`Picker`, the org's categories plus a "New category…" footer row), **Icon** (emoji picker), **Description** (textarea, 3 rows, auto-grow to 12). FULL holders edit in place; everyone else sees plain text.
    - **Login** section, title 16/600: rows **Username**, **Password**, **API key**, **Notes**. Each value renders as `••••••••` with a 28px ghost `Eye` ("Show", `aria-label` "Show password") and a 28px ghost `Copy`. Revealing or copying writes one `tool.credential.revealed` audit row with the tool, the field and the actor. An unset field reads "Not set" in `--os-ink-3` and, for a FULL holder, is editable in place. The whole section is absent for a viewer with no role on the tool, which cannot happen on this page (they would not see the row).
    - **Who has access** section: the first five rows from `GET /api/access/grants?type=tool&id=`, avatar 24 + name 14/400 + role chip 12/500; a "Manage" text link opens the same `ShareDialog`. A lock glyph never appears here (a Tool has no inheritance).
    - **Danger**: last, a card bordered `--os-danger-border` with a destructive ghost **"Delete tool"** for FULL holders. Confirm modal 400: "Delete Figma? The saved login is deleted with it. You can restore it from Trash for {retention} days." Cancel / Delete. The delete writes a `TrashItem` snapshot (§2.12) rather than a hard delete.
  - **Add tool modal**, 560, header 56 "Add tool": **Name** (required, the word "(required)" as text, never a red asterisk), **Website**, **Category** (`Picker` plus create), **Icon** (emoji), **Description**; then a collapsed section **"Add a login"** (Username, Password, API key, Notes) that expands in place over 160ms. Footer 64: Cancel ghost left of the one primary **"Add tool"**. This replaces the two chained `prompt` dialogs at `tools/page.tsx:82-95` that always wrote category "Uncategorized" (misc-apps 1.15 issue 2).
- **States**:
  - Loading: the rail logo dots pulse after 200ms; the content shows `--os-skeleton` bars at the exact 44px row height, widths 60 / 40 / 80 percent, 8 rows, one 1.6s opacity pulse; one 13/400 `--os-ink-2` line under the first skeleton carrying the rotating company value. No `Loader2`, no `DotsLoader` in content, no blocking overlay.
  - Empty (Owner or Admin, no tools at all): the four-dot **row** illustration at 96px in `--os-line-strong`, then one sentence 15/400 `--os-ink-2` "No tools yet". No second button; the blue "Add tool" in the toolbar is the one primary.
  - Empty (Member, nothing shared): the same illustration and "No tools shared with you yet." No link, no lock, no "request access" (a tool is not discoverable).
  - Filtered empty: an inline 44px row inside the card, "No results · Clear filters" 15/400 `--os-ink-2` with the clear as a text link. No illustration inside a card.
  - Error: `OsEmptyView` restyled, "Couldn't load Tools", the error sentence as the second line, and a **wired Retry** text link. The current pattern that passes `cta` with no handler and silently hides the button is gone (misc-apps #14).
  - Read-only: as the Access table above, and in full per access §5.4, which asks for both halves. **The chip**: where Share would sit in the drawer header, a 24px neutral `Chip` reading "Can view" (or "Can comment" at COMMENT); clicking it opens Who has access read only. **The banner**: one slim 36px banner directly under the drawer header, `--os-surface-1`, 13/400 `--os-ink-2`, reading "View only. Ask {owner} for edit access." with a **Request** text link that opens the access spec's request flow (§5.6). The banner renders at VIEW and COMMENT and nowhere else. It lives in the drawer, not on the page, because the Tool is the object with the role; the list itself is simply the set of tools the viewer can see. Beyond that: the header shows no Add, and the row menu, bulk bar and drawer field edits are absent rather than disabled.
  - Denied: Guest `notFound()`; app hidden or floored in Settings › Apps, `<AppOff app="tools">` at the same URL with a link to `/settings/apps` for Admins.
  - Offline or session expired: the shell's 401 interception and offline banner (spec-shell §2.15). No fetch in this page swallows an error into an empty state.
- **Keyboard**: `⌘K` search, `⌘1..8` hubs, `⌘\` sidebar; `/` opens the filter panel and focuses the row search (§1); in the table `↑ ↓` move, `Enter` opens the drawer, `Space` toggles the checkbox, `⇧↑↓` extends a range; `Esc` clears the row search, then closes the drawer, then the filter panel; `?` opens the shortcut overlay. Every icon-only control carries a tooltip after 400ms (0ms between adjacent triggers) and an `aria-label`.
- **Data**:
  - Existing, rebuilt: `GET /api/tools` (today it branches on a hard-coded `["SUPER_ADMIN","COMPANY_ADMIN","C_LEVEL","HR"]` list at `route.ts:13-26`; it becomes `accessibleIds(viewer, "tool", VIEW)` with Owner and Admin seeing all, and it never returns `credentials` in the list payload; it gains `?q=&category=&hasLogin=&sharedWith=&addedBy=&sort=&cursor=`, where `q` matches the name, the website and the description, which is what the deleted page-local search box matched), `POST /api/tools` (`requireCan("create", { type: "app", key: "tools" })`, Owner and Admin), `PATCH /api/tools/[id]` and `DELETE /api/tools/[id]` (`requireCan("manage", { type: "tool", id })`; DELETE writes a `TrashItem`).
  - Existing, gaining its first caller: `POST /api/tools/[id]/share` and `DELETE /api/tools/[id]/share` are replaced by the one grant API, `POST /api/access/grants { objectType: "TOOL", objectId, subjectType, subjectId, role }` and its DELETE, so the `ShareDialog` needs no per-type endpoint. The `ToolShare` rows are migrated to `AccessGrant` rows at role VIEW in the access spec's step 4 backfill; the `ToolShare` model is kept for one release as a read fallback, then dropped.
  - New: `GET /api/tools/[id]` (one tool including `credentials`, only for a viewer with VIEW or above; writes the reveal audit row when `?reveal=1`), `GET /api/tools/categories` (distinct categories for the picker), `POST /api/tools/bulk { op: "category" | "delete" | "share", ids[], value }` (max 200 ids), `GET /api/export/tools` (CSV honouring the active filters; denied to Guests, Agents and acting-as principals).
  - Settings read: `UserPreference.density`; `settings.retention.trashDays` for the delete confirm copy.
- **Realtime**: refetch on window focus and after every write. The page subscribes to `workwrk:access-changed` (a grant on a tool) and refetches the affected row. No poller.
- **What changes vs today**:
  - Three labels become one, **Tools** (misc-apps #23).
  - `tools/layout.tsx`'s `requireManagerOrRedirect` is deleted, so a Member who has a tool shared with them can finally open the page instead of being bounced to `/dashboard` (misc-apps 1.15 issues 5 and 6).
  - The two chained `prompt` dialogs become one modal with a real category, description and icon (issue 2).
  - Category, description, icon, delete and sharing all gain controls; the orphan share route gains its caller (issues 2, 3, 4).
  - The four KPI tiles (Tools / Categories / With creds / Shared to me) are deleted; a list page has no stat strip in this design system, and three of the four numbers were only the length of the loaded array.
  - The hand-rolled `fixed inset-0 z-[120]` credentials modal becomes the standard drawer; its Tailwind `max-w-md` and `#0073EA` literal go with it (issue 7).
  - `OsTitleBar` and its dead Ask AI / Share / Invite trio and always-filled star go (critic #2, misc-apps #4); the `Settings` header nav link goes (settings §2.4).
  - The `.tls__*` BEM family and the page-local `KpiTile` are deleted from `os.css`.
  - Loading goes from `ValueLoader` plus a "Loading…" title-bar description to skeletons plus one value line (misc-apps #21).
  - The page-local search box at `page.tsx:164-166`, which filtered only the rows already loaded, becomes the row search at the top of the filter panel with a real `?q=` on the API and a `/` shortcut (§1). The capability is kept and made server-side, not dropped.
- **Open questions**: (1) Today anyone the tool is shared with sees the saved login. Should there be a second, narrower right ("shared, but without the login") for people who need to know the tool exists but not how to sign in? The spec assumes no, because two rights on one small object is exactly the complexity the founder is trying to remove, but it is a real security question for an org that shares a billing login. (2) **Can comment on a Tool.** The one ladder has four rungs and the share dialog shows all four everywhere. On a Tool, Can comment grants nothing that Can view does not, because a Tool has no comment thread. Three answers are possible and only the founder and the access unit can pick: give Tools a comment thread (a small build, and "why do we pay for this" is a real conversation to have on the tool itself), let the access unit add a per-type rung policy to `ShareDialog` so a rung that grants nothing is not offered, or leave it and accept one inert choice. This spec ships the full ladder until that is decided, because a subset invented here would fragment the access model, which is the thing the model exists to stop. Listed as an ask on the access unit in §4.

---

### 2.2 `/assets`  (`src/app/(dashboard)/assets/page.tsx`)

- **Purpose**: know what kit the company owns, who has it, and what is about to go out of warranty.
- **Who sees it and entry points**: anyone with reports sees their chain's assets; the People team and Admin see the org's. **A Member without reports does not see this page at all**: access §5.2.1 `assets` reads "a Member without reports sees their own assets on `/people/me`, not here", the access spec wins on access, and their own kit is one click away on their profile's Assets tab (teams-people §2). Agents and Guests never. Entry: Teams sidebar RESOURCING › **Assets** (rendered only for the audience above); `⌘K` "Assets" (filtered through `visibleApps`, so it is not offered to people it would 404 for); a person's profile › Assets tab links to `/assets?asset={id}` for a viewer who can open it; the onboarding tour step 7 (its copy is rewritten to the canon label and the step is skipped for a viewer without the app); search.
- **Top bar**: ‹ › then "Teams › Assets"; search; "+"; bell; "?"; avatar.
- **Secondary sidebar**: Teams hub sidebar; RESOURCING › Assets active.
- **Page header stack**:
  - Title row 48: **Assets** 22/600. Right: nothing.
  - Views row 36: text-tab pills **My team · All**, each rendered only when the viewer has it (a manager has only "My team", so the row does not render for them and the page is 140 tall above the first data pixel; the People team and Admin have both). There is **no "Mine" pill**: a person's own kit lives on their profile's Assets tab, which is where every Member reads it, and duplicating it here would give one destination two doors and re-open the access question this spec just closed. The pill writes `?scope=team|all`, which is also the API scope, so the view and the data cannot disagree.
  - Toolbar row 44: left **Filter**, **Sort** (Name, Purchase date, Warranty expiry, Value), **Group** (`Rows3` + "Group": None, Status, Type, Assigned to), a 1px 20px divider, no view-type switcher. Right: the one primary **"Add asset"** (Owner, Admin and People team); then the "…" square: **Display** (Density, Columns, a "Show retired" toggle), divider, **Export CSV**.
- **Body layout**:
  1. `FilterPanel` 272 when open: "Filter assets by", the row search (placeholder "Search assets", matches name, serial and model, writes `?q=`, focused by `/`), checkbox rows **Status** (Available, Assigned, In repair, Retired, Lost), **Condition** (New, Good, Fair, Poor, Damaged), **Type** (the 15 asset types), **Assigned to** (people picker), and **Warranty expiring** (a checkbox that expands an inline `SegmentedControl` of **30 · 60 · 90 days**, default 60, each option carrying its count). The window is a filter value chosen on screen, not a setting: see "the warranty window" under Data below.
  2. One `TableCard`:

     | Column | Content |
     |---|---|
     | checkbox | 18px |
     | Asset | `EntityTile size="sm"` neutral with the type glyph (`Laptop`, `Monitor`, `Smartphone`, `Armchair`, `Car`, `IdCard`, else `Box`) + name 15/500 |
     | Type | 15/400 sentence case ("Laptop", "Access card") |
     | Assigned to | avatar 24 + name 15/400, or "Unassigned" 15/400 `--os-ink-2` |
     | Status | pale `StatusChip`: Available → neutral, Assigned → info, In repair → warning, Retired → neutral, Lost → danger; 6px dot + the word, 12/500, sentence case |
     | Condition | 15/400 word ("Good") |
     | Serial | JetBrains Mono 13/400 with `tnum`, truncated at 18 characters with a tooltip |
     | Warranty | date 13/400; inside 60 days a 12px `CircleAlert` in `--os-danger-text` + "in 23 days"; expired reads "Expired" in `--os-danger-text`. 60 is a fixed product rule, the same number on every page in every org, not a setting |
     | Value | right-aligned `tnum` in the org currency |
     | "…" | a 32px ghost row menu, rendered only for a viewer who can manage the row |

     Row menu order: **Open**, **Assign to…**, **Unassign** (only when assigned), **Change status ›** (submenu of the five), **Edit**, **Copy link**, a divider, **Delete** (destructive ghost). The permanently disabled "Check-out log · Soon" row is deleted; it returns only when the log exists, and then as a real row (critic #15).
     Group headers when Group is on: 44px `--os-surface-1`, chevron + name 15/500 + count; when grouped by Status the name is replaced by the pale `StatusChip`. Never a solid pill.
     Footer row 44: left "Total records 128", and, because money is the thing an admin came for, a second left cell "Total value {formatted}" 13/500 with `tnum`; right "1 to 40" with ‹ ›.
  3. Bulk bar: "6 selected" · Assign to… · Change status · Export · Delete · ✕.
- **Side panel, drawer, modal**:
  - **Asset drawer** 520 at `/assets?asset={id}`. Header "Assets › {name}", copy link, ✕ (no Share: an Asset is not a ladder object, so no share control is rendered). Fields strip in two groups: **Identity** (Name, Type, Brand, Model, Serial, IMEI), **Money and cover** (Purchase date, Purchase cost, Warranty expiry), **State** (Condition, Status, Assigned to, Notes). Below, a **History** section: 36px rows from `ActivityLog` for this asset ("Assigned to Dev Kumar · 4 Sep · by Anita"), newest first, 10 with a "Show all" text link. Danger card last: destructive ghost "Delete asset" for a manager of the row, confirm 400, writes a `TrashItem`.
  - **Add asset modal** 560 and **Edit asset modal** 560 (the existing `asset-form-dialog.tsx`, restyled to `ui/dialog` and tokens): the same fields as the drawer strip, Status only in edit mode, one primary "Add asset" / "Save".
  - **Assign dialog** 560 (`assign-dialog.tsx`, restyled): a people `Picker` over `GET /api/people/pick?q=`, one primary "Assign", plus a destructive ghost "Unassign" when the asset is assigned.
- **States**: loading = rail pulse plus 8 skeleton rows plus the value line (today it is the plain text "Loading…" at `page.tsx:142`, misc-apps #21); empty (People team or Admin, no assets at all) = four-dot row illustration + "No assets yet", no second button; empty (manager, nobody in their chain holds kit) = the same illustration and "Nobody on your team has kit assigned yet."; filtered empty = the inline "No results · Clear filters" row; error = "Couldn't load Assets" with a wired Retry (today a bare unstyled div); read-only = a manager sees their chain's rows with no Add, no row menu and no bulk bar, and no banner (a manager holds no object role here, so access §5.4's banner does not apply; the missing controls are the whole signal); denied = `notFound()` for a Member without reports, an Agent or a Guest, hidden or floored app `<AppOff app="assets">` with the `/settings/apps` link for Admins; offline and session expiry from the shell.
- **Keyboard**: as Tools, including `/` for the row search, plus `A` on a focused row opens Assign (documented in the `?` overlay).
- **Data**:
  - Existing, gated: `GET /api/assets` gains `?scope=team|all&status=&condition=&type=&assignedTo=&warrantyWithin=30|60|90&q=&sort=&cursor=` and resolves through `can()` instead of `requirePermission` plus a hand-rolled scope string; the `?mine=1` form stays for the profile tab (access §9 `assets.viewOwn`), which is the one place a Member reads their own rows; `POST /api/assets`; `PATCH /api/assets/[id]`; `DELETE /api/assets/[id]` (writes a `TrashItem`).
  - New: `POST /api/assets/bulk { op: "assign" | "status" | "delete", ids[], value }`, `GET /api/export/assets` (CSV, filter-aware).
  - Settings read: **org currency**, `settings.currency` (full ISO list), which **already exists** at Settings › Locale and work week (settings-architecture §5.15, PATCH section `locale` per §9) with the default set per country at org creation, INR for India and USD otherwise (§11). An earlier draft of this spec called it `settings.locale.currency`, called it new and proposed deriving the default from `Campaign.currency`; all three were wrong and are withdrawn. This unit is a **reader**, not the owner: it reads the existing key through `useOrgCurrency` (§3) together with the viewer's locale for `Intl.NumberFormat`. That closes `fmtMoney`'s hard-coded `"USD"` (`assets/page.tsx:29`) and the marketing suite's hard-coded `₹` with lakh and crore grouping (misc-apps #22, critic #13) with no new setting at all.
  - Settings read: `UserPreference.density`, `settings.retention.trashDays`.
  - **The warranty window is not a setting.** An earlier draft proposed `settings.work.assetWarrantyDays` (default 60). It has no home: settings-architecture defines the `work` PATCH section as `defaultItemTypeId`, `capacity` and `automationsPaused` only, every section schema is `.strict()` so an unknown key returns 400, and no settings page in that spec renders a warranty window. A spec may not mint a key with no door. So the 60-day rule stays a fixed product rule for the row warning (a red date is a red date in every org), and the thing a person actually wanted to vary, "show me what expires soon", becomes the 30 / 60 / 90 choice in the filter panel, which persists the way every other filter does, as `?warrantyWithin=` in the URL and in a saved filter. misc-apps §6 "warranty window" is therefore **deferred, not resolved**, and §5 records it that way.
- **Realtime**: refetch on focus and after each write; `rowVersion("assets")` from the shell context is kept as the cross-tab invalidation signal it already is.
- **What changes vs today**:
  - Three labels become **Assets**.
  - `assets/layout.tsx`'s `requireManagerOrRedirect` is deleted. It is replaced by `gatePage("view", { type: "app", key: "assets" })` against the one `APP_RULES` row, not by a wider audience: a manager stops being bounced to `/dashboard` when the register is exactly their job, and a Member without reports gets the in-shell 404 instead of a redirect. Their own kit is on their profile's Assets tab, which is the single door for that (misc-apps 1.16 issue 8 is resolved as a denial-convention fix, not as a widening).
  - The page-local search box becomes the row search in the filter panel with a real `?q=` and a `/` shortcut (§1).
  - The four stat tiles are deleted; the money moves into the card footer and the warranty count into a filter row, so no number on screen is a client-side count over a capped list (critic #12).
  - The injected `<style>` block at `page.tsx:122-135` that overrode `os.css` is deleted (misc-apps #27), with the responsive behaviour replaced by the column-priority rule in §1.
  - `ui/toast`'s `useToast` is replaced by `useOsToast` so the page has one toast system (misc-apps 1.16 issue 6).
  - `STATUS_HUE` and `CONDITION_HUE` in `types.ts`, which map onto `--os-c-green`, `--os-c-blue`, `--os-c-orange`, `--os-c-darkgray`, `--os-c-red`, are deleted; status becomes the semantic `StatusChip` mapping above and condition becomes a plain word. The `--os-c-*` family is deleted app-wide in design §8.5 step 5.
  - The product catalog's `workwrk-assets` PLUS entry with `defaultEnabled: false` is deleted. Assets is **not** a module; it is an app key in the Apps config (hide, floor, order), which is now enforced by access rule 2. This is stated so nobody wires a fake module gate later (misc-apps 1.16 issue 7).
  - Loading, error and empty states join the standard family; the `GRAD.bluePurple` icon gradient goes with `OsTitleBar`.
- **Open questions**: (1) Should the People team be able to add and assign assets, or only see them? The spec grants them add and assign, because "who has the laptop" is a people-operations job and the access model already gives the People team Full on Policies, Contracts, Reviews, Surveys and Assets org-wide (access §2.1). Flagged because it is the one place this unit widens a write right.

---

### 2.3 `/build`  (`src/app/(dashboard)/build/page.tsx`)

- **Purpose**: make a small app of your own, by describing it, when a List is not the right shape.
- **Who sees it and entry points**: Owner and Admin. Entry: AI sidebar APPS › **Build apps** (spec-ai-automation §1 row 11); `⌘K` "Build apps"; the footer text link **"Build apps"** on Settings › Apps and modules (settings-architecture §5.3, which already uses exactly this label, so nothing has to be renamed there); the Marketplace link card; search. The Sidekick prompt panel no longer needs to be the create path.
- **Top bar**: ‹ › then "AI › Build apps"; search; "+"; bell; "?"; avatar.
- **Secondary sidebar**: AI hub sidebar; APPS › Build apps active; the AUTOMATION section keeps its own state.
- **Page header stack**:
  - Title row 48: **Build apps** 22/600. Right: an **"Ask AI"** slot is not rendered here; the AI action is the primary button itself.
  - Views row 36: text-tab pills **All · Published · Drafts**. These replace today's status chip row, so filtering an app list works the same way as filtering any other list.
  - Toolbar row 44: left **Filter** (the row search "Search apps" matching name and description and writing `?q=`, then Status, Created by), **Sort** (Recently updated, Name, Created); no Group, no view-type switcher. Right: the one primary **"New app"** fused to a 36px split chevron separated by `1px rgba(255,255,255,.24)`: the chevron menu holds **"Describe it to AI"** (the default the button itself runs) and **"Start blank"**. Then the "…" square: **Display** (Density, Columns, **Show archived**), divider, **Export CSV**.
- **Body layout**: one `TableCard`.

  | Column | Content |
  |---|---|
  | checkbox | 18px |
  | App | `EntityTile size="sm"` **neutral** (`--os-surface-hov` tile, `--os-ink-2` glyph) + name 15/500. The `PALETTE` of purple, indigo, pink and the `appHue` hash at `page.tsx:46-51` are deleted; opt-in colour, if ever wanted, is one of the eight muted hues in design §1.7, never a hashed hue |
  | Description | 13/400 `--os-ink-2`, single line, ellipsis |
  | Status | pale `StatusChip`: Published → success, Draft → neutral, Archived → neutral with the word "Archived" |
  | Rows | count, right-aligned `tnum` |
  | Updated | relative 13/400 `--os-ink-2` |
  | "…" | row menu: Open, Rename, Duplicate, Copy link, divider, Archive, Delete |

  Row click opens `/build/[slug]`. Footer "Total records N · 1 to 40". Bulk bar: Archive, Delete, ✕.
- **Side panel, drawer, modal**:
  - **New app modal**, 720 (a rich create with a description), header 56 "New app".
    - Step 1, "Describe it": a textarea, 4 rows, auto-grow, placeholder "A register of our company vehicles, with the plate, the driver, the service date and whether it is on the road." Below it three 32px secondary example chips that fill the textarea. Footer: Cancel ghost, one primary **"Generate"**. Pending: the label stays and a 16px monochrome four-dot loader in `currentColor` replaces the icon (design §5.10, §5.16 `pending`). Calls `POST /api/build/generate`.
    - Step 2, "Check the fields": the proposed name, slug and the field list as 36px rows (label, type as a `Picker`, a 28px ghost ✕ to drop a field, a ghost "+ Add field" last). One primary **"Create app"** calling `POST /api/build/apps`, and a ghost "Back" to step 1. Nothing is written until this button.
    - "Start blank" opens step 2 directly with an empty field list and an editable name.
  - This replaces `page.tsx:106`, where "Generate app" only raised the toast "Use the prompt panel in Sidekick to scaffold a new app" while the empty state's CTA was hidden for want of a handler (misc-apps #10 and #14). There is now a visible way to build an app from Build.
- **States**: loading = rail pulse plus 6 skeleton rows plus the value line; empty = the four-dot **2x2 grid** illustration (apps are a board-shaped thing) + "No apps yet", no link (the blue New app is the one primary); filtered empty = inline row; error = "Couldn't load Build apps" with a wired Retry; read-only = none (there is no read tier on Build apps); denied = **`notFound()`** for a Member, an Agent or a Guest. This corrects an earlier draft that showed them `<AppOff app="build">` with the sentence "Build is for workspace admins." and cited access §5.5 item 6: item 6 is the Apps-config case (rule 2, an app hidden or floored in Settings › Apps), and a viewer who is simply outside the `build` audience is access §5.3's "role none, not discoverable", which resolves to the in-shell 404. AppOff for a Member would confirm the page exists, which is the leak the not-discoverable case is built to avoid. `<AppOff app="build">` is still the right screen for an Owner or Admin in an org that hid or floored the app, with the `/settings/apps` link for Admins. Offline and session expiry from the shell.
- **Keyboard**: `⌘K`; `/` opens the filter panel and focuses the row search; `↑ ↓ Enter` in the table; `Esc` closes the modal with a dirty guard on step 2; `?`.
- **Data**: existing `GET /api/build/apps` (gains `?includeArchived=1&status=&q=&sort=&cursor=`, where `q` is the row search that replaces the page-local input, so the Display toggle is real; today the route filters `status: { not: "ARCHIVED" }` server side at `route.ts:24`, which is what makes the checkbox dead), `POST /api/build/apps`, `POST /api/build/generate`, `PATCH /api/build/apps/[slug]`, `DELETE /api/build/apps/[slug]`. All five gain `requireCan("manage", { type: "app", key: "build" })`; today any org member can create, edit and archive any app. New: `POST /api/build/apps/bulk { op, slugs[] }`.
- **Realtime**: refetch on focus and after a write; `rowVersion("build")` kept.
- **What changes vs today**: a real create flow replaces the toast; "Show archived" becomes real; the four KPI tiles, including the Templates tile whose value is a dash and whose caption is "coming soon", are deleted (a placeholder inside a stats strip is exactly the fabricated chrome the critic names); the `Agents` header nav link goes (the AI sidebar has that row); `OsTitleBar`, its gradient and the dead trio go; the hashed purple and pink palette goes; the page is re-parented from Settings › Operations, where a maker tool never belonged (misc-apps 1.11 issue 5), to the AI hub; the page-local search becomes the filter panel's row search with a real `?q=`; the name becomes **Build apps** everywhere, which is what Settings and the AI sidebar already call it.
- **Open questions**: (1) Should a Member be able to build an app for their own team, with Owner and Admin approving publication, or does Build apps stay an admin tool? Both specs currently say Owner and Admin; this is the one place where "teams build their own workspace" (the AI-OS vision) and the access model point in different directions.

---

### 2.4 `/build/[slug]`  (`src/app/(dashboard)/build/[slug]/page.tsx`)

- **Purpose**: use the app you built: add, change and look through its rows.
- **Who sees it and entry points**: Owner and Admin. Entry: a row on `/build`; a copied link; search. A published app does not yet appear anywhere else; when it does, that is a change to the AI hub sidebar, not to this page.
- **Top bar**: ‹ › then "AI › Build apps › {app name}"; the app-name crumb is the last one, 14/500, not clickable; search; "+"; bell; "?"; avatar.
- **Secondary sidebar**: AI hub sidebar; APPS › Build apps stays active (the detail route keeps its parent row lit).
- **Page header stack**:
  - Title row 48: `BackButton{fallbackHref="/build"}` (28px ghost, `ArrowLeft`, label "Build apps", 13/500 `--os-ink-2`) then `EntityTile size="lg"` neutral then the app name 22/600, single line with ellipsis. Right: a ghost "…" holding **Rename**, **Edit fields**, **Duplicate**, **Copy link**, a divider, **Archive**, **Delete** (destructive ghost). The "Built with Vibe" pill is deleted; "Vibe" is a product name used nowhere else.
  - Views row 36: not rendered (one saved view, no "+ View").
  - Toolbar row 44: left **Filter**, **Sort**, **Group**, a divider, then the **view-type switcher**: `List`, `LayoutGrid` (board), `Calendar`, `Image` (gallery) as 32px icon buttons, the active one `--os-brand-deep` on `--os-brand-soft` radius 6, the rest `--os-ink-2`. Right: the one primary **"New row"**; then the "…" square: Display (Density, Fields shown), Export CSV.
- **Body layout**: the existing `BoardView` renderer is kept (it already does Table, Kanban, Calendar and Gallery) and is re-skinned onto `TableCard`, the hairline rows, the 15px row type and the tokens. Inline edit, bulk change and bulk delete stay. Two structural fixes: row identity becomes the row's real id rather than its array index, and a bulk operation issues one request rather than re-fetching after each step (`page.tsx` today does both, "fragile but works" per the audit).
- **Side panel, drawer, modal**: **New row modal** 560, one input per field from the app schema in schema order, types mapped to the standard controls (TEXT and URL and EMAIL to input, TEXTAREA to auto-grow textarea, NUMBER to a numeric input with `tnum`, DATE to the date `Picker`, CHECKBOX to `Switch`, SELECT and MULTI_SELECT to `Picker`), one primary "Add row". **Edit fields modal** 960, max 90vh: the field list with label, type, and a drag handle using the `Dots` `grip` variant, plus keyboard reorder. **Delete app** confirm 400, destructive, typed confirmation is not required (it is not an org-level delete) and the app lands in Trash.
- **States**: loading = rail pulse plus a skeleton table (today a bare `Loader2`, misc-apps #21); empty = the four-dot 2x2 illustration + "No rows yet", no second button; error = "Couldn't load this app" with Retry; **404** = the standard in-shell 404 with `BackButton{fallbackHref="/build"}` and the sentence "That app does not exist, or it was deleted." Today the page silently `router.push("/build")` with no message, which reads as a bug; read-only = none; denied = `notFound()` for a Member, an Agent or a Guest (§2.3 States, access §5.3), and `<AppOff app="build">` only for an Owner or Admin whose org hid or floored the app; offline and session expiry from the shell.
- **Keyboard**: `↑ ↓` rows, `Enter` edits the focused cell, `Esc` cancels the cell then closes the modal, `⌘K`, `?`.
- **Data**: `GET /api/build/apps/[slug]`, `GET/POST/PATCH/DELETE /api/build/apps/[slug]/rows`, `PATCH /api/build/apps/[slug]` (rename, archive). Every route gains `requireCan("manage", { type: "app", key: "build" })`. Archive writes a `TrashItem` with `entityType: "app"`.
- **Realtime**: refetch on focus; no poller.
- **What changes vs today**: the dynamic Tailwind classes `bg-${app.hue}-100 text-${app.hue}-600` at `page.tsx:136`, which Tailwind cannot generate and which therefore render the tile unstyled for every hue, are deleted along with the hue concept (misc-apps #18); the hand-rolled header with `text-2xl`, `rounded-2xl` and `#0073EA` literals becomes the standard header stack; `<Link href="/build">← All apps</Link>` becomes `BackButton`; `Loader2` becomes skeletons; the unused `CellValue` component at lines 247-277 is deleted; the "Built with Vibe" pill is deleted.
- **Open questions**: none.

---

### 2.5 `/store`  (`src/app/(dashboard)/store/page.tsx`)

- **Purpose**: see everything WorkwrK can do, and turn on the parts your company wants.
- **Who sees it and entry points**: every Member browses; Owner and Admin turn things on and off. Guests never. Entry: AI sidebar APPS › **Marketplace** (spec-ai-automation §1 row 10); `⌘K` "Marketplace"; the footer text link "Marketplace" on Settings › Apps and modules (settings-architecture §5.3); search. **Not** from the `<ModuleOff>` screen: an earlier draft listed a "See what else WorkwrK can do" text link there, which exists in neither decided doc. settings-architecture §2.4 specifies that screen as the on and off switch for Owners and Admins and, for everyone else, "Ask an admin to turn on Talk" with the Owners' and Admins' avatars and **no link**, and access §5.5 item 5 agrees. The link is withdrawn; a person who cannot turn a module on is not sent shopping.
- **Top bar**: ‹ › then "AI › Marketplace"; search; "+"; bell; "?"; avatar.
- **Secondary sidebar**: AI hub sidebar; APPS › Marketplace active.
- **Page header stack**:
  - Title row 48: **Marketplace** 22/600. Right: nothing. No hero, no fake avatar stack, no "50+ integrations supported" claim.
  - Views row 36: text-tab pills **All · On · Off**.
  - Toolbar row 44: left **Filter** (Plan: Included in your plan / Add-on), **Sort** (Name, Recently added); no Group, no view-type switcher. Right: the one primary **"Suggest an app"** (36px `--os-brand`, white 14/500, 16px `Plus`, radius 6), rendered for **every** Member including those who cannot turn a module on. It is the only action on this page that everyone can take and the only thing the page creates, so it is the page's one primary and it sits where every primary in the product sits. An earlier draft buried it in the "…" overflow while leaving the page with no primary at all, which made the page's one real control its least findable one. Then the bordered 36px "…" square holding **Display** (Density) alone.
- **Body layout**: a card grid, `repeat(auto-fill, minmax(300px, 1fr))`, 16px gap, 8px under the toolbar. One `ModuleCard` per entry (§3), and the inventory is **real**:
  1. Every entry in the `MODULES` registry (`src/lib/modules.ts`), which today is **Talk** and **Tables**.
  2. Two link cards, **Build apps** (to `/build`, rendered only for Owner and Admin) and **Integrations** (to `/integrations`, every Member), so the neighbouring AI rows are discoverable from one place. There is **no Connections card**: `/automation/connections` is Owner and Admin only, so linking it from a page every Member can open would send most viewers to a denial. The second card's label and destination follow the naming canon in §1.
  Card contents follow settings-architecture §5.3's module card exactly, so the two surfaces cannot drift: a 20px module glyph in a 32px neutral tile, name **16/600**, a "Competes with {Slack + Zoom}" line 13/400 `--os-ink-2`, the blurb 13/400 on the next line, an "Included in {plan}" or "Add-on" `Chip` at the right of the title row, and a `Switch` at the far right. An earlier draft of this spec used its own geometry (`EntityTile size="md"`, name 15/500, a "Replaces" line); settings-architecture wins on the settings surface and this page adopts its card rather than inventing a second one. The footer is **one control**:
  - Owner or Admin: the `Switch` (track `--os-line-strong` off, `--os-brand` on) with the word "On" or "Off" 13/500 beside it, optimistic with revert, autosaving through `POST` and `DELETE /api/products/installations` with an inline "Saved ✓" 12/500 `--os-success-text` that fades after 2s. Turning one **off** opens the access spec's confirm, 400 wide: "Turning this off locks {N} channels for everyone until it is turned on again. Nothing is deleted." Cancel / Turn off.
  - Member or Agent: a 13/400 status line, "On" with a 6px `--os-presence` dot, or "Off · ask an admin" in `--os-ink-2`. Never a disabled switch.
  - When on, a text link **"Open Talk"** 14/500 `--os-brand-deep` at the right of the footer.
  **One switch, one component, but only if the settings unit takes it.** This spec proposes `ModuleCard` (§3) with a `variant` prop so the same control serves this grid, the Settings › Apps and modules rows and the `ModuleOff` screen. `spec-settings-workspace.md` §5.3 currently specifies its card inline and does not reference a shared component, so the adoption is an **ask on the settings unit**, listed in §4, not a fact asserted here. If that unit declines, the two cards stay behaviourally identical by contract: the same two API calls, the same confirm copy, the same optimistic-with-revert write, and the same event. The event is the existing **`workwrk:prefs-changed`**, which settings-pages and spec-settings-workspace both already dispatch and the rail already listens to; the earlier draft's `workwrk:modules-changed` appears in no other spec and is withdrawn.
- **Side panel, drawer, modal**: **Suggest an app** modal, 560, opened by the page's one primary button: one textarea "What would you want WorkwrK to do?", an optional "Email me when it exists" `Switch` (defaults on), Cancel ghost left of one primary **"Send"**, calling `POST /api/marketplace/requests`. A toast confirms: "Thanks. We read every one of these." This is the only action on the page for a Member and it is real, which is why the page survives at all, and why it is the primary rather than an overflow row.
- **States**: loading = rail pulse plus 4 card skeletons (`--os-skeleton` blocks at the card's height); empty = impossible (the registry always has entries), but the filtered-empty case renders the inline "No results · Clear filters" row; error = "Couldn't load Marketplace" with a wired Retry; read-only = the Member footer above; denied = Guest `notFound()`; offline and session expiry from the shell.
- **Keyboard**: `⌘K`; `Tab` walks the cards, `Space` toggles the focused switch; `Esc` closes the modal; `?`.
- **Data**: `GET /api/products` (the real registry plus this org's `ProductInstallation` rows and the plan's entitlement), `POST /api/products/installations`, `DELETE /api/products/installations` (both `requireCan("manage", { type: "settings", page: "apps" })`). New: `POST /api/marketplace/requests { text, notify }` writing an `AppSuggestion` row (`id, organizationId, userId, text, notify, createdAt`) and `GET /api/marketplace/requests` for Owners and Admins, surfaced on Settings › Apps and modules as a count, not on this page.
- **Realtime**: refetch on focus; the switch write dispatches the existing `workwrk:prefs-changed`, which the rail already listens to, so a hub appears or disappears without a reload. No new event is introduced.
- **What changes vs today**: this is the largest honesty fix in the unit.
  - The `Install` and `Installed` buttons at `page.tsx:224-233`, which have **no `onClick` at all**, become the one real switch (misc-apps High #3, critic #2).
  - `getAllModules()` from the demo fixture catalog and the hard-coded `INSTALLED` set at `page.tsx:55-61` are deleted. Those fixtures list CRM, Helpdesk, ITSM, Legal, Financials, Procurement and Marketing, every one of which the PPMS scope removed, and the "N apps installed" count came from a constant.
  - The 13 category buttons and their gradients (`GRAD.bluePurple`, `GRAD.pinkPurple`, `GRAD.orangePink` and the rest) are deleted along with the taxonomy Sales / Support / IT / Legal / Finance / Engineering, which contradicts the product's positioning.
  - `FEATURED_INTEGRATIONS` is deleted; connectors live on `/integrations` and nowhere else, which collapses the overlapping integration doors (misc-apps #17, critic #3). Marketplace sells WorkwrK's own parts and links to Integrations once, as a card.
  - The hero's "50+ integrations supported" is deleted; `/integrations` says which connectors are real and which are not built yet, and two pages must not contradict each other.
  - The fake `PEOPLE.bb, PEOPLE.mk +3` avatar stack in the title bar is deleted (misc-apps #13, critic #2).
  - `src/components/products/catalog-stub-page.tsx` is deleted: it links to `/studio`, which does not exist, uses a violet palette that the brand rules forbid, carries a disabled "Notify me" button, and is reachable only for `COMING_SOON` slugs, of which the catalog has none (misc-apps #24).
  - The `.os-mkt*` BEM family is deleted from `os.css`.
- **Open questions**: (1) Marketplace and Settings › Apps and modules now show the same switch on the same card. Keep both doors (Marketplace to browse and be tempted, Settings to administer), or make Marketplace the only browse surface and leave Settings › Apps and modules as a plain list? The spec keeps both because the settings spec asks for the footer links and because a Member can browse Marketplace but cannot open Settings, so they are not the same audience.

---

### 2.6 `/integrations`  (`src/app/(dashboard)/integrations/page.tsx`)

**Ownership, and why the route survives.** This spec had 308'd `/integrations` to `/automation/connections` saying the AI spec won, while `spec-ai-automation.md` kept the route and recorded that its own earlier deletion was withdrawn. Each file was deferring to the other, and the route would have been deleted by one and kept by the other. It is **kept**, on access grounds: `access-model-spec.md` §5.2.1 carries an `integrations` row in the AI hub reading "every Member browses the catalogue", `/automation/connections` is Owner and Admin only, and a 308 would therefore have taken a destination away from every Member and handed them a denial instead. `settings-architecture.md` §5.4 and §7.1 also name `/integrations` as the surviving marketplace for other people's tools. Ownership splits and neither unit owns both halves: the **sidebar row is `spec-ai-automation.md`'s** (AI hub, APPS section, `Plug`, §1), the **page below it is this unit's**, specified here.

**The two pages do not repeat each other.** Integrations is the catalogue of other people's tools, browsable by everyone, where demand is collected. Connections is where an automation sends things, today the webhook, and is Owner and Admin only. The four providers the old Connections page faked (WhatsApp, Gmail, Google Calendar, Slack) leave that page and become real **Request this** cards here.

- **Purpose**: see which of the tools you already use WorkwrK can talk to, set up the ones that are ready, and ask for the ones that are not.
- **Who sees it and entry points**: every Member browses; Owner and Admin connect. Guests never. Entry: AI sidebar APPS › **Integrations** (spec-ai-automation §1); `⌘K` "Integrations" (which retires "Connect apps" and "Integrations marketplace"); the **Integrations** link card on Marketplace (§2.5); the footer text link on Settings › Apps and modules; the `/settings/integrations` 308 lands on `/settings/api`, whose "App marketplace" card points at `/store` and whose connector line points here; search.
- **Top bar**: ‹ › then the breadcrumb "AI › Integrations" (last crumb 14/500 `--os-chrome-fg`, not clickable); the 400px global search; "+", bell, "?", avatar. No page action on the bar.
- **Secondary sidebar**: AI hub sidebar; APPS › Integrations active; the AUTOMATION section keeps its own state.
- **Page header stack**:
  - Title row 48: **Integrations** 22/600 `--os-ink`. Right: nothing. No hero, no fake avatar stack, no "50+ integrations supported" claim.
  - Views row 36: text-tab pills **All · Ready · Requested**. "Ready" is the set that can be set up today; "Requested" is what this org has asked for, with the viewer's own requests marked.
  - Toolbar row 44: left **Filter** (`Funnel` 16px + "Filter", 36px toggle chip), **Sort** (Most requested, Name A to Z); no Group, no view-type switcher. Right: for Owner and Admin the one primary **"Request a connector"** (36px `--os-brand`, white 14/500, 16px `Plus`, radius 6) opening the same modal a card's Request this opens with an empty name; for a Member the same button, because asking is the action every Member can take here and it is the page's one primary. Then the bordered 36px "…" square with **Display** (Density) alone.
- **Body layout**, in reading order:
  1. When Filter is open, the 272px `FilterPanel` at the left with a 16px gap. Heading "Filter connectors by" 16/600 with "Clear all"; then the 36px **row search** (placeholder "Search connectors", matches name and category, writes `?q=`, focused by `/`, per §1 "Finding one row on a long page"); then 36px checkbox rows **Category** (Calendar, Identity, Messaging, Storage, Analytics) and **Status** (Ready, Not built yet, Requested).
  2. A card grid, `repeat(auto-fill, minmax(300px, 1fr))`, 16px gap, 8px under the toolbar, one `ConnectorCard` per row: a 20px connector glyph in a 32px **neutral** tile (`--os-surface-hov`, `--os-ink-2`; no vendor colour, no gradient), name 16/600, the category as a 24px neutral `Chip` at the right of the title row, then one plain sentence 13/400 `--os-ink-2` saying what it does in the user's words. The footer is **one control** and never two:
     - **Ready, and the viewer can set it up**: a 32px secondary **"Set up"** linking to the real destination in the table below.
     - **Ready, but setting it up is somebody else's job**: a 13/400 line "Ask an admin to connect this" in `--os-ink-2`. Never a disabled button.
     - **Already connected**: 13/400 "Connected" with a 6px `--os-presence` dot, and a text link "Manage" to the same destination for the people who can.
     - **Not built yet**: `RequestButton` (§3) reading **"Request this"**, which becomes a 13/400 count line ("Requested · 7 people here want this") after the click, with Undo in the toast for 10 seconds. The word "Coming soon" is never rendered as a control, and never rendered at all on a row nobody has committed to (critic #15).
  3. **Three connectors are genuinely ready today and are never shown as not built.** Calling a live capability "coming soon" is the same dishonesty this page exists to end:

     | Connector | Category | Set up at | Who can |
     |---|---|---|---|
     | Google Calendar | Calendar | `/account/connections` (My settings › Calendar and connections, planner unit §2) | every Member, it is a personal connection |
     | Single sign-on (SAML: Okta, Microsoft Entra ID) | Identity | `/settings/security?tab=sso` | Owner, or Admin with the `security` scope; everyone else reads "Ask an admin to connect this" |
     | Directory sync (SCIM) | Identity | `/settings/security?tab=provisioning` | same |

     Google Calendar renders only when `GET /api/integrations/google-calendar` reports `available`, so an unconfigured deployment never advertises it. Single sign-on renders only under `UserPreference.home.ui.showUpcoming` until the SAML login route is verified end to end, because settings-architecture §5.9 hides the SSO tab on exactly that condition and two surfaces must not disagree.
  4. **Four cards arrive from Connections, as real Request-this rows**: **WhatsApp**, **Gmail**, **Google Calendar** (which is Ready, above, rather than a request) and **Slack**. On `/automation/connections` these were Connect buttons with no backend behind them (misc-apps High #3's sibling); here they are honest rows that count demand.
  5. **Two rows are deleted, not moved**: **Stripe** ("sync payments into the GL ledger") and **QuickBooks** ("mirror invoices, expenses and journal entries"). Finance left the product on 2026-06-03, and a row for a module that will not exist is a promise the product cannot keep.
  6. **Two rows render only behind the preference**: **Looker** and **Metabase**, retagged "Embed a saved dashboard in a doc", rendered only when `UserPreference.home.ui.showUpcoming` is on (settings-architecture §4, §9.2; default off). This is the one place in the unit that deliberately renders a not-built-yet row on a timeline, and it names its key and its home.
  7. **Every remaining tagline is rewritten** to a thing WorkwrK would actually do, in the user's words, with no em dashes and no developer jargon.
- **Side panel, drawer, modal**: **Request a connector** modal, 560, header 56: a **Name** input (pre-filled and read-only when opened from a card), a textarea "What would you use it for?", an optional "Email me when it exists" `Switch` (defaults on), Cancel ghost left of one primary **"Send request"**. A toast confirms: "Thanks. We read every one of these." No drawer, no detail route: a connector has no page of its own.
- **States**:
  - Loading: the rail logo dots pulse after 200ms; 6 card skeletons at the card's height in `--os-skeleton`, one 1.6s opacity pulse, and one 13/400 `--os-ink-2` line carrying the rotating company value. No `Loader2`.
  - Empty: impossible, the catalogue always has rows; the filtered-empty case is the inline 44px "No results · Clear filters" row.
  - Error: "Couldn't load Integrations", the error sentence second, and a **wired Retry** text link.
  - Read-only: the Member footer above, per access §5.4. Fewer controls, never disabled ones.
  - Denied: Guest `notFound()` (situation 1 in §1 Denial); app hidden or floored in Settings › Apps, `<AppOff app="integrations">` at the same URL with the `/settings/apps` link for Admins.
  - Offline or session expired: the shell's 401 interception and offline banner (spec-shell §2.15).
- **Keyboard**: `⌘K`; `/` opens the filter panel and focuses the row search; `Tab` walks the cards, `Enter` fires the card's one control; `Esc` closes the modal, then the filter panel; `?` opens the shortcut overlay. Every icon-only control carries a tooltip after 400ms and an `aria-label`.
- **Data**:
  - `GET /api/integrations` (the static connector registry joined to this org's request counts, connection state and the two feature checks; gains `?q=&category=&status=&sort=&cursor=`), gated `requireCan("view", { type: "app", key: "integrations" })`.
  - `GET /api/integrations/google-calendar` for the availability check that decides whether the Google Calendar card renders at all.
  - New: `POST /api/integrations/requests { key, note, notify }` and `GET /api/integrations/requests`, backed by `IntegrationRequest { id, organizationId, key, userId, note, notify, createdAt, @@unique([organizationId, key, userId]) }`. The unique key is what makes the count a count of people rather than of clicks. Owners and Admins read the totals on Settings › Apps and modules as a number, not as a second page.
  - Settings read: `UserPreference.density`, `UserPreference.home.ui.showUpcoming`. No new settings key.
- **Realtime**: refetch on window focus and after a request write. No poller.
- **What changes vs today**:
  - `integrations/layout.tsx`'s `requireManagerOrRedirect` is deleted, so the `⌘K` entry stops silently bouncing a Member to `/today` (misc-apps 1.8 issue 1) and the page finally matches the "every Member browses" rule it was always supposed to have.
  - The KPI tiles (Catalog / Categories / Status = Preview) and the inline-styled banner go (misc-apps 1.8 issue 3); the page-local `KpiTile` and the `.ing__*` BEM family are deleted from `os.css`.
  - The header `Settings` and `Calendar` nav links go (settings-architecture §2.4 removes them by name); `OsTitleBar` and its dead Ask AI / Share / Invite trio go with them (critic #2).
  - "Coming soon" as a static span on every card becomes one of four real footers: a Set up link, an Ask-an-admin line, a Connected state, or a counted Request this.
  - The three overlapping integration doors become **two, each with one job** (misc-apps #17, critic #3): Integrations is the catalogue of other people's tools, Connections is where automations send things, and `/settings/integrations` 308s to `/settings/api` with its "App marketplace" card re-pointed at `/store`.
  - The four faked provider Connect buttons leave `/automation/connections` and land here as Request-this cards, so no page carries a button with no backend.
- **Open questions**: (1) Should a connector request notify anyone, or only accumulate a count? This unit's answer is a count and nothing else, because a notification per request is noise; if the founder wants the signal actively, a weekly digest to Owners is one cron row. (2) The registry is a static file today. Once the counts are real, the ordering of the grid is a product decision (most requested first, or a curated order), and this spec defaults to most-requested because that is the only honest signal the page has.

---

### 2.7 `/marketing`  (`src/app/(dashboard)/marketing/page.tsx` → `src/app/(dashboard)/marketing/[[...slug]]/page.tsx`)

- **Purpose**: none after this change. Marketing is not part of a People and Project Management System; the work it held becomes a Space made of Lists, which is the product's stated way to build a vertical.
- **Who sees it and entry points**: nobody navigates here. There is no `APP_RULES` row, no sidebar row, no palette entry, no launcher tile and no `matchPaths` today either; the only reach is a typed URL, a bookmark, or the dead `dept-home.ts`. After the change: Owner and Admin who type the URL land on the legacy import; everyone else gets the in-shell 404.
- **Top bar**: never painted. The resolver is a server component that redirects or calls `notFound()` before any page code runs.
- **Secondary sidebar**: n/a.
- **Page header stack**: n/a.
- **Body layout**: the replacement is one server component covering `/marketing` and every child path:
  1. `gatePage` resolves the viewer. A Guest gets `notFound()`.
  2. It looks for the migrated Space by its marker, `Space.metadata.legacySource = "marketing"`, and for its three Lists by `Board.metadata.legacyKind` of `"campaigns"`, `"content"` and `"events"`. **These markers are data written by the importer, not a setting.** An earlier draft stored the id in `settings.legacy.marketingSpaceId`, which has no home: settings-architecture §9 lists every `PATCH /api/settings` section and every one is `.strict()`, so a `legacy` section does not exist and an unknown key returns 400, and no settings page renders or edits such a value. A marker on the object the importer creates needs no door, survives a Space rename, and is exactly the kind of thing `metadata` is for. The lookup is one indexed query per request on a route that only redirects, and its result is cached for the request.
  3. **Migrated**: 308 to the target for the requested path, `/marketing` → `/spaces/{slug}`, `/marketing/campaigns` → `/boards/{campaignsListSlug}`, `/marketing/content` → `/boards/{contentListSlug}`, `/marketing/events` → `/boards/{eventsListSlug}`, `/marketing/{id}` → `/item/{Campaign.customFields.migratedItemId}` (and, when that id is absent, to the Campaigns List).
  4. **Not migrated, viewer is Owner or Admin**: 307 to `/settings/data?tab=import&legacy=marketing`. The `?legacy=` query is **an ask on the settings unit** (§4): Settings › Data › Import must accept it and scroll to, and pulse, the "Marketing (legacy)" row, the same way `/settings/apps#modules` arrives scrolled to its section (settings-architecture §12). Without that the person lands on a page of import rows with no idea which one they were sent for. If the settings unit declines the query, the 307 target becomes the plain `/settings/data?tab=import` and the row carries its own explanation.
  5. **Not migrated, anyone else**: `notFound()`.
  The 308 for the migrated case is permanent because the destination is stable; the 307 is temporary because it stops applying the moment the import runs.
- **Side panel, drawer, modal**: none. The resolver paints nothing, so there is nothing to open or close.
- **Where the work goes (nothing is lost)**:
  1. **A Space template.** The Template Center gains a seeded Space template **"Marketing"** (kind SPACE, spaces-lists §2 `/templates` owns the Template Center) with three Lists: **Campaigns** (fields Status, Channel, Budget, Spent, Start date, End date, Goal metric, Goal target, Owner), **Content** (Status, Type, Channel, Publish date, Link), **Events** (Date, Format, Capacity, Registered, Spend, Page link). Every one of those fields already exists as a task field type, which is the point: the vertical is Lego, not a module.
  2. **A one-click importer**, on Settings › Data › Import as the row **"Marketing (legacy)"**, rendered only for orgs holding at least one `Campaign`, `ContentPiece` or `MarketingEvent` row. This is the exact precedent the settings spec sets for the legacy Purchase-order and Invoice exports, which render only for orgs that hold such rows. The importer creates the Marketing Space from the template, writes one task per row with its fields and its `currency`, writes `Campaign.customFields.migratedItemId` back so old campaign links resolve, and stamps `Space.metadata.legacySource = "marketing"` plus `Board.metadata.legacyKind` on the three Lists so the resolver can find them. It is idempotent and reports a dry run before it writes. **Nothing is deleted**; the `Campaign`, `ContentPiece` and `MarketingEvent` tables stay.
  3. **An export**, on Settings › Data › Export under the existing "Legacy" divider and on the same condition: **"Marketing (legacy) CSV"**, one file per entity, so an org can take the data without importing it.
- **States**: the resolver has no visual states of its own. The 404 is the standard in-shell 404 with `BackButton{fallbackHref="/today"}`; the settings redirect lands on a page with its own states.
- **Keyboard**: n/a.
- **Data**: reads the `Space.metadata.legacySource` and `Board.metadata.legacyKind` markers and, for the campaign case, `Campaign.customFields.migratedItemId`. It reads no settings key, so it adds nothing to any `.strict()` section. The CSV export formats money through `useOrgCurrency` on the existing `settings.currency`, with each row's own `Campaign.currency` winning where it is set, which is the fix for the hard-coded `₹`. The existing `/api/marketing/campaigns`, `/api/marketing/content` and `/api/marketing/events` routes are kept **read-only** for one release (GET only, `requireCan("manage", { type: "settings", page: "data" })`) so the importer and the CSV export can read them, then deleted with their pages. Their POST and PATCH handlers go immediately, because `resolveSuiteContext` checks only the session, which today lets any employee create and patch campaigns (misc-apps 1.19 issue 6).
- **Realtime**: n/a.
- **What changes vs today**: five orphaned pages, roughly 1,930 lines, go. With them go: the fake `PEOPLE.bb/mk/an +3` avatar stacks on three of them; the hard-coded `₹` with lakh and crore formatting (`page.tsx:75-80`) on a model that already carries a `currency` column; the "Reports" launch tile that advertises "performance and ROI dashboards" and links to the campaigns list; the dead `MoreHorizontal` button with no handler on the campaign detail (`[id]/page.tsx:222`); the two bare `history.back()` buttons; the `/marketing/events` hero that links to an anchor on its own page; the "Activity: coming soon" placeholder panel; the hidden empty and error CTAs on all four list pages; and the name collision with the public `(marketing)` route group. The `os.css` families `.mkt__*`, `.cmps__*`, `.evts__*`, `.camp__*`, `.lib__*` and `.os-mkt*` are deleted, as are `src/lib/dept-home.ts` (which routes to `/crm`, `/dev`, `/itsm`, `/helpdesk`, `/legal`, `/procurement`, all removed) and the product-catalog entry `workwrk-campaigns`.
- **Open questions**: (1) Do any live orgs actually hold campaign, content or event rows? If none do, the importer is dead code and the redirect can be a plain 308 to `/templates?q=marketing`. A count query before build settles it, and the answer changes roughly a day of work.

---

### 2.8 `/marketing/campaigns`  (`src/app/(dashboard)/marketing/campaigns/page.tsx`)

- **Purpose**: none after this change; campaigns become tasks in the Campaigns List of the Marketing Space.
- **Who sees it and entry points**: reached only by a typed URL or by the links on the other Marketing pages, all of which are deleted. After: the resolver in §2.7.
- **Top bar / Secondary sidebar / Page header stack / Body layout**: never painted; folded into the `[[...slug]]` resolver.
- **Side panel, drawer, modal**: none.
- **States**: the resolver's three outcomes (§2.7).
- **Keyboard**: n/a.
- **Data**: `GET /api/marketing/campaigns` stays read-only for the importer and the CSV, then goes.
- **Realtime**: n/a.
- **What changes vs today**: the page goes with its bare `history.back()` at line 205 (forbidden by the project's back convention and, on a fresh tab, it leaves the app), its five-segment status pipeline bar that has no Cancelled segment for a status the model has, its hidden empty and error CTAs, its quick actions (Launch, Pause, Resume, Complete) that render for everyone against an ungated API, its fake avatars and its hard-coded `₹`.
- **Open questions**: none.

---

### 2.9 `/marketing/content`  (`src/app/(dashboard)/marketing/content/page.tsx`)

- **Purpose**: none after this change; content pieces become tasks in the Content List.
- **Who sees it and entry points**: reached only from `/marketing`, which is deleted. After: the resolver in §2.7.
- **Top bar / Secondary sidebar / Page header stack / Body layout**: never painted.
- **Side panel, drawer, modal**: none.
- **States**: the resolver's three outcomes.
- **Keyboard**: n/a.
- **Data**: `GET /api/marketing/content` stays read-only for the importer, then goes.
- **Realtime**: n/a.
- **What changes vs today**: the page goes with the only hand-rolled gradient icon-tile header left in the product (the pattern `OsTitleBar` explicitly removed), the single `prompt` create that always writes BLOG_POST and IDEA, the complete absence of any edit control (status, type, channel, dates and URLs can never be set, so the status pill reads "Idea" forever and the Brief, Draft and Live links never appear), the plain-text loader, the bare-div error and the fact that it is the only page in its family with no back link at all, that is, a dead end.
- **Open questions**: none.

---

### 2.10 `/marketing/events`  (`src/app/(dashboard)/marketing/events/page.tsx`)

- **Purpose**: none after this change; events become dated tasks in the Events List, where the Planner and Calendar already know how to show them.
- **Who sees it and entry points**: reached only from `/marketing`. After: the resolver in §2.7.
- **Top bar / Secondary sidebar / Page header stack / Body layout**: never painted.
- **Side panel, drawer, modal**: none.
- **States**: the resolver's three outcomes.
- **Keyboard**: n/a.
- **Data**: `GET /api/marketing/events` stays read-only for the importer, then goes.
- **Realtime**: n/a.
- **What changes vs today**: the page goes with its bare `history.back()` at line 249, its "Next up" hero that links to an anchor on its own page and never appears for a UI-created event (dates, capacity and format cannot be set anywhere), its "Spent" KPI labelled with a `MapPin` glyph, its hidden empty and error CTAs and its hard-coded `₹`.
- **Open questions**: none.

---

### 2.11 `/marketing/[id]`  (`src/app/(dashboard)/marketing/[id]/page.tsx`)

- **Purpose**: none after this change; a campaign becomes a task, and the task detail (task-detail unit) is the one place a record opens.
- **Who sees it and entry points**: reached only from the campaign tiles and rows. After: the resolver redirects to `/item/{migratedItemId}`, so an old bookmark lands on the migrated record rather than a 404.
- **Top bar / Secondary sidebar / Page header stack / Body layout**: never painted.
- **Side panel, drawer, modal**: none.
- **States**: the resolver's three outcomes, plus one more: migrated, but this campaign has no `migratedItemId` (it was created after the import), in which case the redirect target is the Campaigns List and a toast on arrival reads "That campaign was not moved. It is in the list."
- **Keyboard**: n/a.
- **Data**: `GET /api/marketing/campaigns` (the page today fetches the whole list and `.find`s, there is no get-by-id) stays read-only for the importer, then goes.
- **Realtime**: n/a.
- **What changes vs today**: the page goes with its dead `MoreHorizontal` button at line 222, its read-only scoreboard whose rings are always zero because budget, spent, channel, goal and dates cannot be set anywhere in the suite, its "Activity: coming soon" placeholder panel, its `router.push("/marketing")` back button and its hidden not-found CTA.
- **Open questions**: none.

---

### 2.12 `/trash`  (`src/app/(dashboard)/trash/page.tsx`)

- **Purpose**: get back anything you deleted, from anywhere in the app, before it is gone for good.
- **Ownership**: **this page is specified by `spec-spaces-lists.md` §2 `/trash`** and is not re-specified here. Its purpose, entry points, top bar, Work-hub sidebar row, header stack, Deleted and Archived pills, `TableCard` columns, Restore and Restore-to flows, bulk bar, Empty-trash action, states, keyboard map, API shape and realtime rules are that spec's. This unit agrees with all of it and adds nothing to the page's chrome.
- **Who sees it and entry points**: every Member sees rows they deleted or hold Full access on; Owner and Admin see everything and can delete permanently; Guests never (spaces-lists §2, access §5.2.1 `trash`). This replaces today's `isManager` gate on `/api/trash` (misc-apps 1.13 issue 2). **The profile-menu "Trash" row is removed** (misc-apps 1.13 issue 1). Fixing the gate makes the row work, but working is not the same as belonging: `spec-spaces-lists.md` §2 lists five doors to `/trash` (the Work sidebar row, the Settings › Data link card, the post-delete toast action, the `/docs/trash` redirect and search) and the profile menu is not among them, and one destination should not also hang off the avatar menu, which is where a person's own account lives. Trash is workspace content, not account settings. **Ask on the shell unit** (§4): delete that row from the profile menu. Nothing is lost, because the Work sidebar row is permanent and visible to exactly the same people.
- **Top bar / Secondary sidebar / Page header stack / Body layout / Side panel / States / Keyboard / Realtime**: spaces-lists §2 `/trash`.
- **What this unit owes that page** (the only new content here):
  1. **One trash, fed from here too.** Deleting a **Tool** (§2.1), an **Asset** (§2.2) or a **Build app** (§2.3, §2.4, including Archive) writes a `TrashItem` snapshot instead of hard-deleting, with `entityType` `"tool"`, `"asset"` and `"app"` respectively, the object's display name as `label`, and the actor as `deletedByName`. Today all three routes hard-delete and the object is gone.
  2. **The type filter gains three values, as an ask that must be accepted.** `spec-spaces-lists.md` §2 `/trash` fixes the Filter panel's Type list as Space, Folder, List, Task, Doc, Canvas, Table, File, SOP, Policy, Contract, Template, and names only the Docs and Tables units in its open question. This unit asks for three more values, **Tool**, **Asset** and **App**, with the same 16px glyphs those objects use everywhere else (`Wrench`, `Boxes`, `Hammer`, which is also why the AI unit's Build apps row moves off `Wrench`, §1), plus the three matching `entityType` cases on restore and purge. The ask is recorded in §4 and in §2.12's open questions, and the "one trash" claim in this spec holds only once spaces-lists accepts it. Until it does, deleting a Tool, an Asset or a Build app still writes its `TrashItem` snapshot, so no data is lost in the gap; the rows would simply be unfilterable by type.
  3. **Restore rules.** A Tool restores with its grants intact (the `AccessGrant` rows are soft-deleted with it and restored together) and with its saved login intact. An Asset restores unassigned if the person it was assigned to has since been deactivated, and the row shows the sentence "Restored unassigned, {name} is no longer active". A Build app restores with its rows. None of the three has a container, so "Restore to…" never applies to them.
  4. **Retention.** All three obey `settings.retention.trashDays` (60 default) and the retention purge cron, not a hard-coded 60 (misc-apps §6, "Trash retention: 60 days hard-coded in `trash/page.tsx:40` and the API").
- **Data**: this unit's contribution is only in the write paths listed above plus the three new `entityType` cases in `POST /api/trash/[id]/restore` and `DELETE /api/trash/[id]`.
- **What changes vs today**: the four trash surfaces become one (critic #3): `/docs/trash` redirects here (docs unit), the Contracts "Trash" view and the Docs "Archived" view become filters of this page, and this unit stops creating a fifth by hard-deleting tools, assets and apps.
- **Open questions**: (1) cross-unit, already raised by spaces-lists: the Docs and Tables units must agree that their archives are listed by this route. This unit adds the same ask for itself and answers it yes. (2) cross-unit, raised here and **not yet accepted by spaces-lists**: the three new Type values (Tool, Asset, App) and the three new `entityType` cases on `POST /api/trash/[id]/restore` and `DELETE /api/trash/[id]`. This is a one-way ask today, which is why it is written as an open question rather than as a settled fact; the spaces-lists unit owns the answer.

---

### 2.13 `/loader-preview`  (`src/app/loader-preview/page.tsx`)

- **Purpose**: none for a user. It is a developer gallery that renders `DotsLoader` at three sizes on a light and a dark card, and it is publicly reachable in production today, outside the auth boundary.
- **Disposition**: **removed.** The route file and its entry in the proxy route list are deleted. This agrees with `spec-shell.md` §0 and §2.7, which already delete it; the brief's "dev-only: remove from prod" and the shell spec's "deleted" resolve to the same thing, and a route that exists only behind an environment check is still a route that can be shipped by mistake.
- **Where the capability goes**: the loader family is fully specified in design-system §5.15 (splash, route pulse, skeletons, button pending) and §5.16 (the `Dots` variant table: `status`, `unread`, `presence`, `live`, `saving`, `quad-steps`, `steps-n`, `pending`, `grip`, `grid`). A visual gallery, if the team wants one while building those, is a Storybook story under `src/components/brand/`, which never ships a URL.
- **Who sees it / Top bar / Secondary sidebar / Page header stack / Body layout / Side panel / States / Keyboard / Data / Realtime**: n/a, the route does not exist.
- **What changes vs today**: one public page that leaks a pre-refresh loader treatment (Figtree, `#181B34`, `#FBFBFC`, `rounded 16px`, none of which survive the token pass) and one file of inline styles are deleted.
- **Open questions**: none.

---

## 3. Shared components this unit introduces or requires

Everything in `design-system.md` (`TableCard`, `FilterPanel`, `Picker`, `Chip`, `StatusChip`, `EntityTile`, `MenuList`, `MenuItem`, `ViewTab` text-tab pills, `BackButton`, `Dots`, `AutosaveIndicator`, `OsEmptyView`, `Dialog`, `Switch`, `SegmentedControl`, `Button`, `Tooltip`) and in `access-model-spec.md` (`ShareDialog`, `LockedPage`, `ModuleOff`, `AppOff`, `AccessProvider`, `useAccess`) is used, not redefined. New or reshaped here:

| Name | Lives at | Props (summary) | Used by |
|---|---|---|---|
| `ModuleCard` | `src/components/products/module-card.tsx` (new; replaces the Store's `os-mkt-card` markup) | `module` (from the `MODULES` registry plus this org's installation and entitlement), `canManage: boolean`, `onToggle(on)`, `variant: "grid" \| "row"`. Geometry follows settings-architecture §5.3 in both variants; the switch write is the same two calls and dispatches `workwrk:prefs-changed` | `/store` (grid). Settings › Apps and modules › Modules (row) and the `<ModuleOff>` screen only **if the settings unit adopts it** (§4 ask); that unit specifies its card inline today and owns the decision |
| `CredentialField` | `src/components/tools/credential-field.tsx` (new) | `label`, `value`, `masked` (default true), `canEdit`, `onChange`, `onReveal()` (writes the audit row), `onCopy()` | the Tool drawer's Login section; reusable by any future secret field |
| `ResourceDrawer` | `src/components/layout/os/resource-drawer.tsx` (new; a thin wrapper over the shell's `Drawer`) | `urlParam` (`"tool"` or `"asset"`), `title`, `breadcrumb`, `headerActions`, `showExpand: false`, `children` | the Tool drawer, the Asset drawer. It exists so a drawer with a query-param URL and no full page behind it is one pattern, not two |
| `useOrgCurrency` | `src/lib/org/use-org-currency.ts` (new) | returns `{ code, format(n): string }` from the existing `settings.currency` (settings-architecture §5.15) and the viewer's locale, using `Intl.NumberFormat`; accepts a per-row override so a record carrying its own currency formats in it | Assets value cells and totals, the legacy Marketing CSV export, any future money cell. Replaces `fmtMoney`'s hard-coded `"USD"` and the marketing pages' `₹` |
| `AppSchemaEditor` | `src/app/(dashboard)/build/_components/app-schema-editor.tsx` (new) | `fields[]`, `onChange`, `max: 20`, keyboard reorder plus a `Dots` `grip` drag handle | the New app modal's step 2 and the Edit fields modal on `/build/[slug]` |
| `RequestButton` | `src/components/ui/request-button.tsx` (new, small) | `requested: boolean`, `count: number`, `onRequest()`, `undoWindowMs: 10000`; renders a 32px secondary button reading "Request this" that becomes a 13/400 count line after the click, with Undo in the toast | `/integrations` not-built-yet cards (§2.6). It is built by this unit, because this unit owns the page that consumes it |
| `ConnectorCard` | `src/components/integrations/connector-card.tsx` (new; replaces the `.ing__card` markup) | `connector` (registry row plus this org's state and request count), `canConnect: boolean`, `onRequest()`; renders the neutral tile, name, category chip, one sentence, and exactly one of the four footers in §2.6 | `/integrations` |
| `AvatarStack` | `src/components/ui/avatar-stack.tsx` (defined by spaces-lists §3) | `people[]`, `size`, `max`, `onClick` | the Tools "Shared with" column at size 20, max 3 |

Deleted components: `src/components/products/catalog-stub-page.tsx`, `src/lib/dept-home.ts`, the `PEOPLE` fixture and `getAllModules()` fixture set in `src/components/layout/os/catalog.ts` (the `GRAD` gradients die with `OsTitleBar`), the page-local `KpiTile` implementations in `tools`, `build`, `integrations` and the three marketing pages, the hand-rolled credentials modal in `tools/page.tsx`, the unused `CellValue` in `build/[slug]/page.tsx`, and `SettingsSidebar` (deleted by the settings unit, listed here because three of its five rows are this unit's).

---

## 4. Migration and build notes

Order of work. Each step is shippable on its own and sits inside the design system's global order (tokens, type, shell, primitives first, per design §8.5).

1. **Honesty first, no design dependency.** This can ship before the token PR and removes the worst of what the critic found.
   - Delete the Marketplace fixtures and wire the real switch: `ModuleCard` on `GET /api/products` and `POST`/`DELETE /api/products/installations`, dispatching `workwrk:prefs-changed`. Delete `getAllModules()`'s store consumers, the `INSTALLED` set, the 13 categories, `FEATURED_INTEGRATIONS`, the hero claim, the fake avatars, `catalog-stub-page.tsx`. Make "Suggest an app" the page's one primary button.
   - Wire Build apps' create flow (`POST /api/build/generate` then `POST /api/build/apps`) and make "Show archived" real (`?includeArchived=1`).
   - Wire Tools: one Add-tool modal instead of two prompts, category, description, icon and delete controls, the share caller.
   - Rebuild `/integrations` on the real registry (§2.6): delete `integrations/layout.tsx`, the KPI tiles and the inline banner, replace the static "Coming soon" spans with the four real footers, delete the Stripe and QuickBooks rows, move Looker and Metabase behind `home.ui.showUpcoming`, and wire `RequestButton` to `POST /api/integrations/requests`. The four faked provider cards move off `/automation/connections` in the same PR, which is the AI unit's step 1.
   - Move the page-local search inputs into the filter panel as the row search, and add `?q=` to `GET /api/tools`, `GET /api/assets`, `GET /api/build/apps` and `GET /api/integrations`, so search stops being a filter over one loaded page.
   - Delete `requireManagerOrRedirect` from `tools/layout.tsx`, `assets/layout.tsx` and `integrations/layout.tsx`, all three of which are then deleted outright.
   - Delete the five Marketing pages behind the resolver, keep the GET routes.
   - Delete `/loader-preview`.
   - Every empty and error state in the unit gets a wired Retry or create handler (`OsEmptyView` already hides a CTA with no handler; this stops passing `cta` alone).
2. **Access pivot** (access steps 0 to 3, in lockstep with the access unit). `gatePage("view", { type: "app", key })` on all six kept routes; `requireCan` on every API listed in §2; `GET /api/tools` moves off the hard-coded `accessLevel` list to `accessibleIds(viewer, "tool", VIEW)`; `GET /api/assets` moves to `can()` with `?scope=team|all` and keeps `?mine=1` for the profile tab; the Build routes gain the Owner-and-Admin rule; `GET /api/integrations` and the two request routes gain the `integrations` key; `/api/trash*` moves off `isManager` (spaces-lists owns that change, this unit's three new `entityType` cases ride with it, if accepted). The denial convention is applied as §1's three-situation table states it: the in-shell 404 for a viewer outside an app key's audience, the default view plus a stripped parameter plus one notice line for a view of a page they already hold, `LockedPage` with Request access only for an object they can discover and hold no role on, and `<AppOff>` reserved for the Apps-config case. Nothing visual changes beyond that. `ToolShare` rows are backfilled into `AccessGrant` at role VIEW.
3. **Re-parenting.** The Teams RESOURCING rows (teams-people unit renders them, with row 20 narrowed per §1) and the AI APPS rows (AI unit renders them, with Build apps on `Hammer` and Integrations on `Plug`) appear; `ROUTE_HUB` drops `/marketing` and keeps `/integrations` under `ai`; `SettingsSidebar` is deleted by the settings unit; the profile-menu Trash row is deleted by the shell unit; the command palette entries are relabelled to the canon in §1 and filtered through `visibleApps`. After this step every page in the unit has a permanent home and a breadcrumb, which is the fix for critic #1 as it touches these routes.
4. **Tokens, type and primitives applied** (after design steps 1, 2 and 4 land). Every page in the unit moves to the header stack, `TableCard`, `FilterPanel`, `Picker`, `StatusChip`, `EntityTile` neutral, the skeleton loader, the four-dot empty states, `useOsToast`, `ui/dialog`, `BackButton`. The BEM families `.tls__*`, `.ast__*`, `.bld__*`, `.ing__*`, `.os-mkt*`, `.mkt__*`, `.cmps__*`, `.evts__*`, `.camp__*`, `.lib__*` are deleted from `os.css` in the same PRs that stop using them. The Assets `<style>` injection and the `--os-c-*` hue maps go here.
5. **The legacy Marketing migration.** The "Marketing" Space template is seeded (spaces-lists owns the Template Center); the Settings › Data › Import row and the Settings › Data › Export Legacy row are built (settings unit owns both pages, this unit supplies the importer and the CSV writer); the importer runs with a dry-run report and stamps `Space.metadata.legacySource` and `Board.metadata.legacyKind`; the resolver's 308 branch goes live; the Marketing GET routes and tables are then retired (tables kept, routes deleted).
6. **Settings this unit reads** (it introduces none). `settings.currency` on Settings › Locale and work week, `settings.retention.trashDays`, `UserPreference.density` and `UserPreference.home.ui.showUpcoming` all exist in settings-architecture with a door, a writer and now a reader here; `useOrgCurrency` is the reader that makes the currency field mean something on screen for the first time. No new key is minted anywhere in this unit: the proposed `settings.locale.currency` was the wrong path for an existing field, `settings.work.assetWarrantyDays` had no door and became a filter value, and `settings.legacy.marketingSpaceId` had no door and became a marker on the migrated Space.
7. **Copy and accessibility sweep** over the unit: no em dashes, no double hyphens, no "Coming soon" rendered as a control, a tooltip and an `aria-label` on every icon-only control, a keyboard path for every hover-only affordance, `/` reaching the row search on every list page, `aria-current="page"` on the active sidebar row.

**Data migrations**

| What | Shape | Safety |
|---|---|---|
| `ToolShare` → `AccessGrant` | one grant per share at `objectType: TOOL`, `role: VIEW`, `grantedById: sharedBy` | additive; `ToolShare` is kept for one release as a read fallback, then dropped. Dry-run report first |
| Tool, Asset and App deletes → `TrashItem` | a snapshot row per delete, from the moment step 1 ships | no backfill (past deletes are already gone); forward-only |
| Campaign, ContentPiece, MarketingEvent → tasks | one task per row in the Marketing Space's three Lists, with `Campaign.customFields.migratedItemId` written back and the two `metadata` markers stamped | idempotent, dry-run first, source tables never deleted |

No settings migration is needed. `settings.currency` already exists on every org with a country-derived default (settings-architecture §11).

**Blocked on other units**

- **access**: steps 0 to 5; the `tools`, `assets`, `build`, `store`, `integrations` and `trash` rows in `APP_RULES` (all already written in §5.2.1, and this unit follows every one of them exactly rather than widening or narrowing any, per §1 "Folded-app row audiences"); `GrantObject.TOOL` in the schema; `POST /api/access/grants`; `ShareDialog` with the unchanged four-rung ladder; `LockedPage`; `AppOff`. **Asks**: (a) decide whether `ShareDialog` should hide a rung that grants nothing on a given object type (the Can-comment-on-a-Tool question, §2.1 open question 2); the policy belongs in the access model and this unit will not subset the ladder on its own. (b) Confirm the one sanctioned exception to §1's denial table, `spec-teams-people.md`'s two app-key `LockedPage`s on `/team` and `/team/workload`, which that unit writes with an explanatory sentence and **no** Request access link; if declined, both fall back to the in-shell 404 and nothing else in any unit changes.
- **shell**: `ROUTE_HUB` without `/marketing`, with `/integrations` under `ai`; the URL-derived rail and sidebar; the 48px navy top bar with the breadcrumb; §1.16's breakpoints, which this unit defers to entirely; the 401 interception and offline banner; the deletion of `/loader-preview` from the proxy list. **Ask**: delete the "Trash" row from the profile menu (§2.12).
- **teams-people**: renders the RESOURCING section and its two rows. **Ask**: narrow its §1 row 20 gating for Assets from "every Member" to "anyone with reports, People team, Admin", so it matches access §5.2.1 and §1 here.
- **AI and automation**: `spec-ai-automation.md` owns the AI hub sidebar (the APPS section and its rows, including the **Integrations** row this unit's §2.6 page hangs from), `/automation/connections`, and the `/store`, `/build` and `/integrations` `ROUTE_HUB` prefixes. **Asks**: (a) change the Build apps row icon from `Wrench` to `Hammer`, because `Wrench` is the Tools glyph in two other specs and design §5.14 allows one icon per concept; Connections keeps `Cable` and Integrations keeps `Plug`, so no other row moves. (b) Print the row label as **Build apps**, which is what settings-architecture §5.3's footer link already says and what the page owner prints. (c) Move the four faked provider rows (WhatsApp, Gmail, Google Calendar, Slack) off `/automation/connections`; they become real Request-this cards on `/integrations` (§2.6), so Connections keeps only what an automation can actually send to. The section label **APPS** is that unit's own word and this file now uses it everywhere.
- **settings**: deletes `SettingsSidebar`; ships `/settings/integrations` → `/settings/api`; hosts the Marketing legacy import and export rows on Settings › Data and accepts the `?legacy=marketing` query that scrolls to and pulses the row (§2.7); keeps the Build apps and Marketplace footer links on Apps and modules exactly as it labels them today. **Ask**: adopt `ModuleCard` in `variant="row"` on Apps and modules and on the `ModuleOff` screen, so the module switch exists once. If it declines, both cards keep the same two API calls, the same confirm copy and the same `workwrk:prefs-changed` event, and the duplication is accepted knowingly. This unit asks for **no new settings key**.
- **spaces-lists**: owns `/trash` and the Template Center. **Asks**: accept the three new `entityType` values (Tool, Asset, App) with their Type-filter rows and glyphs, and seed the Marketing Space template. The "one trash" claim in §2.12 depends on the first.
- **planner**: owns `/account/connections`, which the Google Calendar connector row points at wherever it ends up rendering.
- **docs**: redirects `/docs/trash` to `/trash?type=doc`, so this unit's "one trash" claim holds.

**Ships independently of everything**: step 1 in full. It deletes fabricated chrome and wires real handlers without touching a token, a route table or the access layer, which makes it the cheapest possible first PR and the one that most changes how the product reads.

---

## 5. Checklist against the audit

| ID | Where it is resolved |
|---|---|
| misc-apps High #3 (Store Install does nothing, fixture catalog) | resolved by §2.5: the fixtures are deleted and the switch writes `ProductInstallation` through `ModuleCard` |
| misc-apps High #4 (`OsTitleBar` dead trio, this unit's pages) | resolved by §2.1 to §2.6: `OsTitleBar` is replaced by the header stack on all six kept pages, and the trio and the always-filled star exist in none of them |
| misc-apps High #5 (orphaned routes, the `/marketing/*` half) | resolved by §2.7 to §2.11: removed with a redirect, the data migrated and exportable |
| misc-apps High #7 (controls that 403, the Tools and Assets half) | resolved by §1 Access and §2.1, §2.2: a control the role cannot use is not rendered; the page gates and the API gates are the same `can()` call |
| misc-apps Medium #9 (gate inconsistency across nav, page and API) | resolved by §1 Access: one `APP_RULES` row per key drives the sidebar row, the page gate and the API, and the `assets` row is followed as written rather than widened |
| misc-apps Medium #10 (Build create toast, dead Show archived) | resolved by §2.3: the two-step New app modal and `?includeArchived=1` |
| misc-apps Medium #11 (Marketing has no edit path) | resolved by §2.7: the suite becomes Lists, where every field is editable by construction |
| misc-apps Medium #12 (Tools: no category, delete, share; three labels; prompt dialogs) | resolved by §2.1 and §1 Naming canon |
| misc-apps Medium #13 (fake `PEOPLE` avatars, Store and Marketing) | resolved by §2.5 and §2.7: both deleted with their pages' title bars |
| misc-apps Medium #14 (hidden empty and error CTAs) | resolved by the States heading of §2.1 to §2.5 and by build step 1: every state passes a handler |
| misc-apps Medium #16 (four trash and archive surfaces) | resolved in this unit's half by §2.12: Tool, Asset and Build-app deletes write `TrashItem` rows instead of hard-deleting, so this unit stops creating a fifth surface. The other three surfaces are closed by spaces-lists (`/trash` rebuilt) and docs (`/docs/trash` 308, the Archived view as a filter), which this spec depends on and names in §4 |
| misc-apps Medium #17 (three integration doors) | resolved by §2.5 and §2.6: the doors go from three to **two, each with one job**. `/integrations` is the catalogue of other people's tools that every Member browses; `/automation/connections` is where automations send things and is Owner and Admin only; `/settings/integrations` 308s to `/settings/api` with its "App marketplace" card re-pointed at `/store`. Marketplace sells WorkwrK's own parts and is not a connector door, and links to Integrations once. The two AI pages no longer repeat each other's rows: the four faked providers leave Connections and become Request-this cards on Integrations |
| misc-apps Medium #18 (`/build/[slug]` dynamic Tailwind classes) | resolved by §2.4: `EntityTile` neutral, the hue concept deleted |
| misc-apps Low #21 (three loader conventions) | resolved by the States heading on every route: rail pulse plus skeletons plus one value line, everywhere |
| misc-apps Low #22 (currency hard-coded) | resolved by §2.2 and §3 `useOrgCurrency` reading the **existing** `settings.currency` (settings-architecture §5.15); no new key |
| misc-apps Low #23 (label drift) | resolved by §1 Naming canon: Tools, Assets, **Build apps**, Marketplace, **Integrations**, Connections, Login, Trash, one label each. "Build apps" is chosen because settings-architecture §5.3's footer link already prints it; Integrations and Connections are two labels for two different pages, not two names for one |
| misc-apps Low #24 (`CatalogStubPage`, `/studio`, violet) | resolved by §2.5: deleted |
| misc-apps Low #27 (Assets injects `<style>`) | resolved by §2.2 and build step 4 |
| misc-apps §5 access rows for this unit | resolved by §1 Access and each route's Data heading |
| misc-apps §6, org currency | resolved by §2.2: `useOrgCurrency` on the existing `settings.currency`, edited at Settings › Locale and work week |
| misc-apps §6, Tools categories | resolved by §2.1: categories are data, with a `Picker` and a "New category…" create row, not a settings page |
| misc-apps §6, Store install state | resolved by §2.5: the state is `ProductInstallation`, written by the one switch |
| misc-apps §6, who may view credentials | **deferred.** Today everyone a Tool is shared with sees the saved login, and this spec keeps that. Splitting "can see the tool" from "can see the login" is a second right on one small object, which is the complexity the founder asked to remove, and the answer is a security judgement only the founder can make. It is §2.1 open question 1, it is not resolved by this spec, and nothing ships that pretends otherwise |
| misc-apps §6, Assets warranty window | **deferred as a setting, replaced on screen.** `settings.work.assetWarrantyDays` has no home: settings-architecture's `work` section is `defaultItemTypeId`, `capacity` and `automationsPaused`, every section is `.strict()`, and no settings page renders a warranty window. The 60-day row warning becomes a fixed product rule and the "expiring soon" question becomes a 30 / 60 / 90 choice in the Assets filter panel (§2.2). If the founder wants a per-org window, it needs a door on Settings › Locale and work week or Settings › Task system first, which is the settings unit's call |
| settings-pages 1.17 (`/settings/integrations` hub of stubs, wrong link) | resolved jointly: the settings unit ships the 308 to `/settings/api`, §2.5 re-points the "App marketplace" card at `/store`, and §2.6 rebuilds `/integrations` as the one connector catalogue the card should have meant |
| critic #1 (nav decoupled, folded apps unreachable) | resolved by §1 Hub and sidebar plus build step 3: six routes (Tools, Assets, Build apps, Marketplace, Integrations, Trash) gain a permanent, URL-derived row, two in the Teams sidebar's RESOURCING section and three in the AI sidebar's APPS section |
| critic #2 (fabricated and inert chrome) | resolved by §2.5 (Install), §2.3 (Generate), §2.7 (Marketing counters and avatars), the withdrawal of the invented `ModuleOff` link and the invented `workwrk:modules-changed` event, and the no-dead-control rule in §1 Access |
| critic #3 (duplicate surfaces) | resolved by §2.5 and §2.6 (three integration doors to two, each with one job, neither repeating the other's rows), §2.12 (four trash surfaces to one, subject to the spaces-lists ask), §2.7 (the Marketing module folded into Spaces) |
| critic #4 (fragmented access) | resolved by §1 Access: one gate, one vocabulary, one ladder with all four rungs, the access table settling all five folded-app audiences, and one denial convention whose three situations (app key excluded, view of a page you hold, object you hold no role on) are stated once with their three screens, so no unit applies the wrong one. No `accessLevel` read is left in the unit |
| critic #5 (no back convention) | resolved by §1 Back and close: `BackButton{fallbackHref}` on `/build/[slug]`, breadcrumb on every list page, four hand-rolled patterns deleted |
| critic #6 (five visual systems) | resolved by build step 4: tokens and primitives only, ten BEM families deleted, one toast, one dialog |
| critic #7 (settings that do nothing) | resolved by build step 6: this unit mints no setting and reads three that already have doors; the three keys an earlier draft invented are withdrawn; the fake `workwrk-assets` and `workwrk-campaigns` module flags are deleted rather than wired to nothing |
| critic #9 (naming drift) | resolved by §1 Naming canon, including retiring the word "install" and settling `/store`'s path question explicitly |
| critic #10 (desktop-only, hover and right-click only) | resolved by §1 Mobile and narrow (which defers every breakpoint to spec-shell §1.16): column priority, a reflowing card grid, a keyboard path for every row menu, `/` for the row search |
| critic #11 (errors swallowed, no Retry) | resolved by the States heading on every route |
| critic #13 (money and locale per surface) | resolved by §2.2 and §3 `useOrgCurrency` |
| critic #14 (dead code and stale registries) | resolved by §3 Deleted components and build steps 1 and 5 |
| critic #15 (copy hygiene, "Coming soon" as a control) | resolved by build step 7; the only Coming-soon rows this unit still asks for are Looker and Metabase behind `UserPreference.home.ui.showUpcoming`, named with their key in §2.6 |
| critic #8 (core flows broken) | partly: the Store half is resolved by §2.5. The rest of #8 belongs to other units |
| critic #12 (round trips, caps, polling) | partly: no page in this unit polls, every list is cursor-paged, and the four page-local searches become server-side `?q=`. The broader data-layer work is not this unit's |

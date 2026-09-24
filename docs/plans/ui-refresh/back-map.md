# Back map: every detail route, drawer and modal, with its back or close target

Cross-unit canon, Phase 3. Compiled 2026-09-12 from the 17 unit specs. This file settles `critic-gaps.json` topSystemicIssue #5 (back navigation has no working convention: `BackButton{fallbackHref}` on 4 or 5 routes, hand-rolled `router.push(parent)`, bare `history.back()`, text links with six different labels, and `SettingsShell` Back/×/Esc always landing on `/today`).

---

## 0. The three mechanisms, and the one rule each

| Mechanism | Job | Where |
|---|---|---|
| The bar's **‹ ›** | history | top bar, left of the breadcrumb. 32px icon buttons at `--os-chrome-fg-2`, 40% opacity with no history. They read `navStack` |
| The **breadcrumb** | hierarchy | top bar. Hub › Space › Folder › List › Item. Middle crumbs collapse to a "…" menu past 4 levels; the last crumb is not clickable |
| The **sidebar pill** | where you are | secondary sidebar, URL-derived |

**`BackButton{fallbackHref, label}`** is the one back control: a 28px ghost with `ArrowLeft` and the parent's name at 13/500 `--os-ink-2`, 8px before the title in the **title row** of every full page reached from a list. It uses browser back when the in-app history stack has an entry, and `fallbackHref` otherwise. The browser exposes no way to read the previous history entry, so no route may make its BackButton conditional on where the person came from: it is always rendered, with a fixed fallback.

**Forbidden by lint** (`no-restricted-syntax` on `history.back(` and `router.back(` outside `ui/back-button.tsx`): bare `router.back()`, `history.back()`, `router.push(parent)` as a back button, and text-link "← All …" crumbs inside page content. `router.push("/today")` from settings chrome is its own lint error; `closeSettings()` is the only exit. `components/system/go-back-button.tsx` is merged into `ui/back-button.tsx`.

**Hub pages carry no BackButton.** A page reached from a sidebar row is where the sidebar says you are; the breadcrumb and the ‹ › are the way back.

**The one Esc rule.** Esc closes **the most recently registered layer in the `LayerStack`, and nothing else**. No kind ordering, no z-index tie-break: a picker opened from inside a modal was registered after the modal, so the first Esc closes the picker and the second closes the modal, even though `--os-z-popover` sits below `--os-z-modal`. Components never register their own `keydown` listeners; they register a layer. A layer may refuse to close (the Session-expired dialog; a dirty form, which opens its confirm as a new layer instead). Toasts and the offline strip are not layers and Esc never touches them. The splash is a layer and **any** key skips it. Esc never navigates.

The five hand-rolled `keydown` listeners in `my-work-panel.tsx`, `notepad-panel.tsx`, `reminder-popover.tsx`, `voice-capture-popover.tsx` and `set-status-modal.tsx` are deleted with this rule.

**Drawers carry their page's URL.** Copy link always works, the browser Back button closes the drawer, and closing replaces the URL with the list's own (`router.replace`) without re-fetching the list underneath.

**Denial views carry a BackButton.** `LockedPage`, `ModuleOff`, `AppOff`, the in-shell 404 and the error boundary all take `BackButton{fallbackHref}`, falling back to the hub's `defaultHref` when nothing better is known. The `AdminOnly` card is the exception that proves it: it carries `BackButton{fallbackHref="/settings"}` labelled "Back to Overview". The Ask-an-admin strip needs none, because the page under it is a real destination.

---

## 1. Work hub

| Surface | Back target | Close | Esc |
|---|---|---|---|
| `/home`, `/my-work`, `/inbox`, `/activity`, `/everything`, `/favorites`, `/spaces`, `/templates`, `/trash`, `/okrs` | none (hub pages) | n/a | closes any open drawer, then the filter panel, then nothing |
| `/my-work/personal` | none (it is a sidebar row); breadcrumb "Work › My work › Personal list" | n/a | as above |
| `/me/weekly-review` | `fallbackHref="/home"`, label **Home** | n/a | closes a picker if open, else nothing. A dirty form asks "Save your changes?" on any navigation (`useDirtyGuard`) |
| `/spaces/[slug]` | `fallbackHref="/spaces"`, label **Spaces**, **always rendered** | n/a | closes an open modal or picker first |
| `/folders/[id]` | the parent Folder when nested (its name), else `/spaces/[slug]` (the Space name). The target is always the crumb immediately left in the breadcrumb, so no ancestor is skipped | n/a | as above |
| `/boards/[slug]` | `/folders/[id]` (the Folder name) when in a Folder, else `/spaces/[slug]` (the Space name) | n/a | closes the task drawer if open, else a modal or picker |
| `/okrs/[id]` | `fallbackHref="/okrs?view=…"`, chosen as: `company` when the goal is COMPANY level, `team` when the viewer manages the owner and neither owns nor contributes, else `/okrs`. Label = the view name | n/a | none (page) |
| `/item/[id]` full page (hard load, search, notification, deep link, Expand) | first match wins: (1) a same-origin `?returnTo=`, labelled with that destination's name from the route table; (2) a subtask → the parent task `/item/<parentId>`, label = the parent title at 160px ellipsis; (3) the task's List `/boards/<listSlug>`, label = the List name; (4) a Personal list task → `/my-work/personal`, label **Personal list**; (5) an assignee-only viewer who cannot read the List → `/home`, label **Home** | n/a | nothing (pickers and menus close first; a focused inline editor commits on Esc) |
| `/tasks/[id]` with no migrated Item | the in-shell 404, which carries `BackButton{fallbackHref: hub.defaultHref}` resolving to `/home` labelled **Work** | n/a | n/a |

### Objects opened from Work (open in place, 2026-09-24)

A doc, table, canvas, SOP or form opened from anywhere in Work stays in Work: the Work sidebar stays on the left, the object opens in the main area, and the rail never switches hub. Each object has a Work address as well as its canonical one (src/lib/nav/object-href.ts): `/spaces/[slug]/{docs,tables,canvas}/[id]` when its own Space is in the viewer's Work tree, and the Work door `/work/{docs,tables,canvas,sops,forms}/[id]` otherwise. The door moves a Space item to its Space-scoped address before any editor mounts, keeping the query and the hash, and a Space-scoped address naming the wrong Space is corrected the same way, so an object never renders under a wrong crumb. The crumb reads **Work › Space › (Folder) › Item** and is declared once, by the route's WorkPlacementProvider, from the first frame. The BackButton target is always the crumb immediately left of the item that has an href, else `/home` labelled **Work**; a Trash of the open item lands on that same crumb.

| Surface | Back target | Close | Esc |
|---|---|---|---|
| `/spaces/[slug]/docs/[id]` | the nearest crumb with an href: a sub-doc's parent doc (at its Work address), else the task, the List, the Folder (a folder doc's own, or its List's), else the Space. Label = that crumb's name. For a folder-only grantee the Space crumb has no href, so Back lands on the granted Folder | n/a | as `/docs/[id]` |
| `/spaces/[slug]/tables/[id]` | the Space (`/spaces/[slug]`), label = the Space name. A table carries no Folder crumb: the Work tree lists tables at the Space's top level | n/a | as `/tables/[id]`: **Esc never navigates away from a table** |
| `/spaces/[slug]/canvas/[id]` | the Space, label = the Space name (no Folder crumb, as a table) | n/a | as `/canvas/[id]` |
| `/work/docs/[id]` (a doc with no Space in the viewer's tree: standalone, NOTEPAD, a personal List's, a List reached only by a List grant) | the nearest readable crumb (a parent doc, the List, the task), else `/home`, label **Work** | n/a | as `/docs/[id]` |
| `/work/tables/[id]`, `/work/canvas/[id]` (unscoped) | `/home`, label **Work** | n/a | as the canonical route |
| `/work/sops/[id]` and `/work/sops/[id]?edit=1` | `/home`, label **Work**. Delete lands there too | n/a | as `/sops/[id]` |
| `/work/forms/[id]` | the destination List or table at its Work address when the form has one, else `/home`, label **Work** | n/a | as `/forms/[id]` |
| Any of the above, refused by the object's own gate or missing | the in-shell 404 in Work chrome, with the hub's BackButton (**Work**); nothing about the object is named | n/a | n/a |
| Any of the above, the gate failed to answer | the error state "This page couldn't load" with Try again (a route refresh) and `BackButton{fallbackHref="/home"}` labelled **Work** | n/a | n/a |

Query-only navigations (`?peek`, `?row`, `?new`, `?tab`, `?edit`, `?preview`) stay at the address the object is mounted at, never the task drawer's `/item/[id]`, and a Move while the object is open re-places its crumb and tree branch in place without remounting the editor. The canonical rows in sections 6 and 7 are unchanged and are what the Docs and Tables hubs open.

### Work drawers and modals

| Surface | Close target | Esc |
|---|---|---|
| **Task drawer** (intercepted `/item/[id]` over any list: `/boards/[slug]`, Space and Folder task views, `/everything`, `/my-work`, `/my-work/personal`, Planner day and week, Goals › linked tasks) | ✕ in the drawer header, a click on the dimmed list, or the browser Back: all three call `router.back()` when the previous entry is the host list, else `router.replace(hostUrl)`. The list keeps its view and scroll; the URL drops back to the host's | closes the drawer, unless a picker, menu or inline editor is open (those close first). A dirty comment draft is kept in memory per task per tab and is never lost by Esc |
| Task drawer **Expand** (⤢) | animates into the full page in place (240ms) at the same URL; the page it becomes gets `BackButton{fallbackHref = hostUrl}` labelled with the List name | |
| **Create task modal** (⌘⇧K, the Create menu, every "+ Add task") | ✕, Cancel, scrim click. A dirty modal (title, description or any staged field) opens the 400 confirm "Discard this task?" with Keep editing / Discard | as Close |
| **Inbox right pane** | "Open" goes to the target's full page with `returnTo=/inbox?tab=…`, so that page's BackButton returns to the same tab | deselects the row; the pane shows the "Pick a notification" state |
| Home "Display" popover, Inbox "Inbox options" popover, filter panels | the trigger, an outside click | closes |
| `ShareDialog`, `CreateListModal`, `CreateSprintModal`, `NewFolderDialog`, `NewSpaceDialog`, Status editor, About (Space / Folder / List), Duplicate and Delete confirms, `MoveTargetDialog` | ✕, Cancel, outside click (dirty forms confirm) | closes |
| Field shelf, Filter panel | ✕ or the Filter chip | closes |
| Template Center in modal mode (over `/templates`) | ✕; a Template detail opens as a 720 modal over the grid | closes the detail, then the modal |
| Create / Edit goal modal (560) | Cancel, ✕, outside click; dirty confirms. When opened by `?new=1`, closing does `router.replace` without the param | closes |
| Check in modal (400) | Cancel, ✕ | closes |
| Delete goal confirm (400) | Cancel, ✕, outside click. After a delete from `/okrs/[id]` the router goes to `/okrs?view=…` by the BackButton's rule | **Esc always cancels, never deletes** |
| Assign owner `Picker` on a goal (280, anchored) | outside click, or choosing a person | closes; nothing to save |
| `LockedPage` on any Work route | the same fallback as the route | n/a |

---

## 2. Planner hub

| Surface | Back target | Close | Esc |
|---|---|---|---|
| `/planner`, `/timesheets`, `/clock`, `/meetings` | none (hub pages) | n/a | closes any open popover or panel |
| `/meetings/[id]` | `fallbackHref="/meetings"`, label **Meetings**. The custom `.mtgr__back` that always pushed `/meetings` is deleted | n/a | closes the open modal or picker; nothing else |
| Task drawer opened from the Calendar (URL `/item/[id]`) | n/a | ✕ and Esc return to the calendar at the same period and view (restored from history; `/planner` if none) | closes the drawer |
| Timesheet drawer (Approvals, Team) | n/a | ✕ returns to `/timesheets?view=…` with the same filters | closes |
| Event popover (personal event, external event, reminder) | n/a | outside click, ✕ | closes without saving unless a field changed (each field autosaves) |
| New event, New meeting, Log time, Reject modals | n/a | Cancel, ✕, outside click; dirty confirms "Discard this event?" | closes |
| Reminders bell popover and the reminder create panel | n/a | outside click | closes |
| Fired-reminder card (`reminder-ticker`) | n/a | Snooze, Done or ✕ | closes the card only |

---

## 3. AI hub

| Surface | Back target | Close | Esc |
|---|---|---|---|
| `/sidekick`, `/agents`, `/automation/workflows`, `/automation/templates`, `/automation/logs`, `/automation/health`, `/automation/usage`, `/automation/connections`, `/store`, `/integrations`, `/build` | none (hub pages) | n/a | closes the topmost overlay |
| `/sidekick?view=all` (All chats) | `fallbackHref="/sidekick"`, label **Ask AI** | n/a | as above |
| `/automation/workflows/[id]` | `fallbackHref="/automation/workflows"`, label **Workflows**. History first, the fallback second, so arriving from Logs, Health or a Template returns you there. The hard `<Link>` chevron at `[id]/page.tsx:928` is deleted | n/a | closes the version-history modal, then a picker |
| `/build/[slug]` | `fallbackHref="/build"`, label **Build apps**. The `<Link>← All apps</Link>` is deleted | n/a | closes a modal, then the drawer, then nothing; never navigates |
| **Ask AI panel** (⌘J, the page-header slot, the task and canvas entry points) | n/a | ✕ in its own 48px header, ⌘J again, or Esc. Focus returns to whatever opened it; the session stays alive. **Below 1024 the panel does not render**: ⌘J navigates to `/sidekick` instead | closes the panel |
| Logs run drawer (`?runId=`) | n/a | ✕, a click on the dimmed list. Closing drops `?runId` and leaves `/automation/logs` with its filters intact | closes |
| Agent drawer (`?agent=`) | n/a | ✕, dimmed-list click. Closing drops `?agent` | closes |
| Agent run detail (`?agent=<slug>&run=<id>`) | n/a | its own ✕ collapses the run back to `?agent=<slug>` with the drawer still open. Arriving from a deep link, ✕ collapses to the drawer, so there is never a dead end | first Esc collapses the run, second closes the drawer |
| Version history modal, Add agent modal, Rename dialogs, Archive confirms, Restore version confirm | n/a | Cancel, ✕, outside click. A dirty form confirms first | closes |
| Builder dirty guard | n/a | while dirty, `beforeunload` arms and the BackButton, the crumbs, every sidebar row, the rail and in-page tab switches open a 400 confirm: **Keep editing** (ghost) · **Discard** (destructive ghost) · **Save** (primary). A failed save keeps the form dirty and re-arms | the confirm is a layer; Esc closes it as Keep editing |
| `LockedPage` on `/automation/connections` (a Member) | `fallbackHref="/automation/workflows"` | n/a | n/a |

---

## 4. Talk hub

| Surface | Back target | Close | Esc |
|---|---|---|---|
| `/tlk` | none (hub page) | n/a | closes a panel inside the pane first, then the pane |
| `/tlk/[id]` | `fallbackHref="/tlk"`, label **Talk**, 28px ghost, first thing in the conversation header | n/a | closes the open right panel (thread, details, search) first, then nothing |
| `/tlk` detail pane (`?c=`, `?thread=`, `?m=`) | n/a (the list is beside it) | ✕ in the pane header strips `c`, `thread` and `m` and keeps `view` (`router.replace`). "Open full page" goes to `/tlk/[id]` | closes a panel inside the pane, then the pane |
| Thread panel (`?thread=`) | n/a | ✕ removes `?thread=` (`router.replace`) | closes the panel |
| Details panel, Search panel | n/a | ✕ in the panel header | closes the panel |
| `/announcements` | none (hub page) | n/a | closes the drawer, then the filter panel |
| `/announcements/[id]` as a **drawer** over the list | n/a | ✕ returns to `/announcements` with the list scroll kept | closes the drawer |
| `/announcements/[id]` as a **full page** (notification, deep link) | `fallbackHref="/announcements"`, label **Announcements** | n/a | nothing |
| Announcement composer (modal 720) | n/a | Cancel, ✕; a dirty form confirms "Discard this announcement?" | as Cancel |
| New message, New channel, Browse channels, Add people, Rename, Link, confirm dialogs | n/a | Cancel or ✕ returns to the page underneath; nothing navigates | closes the dialog (a dirty New channel form confirms) |
| The one share dialog on a channel | n/a | ✕ | closes |
| **Call dock** (shell overlay, every route) | never navigates; "Open conversation" goes to `/tlk/[id]` | Leave call ends the call; Collapse keeps it | **nothing: a call never ends on Esc** |
| Incoming call card (shell overlay) | n/a | Decline | Decline |
| `/meet/[code]` (public) | none (standalone); after leaving, a "You left the call" card with Rejoin | the browser tab | nothing |
| `LockedPage` on a findable public channel | `fallbackHref="/tlk"`; its one primary is **Join channel**, not Request access | n/a | n/a |

No `router.back()` and no `window.location.reload()` anywhere in Talk: the self-join reload at `tlk/[id]/page.tsx:117` becomes a state refetch.

---

## 5. Teams hub

| Surface | Back target | Close | Esc |
|---|---|---|---|
| `/people`, `/organization`, `/people/departments`, `/people/roles`, `/people/skills`, `/team`, `/team/workload`, `/kra-kpi`, `/team/alignment`, `/team/kpi-reviews`, `/team/reviews`, `/reviews`, `/talent`, `/candor`, `/kudos`, `/surveys`, `/tools`, `/assets`, `/analytics` | none (hub rows). The bare `history.back()` "← People" buttons on Departments (`departments-client.tsx:306`) and Skills (`skills-client.tsx:128`) are deleted | n/a | one Esc, one surface, outermost last: a picker or popover inside a drawer, then the drawer, then the `FilterPanel`, then nothing |
| `/team/rollup` | none: it is the **Sub-teams** view of Alignment; the breadcrumb and the views row are the way back | n/a | as above |
| `/people/[id]` as a **drawer** over `/people` | n/a | ✕ returns to `/people` with the list's URL state (filters, page) intact; the list is never re-fetched | closes the drawer (a picker or modal inside closes first) |
| `/people/[id]` as a **full page** (Expand, deep link, search, notification, org chart, My team, a kudos card, a mention) | `fallbackHref="/people"`, label **Directory**. When reached from `/team` the browser history provides the back; the fallback stays Directory | n/a | closes an open modal or picker only |
| `/people/me` | `fallbackHref="/people"`, label **Directory** | n/a | as above |
| `/people/roles/[id]` | `fallbackHref="/people/roles"`, label **Job titles**. The crumb no longer bounces Members, because `/people/roles` is readable by every Member | n/a | closes an open modal or picker |
| `/reviews/[id]` | `fallbackHref="/reviews"`, label **Review cycles**. For a subject who cannot open `/reviews`, `fallbackHref="/people/me"`, label **My profile**, so the button never points at a locked page. The `router.push("/reviews")` at `review-detail-client.tsx:659` is deleted | n/a | closes the person drawer, then an open picker, then nothing |
| `/candor/[id]` | `fallbackHref="/candor"`, label **Candor**. The `<Link>← All sessions</Link>` and the four "Back to Candor" buttons in the blank and thanks states are deleted; the **thanks** state keeps one text link "Back to Candor", because it is the end of a flow and not a back button | n/a | closes an open picker |
| `/surveys/[id]` | `fallbackHref="/surveys"`, label **Surveys**. The `<Link>← All surveys</Link>` is deleted | n/a | closes the builder modal (dirty confirms), then a picker |
| Weekly review drawer (on `/team/reviews`, `?review=`) | n/a | ✕ returns to `/team/reviews` with the list's URL state intact; the list is never refetched | closes the drawer; a dirty notes field confirms |
| Manager review drawer (on `/reviews/[id]`, `?person=`) | n/a | ✕ returns to the cycle page and drops `?person=` | closes the drawer; dirty confirms |
| Tool drawer (`/tools?tool=`), Asset drawer (`/assets?asset=`) | n/a | ✕ clears the query param and returns to the list with the row still selected | closes the drawer |
| Department drawer, Skill drawer | n/a | ✕ returns to the list | closes |
| Modals here (New job title, Edit details, Manage alignment, Capacity, Import people, Remove person / transfer, Link SOP, Add skill, Rate skill, New cycle, Give kudos, Place person, Adjust score, Ask for peer feedback, Survey builder, Appraisal letter, Add tool, Add asset, every confirm) | n/a | Cancel (ghost, left of the primary) or ✕ returns to the page that opened it; outside click closes and a dirty form confirms first | closes the modal; dirty forms confirm |
| Share dialog on a Tool | n/a | ✕; changes autosave per row, so there is no Save and no dirty guard | closes |
| `LockedPage` on `/team` and `/team/workload` (a Member with no reports) | `fallbackHref="/people"`. No Request access: neither is a shareable object | n/a | n/a |
| The in-shell 404 on `/reviews`, `/team/reviews`, `/talent`, `/reviews/[id]`, `/candor/[id]`, `/surveys/[id]` | the shell's own "Back to Home" link. **No page-level back target is added to a 404**, because a 404 must never hint at what was there | n/a | n/a |

**A confirm opened from inside a drawer** is the one stacked case the design system forbids, so a destructive confirm inside a drawer renders as an **inline confirm strip in the drawer footer**: the question at 13/400, then Cancel and the danger action in place of the footer's usual pair.

---

## 6. Docs hub

| Surface | Back target | Close | Esc |
|---|---|---|---|
| `/docs`, `/canvas`, `/files`, `/notetaker`, `/sops`, `/sops/my-sops`, `/sops/compliance`, `/process-runs`, `/policies`, `/policies/compliance`, `/agreements` | none (list pages). `/files` carries the folder path in the top-bar breadcrumb (Docs › Files › Q4 › Contracts) | n/a | first Esc clears focus inside the Filter panel's search field, second closes the panel; any open picker closes first |
| `/docs/[id]` (opened from the Docs hub; from Work see section 1, Objects opened from Work) | `fallbackHref`: `/docs/[parentId]` for a sub-doc, else the anchor page for an anchored doc (`/spaces/[slug]`, `/folders/[id]`, `/boards/[slug]`, `/item/[id]`), else `/docs`. Label = the parent's name ("Docs", the parent doc's title, or the Space name) | n/a | closes a right panel when focus is inside it; otherwise Esc in the editor blurs the current block |
| `/canvas/[id]` (opened from the Docs hub; from Work see section 1) | the anchor Space page when `spaceId` is set, else `/canvas`. Label = the Space name or **Canvases** | n/a | closes the AI panel, then a picker |
| `/sops/[id]` and `/sops/[id]?edit=1` (opened from the Docs hub; from Work see section 1) | `fallbackHref="/sops"`, label **SOPs** (history-aware: arriving from My SOPs, the browser history wins and the label still reads SOPs) | n/a | in edit mode with nothing dirty: leaves edit mode; dirty: confirm "Discard changes?"; in read mode: nothing |
| `/sops/new`, `/sops/new/{text,steps,checklist,record}` | `fallbackHref="/sops"`, label **SOPs** | n/a | on a blank editor: back to `/sops`; once the row exists: confirm if dirty |
| `/sops/manage` (Organize) | `fallbackHref="/sops"`, label **SOPs** | n/a | nothing |
| `/policies/[id]` | `fallbackHref="/policies"`, label **Policies** | n/a | as the SOP page |
| `/policies/[id]/compliance` (Acknowledgements) | `fallbackHref="/policies/[id]"`, label = the policy title | n/a | nothing |
| `/agreements/[id]` (live contract) | `fallbackHref="/agreements"`, label **Contracts** | n/a | leaves Place-fields mode if in it |
| `/agreements/[id]` (template) | `fallbackHref="/agreements?view=templates"`, label **Contract templates** | n/a | as above |
| File preview drawer (`/files?file=`) | n/a | ✕ removes `?file=` and keeps the folder. **No ⤢**: files have no page, so the drawer never offers Expand | closes the drawer |
| Run drawer on `/process-runs` (`?run=`) | n/a | ✕ closes and drops `?run=`, restoring `/process-runs` with the row still selected | closes |
| **Audience panel 360** on `/policies/[id]` | n/a | ✕; the Audience button toggles it | closes it and returns focus to the Audience button |
| **Evidence panel 360** on `/policies/[id]/compliance` | n/a | ✕; opening another row's Evidence swaps the contents without closing | closes it and returns focus to the row's "View" button |
| **Place-fields panel 272** on `/agreements/[id]` | n/a | **no ✕**: the panel belongs to Place-fields mode, and the segmented control's "Write" closes both | leaves the mode and closes the panel; with a field selected, the first Esc deselects and the second leaves the mode |
| Editor right panels (Ask AI, Comments, Version history) | n/a | ✕ in the panel header | closes the panel when focus is inside it |
| Split view (`?peek=`) | n/a | the peek pane's ✕ removes `?peek=` | the same, when focus is inside the peek pane |
| Modals here (Share, Move to, New folder, Delete confirm, SOP kind chooser, Assign, Publish, Start run, New policy, New contract, Send for signature, Signature pad, every confirm) | n/a | ✕, Cancel; outside click closes unless dirty (then confirm). Focus returns to the opener | closes |

---

## 7. Tables hub

| Surface | Back target | Close | Esc |
|---|---|---|---|
| `/tables`, `/forms` | none (list pages at the root of the hub); the top-bar breadcrumb is the location | n/a | closes the drawer, then the filter panel |
| `/tables/[id]` (opened from the Tables hub; from Work see section 1, Objects opened from Work) | `fallbackHref`: the table's Space page (`/spaces/[slug]`) when `spaceId` is set, else `/tables`. Label = the Space name or **Tables**. The hand-rolled `frmb__back` that always pushed `/tables` is deleted | n/a | **inside the grid**: first Esc cancels the current cell edit, second collapses the selection to the active cell, third clears the search or filter highlight. **Esc never navigates away from a table** |
| `/forms/[id]` (opened from the Tables hub; from Work see section 1) | `fallbackHref`: the destination List's board (`/boards/[slug]`) when the form goes to a List, else the destination table (`/tables/[id]`), else `/forms`. Label = the destination name or **Forms**. The `ArrowLeft` push at `page.tsx:223` is deleted | n/a | closes the field picker, then a dialog |
| Row detail drawer on `/tables/[id]` (`?row=`) | n/a | ✕ removes `?row=` and returns focus to the row's gutter cell. **No Expand**: a table row has no page | closes the drawer |
| Response drawer on `/forms/[id]` (`?response=`) | n/a | ✕ removes `?response=` and returns focus to the response row | closes |
| Dialogs here (CSV import, Conditional formatting, Data validation, Column type, Named ranges, Data › Trash, Ask your data, Pivot, Share, Move to Space, Delete confirm) | n/a | ✕, outside click; dirty forms confirm first; focus returns to the opener. Pickers inside are `position:absolute` children, never portalled | closes |
| `/forms/[id]/respond` (public) | **none by design** (no shell). A signed-in visitor gets one 13/500 `--os-brand-deep` text link "Open in WorkwrK" under the footer, pointing at `/forms/[id]`; an anonymous visitor gets nothing but the wordmark | n/a | closes a picker inside a field |
| `/embed/forms/[id]`, `/embed/tables/[id]` | **none by design**: an embed renders the object alone with no chrome | n/a | closes a picker |

---

## 8. Settings takeover (both doors)

| Surface | Back or close target | Esc |
|---|---|---|
| Every `/settings/*` and `/account/*` page | the takeover's one **"← Back to app"** ghost button calls `closeSettings()`: `returnTo` (written by `openSettings(href)` into `sessionStorage["workwrk:settings:return"]`) when it exists and is not itself a settings route; else `lastAppPath` (mirrored to `sessionStorage["workwrk:shell:last-app-path"]`); else `/home`. **There is no ✕**: the design system puts the ghost back button at the left of the 48px bar and nothing at the right, and the design system wins on look | `closeSettings()`, after the dirty guard and after any open dialog |
| Inside a door | sidebar rows, tabs and breadcrumb crumbs are ordinary `router.push`. Browser Back walks settings pages and does not jump out of the door. **`BackButton{fallbackHref}` is not used inside the doors** | |
| **Detail routes inside the doors: there are none.** Every "detail" is a 520px drawer over its list (a member, an audit row, an API key, a webhook, a Guest, a pending invite) | ✕ returns to the list; the drawer carries the list's URL plus `?row={id}` so Copy link works | closes the drawer |
| The one drawer that is **not** a record: Task system's 360px "Recommended types" browser | it carries no `?row=`, because there is no record to link to; ✕ returns to the Task types tab | closes |
| Dirty guard (Identity › Profile and Culture, Locale, Members › Invite rules, Security › Sign-in policy and Single sign-on, Data › Retention & privacy, Scoring per section) | while dirty, every in-door navigation (sidebar row, tab, crumb, Back, Esc) opens a 400 confirm "Save your changes?" with **Keep editing** · **Discard** · **Save changes** (primary right). A failed save keeps the form dirty and re-arms | the confirm is a layer; Esc closes it as Keep editing |
| Dialogs on `/account/*` (two step verification enrol and turn off, Backup codes, Change password, Delete my account, Log out everywhere confirm, Security hold) | their own ✕ and Cancel, returning focus to the row's trigger. **A modal header does carry a ✕**; the takeover bar does not. The two are different objects, and this is the only ✕ in the personal door | closes the dialog only; it never reaches the takeover |
| `AdminOnly` card (an Admin on an Owner-only page without the scope) | `BackButton{fallbackHref="/settings"}`, label **Back to Overview** | n/a |
| Ask-an-admin strip (a Member, Agent, Guest, or the People team outside their four pages) | none needed: the page under it is My settings › Profile, a real destination | n/a |
| `/imports` (while it renders inside the takeover) | the takeover's "← Back to app" | as above |

Below 900px the 264px list becomes a "Pages" select in the takeover bar; the exit affordance and the Esc rule are unchanged.

---

## 9. Auth, onboarding and the public token pages

| Surface | Back target | Close | Esc |
|---|---|---|---|
| `/login`, `/forgot-password` | none (entry points) | n/a | clears the focused field's error state |
| `/signup` | text link "Already have a workspace? **Log in**" → `/login` | n/a | as above |
| `/join` | text link "Not you? **Log in** with a different account" → `/login` | n/a | as above |
| `/reset-password`, `/verify-email` | text link "Back to log in" → `/login`, on every state including the error states | n/a | as above |
| The `(auth)` logo lockup | `MARKETING_HOST` when set, else `/` | n/a | n/a |
| `/onboard` step N > 1 | an in-wizard **Back** secondary button → step N-1, keeping everything already typed | **"Finish later"** text link in the header writes `settings.console.setupDismissedAt` then goes to `/home`. One exit affordance, not the two that looped | "Finish later" after a confirm when the current step has unsaved input |
| `/run/[token]`, `/sign/[token]`, `/share/sop/[token]` | **none by design**: a shell-less page opened from a link by someone who may have no account. The org name in the header is not a link | n/a | closes the signature pad, then a picker |
| `/share/doc/[token]` | **none by design**, stated rather than omitted: there is nothing inside the product to send the reader to, and a sign-in or marketing button on a client-facing page is exactly the chrome this refresh removes. The browser's own back is the way out | n/a | closes a picker |
| `/meet/[code]` | none (standalone) | the browser tab | nothing |

---

## 10. Staff console (`admin.workwrk.com`)

| Surface | Back or close target | Esc |
|---|---|---|
| `/admin`, `/admin/companies`, `/admin/staff`, `/admin/analytics`, `/admin/appsumo`, `/admin/audit` | no back button: they are top-level. The top bar's ‹ › are the only history control | Esc on a bare page does nothing |
| `/admin/companies/[id]` as a **full page** | `BackButton{fallbackHref="/admin/companies"}`, label **Companies**. Today's `router.push` at `companies/[id]/page.tsx:76` is deleted | closes a modal, then nothing |
| `/admin/companies/[id]` as a **drawer** | ✕ returns to `/admin/companies` with the list's filters and scroll intact. ⤢ Expand animates the drawer into the full page in place (240ms) at the same URL | closes the drawer |
| Add staff (560), Import codes (720), Set workspace Owner (560), See details (560) | Cancel (ghost, left of the primary), ✕, outside click. A dirty form confirms before discarding | closes the modal |
| Confirm modals (400) | Cancel | **Esc never confirms** |
| "About this page" modal (400, the last row of every "…") | one ghost **Close**, ✕, outside click. Text only, so nothing to discard | closes |
| Search (⌘K) overlay (640) | ✕ in the field, outside click. It closes itself before it opens anything, so nothing ever stacks on it | closes |
| `LockedPage` (a signed-in person who is not Platform staff) | `BackButton{fallbackHref="<NEXT_PUBLIC_APP_URL>"}`, label **WorkwrK**. The href is absolute because the proxy bounces relative paths back to `/admin` on this host; `BackButton` accepts an absolute href today. **No Request access**: there is nobody inside this console to ask | n/a |

Esc closes the topmost layer only: the search overlay before a modal, a modal before a drawer, a drawer before nothing.

---

## 11. Shell overlays with no URL

All of them are `LayerStack` members unless stated. None of them navigates on Esc.

| Overlay | Opened by | Closed by |
|---|---|---|
| **Search palette** (⌘K) | ⌘K, the bar's search field, "Search" on the 404 | Esc, outside click, choosing a result |
| **Create menu** (the bar's "+") | the "+", the Work sidebar header "+" | Esc, outside click, choosing a row |
| **Bell popover** (Inbox and Reminders tabs) | the bell | Esc, outside click |
| **Avatar menu** | the avatar | Esc, outside click |
| **Help menu** | the "?" | Esc, outside click |
| **Workspace menu** | the sidebar header switcher | Esc, outside click |
| **Customize panel** | the sidebar footer "Customize Sidebar" | Esc, ✕, outside click |
| **Keyboard shortcuts overlay** (`?`, ⌘/) | `?` outside an input, ⌘/ outside a door | Esc, ✕, outside click |
| **Reminder dialog**, **Notepad panel**, **Voice note popover** | the Create menu, the palette's CREATE section | Esc, ✕, outside click. Their four hand-rolled `keydown` listeners are deleted; they register layers |
| **Mission splash** | boot, per `companyProfile.splash` | **any key or click**, not only Esc |
| **Session-expired dialog** | any 401, or an SSE 401 close | its own **Sign in** primary only. **It is a layer that refuses to close**: Esc and outside click do nothing, because there is nothing behind it that works |
| **Confirm and prompt dialogs** (`DialogProvider`, 68 call sites) | `useConfirm`, `usePrompt` | Cancel, ✕, Esc, outside click |
| **Toasts**, the **offline strip** | writes, `workwrk:offline` | **not layers**: Esc never touches them. A toast closes on its own timer or its ✕ |
| **Call dock**, **incoming call card** | a call | their own controls. A call never ends on Esc |
| **Timer pill** | a running timer | its own stop control |

---

## 12. Bounce targets deleted everywhere

These four URLs were used as denial or back targets across the product and are removed from every file: **`/dashboard`**, **`/today`**, **`/people/me`** (as a bounce) and **`/team/alignment`** (as a bounce). `/home` replaces `/today` and `/dashboard` as the one Work landing, and `closeSettings()` replaces the hard-coded `/today` in settings chrome.

The one redirect in the whole system is `/login?callbackUrl=<current>` when there is no session. Two boot conditions also redirect, and neither is a denial: no session → `/login`, and a signed-in person whose org has not finished setup → `/onboard` (and even that stops being a gate: `seedOrgDefaults` makes a new org complete the moment it exists, so the wizard is an offer). **No `can()` decision ever redirects.** Every other denial renders `LockedPage`, `ModuleOff`, `AppOff`, `AdminOnly`, the Ask-an-admin strip or the in-shell 404 **at the same URL**, with the rail, sidebar and bar intact.

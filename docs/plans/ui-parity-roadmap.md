# WorkwrK UI/UX Parity Roadmap (ClickUp + Monday)

Goal: bring every WorkwrK surface to ClickUp/Monday-grade polish, component by
component, well-aligned and consistent. This is the living checklist. Update the
status boxes as surfaces land.

## Principles
- **Match a real reference, never invent.** For each surface, work from an actual
  ClickUp/Monday screenshot. **Mobbin is now connected to the Claude Code session
  as an MCP connector** (`search_screens` / `search_flows`, platform: web) — pull
  ClickUp reference screens per surface directly; no more waiting on pasted
  screenshots. This is the standing parity rule.
- **Honest "Soon", no fake toggles.** Show the full ClickUp option set for parity,
  but wire only what's backed; unbuilt items are disabled/"coming soon" (the
  established pattern), never dead controls that pretend to work.
- **Data is sacred.** Never regress a save/load path. See
  `feedback_data_integrity_paramount`. Autosave everywhere: keepalive on close,
  retry, surface failures.
- **Verify before ship.** No blind UI deploys. Typecheck + lint every change; run
  the surface in the dev server and eyeball it before deploying. (Getting the
  local dev server back up is a prerequisite for fast, safe UI work.)
- **One shared primitive per pattern.** Context menus, create menus, popovers,
  pickers, empty states, toasts all route through one component each, so fixing
  one fixes all. (`ui/menu`, `MorePortal`, `EntityTile`, `ui/chip`, etc.)

## Process per surface
1. Get the ClickUp/Monday screenshot(s) for the surface.
2. Inventory our current version vs. the reference (layout, spacing, type, icons,
   states, options).
3. Rebuild to match, reusing shared primitives; wire real actions, honest-Soon the rest.
4. `tsc --noEmit` + `eslint`, then render it in dev and compare to the screenshot.
5. Commit small, deploy in a batch, human spot-checks.

---

## Foundations (cross-cutting — do continuously)
- [ ] **Context-menu primitive**: every entity "..." menu (Space/Folder/Board/List/
      Table/Doc/Whiteboard/Task) uses `MorePortal` + `ui/menu` so panels are solid,
      escape overflow, and share styling. (Folder done; audit the rest.)
- [ ] **Create-menu primitive**: every "+" (Space/Folder/List/Board) uses the same
      portaled `MenuList` with the same Create option set + section labels. (Folder
      "+" done; align the others.)
- [ ] **Spacing + type scale**: audit row heights, paddings, font sizes against
      ClickUp (h-7 rows, 12–13px labels). Codify in a few shared classes.
- [ ] **Icon system**: consistent lucide set + colors per entity type (matches the
      colored field-type icons already in the field shelf).
- [ ] **Empty states**: one `EmptyState` component (icon + title + subtitle + CTA),
      used everywhere, matching ClickUp's friendly empties.
- [ ] **Loading / skeleton states**: shared skeletons for lists/boards/cards.
- [x] **Dark mode** — 2026-08-06 pass (ce822d0): walked every reshipped surface
      with data-theme=dark via the real preference flow. Fixed light-only
      chrome (List group-label borders, Calendar weekend/adjacent-month
      tints, Gantt Today/zoom/weekend/spill-labels, Inbox unread accent,
      Home greeting). Everything else themes via tokens + the .dark
      guardrail. NB: the "violet Switch" audits flagged was the demo
      account's user-picked purple ACCENT (legit theme-picker option);
      code default is brand blue.
- [ ] **Toasts, dialogs, confirms**: already shared (`useOsToast`, dialog-provider);
      keep everything on them.

---

## Wave 1 — the high-traffic core (where people live)
1. **Left sidebar (Spaces tree)** — partially done.
   - [x] Folder "..." menu → ClickUp parity (Favorite/Rename/Copy link/Create new/
         Folder color/Automations/Custom Fields/Task statuses/More/Imports/Templates/
         Move/Duplicate/Archive/Delete/Sharing button).
   - [x] Folder "+" create menu → proper panel + List/Doc/Dashboard/Whiteboard/Form/
         Folder/Imports/Templates.
   - [x] Space "..." menu — already comprehensive (Create new / Modules / Custom
         Fields / Task statuses / Templates / Move / Duplicate / Hide / Archive /
         Delete / Sharing). Verified 2026-07-18, no change needed.
   - [x] Board/List "..." menu — already comprehensive (Email-to-List / Default
         task type / List info / etc.). Verified, no change needed.
   - [x] Table "..." menu — portaled + consistent. Verified.
   - [x] Space "+" create menu — already full (List/Folder/Doc/Dashboard/Whiteboard/
         Database/Form/Imports/Templates). Folder "+" now aligned to it.
   - [ ] Row: hover cluster (star / "..." / "+"), active state, indentation, chevrons,
         drag affordance — match ClickUp exactly.
   - [ ] Instant updates on every rename/delete/move (folder + notes done; verify all).
2. **Board / List views** — the product's heart.
   - [x] View tabs (List/Board/Calendar/Gantt/…) — verified 2026-08-05 vs Mobbin:
         icons, active underline, "+ View" already match.
   - [x] Toolbar row — 2026-08-05: left cluster now labeled ClickUp-style
         ("Group: Status" / "Subtasks" / "Columns" + item count); right side
         (Filter/assignee/sort/search/Statuses/Fields/+ Task) verified.
   - [x] Table view group headers — 2026-08-05: solid status pills (white on
         status color) + count; column labels repeat inside every group like
         ClickUp (colgroup pins fixed-layout widths); wider Assignee/Due/Priority
         defaults so labels don't truncate. Monday table style untouched.
   - [x] Bulk bar — verified: dark floating pill (N selected / Set status / Set
         owner / Set due date / Priority / Archive / Trash / clear).
   - [x] Kanban — 2026-08-05: solid status-pill column headers, cards drop the
         created-date footer (subtask count only), "Add Task" labels. Hover
         cluster (check/+/pencil/…) verified.
   - [x] Calendar polish — 2026-08-05 (workflow-audited vs Mobbin): tinted
         chips w/ left color edge + assignee avatar, ghost-chevron toolbar,
         mixed-case weekday header, adjacent-month grey day numbers, weekend
         tint, 4-chip cells.
   - [x] Gantt polish — 2026-08-05: two-tier month-band header, rose today
         bubble+line, weekend shading, 24px bars w/ hover resize handles +
         short-bar label spill, Today-first toolbar, floating zoom stack.
3. **Task detail (drawer + `/item/[id]`)** — Schedule/Repeat/Reminders done.
   - [x] Verified 2026-08-05 vs Mobbin ClickUp task view: type chip, title,
         two-column field grid (Status/Dates/Estimate/Track | Assignees/Priority/
         Tags/Alignment), description, Add subtask / Relate / Checklist / Attach
         sections, Comments+Activity tabs — structure already matches; no change.
   - [x] Polish trio shipped 2026-08-05: solid status pill + "›" advance +
         ✓ complete button; collapsible "Custom Fields" header; Ask Brain
         strip wired on /item/[id].

## Wave 2 — content + creation
4. **Docs / Notes editor (BlockNote)** — align to ClickUp Docs (cover, title, slash
   menu, block hover controls, right rail, share).
5. **Create modals** — List / Space / Folder (done) / Doc / Whiteboard: one shared
   shell, same header/footer/fields, colour+icon pickers.
6. **Whiteboards** — toolbar + library parity (Excalidraw chrome is mostly theirs).

## Wave 3 — the rest of the shell
7. **Home / Today** — cards, my-work, agenda.
8. **Dashboards** — widget gallery, add-widget, layouts.
9. **Calendar app** — month/week/people, event chips.
10. **Topbar + rail** — spacing, icons, popovers (search, notifications, reminders).
11. **Settings** — nav + panels consistency.
12. **Inbox / Notifications** — tabs + row layout.

---

## Status log
- 2026-08-06 (later): **Coverage matrix + Waves A & B shipped.**
  Coverage matrix 24fc2ff (docs/plans/coverage-matrix.md, 135 surfaces from an
  8-agent ClickUp/Monday inventory: 23 parity / 66 partial / 32 missing / 14
  product-decision) with wave plan A–E.
  **Wave A** (gap fills): per-user notification settings page + shouldNotify
  gate (51f01e4), Invite People modal honoring the KRA/SOP invitation contract
  (c02ff4b), comment @mention typeahead + mention notifications + edit-own
  (a8edc03), board filter rules {field,operator,value} + AND/OR + saved
  filters, Everything view (read-gated cross-board list at /everything);
  seam fixes 1788c59 (filter panel through MorePortal, @Mentions toggle live).
  **Wave B** (live dashboard widgets): widget model + defensive parse +
  zod-validated PATCH + react-grid-layout canvas (debounce-PATCH, retry,
  unmount flush) + Stat/Notes/TaskList widgets + shared per-source item cache
  (07d920f); Battery + Chart (pie/bar by status/assignee/priority, avatar-hue
  slices) + Add Card gallery wiring + shared StatusDistribution now also
  powering the board Dashboard view's breakdown cards (0f9ac61); dark seams
  from live verification 91e2a0e (zinc-50 hairlines, pie mount animation
  zero-sector flake, gallery preview tints stay light). Verified live both
  themes: add/drag/resize/persist round-trip, source switch to board scope,
  single shared fetch per source, menus/popovers dark-clean.
  Remaining honest-toast tiles: Time Reporting, Portfolio, Discussion.
  Next: Wave C (Workload capacity grid, Timeline drag/zoom, Team cards,
  Sprints), Wave D (doc sharing/permissions, subpages), Wave E (Automations).
- 2026-08-06: **Wave 3 sweep shipped** (6 workflow audits → 7 commits):
  sidebar tree rows c8fb029 (active pill, no guide lines, zinc icons),
  create-modals 862603e (shared shell, dark pills, ui/dialog flat scrim +
  blue focus ring), settings 4db86b6 (All-settings nav, 16px headers, blue
  cards), whiteboards 2da1583 (canvas bar + flat library), docs 3f87557
  (breadcrumb header, Ask/Share, 32px title, de-purpled), dashboards
  b885e8e (breadcrumb+toolbar shell, Add Card gallery, template chooser,
  WidgetCard shell). Docs leftovers (low-pri): bottom word-count pill,
  empty-doc hint chips, font-card labels, Add page button, cover-icon
  card look. Settings leftovers: Log out nav footer, personal-section
  username label. Shared-Switch violet track + bdoc iact is-on tint are
  global-token questions, not per-surface.
  NEXT: dark-mode verification pass across everything shipped 08-05/06.
- 2026-08-05 (evening): **Wave 2/3 sweep via workflow audits.** 5 parallel
  agents pulled fresh Mobbin ClickUp references and produced file-anchored
  diffs; all implemented + browser-verified: task-detail trio (d68e676),
  Home (6168455), Inbox rows/tabs/hover-actions (79992b0), Calendar chips +
  chrome (bbb50ab), Gantt header/bars/zoom (57527b4). Also fixed the React
  key warning on Board view (9bde868, keyed addTaskSlot at both call sites).
  Remaining ClickUp-parity queue: Docs editor chrome (Wave 2), Dashboards
  widget gallery, Settings nav consistency, dark-mode verification pass.
- 2026-08-05: **Mobbin MCP connected** — reference screens now pulled directly.
  Wave 1 core shipped against real ClickUp references: List view (status-pill
  group headers, per-group column labels, labeled toolbar, bulk bar verified),
  Kanban (solid pills, clean cards, Add Task), task detail verified at parity.
  Sidebar Space tree expansion verified (nested lists, ClickUp-style).
  Local dev env note: `.env` points DATABASE_URL at the prod SSH tunnel
  (127.0.0.1:5433, currently down); created gitignored `.env.local` overriding
  to local brew Postgres `workwrk` DB (schema via `prisma db push`, seeded
  users incl. admin@workwrk.com + demo Design Team space/board). Delete
  `.env.local` to return to the tunnel workflow. Never point local dev at prod.
  Known pre-existing issues (not from this pass): React key warning in
  BoardCanvas children (chip spawned), eslint set-state-in-effect in
  AddSubtaskRow (deliberate pattern).
  Next: Home /today cards, Inbox tabs, Calendar/Gantt polish, task-detail
  polish candidates above.
- 2026-07-18: Roadmap created. Wave 1 sidebar folder "..." menu + folder "+" create
  menu shipped to ClickUp parity. Audited the rest of the sidebar menu layer:
  Space / Board / Table "..." menus and the Space "+" were **already** comprehensive
  and portaled, so the folder surfaces were the only gaps and are now closed. The
  whole sidebar menu layer is consistent.
  Next: Wave 1 board/list views + task detail — these need per-surface references
  (Mobbin/ClickUp screenshots) and dev-server visual verification to match pixel-for-pixel.

## Notes
- Mobbin IS connected as an MCP connector — pull references with search_screens.
- Local dev server: `npm run dev` (port 3000) with `.env.local` → local Postgres.
- Keep commits small and typecheck/lint-clean; batch deploys; human spot-checks each surface.

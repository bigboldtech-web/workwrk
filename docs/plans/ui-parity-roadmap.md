# WorkwrK UI/UX Parity Roadmap (ClickUp + Monday)

Goal: bring every WorkwrK surface to ClickUp/Monday-grade polish, component by
component, well-aligned and consistent. This is the living checklist. Update the
status boxes as surfaces land.

## Principles
- **Match a real reference, never invent.** For each surface, work from an actual
  ClickUp/Monday screenshot (Mobbin export or a direct screenshot). Mobbin is not
  reachable from the Claude Code CLI session, so the human drops the screenshots;
  Claude matches them. This is the standing parity rule.
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
- [ ] **Dark mode**: verify every new surface themes (light + dark) via the accent
      tokens; the app already supports `data-accent` + `.workwrk-os`.
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
   - [ ] View tabs (List/Board/Calendar/Gantt/…) — icons, active state, "+ View".
   - [ ] Toolbar row (Group by / Filter / Sort / Fields / Assignee / search / "+ Task").
   - [ ] Table view: column headers (type icon + menu), row hover, inline edit,
         group headers, subtasks, add-row, bulk bar.
   - [ ] Kanban: column header (count, WIP, "..."), card layout, add-card, drag.
   - [ ] Calendar + Gantt polish.
3. **Task detail (drawer + `/item/[id]`)** — Schedule/Repeat/Reminders done.
   - [ ] Header (breadcrumb, status pill, actions), two-column field grid, activity,
         subtasks, checklist, custom fields, comments — align to ClickUp task view.

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
- 2026-07-18: Roadmap created. Wave 1 sidebar folder "..." menu + folder "+" create
  menu shipped to ClickUp parity. Audited the rest of the sidebar menu layer:
  Space / Board / Table "..." menus and the Space "+" were **already** comprehensive
  and portaled, so the folder surfaces were the only gaps and are now closed. The
  whole sidebar menu layer is consistent.
  Next: Wave 1 board/list views + task detail — these need per-surface references
  (Mobbin/ClickUp screenshots) and dev-server visual verification to match pixel-for-pixel.

## Notes
- Mobbin is NOT connected to the Claude Code CLI session; screenshots must be pasted in.
- Local dev server needs to be up for visual verification (currently down).
- Keep commits small and typecheck/lint-clean; batch deploys; human spot-checks each surface.

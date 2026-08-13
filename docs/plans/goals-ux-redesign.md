# Goals UI/UX redesign (mirror ClickUp)

Decided 2026-08-13. User chose "mirror ClickUp Goals" for the look, and
chose to **wait for ClickUp reference** before any goals UI is built —
Mobbin was disconnected this session, so no live ClickUp screens could be
pulled. This doc is the spec; execute it once reference is in hand.

## BLOCKED ON (need one of these before building)

- The **Mobbin connector reconnected** (claude.ai connector settings), so I
  can pull ClickUp's New/Edit Goal modal, goal-row `...` menu, and goal
  detail header, OR
- **Screenshots** from the user of: ClickUp Goals list, a goal's detail
  page, and the New/Edit Goal modal.

Until then: do NOT build or restyle any goals surface. (Goal delete + the
"Me" sidebar item already shipped separately — commits e1da02b / 82e6259 /
58e531e — and are not part of this hold.)

## The headline gap: "assign to a person" only half-works today

The audience picker (`goal-audience-picker.tsx`) adds a person as a
**contributor** (a `GoalAssignee`), never as the single accountable
**owner**. `OKR.ownerId` is set server-side only (creator, or a
manager-supplied id no UI ever sends), so goal cards render "Unassigned"
(`okrs-client.tsx:309`) even after you pick someone. There is **no owner
picker anywhere**, and **no edit modal at all** — title/level/dates/owner
are uneditable after creation. `PATCH /api/okrs` already accepts every
field; the UI just never calls it for these.

## Phased plan (from the swarm audit)

### P0 — assignment-to-person + edit + progress correct and visible
1. Add an **Owner (single person)** picker to `create-goal-modal.tsx`,
   writing `ownerId` via the POST body. Reuse the existing assignee-picker
   PersonAvatar rows. Keep `GoalAudiencePicker` as a **separate**
   "Contributors" field — owner ≠ audience.
2. Make `create-goal-modal.tsx` reusable for **Edit** (opened from the
   goal `...` menu). `PATCH /api/okrs` already accepts
   title/level/ownerId/dates/quarter/description/assignees.
3. Show the **real owner** (avatar + name) on the list card; stop
   rendering "Unassigned" when an owner/contributors exist.
4. Delete already ships (`goal-row-more-menu.tsx`). The fuller row menu
   (Open / Edit / Assign owner / Copy link / Duplicate / Move / Archive)
   layers onto that same component.

### P1 — layout + visual parity (NEEDS ClickUp reference)
1. Reskin `dashboard-okrs.tsx` off the old lime/violet/pink palette to
   blue `#0073EA` + zinc; deep-link rows to `/okrs/[id]` (they currently
   all link to `/okrs`).
2. Swap `okrs-client.tsx` chrome off indigo/pink/purple gradients
   (`GRAD.indigoBlue`, `GRAD.redPink`, `C.indigo`, `AV_PALETTE`) to
   blue + neutral. Design-system rule: brand blue only, no purple/violet/
   pink, `#E2445C` destructive.
3. Add list controls (Filter / Sort / Group); the "New objective" button
   currently hardcodes level INDIVIDUAL (`okrs-client.tsx:151`).
4. Match card visual language to the already-clean profile GoalsSection
   (`profile-client.tsx:404`) — blue bar, StatusChip, tabular %.

### P2 — polish + cleanup
1. Delete dead legacy files (no importers): `cascade-tree.tsx`,
   `my-okrs-hero.tsx`, `sparkline.tsx`.
2. Wire the dead query params the profile hero already links to:
   `/okrs?new=1` (auto-open create modal), `/okrs?mine=1` (filter to
   owner + audience of current user). `okrs-client.tsx` reads neither today.
3. Unify progress visuals to one blue status ramp; render NONE-source bars
   neutral (no colored fill under a "—" label). The progress NUMBER is
   already consistent everywhere (single `computeGoalRollups` source); only
   the color treatment differs by surface.

## Right-click rollout (separate, not blocked on reference)

Right-click is already wired app-wide via one pattern (`MorePortal` +
`ContextMenuHandle`, cloned from `board-view/item-row-more-menu.tsx`). Real
gaps, low effort — just add the `onContextMenu` one-liner + reuse the ref:
- Board **Cards/Gallery**, **Calendar events**, **Gantt/Timeline/Hierarchy**
  renderers (reuse the existing `ItemRowMoreMenu` ref).
- **Stackby DataTable** rows + column-header menu (hover-delete exists, no
  right-click).
- Goals: delete done; the fuller menu layers on later.

## Open decision carried from the delete fix

Goal **delete** is currently gated to owner / tree-manager / org-admin
(`canDeleteGoal`). Edit is broader (`canEditOkrOwner` also admits
C_LEVEL/VP/DIRECTOR/HR). If Directors/VPs/HR should be able to delete too,
swap `isOrgAdminLevel` → `isOrgWideAlignment` in `canDeleteGoal` — one line.

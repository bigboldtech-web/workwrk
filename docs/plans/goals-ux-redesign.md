# Goals UI/UX redesign (mirror ClickUp)

Decided 2026-08-13. User chose "mirror ClickUp Goals" for the look, and
chose to **wait for ClickUp reference** before any goals UI is built —
Mobbin was disconnected this session, so no live ClickUp screens could be
pulled. This doc is the spec; execute it once reference is in hand.

## UNBLOCKED 2026-08-13 — Mobbin reconnected, reference captured

ClickUp Goals reference (verified live from Mobbin, ClickUp web):

- **Goal detail** — https://mobbin.com/screens/a9e061e2-07f3-4a80-a367-d4502cb0ea51
  (also fa913a4c…, 16d28e5f…): neutral hero band across the top; LARGE
  progress ring left with % centered; title + inline `…` menu; description
  in a white card under the title; right side of hero: due date,
  "Sharing & Permissions" button, owner avatar(s). Below the hero, white
  cards: **Targets** (header + "+ Add"), each row = owner avatar cluster,
  title, "N task" link, `…`, right-aligned thin progress bar with `0/1`
  fraction; **Timeline** card = activity entries ("Created Key Result",
  "Today, by <name>").
- **Create goal flow** (11 screens) —
  https://mobbin.com/flows/e0cd95bd-dbfc-453b-b2d7-5b79da7faaef :
  slide-over panel, sequential fields each with helper text + OK/press
  ENTER: Goal name → **Owner ("Who is responsible for this Goal?" —
  avatar picker, first-class field)** → access (Workspace / Private
  cards) → optional end date → optional description.
- **Create target flow** —
  https://mobbin.com/flows/d0c11e46-0967-4d3b-8747-bdb9f88beb54 : Owner
  row, then "Type of Target" radio cards (Number / True-False / Currency /
  Tasks), Start + Target inputs with "+ Add unit"; Tasks type requires
  linked tasks/lists.
- **Check-in modal** —
  https://mobbin.com/screens/662c87bf-64aa-4e1f-9a9c-d1f96eaddf26 :
  target title, progress bar, Start / Current / Target row, Decrease |
  Increase toggle, value input, "Save update", optional note (max 2000).
- **Empty state**: illustration + "Targets are specific and measurable
  pieces that must be accomplished in order to reach your Goal." +
  "Create a Target" button.

Translation rules: ClickUp's purple accent → brand blue `#0073EA`
everywhere; our Contributors (GoalAudiencePicker) maps to ClickUp's
sharing/access concept and stays a separate field from the single Owner;
Key Results = Targets; check-ins keep our direction-aware math.

(Goal delete + the "Me" sidebar item already shipped separately —
commits e1da02b / 82e6259 / 58e531e.)

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

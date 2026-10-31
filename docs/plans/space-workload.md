# Workload for a whole Space

Founder, 2026-10-31: "add workload view per space for employees in the space".

## What it is

A **Workload** tab on every Space, after Team: `/spaces/<slug>?view=workload`. It can be pinned as the Space's default view like any other tab.

It is the same `WorkloadGrid` a List's WORKLOAD view and Teams > Workload render: people rows by day columns, Tasks or Hours, a window of 1, 2 or 4 weeks, the Unassigned row, the Unscheduled column, overdue per person, and the day popover with Assign on unassigned work.

## Decisions (worst case first)

1. **Who is a row.** The Space's members (SpaceMember) and everyone on an open task in its readable Lists, who still work in this workspace (liveHereAmong) and are not deactivated. People with no work in the window hide behind "Show N more people", as on every Workload grid.
   - Members of a single List who hold no task are not rows: the member tables are read only through the engine or `listSpaceMembers`, and a person with work there shows up through their tasks.
2. **A departed holder is never a row.** A task counts for the live people on it, and as Unassigned when nobody live is left. Its departed holders travel as `formerIds`, so Assign can hand it on, and the re-check before Assign refuses if anyone else took it since (`mayAssignOver`). Worst case avoided: a lead reads a task as held when nobody here is doing it.
3. **Whose capacity.** A person's own weekly hours and work schedule are people data. They are sent only for people the viewer may read people data for (self, their chain, the People team, Admin), the dashboard Workload card's rule. Everyone else is measured against the company working calendar, and the tab says how many people are. Worst case avoided: a Space reader learns a colleague is part time.
4. **Which tasks.** Open tasks (not archived, not a meeting, not in a done status of their own List) on the Space's readable Lists (readableListsInSpace, the one predicate every Space tab uses), that touch the window, have no dates, or are overdue. A List the viewer cannot open never adds a task, a count or a person.
5. **Cap.** Three reads, each capped at 5,000: tasks in the window (soonest due first), tasks with no dates (changed most recently first) and tasks due by today (most recently due first). One kind can never crowd out another, and the tab says which read was cut. No silent cut.
6. **Who sees the tab.** Anyone with Can view on the Space: the Team tab already shows the same people and tasks. A path through the Space is not a role (404).
7. **Settings.** The viewer's Workload preferences (Tasks or Hours, window, Tasks a day, Count weekends, show everyone), shared with Teams > Workload through `use-workload-prefs.ts`. The capacity gear here holds only those two numbers of the viewer's own; a person's weekly hours are set in Teams > Workload, Capacity. Lists and Search people narrow what is drawn.
8. **Phones.** The shared grid's People column narrows to 160 and drops the avatar, rows grow to 80 so the name (up to two lines), the load and the overdue count each have room, and Unscheduled scrolls with the days. This applies to every Workload grid.
9. **Loading a window.** `use-workload-data.ts`, shared with Teams > Workload: only the newest answer is kept, and tasks are drawn only for the window they were loaded for (a skeleton while another loads, an error with Try again when it failed). Returning to the tab reloads at most every 30 seconds.

## Files

- `src/app/api/spaces/[id]/workload/route.ts` (and `route.test.ts`)
- `src/lib/work/space-workload.ts` (and `space-workload.test.ts`)
- `src/app/(dashboard)/spaces/[slug]/space-workload-view.tsx`
- `src/components/people/use-workload-prefs.ts` (Teams > Workload now uses it too)
- `src/lib/work/space-default-view.ts`, `space-view-tabs.tsx`, the Space page
- `src/components/board-view/workload-grid.tsx` (the phone layout)
- the changelog entry

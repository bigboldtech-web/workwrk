// Every static row of the Work sidebar in one list, in declaration order, so
// resolveActiveRow can light exactly one of them (spec-shell §1.1). The Spaces
// and Favorites trees are dynamic rows and carry their own active state.
//
// Moved out of apps-catalog.tsx unchanged, so a node test can prove that no
// static row lights on an object's Work address (/spaces/[slug]/docs/[id],
// /work/docs/[id]) or under the task drawer's /item/[id]: on those the open
// object's own tree row, favourite or nearest ancestor carries the pill
// instead (src/lib/nav/open-object.ts). No imports, like route-hub.ts.
export const WORK_ROWS = [
  { href: "/home", match: "exact" as const },
  { href: "/my-work", match: "exact" as const },
  { href: "/my-work/personal" },
  { href: "/inbox" },
  // /activity had a rendered NavItem and NO row here, so the one resolver
  // could never return it and the row never lit. A row that renders without a
  // row here is the same defect, silently, every time.
  { href: "/activity" },
  { href: "/everything" },
  { href: "/favorites" },
  { href: "/okrs" },
  { href: "/okrs?view=team" },
  { href: "/okrs?view=company" },
  { href: "/templates" },
  { href: "/trash" },
];

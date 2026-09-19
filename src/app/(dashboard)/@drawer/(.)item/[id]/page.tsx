/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb --
   The crumb IS declared, one component down: this page is a three-line server
   shell around <ItemDrawerHost/>, which is where the task is loaded and where
   `<Breadcrumb items/>` is rendered from its Space, Folder, List and title.
   The rule checks the page FILE, so it cannot see that; without this the bar
   would read the static table's "Work > Task" while the drawer is open, which
   is exactly what the rule exists to prevent and exactly what was fixed. */
// The task drawer: an INTERCEPT of /item/[id] inside the @drawer slot.
//
// `(.)` matches a segment on the same level. `@drawer` is a slot, not a route
// segment, so /item/[id] IS on the same level despite being two directories
// away in the file system (intercepting-routes.md, "the (..) convention is
// based on route segments, not the file-system").
//
// What that buys, exactly:
//   * a SOFT navigation from a list surface (router.push("/item/<id>"))
//     renders this drawer over the list, with the URL now the task's;
//   * a HARD load, a new tab or a refresh of the same URL does not intercept,
//     so (dashboard)/item/[id]/page.tsx renders the full page;
//   * browser Back closes the drawer, because Next pushed one history entry
//     and the list is still mounted behind it.
//
// It is inert until a host mounts the slot, and a router.push from a host that
// has not migrated yet simply renders the full page, a correct outcome, which
// is why the hosts can migrate one at a time.

import { ItemDrawerHost } from "@/components/board-view/item-drawer-host";

export default async function InterceptedItemDrawer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItemDrawerHost itemId={id} />;
}

/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb --
   This slot page draws nothing, so it names nothing: the crumb is the page's
   beside it, in children, which renders the URL itself. */
// Every other page closes the drawer.
//
// Parallel routes keep a slot's active state across SOFT navigations, so a
// task or person drawer left open stayed over every page reached from it
// (the sidebar, a breadcrumb, a link in the record), and its Close then went
// back one page at a time until it reached the list it was opened from.
// Matching the slot to a page that renders nothing on any other URL is the
// documented way to close it (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/parallel-routes.md,
// "Closing the modal"). The intercepts (.)item/[id] and (.)people/[id] still
// win for their own URLs; a hard load renders nothing here, as default.tsx.
// Named `rest`, as the (dashboard)/[...rest] page beside the slot.
export default function DrawerElsewhere() {
  return null;
}

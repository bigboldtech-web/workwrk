// The fallback for the @drawer slot.
//
// Parallel routes keep a slot's active state across SOFT navigations, but on a
// hard load Next cannot recover the state of a slot that does not match the
// URL, so it renders this file, and 404s the whole page if the file is
// missing (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/parallel-routes.md,
// "default.js"). Every route under (dashboard) that is not an intercepted task
// therefore depends on this returning nothing.
export default function DrawerDefault() {
  return null;
}

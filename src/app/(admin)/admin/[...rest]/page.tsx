// The unknown-path door into the Staff console's own 404.
//
// Without this catch-all an unknown /admin/* path (a typo, a stale link, or
// /admin/audit before Staff activity ships) fell through to the product's
// (dashboard)/[...rest] and put a staff member inside the CUSTOMER workspace
// frame: the rail, their own company's sidebar, product search. The missing
// rail is what tells staff they are not in a customer workspace, so the 404
// renders inside the (admin) layout: the staff gate and the console frame
// both apply, and a person who is not staff still gets the denial.
//
// It renders the console's not-found body directly rather than throwing
// notFound(): in development the thrown path re-rendered the root theme
// provider on the client and flagged an issue on every stale link. The
// body is the same one (admin)/admin/not-found.tsx shows for any notFound()
// thrown below /admin. Next resolves a catch-all last, so this never
// shadows a real console page, and the path is never echoed.

import { ConsoleNotFoundView } from "../../console-not-found";

export const dynamic = "force-dynamic";

export default function UnknownConsolePath() {
  return <ConsoleNotFoundView />;
}

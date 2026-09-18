// The in-shell 404 (spec-shell 2.4): an unknown dashboard path, a
// not-discoverable object (notFound() from a gate) or a deleted object, all
// rendered at the same URL with the rail, sidebar and bar intact. The body
// is NotFoundView; it is deliberately the same for a misspelled URL and for
// an object the viewer may not know exists.

import { NotFoundView } from "@/components/access/not-found-view";

export default function DashboardNotFound() {
  return <NotFoundView />;
}

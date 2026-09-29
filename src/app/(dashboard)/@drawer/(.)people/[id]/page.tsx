/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb --
   The crumb IS declared, one component down: PersonRecord renders
   `<Breadcrumb items/>` from the loaded person ("Teams > Directory > {Name}",
   or "Teams > My profile" for self). */
// The person drawer: an INTERCEPT of /people/[id] inside the @drawer slot,
// the task drawer's pattern (@drawer/(.)item/[id]). A soft navigation to a
// person from the Directory, the org chart, My team or a Skills holder
// renders the record in the 520 drawer over that list; a hard load, a new
// tab or a refresh renders the full page at (dashboard)/people/[id].

import { PersonDrawerHost } from "@/components/people/person-drawer-host";

export default async function InterceptedPersonDrawer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PersonDrawerHost personId={id} />;
}

// People · Directory — manager door. The full "who's who" is a
// management surface; employees land on their own career home instead
// (the API already scopes /api/users to the caller's tree, so this gate
// removes a broken near-empty surface, not data they could see).

import PeopleDirectoryClient from "./directory-client";
import { requireManagerPage } from "@/lib/page-gates";

export const dynamic = "force-dynamic";

export default async function PeopleDirectoryPage() {
  await requireManagerPage();
  return <PeopleDirectoryClient />;
}

// Server-side route guard. The /people directory listing is for
// managers and above; employees and agents had been silently
// soft-scoped to "you only see yourself" instead of being blocked,
// which surfaced in ghost testing as inconsistent with spec. We
// hard-redirect them to /dashboard here. Employees still reach
// /people/[id] for their own profile through other surfaces.
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import PeopleListView from "./people-list-view";

const BLOCKED_LEVELS = new Set(["EMPLOYEE", "AGENT"]);

export default async function PeoplePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const level = (session.user as { accessLevel?: string }).accessLevel ?? "EMPLOYEE";
  if (BLOCKED_LEVELS.has(level)) {
    const userId = (session.user as { id?: string }).id;
    redirect(userId ? `/people/${userId}` : "/dashboard");
  }

  return <PeopleListView />;
}

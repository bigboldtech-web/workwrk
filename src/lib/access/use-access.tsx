"use client";

// The two client hooks of spec 5.1, and the provider they read.
//
//   useAccess()  the Decision for the object the page is about. A page calls
//                gatePage() on the server and wraps its body in
//                <AccessProvider value={decision}>; every control inside then
//                renders from the role rather than from a tier (spec 5.4's
//                read-only mode: "a control the role cannot use is not
//                rendered, not disabled").
//   useViewer()  the org-level chrome only: New Space, Invite, the Admin
//                settings section. Never for object UI, which is what
//                useAccess is for.
//
// Both are named in spec 10 step 0's deliverable list. They ship inert like
// the rest of the engine: no page provides the context yet, which is why
// useAccess has a safe default rather than throwing. Step 3 adds the providers
// and the LockedPage, and step 6 deletes use-role.ts in favour of useViewer.
//
// Client-only: this is the one file in src/lib/access that renders React. It
// imports ./types (pure) and ./org-role (pure) and nothing else from the
// engine, so it never drags prisma into a client bundle.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { adminScopesOf, isAgentOf, isSeededPeopleTeam, orgRoleOf } from "./org-role";
import { ROLE_RANK, type Decision, type ObjectRole, type Viewer } from "./types";

/**
 * The decision a page renders under when it has not provided one. Deny, never
 * allow: a component that reads useAccess() outside a provider must not paint
 * an edit affordance on the strength of a missing context.
 */
const NO_DECISION: Decision = {
  allowed: false,
  role: "none",
  via: "none",
  reason: "This page has not resolved access yet.",
  discoverable: false,
  enforcedAt: "src/lib/access/use-access.tsx (no AccessProvider)",
};

const AccessContext = createContext<Decision>(NO_DECISION);

export function AccessProvider({ value, children }: { value: Decision; children: ReactNode }) {
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

/** The object decision for the page this component is inside. */
export function useAccess(): Decision {
  return useContext(AccessContext);
}

/**
 * Does the viewer's role on this page's object clear a bar? The one place a
 * component should branch, so nothing re-derives the ladder.
 *
 *   const { can } = useAccessLevel();
 *   {can("EDIT") && <AddTaskButton />}
 */
export function useAccessLevel(): { role: ObjectRole | "none"; can: (min: ObjectRole) => boolean } {
  const decision = useAccess();
  return useMemo(
    () => ({
      role: decision.role,
      can: (min: ObjectRole) => ROLE_RANK[decision.role] >= ROLE_RANK[min],
    }),
    [decision.role],
  );
}

export interface ClientViewer extends Viewer {
  /** False until the session resolves, so chrome can hold its render. */
  ready: boolean;
}

/**
 * The org-level half of the Viewer, from the session. Step 0 derives orgRole
 * from the accessLevel claim through orgRoleOf (spec 10 step 0's "written
 * mirror"); step 8 removes the claim and reads orgRole directly, and this
 * function is the only place on the client that has to change.
 *
 * The lazily-loaded server fields (report tree, department, teams, tags) are
 * NOT in the session and are left empty here: a client component that needs
 * them asks the batched POST /api/access/check endpoint step 3 adds, rather
 * than guessing. `hasReports` is deliberately absent for the same reason.
 */
export function useViewer(): ClientViewer {
  const { data: session, status } = useSession();
  const user = session?.user as
    | { id?: string; organizationId?: string; accessLevel?: string | null }
    | undefined;

  return useMemo(() => {
    const accessLevel = user?.accessLevel ?? null;
    const orgRole = orgRoleOf({ accessLevel });
    return {
      userId: user?.id ?? "",
      organizationId: user?.organizationId ?? "",
      orgRole,
      isAgent: isAgentOf(accessLevel),
      adminScopes: adminScopesOf(orgRole, null),
      peopleTeam: isSeededPeopleTeam(accessLevel),
      ready: status !== "loading",
    };
  }, [user?.id, user?.organizationId, user?.accessLevel, status]);
}

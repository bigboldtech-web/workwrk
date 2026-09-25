// The /forms directory gates. Forms is core (founder decision D15), so there
// is no module check here: server components only because a bookmarked URL
// must not bypass the Guest rule (the dashboard layout is a client
// component).
//
// The Guest rule (spec-tables-forms section 1 Access; access 5.2.1 APP_RULES
// forms: Guests see shared forms only), from the one node-access resolver
// (R9): every Member edits a form, its creator keeps Full access for life, and
// a form grant opens the form to the person it names, a Guest included:
//   FormsGate      /forms/**      a session (the dashboard's own rule)
//   FormsListGate  /forms         a Guest gets the in-shell 404, never an
//                                 empty list and never <AppOff> (denial
//                                 shape 1)
//   FormGate       /forms/[id]    Can view on the form or the in-shell 404,
//                                 the same as a wrong id, so it confirms
//                                 nothing
// GET /api/forms scopes a Guest to their own and granted forms the same way,
// so the Tables sidebar never lists a row these gates would 404.

import { notFound } from "next/navigation";
import { requireSessionUser } from "@/lib/page-gates";
import { isGuestViewer } from "@/lib/route-guard";
import { nodeCtxFromSession, nodeRole } from "@/lib/access/node-access";
import { roleAtLeast } from "@/lib/access/node-rules";

export async function FormsGate({ children }: { children: React.ReactNode }) {
  await requireSessionUser();
  return <>{children}</>;
}

export async function FormsListGate({ children }: { children: React.ReactNode }) {
  await requireSessionUser();
  if (await isGuestViewer()) notFound();
  return <>{children}</>;
}

/**
 * FormGate's rule on its own: may this signed-in viewer open this form? Can
 * view or higher on it from the one resolver (a Member always, a Guest when
 * they made it or were given it); the builder's own reads decide edit or view
 * only. The Work door for a form (src/components/access/work-object-gate.tsx)
 * asks the same question, so /work/forms/[id] and /forms/[id] can never
 * disagree.
 */
export async function formGateAllows(formId: string, user: { id: string; organizationId: string }): Promise<boolean> {
  const ctx = await nodeCtxFromSession();
  if (!ctx || ctx.userId !== user.id || ctx.organizationId !== user.organizationId) return false;
  const d = await nodeRole(ctx, { kind: "form", id: formId });
  return roleAtLeast(d.role, "VIEW");
}

export async function FormGate({ formId, children }: { formId: string; children: React.ReactNode }) {
  const user = await requireSessionUser();
  if (!(await formGateAllows(formId, user))) notFound();
  return <>{children}</>;
}

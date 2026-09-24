// The /forms directory gates. Forms is core (founder decision D15), so there
// is no module check here: server components only because a bookmarked URL
// must not bypass the Guest rule (the dashboard layout is a client
// component).
//
// The Guest rule (spec-tables-forms section 1 Access; access 5.2.1 APP_RULES
// forms: Guests see shared forms only). No Guest share path to a form exists
// while the access engine is inert, so the one form a Guest can hold is one
// they made themselves, and the creator keeps Full access and is never
// locked out of it (access 3.3):
//   FormsGate      /forms/**      a session (the dashboard's own rule)
//   FormsListGate  /forms         a Guest gets the in-shell 404, never an
//                                 empty list and never <AppOff> (denial
//                                 shape 1)
//   FormGate       /forms/[id]    a Guest opens only a form they made; any
//                                 other id is the same in-shell 404 as a
//                                 wrong id, so it confirms nothing
// GET /api/forms scopes a Guest to their own forms the same way, so the
// Tables sidebar never lists a row these gates would 404.

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSessionUser } from "@/lib/page-gates";
import { isGuestViewer } from "@/lib/route-guard";

export async function FormsGate({ children }: { children: React.ReactNode }) {
  await requireSessionUser();
  return <>{children}</>;
}

export async function FormsListGate({ children }: { children: React.ReactNode }) {
  await requireSessionUser();
  if (await isGuestViewer()) notFound();
  return <>{children}</>;
}

export async function FormGate({ formId, children }: { formId: string; children: React.ReactNode }) {
  const user = await requireSessionUser();
  if (await isGuestViewer()) {
    const mine = await prisma.formDefinition.findFirst({
      where: { id: formId, organizationId: user.organizationId, createdById: user.id },
      select: { id: true },
    });
    if (!mine) notFound();
  }
  return <>{children}</>;
}

// Candor on the server: who may see, answer, run and read a session, one
// place, so the list, the page, the respond route and the results agree.
//
//   runner      the session's owner, the People team, Owner and Admin:
//               launch, close, reopen, delete a draft, read the results
//   respondent  anyone inside the session's scope (everyone, or its one
//               department) while it is Open, and never its owner (their
//               answer would count toward the floor of results they read)
//   anyone else a session is not discoverable (404, never a locked page)
//
// Who a session may ask (its scope) follows who runs it (access-model-spec
// Candor session row: "anyone with reports FULL for sessions over their
// chain; People team and Admin FULL org-wide"). candorScopesFor below is
// the one rule; POST /api/candor, PATCH /api/candor/[id] and the editor's
// picker all read it, so a manager with one report can never ask the whole
// company.
//
// Server only.

import { prisma } from "@/lib/prisma";
import { viewerFromSession } from "@/lib/access/viewer";
import { sessionOnLegacyManagerTier } from "@/lib/page-gates";
import { candorScopeAllowed, type CandorScopes } from "./candor";

// The pure scope rule lives in candor.ts (pages read it too); re-exported so
// the routes keep one import.
export { candorHasAnyScope, candorScopeAllowed, candorScopeRefusal, type CandorScopes } from "./candor";

export interface CandorCtx {
  userId: string;
  organizationId: string;
  departmentId: string | null;
  peopleTeamOrAdmin: boolean;
  isAgent: boolean;
}

export async function candorCtx(): Promise<CandorCtx | null> {
  const v = await viewerFromSession();
  if (!v || v.orgRole === "GUEST") return null;
  const me = await prisma.user.findUnique({ where: { id: v.userId }, select: { departmentId: true } });
  return {
    userId: v.userId,
    organizationId: v.organizationId,
    departmentId: me?.departmentId ?? null,
    peopleTeamOrAdmin: v.orgRole === "OWNER" || v.orgRole === "ADMIN" || v.peopleTeam === true,
    isAgent: v.isAgent,
  };
}

export function candorFaces(ctx: CandorCtx, s: { createdBy: string; status: string; departmentId: string | null }, hasResponded: boolean) {
  const isOwner = s.createdBy === ctx.userId;
  const canManage = isOwner || ctx.peopleTeamOrAdmin;
  const inScope = !s.departmentId || s.departmentId === ctx.departmentId;
  const canRespond = !isOwner && inScope && s.status === "ACTIVE" && !hasResponded;
  const visible = canManage || (inScope && s.status === "ACTIVE");
  return { isOwner, canManage, canSeeResults: canManage, inScope, canRespond, hasResponded, visible };
}

/**
 * The scopes a person may ask. `departmentIds: null` means any department.
 *   org-wide   Owner, Admin, the People team, and the legacy manager tier
 *              (MANAGER, DIRECTOR and up, HR), who could already ask
 *              everyone before Phase 6: Everyone and any department.
 *   chain      someone who runs sessions only because people report to them
 *              (Phase 6 opened Candor to them): a department they head, or
 *              one where every active member reports to them; Everyone only
 *              when the whole company does. A chain that covers no scope
 *              yet leaves nothing to pick, and the routes say so plainly.
 */
export const CANDOR_ORG_WIDE: CandorScopes = { everyone: true, departmentIds: null };

/** Pure: the scopes a chain-only organiser covers. `members` is every active member of the org. */
export function candorChainScopes(input: {
  userId: string;
  reportTree: ReadonlySet<string>;
  members: ReadonlyArray<{ id: string; departmentId: string | null }>;
  departments: ReadonlyArray<{ id: string; headId: string | null }>;
}): CandorScopes {
  if (!input.reportTree.size) return { everyone: false, departmentIds: [] };
  const others = input.members.filter((m) => m.id !== input.userId);
  // Covered means everyone who would be told (notifyCandorOpen asks every
  // active member of the scope but the owner) is in the chain, and there is
  // at least one of them: an empty department is nobody to ask.
  const covered = (ids: string[]) => ids.length > 0 && ids.every((id) => input.reportTree.has(id));
  const byDept = new Map<string, string[]>();
  for (const m of others) {
    if (!m.departmentId) continue;
    const list = byDept.get(m.departmentId);
    if (list) list.push(m.id);
    else byDept.set(m.departmentId, [m.id]);
  }
  return {
    everyone: covered(others.map((m) => m.id)),
    departmentIds: input.departments.filter((d) => d.headId === input.userId || covered(byDept.get(d.id) ?? [])).map((d) => d.id),
  };
}

/** The first scope to give a new draft that names none: the organiser's own department when allowed. */
export function candorDefaultScope(scopes: CandorScopes, ownDepartmentId: string | null): string | null | undefined {
  if (scopes.everyone) return null;
  if (ownDepartmentId && candorScopeAllowed(scopes, ownDepartmentId)) return ownDepartmentId;
  return scopes.departmentIds?.[0];
}

/** The scopes this viewer may ask (see CandorScopes). */
export async function candorScopesFor(ctx: CandorCtx): Promise<CandorScopes> {
  if (ctx.peopleTeamOrAdmin || (await sessionOnLegacyManagerTier())) return CANDOR_ORG_WIDE;
  const v = await viewerFromSession();
  const reportTree = v?.reportTree ?? new Set<string>();
  if (!reportTree.size) return { everyone: false, departmentIds: [] };
  const [members, departments] = await Promise.all([
    prisma.user.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null }, select: { id: true, departmentId: true } }),
    prisma.department.findMany({ where: { organizationId: ctx.organizationId }, select: { id: true, headId: true } }),
  ]);
  return candorChainScopes({ userId: ctx.userId, reportTree, members, departments });
}

/** Has this person answered this session (CandorRespondent; absent table reads as no). */
export async function hasAnsweredCandor(sessionId: string, userId: string): Promise<boolean> {
  try {
    const r = await prisma.candorRespondent.findUnique({ where: { sessionId_userId: { sessionId, userId } }, select: { id: true } });
    return !!r;
  } catch (e) {
    if ((e as { code?: string })?.code === "P2021") return false;
    throw e;
  }
}

/**
 * Tell everyone in a session's scope that it is open (never its owner): an
 * Inbox row "A candor session is open: {title}" that links the session
 * itself, and an email. Called on launch, never on reopen.
 */
export async function notifyCandorOpen(
  session: { id: string; title: string; description: string | null; departmentId: string | null },
  orgId: string,
  creatorId: string,
): Promise<void> {
  const { sendEmail } = await import("@/lib/email");
  const { genericNotificationTemplate } = await import("@/lib/email-templates");
  const users = await prisma.user.findMany({
    where: { organizationId: orgId, deletedAt: null, id: { not: creatorId }, ...(session.departmentId ? { departmentId: session.departmentId } : {}) },
    select: { id: true, email: true, firstName: true },
  });
  if (!users.length) return;
  await prisma.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      type: "candor_open",
      title: `A candor session is open: ${session.title}`,
      message: "Your answers are anonymous.",
      link: `/candor/${session.id}`,
    })),
  });
  const baseUrl = process.env.NEXTAUTH_URL || "https://workwrk.com";
  for (const u of users) {
    const { subject, html } = genericNotificationTemplate({
      heading: "A candor session is open",
      recipientName: u.firstName,
      subjectText: "Your team is asking for honest, anonymous feedback.",
      itemTitle: session.title,
      itemDetails: session.description || "Say what is working, what is not, and what should change.",
      actionLabel: "Answer",
      actionLink: `${baseUrl}/candor/${session.id}`,
      note: "Your answers are anonymous. WorkwrK records that you answered, never what you answered.",
    });
    sendEmail({
      to: u.email, subject, html,
      template: "candor-session",
      variables: { title: session.title },
      organizationId: orgId, userId: u.id, category: "reminder",
    }).catch(() => {});
  }
}

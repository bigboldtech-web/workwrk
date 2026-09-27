// Who may open and answer a form, resolved ONE way for the three doors that
// ask: GET /api/public/forms/[id] (the responder and the embed read), and
// POST /api/forms/[id]/responses (the one submit path).
//
// spec-tables-forms section 1 Access, the public routes' two questions, public
// first:
//   (1) Is the form's public link on, and does the org's toggle 10 allow it?
//       Then anyone with the link may OPEN and FILL it.
//   (2) Otherwise: is there a session whose person clears the respond check on
//       the form's anchor (the List or Table it feeds)? Then that person may.
// Neither: the caller answers 404, identical for "wrong id", "not public" and
// "not shared with you", so a stranger learns nothing.
//
// SUBMIT needs a session (the decided model: a public link carries Can view,
// access invariant 19), with ONE named exception, founder decision D16: the
// per-form "Accept responses from people without an account" switch. With the
// public link live and the switch on, `anonymousSubmit` is true for anyone who
// is not a member of the form's org (signed out, or signed in elsewhere), and
// the submit route writes their response with no person on it. It grants
// exactly one append; it never widens what they can open or read, and it is
// never a third value on toggle 10.
//
// The destination reach is the one node-access resolver's (the same answer
// the anchors' own pages give): a form grant never bypasses it. Server only.

import { prisma } from "@/lib/prisma";
import { nodeRoles, type NodeCtx } from "@/lib/access/node-access";
import { roleAtLeast, type NodeRef } from "@/lib/access/node-rules";
import type { OrgRole } from "@/lib/access/types";
import { orgPublicLinksAllowed } from "@/lib/public-links";
import { FORM_SELECT } from "./form-select";
import { acceptsAnonymousResponses, readFormSettings } from "./settings";

/** The engine's Viewer, narrowed to what this module reads. */
export interface ResponderViewer {
  userId: string;
  organizationId: string;
  orgRole: OrgRole;
  isAgent: boolean;
}

export type ResponderBranch = "public" | "member";

export interface ResponderForm {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  fields: unknown;
  isPublic: boolean;
  targetBoardId: string | null;
  targetTableId: string | null;
  fieldMappings: unknown;
  createdById: string;
  /** The additive FormDefinition.settings bucket; undefined until it exists. */
  settings?: unknown;
}

export interface ResponderDecision {
  form: ResponderForm;
  branch: ResponderBranch;
  /** Signed in AS A MEMBER and allowed to answer (their name goes on the
   *  response; they may pick people and upload files). */
  canSubmit: boolean;
  /** Not a member, yet may send because the form accepts responses from
   *  people without an account (D16). The response carries no person. */
  anonymousSubmit: boolean;
  signedIn: boolean;
}

/** The anchor check for a signed-in person (branch 2), with the creator and
 *  org admins first so the person who built a form is never locked out. */
/** The engine Viewer shape as a node-access context. */
export function responderCtx(viewer: ResponderViewer): NodeCtx {
  return {
    userId: viewer.userId,
    organizationId: viewer.organizationId,
    orgAdmin: viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN",
    orgGuest: viewer.orgRole === "GUEST",
    isAgent: viewer.isAgent,
    denied: false,
  };
}

export async function viewerCanRespondAsMember(form: ResponderForm, viewer: ResponderViewer): Promise<boolean> {
  if (viewer.organizationId !== form.organizationId) return false;
  if (form.createdById === viewer.userId) return true;
  if (viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN") return true;
  const guest = viewer.orgRole === "GUEST";
  // Destination reach through the one resolver: Can view on the List, or on
  // the table (a table in no Space, or gone, is the org's), one world.
  const refs: NodeRef[] = [];
  if (form.targetBoardId) refs.push({ kind: "list", id: form.targetBoardId });
  else if (form.targetTableId) refs.push({ kind: "table", id: form.targetTableId });
  if (refs.length === 0) {
    // No destination yet. Today any member of the org could open and answer
    // such a form, and access change request T2 (the "no destination inherits
    // nothing" clause) is the access unit's to land, so a Member keeps that
    // reach here and a Guest never had it.
    return !guest;
  }
  const decisions = await nodeRoles(responderCtx(viewer), refs);
  if (form.targetBoardId) return roleAtLeast(decisions.get(`list:${form.targetBoardId}`)?.role ?? "none", "VIEW");
  const tableRole = decisions.get(`table:${form.targetTableId}`)?.role ?? "none";
  if (roleAtLeast(tableRole, "VIEW")) return true;
  // A destination table that is gone gives what no destination gives.
  const exists = await prisma.dataTable.findFirst({ where: { id: form.targetTableId as string, organizationId: form.organizationId }, select: { id: true } });
  return exists ? false : !guest;
}

/**
 * Resolve the two branches for one form id. `viewer` is null for a signed-out
 * visitor. `embed` drops branch 2: an embed never falls back to a sign-in,
 * because a host page cannot carry someone else's login (spec /embed/forms/[id]).
 */
export async function resolveResponder(
  formId: string,
  viewer: ResponderViewer | null,
  opts: { embed?: boolean } = {},
): Promise<ResponderDecision | null> {
  const row = await prisma.formDefinition.findUnique({
    where: { id: formId },
    select: { ...FORM_SELECT, organization: { select: { settings: true } } },
  });
  if (!row) return null;
  const { organization, ...form } = row;

  const publicOn = form.isPublic && orgPublicLinksAllowed(organization?.settings);
  const sameOrg = !!viewer && viewer.organizationId === form.organizationId;

  if (publicOn) {
    // Any signed-in member of the form's org may send a public form. A
    // signed-in person from ANOTHER org opens it like anyone else and may not
    // write into this org through it as themselves (the old submit route's
    // 403, kept); with the D16 switch on they send like anyone without an
    // account, with no person recorded, so no cross-workspace id is stored.
    const anonymous = acceptsAnonymousResponses(readFormSettings((form as ResponderForm).settings), true);
    return { form, branch: "public", canSubmit: sameOrg, anonymousSubmit: !sameOrg && anonymous, signedIn: !!viewer };
  }
  if (viewer && !opts.embed && (await viewerCanRespondAsMember(form, viewer))) {
    return { form, branch: "member", canSubmit: true, anonymousSubmit: false, signedIn: true };
  }
  return null;
}

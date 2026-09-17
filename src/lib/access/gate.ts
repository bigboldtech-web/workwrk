// The two boundaries: requireCan() for APIs, gatePage() for pages.
//
// Spec 5.5, the one denial convention:
//   1. Not signed in                      -> /login?callbackUrl=... (the only redirect)
//   2. Signed in, not discoverable        -> 404 (page: notFound(); API: 404 body)
//   3. Signed in, discoverable, no role   -> LockedPage / 403 with a reason
//   4. Has a role but not this action     -> 403 with the reason
//   5. Module off                         -> 403 module_off (Guests 404)
//   6. App hidden or floored              -> 403 app_off   (Guests 404)
//
// Reads never 403 about an object (invariant 14): requireCan returns 404 when
// the decision is not discoverable, with a body identical to a real 404. The
// rule-2 403s are about the module or app key, never the id.
//
// Server-only: imports next/navigation, prisma (through viewer.ts) and can().

import { notFound, redirect } from "next/navigation";
import { prisma } from "../prisma";
import { can } from "./index";
import { loadFacts } from "./facts";
import { decide } from "./resolve";
import { viewerFromSession } from "./viewer";
import type { Action, Decision, ObjectRef, Viewer } from "./types";

export type AccessErrorKind = "not_found" | "no_access" | "module_off" | "app_off" | "unauthorized";

export class AccessError extends Error {
  readonly status: number;
  readonly kind: AccessErrorKind;
  readonly body: Record<string, unknown>;

  constructor(status: number, kind: AccessErrorKind, body: Record<string, unknown> = {}) {
    super(kind);
    this.name = "AccessError";
    this.status = status;
    this.kind = kind;
    this.body = { error: kind, ...body };
  }
}

/** The 404 body, identical for a cross-org id and an id that does not exist. */
export function notFoundError(): AccessError {
  return new AccessError(404, "not_found");
}

function refName(ref: ObjectRef): { type: string; id: string } {
  if (ref.type === "app") return { type: "app", id: ref.key };
  if (ref.type === "settings") return { type: "settings", id: ref.page };
  if (ref.type === "org") return { type: "org", id: ref.action };
  return { type: ref.type, id: ref.id };
}

/**
 * API boundary. Throws AccessError(404) when the decision is not discoverable
 * and AccessError(403) otherwise; returns the viewer and the decision when the
 * action is allowed.
 */
export async function requireCan(
  action: Action,
  ref: ObjectRef,
): Promise<{ viewer: Viewer; decision: Decision }> {
  const viewer = await viewerFromSession();
  if (!viewer) throw new AccessError(401, "unauthorized");

  // loadFacts + decide rather than can(), because the 403 body of spec 5.3
  // names the object and its owner, and those are facts the Decision does not
  // carry. The page path and this one still answer through the same decide()
  // over the same ObjectRef, which is the whole of invariant 15.
  const facts = await loadFacts(viewer, ref);
  const decision = decide(facts, action);
  if (decision.allowed) return { viewer, decision };

  const guest = viewer.orgRole === "GUEST";

  // Rule 2: the one 403 class on a read, and it names only the module or app.
  if (decision.via === "module-off") {
    if (guest) throw notFoundError();
    throw new AccessError(403, "module_off", { module: decision.context?.module });
  }
  if (decision.via === "app-off") {
    if (guest) throw notFoundError();
    throw new AccessError(403, "app_off", { app: decision.context?.app });
  }

  // Spec 5.3's last row: a not-discoverable `{ type: "settings" }` ref is a
  // 403 naming the page, never a 404. /settings/* is a shared URL space with
  // the personal door, so nothing under it ever 404s for a signed-in person
  // (spec 5.5 item 3), and invariant 14's "reads never 403" is about objects.
  if (ref.type === "settings" && !decision.discoverable) {
    throw new AccessError(403, "no_access", { page: ref.page });
  }

  if (!decision.discoverable) throw notFoundError();

  const named = refName(ref);
  // Spec 5.3: { error, reason, object: { type, id, name }, owner: { id, name },
  // requestAccess }. LockedPage and the Request-access flow consume the name
  // and the owner; omitting them left both with an id to render.
  const owner = await ownerOf(facts.object.ownerId, viewer.organizationId);
  throw new AccessError(403, "no_access", {
    reason: decision.reason,
    object: { ...named, name: facts.object.name ?? null },
    owner,
    requestAccess: true,
  });
}

/** The owner card the LockedPage renders ("Ask {owner} for access"). */
async function ownerOf(
  ownerId: string | null,
  organizationId: string,
): Promise<{ id: string; name: string } | null> {
  if (!ownerId) return null;
  const row = await prisma.user.findFirst({
    where: { id: ownerId, organizationId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!row) return null;
  return { id: row.id, name: `${row.firstName} ${row.lastName}`.trim() };
}

/**
 * Page boundary. notFound() when the decision is not discoverable; otherwise
 * the decision comes back and the page renders locked or read-only. The only
 * redirect in the system is the signed-out one.
 */
export async function gatePage(
  action: Action,
  ref: ObjectRef,
  opts: { callbackUrl?: string } = {},
): Promise<{ viewer: Viewer; decision: Decision }> {
  const viewer = await viewerFromSession();
  if (!viewer) {
    redirect(`/login${opts.callbackUrl ? `?callbackUrl=${encodeURIComponent(opts.callbackUrl)}` : ""}`);
  }

  const decision = await can(viewer, action, ref);
  // Nothing under /settings/* ever 404s for a signed-in person: the personal
  // door shares the prefix, so the layout renders My settings there instead.
  if (!decision.discoverable && ref.type !== "settings") notFound();
  return { viewer, decision };
}

// The ONE gate in front of every Talk API route (spec-talk.md section 4 step 3).
//
// Before this, nineteen route files each wrote their own three lines: a
// session read, a module check, and a `conversationMember.findFirst` whose
// `select` differed from its neighbour's. What a person may DO once they are
// in a conversation was then decided inline, differently, in five of them,
// which is how "any member can rename the channel and add people" came to be
// true while the sidebar menu only offered it to some of them.
//
// This file is that gate, and the decision half lives in src/lib/talk-access.ts,
// which is pure and tested. Here there is only loading:
//
//   talkGate()                       session + the Talk module, one 403 body
//   loadConversationRole(id, gate)   the conversation, my membership, my role
//
// The access ENGINE stays inert, deliberately. `can()` is not called here:
// the engine's rollout is the access unit's, and swapping nineteen live
// routes onto it in this phase would change who can read what on the day the
// engine's facts loader changes. What this does instead is put every route on
// ONE code path, so that swap is later a one-file edit rather than nineteen.

import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { getSessionOrFail, getOrgId, getUserId } from "./api-helpers";
import { isModuleActive } from "./entitlements";
import { orgRoleOf } from "./access/org-role";
import {
  atLeast,
  canSelfJoin,
  talkRole,
  type TalkConversationFacts,
  type TalkOrgRole,
  type TalkRole,
  type TalkViewerFacts,
} from "./talk-access";

export const TALK_MODULE_SLUG = "workwrk-talk";

export interface TalkGate {
  userId: string;
  organizationId: string;
  orgRole: TalkOrgRole;
  accessLevel: string;
}

type GateResult = { error: NextResponse; gate: null } | { error: null; gate: TalkGate };

/**
 * Session plus the Talk module, with the one 403 body the whole unit answers
 * with. A Guest gets the same 403 the rest of the product gives them for a
 * module that is off, because an API that 404s here would be telling a Guest
 * about the workspace's billing.
 */
export async function talkGate(): Promise<GateResult> {
  const { error, session } = await getSessionOrFail();
  if (error) return { error, gate: null };

  const organizationId = getOrgId(session);
  if (!organizationId) {
    return { error: NextResponse.json({ error: "No organization" }, { status: 400 }), gate: null };
  }

  if (!(await isModuleActive(organizationId, TALK_MODULE_SLUG))) {
    return {
      error: NextResponse.json({ error: "This module isn't enabled for your workspace." }, { status: 403 }),
      gate: null,
    };
  }

  const accessLevel = (session.user as { accessLevel?: string } | undefined)?.accessLevel ?? "EMPLOYEE";
  return {
    error: null,
    gate: {
      userId: getUserId(session),
      organizationId,
      orgRole: orgRoleOf({ accessLevel }) as TalkOrgRole,
      accessLevel,
    },
  };
}

export interface ConversationContext {
  conversation: TalkConversationFacts & {
    id: string;
    findable: boolean;
    topic: string | null;
    createdAt: Date;
    callEpoch: number;
  };
  /** My ConversationMember row, or null when I am not in it. */
  membershipId: string | null;
  role: TalkRole;
  viewer: TalkViewerFacts;
  /** True when opening the URL should offer Join rather than 404. */
  joinable: boolean;
  /** The session facts that produced this context, so a route needs one call. */
  gate: TalkGate;
}

/**
 * Load one conversation and decide what this viewer holds in it.
 *
 * Returns null when the id does not exist in this organization, which every
 * caller turns into the SAME 404 it gives a conversation the viewer simply is
 * not in. A conversation must never confirm that it exists to somebody outside
 * it, which is why the role, not the row, is what callers branch on.
 *
 * Tolerates the four Phase 4 columns being absent for one release: a database
 * that predates them answers P2022 for the wider select, and the narrow one
 * below then supplies the defaults (`topic` null, not restricted, findable,
 * not archived), which is exactly how those rows behaved before.
 *
 * Anything ELSE the database says is rethrown rather than swallowed. A dropped
 * connection is a 500 the feed can offer a Retry for; reporting it as a
 * definite 404 told a person their conversation was gone and hid the fault
 * from the logs.
 */
function isMissingColumn(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2022";
}

export async function loadConversationRole(
  conversationId: string,
  gate: TalkGate,
): Promise<ConversationContext | null> {
  const where = { id: conversationId, organizationId: gate.organizationId } as const;
  const BASE = { id: true, type: true, name: true, createdById: true, createdAt: true, callEpoch: true } as const;

  let row: {
    id: string; type: string; name: string | null; createdById: string | null;
    createdAt: Date; callEpoch: number;
    topic?: string | null; restricted?: boolean | null; findable?: boolean | null; archivedAt?: Date | null;
  } | null;
  try {
    row = await prisma.conversation.findFirst({
      select: { ...BASE, topic: true, restricted: true, findable: true, archivedAt: true },
      where,
    });
  } catch (e) {
    if (!isMissingColumn(e)) throw e;
    row = await prisma.conversation.findFirst({ where, select: BASE });
  }
  if (!row) return null;

  const membership = await prisma.conversationMember.findFirst({
    where: { conversationId, userId: gate.userId },
    select: { id: true },
  });

  const conversation = {
    id: row.id,
    type: row.type as "DM" | "GROUP" | "CHANNEL",
    name: row.name,
    topic: row.topic ?? null,
    createdById: row.createdById,
    createdAt: row.createdAt,
    callEpoch: row.callEpoch,
    restricted: row.restricted ?? false,
    findable: row.findable ?? true,
    archivedAt: row.archivedAt ?? null,
  };

  const viewer: TalkViewerFacts = {
    userId: gate.userId,
    orgRole: gate.orgRole,
    isMember: Boolean(membership),
  };

  return {
    conversation,
    membershipId: membership?.id ?? null,
    role: talkRole(conversation, viewer),
    viewer,
    joinable: canSelfJoin(conversation, viewer),
    gate,
  };
}

/** The one 404 body, identical for a wrong id and a conversation I am not in. */
export function conversationNotFound(): NextResponse {
  return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
}

export type ConversationGuard =
  | { error: NextResponse; ctx: null }
  | { error: null; ctx: ConversationContext };

/**
 * The gate every WRITE route stands behind: session, module, the conversation
 * and the viewer's role in it, in one call.
 *
 * `floor` is the role the action needs. `allow` is the pure predicate from
 * talk-access.ts, so a route never re-decides what "archived" or "#general"
 * means: before this, six routes asked `conversationMember.findFirst` and
 * nothing else, which is how posting, reacting, editing, adding people and
 * resetting the guest link all still worked inside an ARCHIVED channel that
 * the product presents as frozen.
 */
export async function requireConversation(
  conversationId: string,
  opts: {
    floor?: TalkRole;
    allow?: (c: ConversationContext["conversation"], role: TalkRole) => boolean;
    /** The sentence in the 403 body, for example "post here". */
    what?: string;
  } = {},
): Promise<ConversationGuard> {
  const { error, gate } = await talkGate();
  if (error) return { error, ctx: null };

  const ctx = await loadConversationRole(conversationId, gate);
  // Not there, or not mine to see: one 404, never a 403 that confirms it.
  if (!ctx || ctx.role === "none") return { error: conversationNotFound(), ctx: null };

  const floor = opts.floor ?? "view";
  const ok = atLeast(ctx.role, floor) && (opts.allow ? opts.allow(ctx.conversation, ctx.role) : true);
  if (!ok) {
    const reason = ctx.conversation.archivedAt
      ? "This conversation is archived. Restore it first."
      : `You need Full access to ${opts.what ?? "do that"}.`;
    return { error: NextResponse.json({ error: reason }, { status: 403 }), ctx: null };
  }
  return { error: null, ctx };
}

/** The one 403 body for an action my role lacks, naming what is needed. */
export function needFullAccess(what = "that"): NextResponse {
  return NextResponse.json(
    { error: `You need Full access to ${what}.` },
    { status: 403 },
  );
}

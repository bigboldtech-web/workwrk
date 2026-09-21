// GET /api/boot: everything the shell needs before first paint, in one
// round trip (spec-shell.md sections 1.12 and 2.1 "Data"):
//
//   { setupCompleted, viewer, apps, manageableOffModules, prefs, org,
//     counts, timer, session }
//
// Over TODAY's tables. The four boot calls it replaces (/api/setup,
// /api/preferences, /api/organization/culture, /api/inbox/count) stay live
// until Phase 1 switches (dashboard)/layout.tsx over; this route only ADDS.
//
// `?counts=1` answers `{ counts }` alone: the 60s fallback poll the shell
// runs while the SSE stream is disconnected (section 1.11).
//
// Never redirects. No session is a 401 like every other route (the client's
// apiFetch turns it into the Session-expired dialog); a failure is a 500 the
// boot screen renders as ErrorState, never a trip to /onboard.

import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { unreadWhere, withClearedAtFallback } from "@/lib/inbox-query";
import { getEffectivePreferences, type EffectivePreferences } from "@/lib/preferences";
import { parseOrgAppsConfig, visibleRailApps } from "@/lib/rail-apps";
import { APP_ACCESS } from "@/lib/app-access";
import { MODULE_APP_KEYS } from "@/lib/modules";
import { orgRoleOf, isAgentOf } from "@/lib/access/org-role";
import { legacyIsAdminLevel } from "@/lib/access/legacy-levels";
import type { ActiveTimer } from "@/lib/realtime-events";

export const dynamic = "force-dynamic";

export type SplashPolicy = "every-open" | "first-open-daily" | "off";

export interface BootCounts {
  inboxUnread: number;
  remindersDue: number;
  talkUnread: number;
  /**
   * The viewer's OPEN SOP assignments (to do plus overdue). Drives the Docs
   * sidebar's My SOPs badge (spec-process section 4: "the badge must not add
   * a sixth poller; it rides the existing one").
   */
  mySops: number;
  /** Policies awaiting the viewer's acknowledgement. Drives the Policies badge. */
  policiesToAck: number;
}

export interface BootPayload {
  setupCompleted: boolean;
  viewer: {
    id: string;
    /** Today's ladder, kept so nothing that reads it breaks. */
    accessLevel: string | null;
    /** OWNER | ADMIN | MEMBER | GUEST, mapped from accessLevel (access step 0). */
    orgRole: string;
    isAgent: boolean;
    active: boolean;
    /** Empty until the access track writes the column. */
    adminScopes: string[];
    hasReports: boolean;
    peopleTeam: boolean;
    name: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    avatar: string | null;
    /** Null until the presence columns exist (settings spec 9.5). */
    presenceStatus: string | null;
    presenceUntil: string | null;
  };
  /** Rail hub keys visible to this viewer, in the org's order. */
  apps: string[];
  /** Hub and folded app keys the viewer may open (the palette's JUMP TO list). */
  launcherApps: string[];
  /** Premium modules that are OFF, for Owners and Admins only (spec 1.4). */
  manageableOffModules: string[];
  prefs: EffectivePreferences;
  org: {
    id: string;
    name: string;
    logo: string | null;
    plan: string;
    culture: { mission: string; values: string[]; splash: SplashPolicy };
  };
  counts: BootCounts;
  timer: ActiveTimer | null;
  session: { idleUntil: string | null };
}

const SPLASH_VALUES: ReadonlySet<string> = new Set(["every-open", "first-open-daily", "off"]);

async function counts(userId: string, orgId: string): Promise<BootCounts> {
  const now = new Date();
  const [inboxUnread, remindersDue, talkRows, mySops, policiesToAck] = await Promise.all([
    // The SAME clause as /api/inbox/count and as the Inbox's Primary + Other
    // tabs, from src/lib/inbox-query.ts. Three files used to run this query
    // by hand, which is how the sidebar badge and the Inbox tabs came to
    // disagree the moment somebody had more than fifty unread rows.
    withClearedAtFallback(() => prisma.notification.count({ where: unreadWhere(userId, now) })),
    prisma.reminder.count({ where: { userId, status: "FIRED" } }),
    // Same query as /api/conversations, collapsed to "conversations with unread".
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT m."conversationId")::bigint AS n
      FROM "ConversationMessage" m
      JOIN "ConversationMember" cm
        ON cm."conversationId" = m."conversationId" AND cm."userId" = ${userId}
      WHERE m."createdAt" > cm."lastReadAt"
        AND m."authorId" <> ${userId}
        AND m."deletedAt" IS NULL
        AND m."parentId" IS NULL
        AND cm."hidden" = false
        AND cm."notifyLevel" <> 'mute'`,
    // The two PROCESS badges (spec-process section 1 rows 10 and 13). Both
    // are the viewer's OWN rows, so neither needs the access engine: an
    // assignment is addressed to one person by id.
    //
    // AND BOTH ARE SCOPED TO THIS ORG. Neither assignment table carries an
    // organizationId of its own; the org lives on the SOP and on the Policy.
    // Counting on userId alone therefore added up a person's assignments
    // across every organisation they belong to, so the badge in one workspace
    // could count another workspace's work. The relation filter is the org.
    //
    // TOLERATING THE TABLE BEING ABSENT. Both counts fall back to 0 rather
    // than taking the whole boot payload down with them: a badge is chrome,
    // and a shell that will not mount because a count query threw is a far
    // worse failure than a missing number. The failure is logged, so a badge
    // that is permanently zero because a query broke leaves a trace instead
    // of looking like an empty list.
    prisma.sOPAssignment
      .count({
        where: {
          userId,
          status: { in: ["ASSIGNED", "IN_PROGRESS", "OVERDUE"] },
          sop: { organizationId: orgId },
        },
      })
      .catch((e: unknown) => { console.error("boot counts: mySops", e); return 0; }),
    prisma.policyAssignment
      .count({
        where: {
          userId,
          status: { not: "COMPLETED" },
          policy: { organizationId: orgId },
        },
      })
      .catch((e: unknown) => { console.error("boot counts: policiesToAck", e); return 0; }),
  ]);
  return {
    inboxUnread,
    remindersDue,
    talkUnread: Number(talkRows[0]?.n ?? 0),
    mySops,
    policiesToAck,
  };
}

async function activeTimer(userId: string, orgId: string): Promise<ActiveTimer | null> {
  // Mirrors /api/timers/active.
  const active = await prisma.timerSession.findFirst({
    where: { organizationId: orgId, userId, stoppedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true, entityType: true, entityId: true, startedAt: true },
  });
  if (!active) return null;
  let title: string | null = null;
  let url: string | null = null;
  if (active.entityType === "BOARD_ITEM") {
    const item = await prisma.item.findFirst({
      where: { id: active.entityId, organizationId: orgId },
      select: { id: true, title: true, boardId: true, board: { select: { slug: true } } },
    });
    if (item) {
      title = item.title;
      url = `/item/${item.id}`;
    }
  }
  return {
    id: active.id,
    entityType: active.entityType,
    entityId: active.entityId,
    startedAt: active.startedAt.toISOString(),
    title,
    url,
  };
}

/**
 * When this session lapses if nothing renews it: the moment the cookie was
 * last issued (`iat`, stamped by every `jwt.encode`) plus `session.maxAge`.
 * That is the cookie's own Expires, which is what NextAuth enforces. The
 * JWE `exp` claim is NOT that boundary: the sign-in callback encodes with the
 * 30-day JWT default, so `exp` sits weeks past the real 12h idle cut-off.
 * Only `GET /api/auth/session` re-issues the cookie (a Route Handler's
 * getServerSession cannot set one), so this is also the value the idle
 * warning's "Stay signed in" refreshes. Null when there is no idle timeout.
 */
async function idleUntil(req: NextRequest): Promise<string | null> {
  const maxAgeSec = authOptions.session?.maxAge;
  if (!maxAgeSec) return null;
  try {
    const secure = process.env.NODE_ENV === "production";
    const token = await getToken({
      req,
      cookieName: `${secure ? "__Secure-" : ""}next-auth.session-token`,
      secureCookie: secure,
    });
    const iat = (token as { iat?: number } | null)?.iat;
    const issuedMs = typeof iat === "number" ? iat * 1000 : Date.now();
    return new Date(issuedMs + maxAgeSec * 1000).toISOString();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const su = session?.user as
    | { id?: string; organizationId?: string; accessLevel?: string; firstName?: string; lastName?: string; avatar?: string; email?: string | null }
    | undefined;
  if (!su?.id || !su.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = su.id;
  const orgId = su.organizationId;

  try {
    if (req.nextUrl.searchParams.get("counts") === "1") {
      return NextResponse.json({ counts: await counts(userId, orgId) }, { headers: { "Cache-Control": "no-store" } });
    }

    const [org, user, prefs, reportCount, c, timer, idle] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { id: true, name: true, logo: true, plan: true, settings: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true, accessLevel: true, status: true, deletedAt: true },
      }),
      getEffectivePreferences(userId, orgId),
      prisma.user.count({ where: { managerId: userId, deletedAt: null } }),
      counts(userId, orgId),
      activeTimer(userId, orgId),
      idleUntil(req),
    ]);

    if (!org || !user || user.deletedAt) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = (org.settings ?? {}) as {
      setupCompleted?: unknown;
      companyProfile?: { mission?: unknown; values?: unknown; splash?: unknown };
      access?: { peopleTeam?: unknown };
    };
    const profile = settings.companyProfile ?? {};
    const mission = typeof profile.mission === "string" ? profile.mission.trim() : "";
    const values = Array.isArray(profile.values)
      ? profile.values.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim())
      : [];
    const splash: SplashPolicy =
      typeof profile.splash === "string" && SPLASH_VALUES.has(profile.splash) ? (profile.splash as SplashPolicy) : "first-open-daily";
    const peopleTeam = Array.isArray(settings.access?.peopleTeam) && (settings.access!.peopleTeam as unknown[]).includes(userId);

    const accessLevel = user.accessLevel ?? null;
    const activeModules = new Set(prefs.modules.activeAppKeys);
    const railConfig = parseOrgAppsConfig(prefs.sidebar.apps);
    // The same resolver the client rail runs, over the pure catalog mirror
    // (src/lib/app-access.ts): the client catalog is a "use client" module.
    const apps = visibleRailApps({ config: railConfig, accessLevel: accessLevel ?? undefined, activeModules, apps: APP_ACCESS }).map((a) => a.key);
    const launcherApps = visibleRailApps({ config: railConfig, accessLevel: accessLevel ?? undefined, activeModules, includeFolded: true, apps: APP_ACCESS }).map((a) => a.key);
    const manageableOffModules = legacyIsAdminLevel(accessLevel)
      ? [...MODULE_APP_KEYS].filter((k) => !activeModules.has(k))
      : [];

    const payload: BootPayload = {
      setupCompleted: !!settings.setupCompleted,
      viewer: {
        id: user.id,
        accessLevel,
        orgRole: orgRoleOf({ accessLevel }),
        isAgent: isAgentOf(accessLevel),
        active: user.status === "ACTIVE",
        adminScopes: [],
        hasReports: reportCount > 0,
        peopleTeam,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || "",
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        email: user.email ?? null,
        avatar: user.avatar ?? null,
        presenceStatus: null,
        presenceUntil: null,
      },
      apps,
      launcherApps,
      manageableOffModules,
      prefs,
      org: {
        id: org.id,
        name: org.name,
        logo: org.logo ?? null,
        plan: String(org.plan),
        culture: { mission, values, splash },
      },
      counts: c,
      timer,
      session: { idleUntil: idle },
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[boot] failed:", err);
    return NextResponse.json(
      {
        error: "Couldn't open WorkwrK",
        // Dev only: the boot screen's reference line; never a stack in prod.
        detail: process.env.NODE_ENV === "production" ? undefined : String(err),
      },
      { status: 500 },
    );
  }
}

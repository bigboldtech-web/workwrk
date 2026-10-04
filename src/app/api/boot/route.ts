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

import { aiEnabledFromSettings } from "@/lib/ai/ai-enabled";
import { accessV2Tables, appGatesEnforce, delegateOn } from "@/lib/access/flags";
import { settingsReaderPagesFor } from "@/lib/access/settings-door";
import { mayCreateSpace } from "@/lib/access/space-create";
import type { SettingsPageKey } from "@/lib/access/types";
import { orgCurrencyFromSettings } from "@/lib/org/org-currency";
import { retentionDays } from "@/lib/trash-view";
import { passwordMaxAgeDaysOf, securityHoldFor, type SecurityHold } from "@/lib/auth/security-policy";
import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import { orgPublicLinksTurnedOn } from "@/lib/public-links";
import { prisma } from "@/lib/prisma";
import { countPoliciesToAck } from "@/lib/policies-to-ack";
import { unreadWhere, withClearedAtFallback } from "@/lib/inbox-query";
import { getEffectivePreferences, type EffectivePreferences } from "@/lib/preferences";
import { parseOrgAppsConfig, visibleRailApps } from "@/lib/rail-apps";
import { engineTiers, tiersOfLevel, type ViewerTiers } from "@/lib/access/viewer-tiers";
import { personScope } from "@/lib/process-scope";
import { APP_ACCESS } from "@/lib/app-access";
import { MODULE_APP_KEYS } from "@/lib/modules";
import { orgRoleOf, isAgentOf, peopleTeamOf } from "@/lib/access/org-role";
import { parseAccessSettings } from "@/lib/access/settings";
import { legacyIsAdminLevel, legacyIsManagerLevel } from "@/lib/access/legacy-levels";
import { ownerSplitOn, scopeForOwnerPage, sessionMayManageOwnerPage } from "@/lib/access/workspace-admin";
import type { ActiveTimer } from "@/lib/realtime-events";
import { teamsFactsAndCounts, EMPTY_TEAMS_COUNTS, type TeamsCounts, type TeamsViewerFacts } from "@/lib/people/teams-counts";

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
  /**
   * Phase 6, the Teams hub badges (spec-teams-performance section 1
   * "Counts", spec-goals section 1, spec-teams-people section 1): weekly
   * reviews awaiting my decision, review forms awaiting me, open candor
   * sessions and surveys I have not answered, KPI numbers awaiting my
   * approval, and my own KPIs this month with no number yet. Computed in this
   * same pass by src/lib/people/teams-counts.ts, through the same helpers
   * the pages use.
   */
  weeklyReviews: TeamsCounts["weeklyReviews"];
  weeklyReviewsChain: TeamsCounts["weeklyReviewsChain"];
  reviewForms: TeamsCounts["reviewForms"];
  candorOpen: TeamsCounts["candorOpen"];
  surveysOpen: TeamsCounts["surveysOpen"];
  kpiReviews: TeamsCounts["kpiReviews"];
  myKpisDue: TeamsCounts["myKpisDue"];
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
    /** Reports, solid or dotted (the access engine's rule). */
    hasReports: boolean;
    /**
     * The display tiers the rail, hub sidebars and create menus read
     * (src/lib/access/viewer-tiers.ts), answered here so no client surface
     * reads the level. Optional for an older payload (none cleared).
     */
    tiers?: ViewerTiers;
    /**
     * Opens the SOP and Policy compliance ledgers (src/lib/process-scope.ts
     * personScope canView: org-wide levels, or a manager with reports), the
     * rule their layouts 404 on. Optional for an older payload (no rows).
     */
    complianceReader?: boolean;
    peopleTeam: boolean;
    /** May create a Space: the answer POST /api/spaces gives (src/lib/access/space-create.ts). Optional for an older payload. */
    canCreateSpace?: boolean;
    /**
     * Opens the Workspace Members, Access and Scoring pages below Admin (the
     * legacy manager tier, People team included: settings-gate.tsx
     * LEGACY_SETTINGS_RULES), so the settings frame shows those rows
     * (sidebar-map 8a) instead of the My settings list.
     */
    settingsReader?: boolean;
    /**
     * Phase 8 stage E: with the engine deciding the settings door
     * (ACCESS_V2_RESOLVER on, the log-only week over), the pages this reader
     * opens: the People team's four (Members, Structure, Access, Scoring),
     * nothing for the manager tier. Absent under today's table.
     */
    settingsReaderPages?: SettingsPageKey[];
    /**
     * Phase 8: the Owner pages (Security, API & webhooks, Plan & billing) this
     * Admin cannot open (only with SETTINGS_OWNER_SPLIT on, and only for an
     * Admin without the page's scope). The Workspace sidebar draws a lock on
     * these rows, as the Overview tiles do. Absent when nothing is locked.
     */
    settingsLockedPages?: SettingsPageKey[];
    /** Phase 8: the Owner-only actions (Identity > Danger zone: delete, transfer) are closed to this Admin (the split on, not an Owner). */
    ownerActionsLocked?: boolean;
    /**
     * Phase 6: in scope of an open candor session, or answered one, or an
     * organiser by the legacy manager tier (the Candor row). The organiser
     * part is the same predicate the /candor page gate and POST /api/candor
     * read (culture-gate.ts isCultureOrganiser), so the row, the palette and
     * the page never disagree.
     */
    candorInvited: TeamsViewerFacts["candorInvited"];
    /** Phase 6: targeted by an open survey, or answered one, or an organiser by the legacy manager tier (the Surveys row). */
    surveyTargeted: TeamsViewerFacts["surveyTargeted"];
    name: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    avatar: string | null;
    /** The viewer's status (settings spec 9.5); null when none, expired, or the columns are absent. */
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
    /**
     * `settings.retention.trashDays` resolved through retentionDays(), so the
     * Move-to-Trash confirms can say "restore within N days" from the org's
     * real value and never a number typed into copy (spec-docs-knowledge
     * section 2, /docs and /canvas confirm copy).
     */
    trashDays: number;
    /**
     * settings.data.aiEnabled, "AI features for members" (default on). The
     * shell's Ask AI entry points (panel, header slot, Cmd+J, palette row)
     * render only when it is on; the page gate enforces it server side.
     */
    aiEnabled: boolean;
    /** settings.currency (Settings > Locale and work week), USD when unset. */
    currency: string;
    /**
     * Task public links are turned on (Public links set to View only,
     * src/lib/public-links.ts orgPublicLinksTurnedOn), so the task menu
     * offers "Public link" to people who may share. Optional for an older
     * payload (read as off).
     */
    taskPublicLinks?: boolean;
    /**
     * The one share dialog serves SOP folders, tools, goals and teams
     * (batch 7, behind ACCESS_V2_TABLES, src/lib/access/object-share): their
     * Share entries render only when this is on, so with the flag off every
     * surface keeps the one it has. Optional for an older payload (read as off).
     */
    objectShare?: boolean;
  };
  counts: BootCounts;
  timer: ActiveTimer | null;
  /**
   * `hold` is the org sign-in rule this person must meet before they carry
   * on (the Security hold dialog): "mfa" when the org requires two step
   * verification for their role and they are not enrolled, "password" when
   * their password is older than the org's maximum age. Null when neither
   * (every org until Workspace settings > Security writes a rule).
   */
  session: { idleUntil: string | null; hold: SecurityHold; passwordMaxAgeDays: number | null };
}

const SPLASH_VALUES: ReadonlySet<string> = new Set(["every-open", "first-open-daily", "off"]);

async function counts(userId: string, orgId: string): Promise<BootCounts> {
  return (await countsAndFacts(userId, orgId)).counts;
}

const NO_TEAMS_FACTS: TeamsViewerFacts = { hasReports: false, candorInvited: false, surveyTargeted: false };

async function countsAndFacts(userId: string, orgId: string): Promise<{ counts: BootCounts; teams: TeamsViewerFacts }> {
  const now = new Date();
  const teamsPass = prisma.user
    .findUnique({ where: { id: userId }, select: { officeId: true, departmentId: true } })
    .then((me) => teamsFactsAndCounts(userId, orgId, { officeId: me?.officeId ?? null, departmentId: me?.departmentId ?? null }, now))
    .catch((e: unknown) => {
      console.error("boot counts: teams", e);
      return { facts: NO_TEAMS_FACTS, counts: EMPTY_TEAMS_COUNTS };
    });
  const [[inboxUnread, remindersDue, talkRows, mySops, policiesToAck], teams] = await Promise.all([Promise.all([
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
    // ONE rule with the /policies "Needs my acknowledgement" pill
    // (lib/policies-to-ack), so the badge and the pill never disagree.
    countPoliciesToAck(userId, orgId)
      .catch((e: unknown) => { console.error("boot counts: policiesToAck", e); return 0; }),
  ]), teamsPass]);
  return {
    counts: {
      inboxUnread,
      remindersDue,
      talkUnread: Number(talkRows[0]?.n ?? 0),
      mySops,
      policiesToAck,
      ...teams.counts,
    },
    teams: teams.facts,
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

    const [org, user, prefs, cf, timer, idle, presence] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { id: true, name: true, logo: true, plan: true, settings: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true, email: true, avatar: true, accessLevel: true, status: true, deletedAt: true },
      }),
      getEffectivePreferences(userId, orgId),
      countsAndFacts(userId, orgId),
      activeTimer(userId, orgId),
      idleUntil(req),
      // Its own query, so a database without the Phase 6 presence columns
      // yet answers "no status" instead of failing boot.
      prisma.user
        .findUnique({ where: { id: userId }, select: { presenceStatus: true, presenceUntil: true } })
        .catch(() => null),
    ]);
    // Its own query for the same reason: a database without the Phase 8
    // passwordChangedAt column answers "no hold" instead of failing boot.
    const security = await prisma.user
      .findUnique({ where: { id: userId }, select: { mfaEnabled: true, passwordChangedAt: true } })
      .catch(() => null);

    if (!org || !user || user.deletedAt) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = (org.settings ?? {}) as {
      setupCompleted?: unknown;
      companyProfile?: { mission?: unknown; values?: unknown; splash?: unknown };
      access?: unknown;
    };
    const profile = settings.companyProfile ?? {};
    const mission = typeof profile.mission === "string" ? profile.mission.trim() : "";
    const values = Array.isArray(profile.values)
      ? profile.values.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim())
      : [];
    const splash: SplashPolicy =
      typeof profile.splash === "string" && SPLASH_VALUES.has(profile.splash) ? (profile.splash as SplashPolicy) : "first-open-daily";
    // The engine's rule, both halves of it (src/lib/access/resolve.ts
    // isPeopleTeam): the configured People team (access.peopleTeamUserIds,
    // read through parseAccessSettings as src/lib/access/facts.ts
    // loadOrgFacts does), OR an HR-level user, whom viewer.ts hydrate always
    // counts (spec 10 step 0 "People team = users at HR until toggle 6
    // exists"). Boot used to read a stale key alone, so an HR person's chrome
    // disagreed with every server gate that let them in.
    const peopleTeam = peopleTeamOf({
      userId,
      accessLevel: user.accessLevel ?? null,
      configured: parseAccessSettings(settings.access).peopleTeamUserIds,
      tablesOn: accessV2Tables(),
    });

    const accessLevel = user.accessLevel ?? null;
    const activeModules = new Set(prefs.modules.activeAppKeys);
    const railConfig = parseOrgAppsConfig(prefs.sidebar.apps);
    // The same resolver the client rail runs, over the pure catalog mirror
    // (src/lib/app-access.ts): the client catalog is a "use client" module.
    // The display tiers, answered once here and shipped to the client
    // (viewer.tiers), so no client surface reads the level (access step 6).
    // By the rule the app routes enforce: today's ladder, or, once the
    // engine decides them (appGatesEnforce), the engine's reading
    // (viewer-tiers.ts engineTiers), so a floored app's rail row and its
    // route never disagree.
    const tiers = appGatesEnforce()
      ? engineTiers({ orgRole: orgRoleOf({ accessLevel }), peopleTeam, hasReports: cf.teams.hasReports })
      : tiersOfLevel(accessLevel);
    const apps = visibleRailApps({ config: railConfig, tiers, activeModules, apps: APP_ACCESS }).map((a) => a.key);
    const launcherApps = visibleRailApps({ config: railConfig, tiers, activeModules, includeFolded: true, apps: APP_ACCESS }).map((a) => a.key);
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
        hasReports: cf.teams.hasReports,
        tiers,
        // The SOP and Policy compliance ledgers' own rule (personScope, the
        // one their layouts 404 on), so the Docs sidebar rows never lead to
        // a page the person cannot open.
        complianceReader: await personScope(session)
          .then((s) => s.canView)
          .catch(() => false),
        peopleTeam,
        // Who creates a Space: the answer POST /api/spaces gives (every New
        // Space control reads this, never a tier of its own).
        canCreateSpace: orgRoleOf({ accessLevel }) !== "GUEST" && !isAgentOf(accessLevel) && (await mayCreateSpace(accessLevel)),
        ...(await settingsReaderFor(accessLevel, session)),
        ...(await settingsLockedFor(accessLevel, session)),
        candorInvited: cf.teams.candorInvited || (orgRoleOf({ accessLevel }) !== "GUEST" && legacyIsManagerLevel(accessLevel)),
        surveyTargeted: cf.teams.surveyTargeted || (orgRoleOf({ accessLevel }) !== "GUEST" && legacyIsManagerLevel(accessLevel)),
        name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || "",
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        email: user.email ?? null,
        avatar: user.avatar ?? null,
        // An expired status (presenceUntil in the past) reads as none.
        ...(presence?.presenceStatus && (!presence.presenceUntil || presence.presenceUntil.getTime() > Date.now())
          ? { presenceStatus: presence.presenceStatus, presenceUntil: presence.presenceUntil?.toISOString() ?? null }
          : { presenceStatus: null, presenceUntil: null }),
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
        trashDays: retentionDays((settings as { retention?: { trashDays?: unknown } }).retention?.trashDays),
        aiEnabled: aiEnabledFromSettings(settings),
        currency: orgCurrencyFromSettings(settings),
        taskPublicLinks: orgPublicLinksTurnedOn(settings),
        objectShare: accessV2Tables(),
      },
      counts: cf.counts,
      timer,
      session: {
        idleUntil: idle,
        hold: securityHoldFor({
          settings,
          orgRole: orgRoleOf({ accessLevel }),
          mfaEnabled: !!security?.mfaEnabled,
          passwordChangedAt: security?.passwordChangedAt ?? null,
        }),
        passwordMaxAgeDays: passwordMaxAgeDaysOf(settings),
      },
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

/**
 * Who reads Workspace settings below Admin, by the gate that decides the
 * door: today's table (the manager tier) until ACCESS_V2_RESOLVER is on and
 * the log-only week is over, then the engine's People-team pages
 * (SETTINGS_PAGE_GATES peopleTeamRead), so the frame never lists a page the
 * gate refuses.
 */
/** The Owner pages this Admin cannot open (the lock glyph); the same rule sessionMayManageOwnerPage applies. */
async function settingsLockedFor(accessLevel: string | null, session: unknown): Promise<{ settingsLockedPages?: SettingsPageKey[]; ownerActionsLocked?: boolean }> {
  if (!legacyIsAdminLevel(accessLevel) || !ownerSplitOn()) return {};
  const pages: SettingsPageKey[] = ["security", "api", "billing"];
  const locked: SettingsPageKey[] = [];
  for (const p of pages) {
    if (!(await sessionMayManageOwnerPage(session, scopeForOwnerPage(p)))) locked.push(p);
  }
  const ownerActionsLocked = !(await sessionMayManageOwnerPage(session));
  return { ...(locked.length ? { settingsLockedPages: locked } : {}), ...(ownerActionsLocked ? { ownerActionsLocked } : {}) };
}

async function settingsReaderFor(accessLevel: string | null, session: unknown): Promise<{ settingsReader: boolean; settingsReaderPages?: SettingsPageKey[] }> {
  if (legacyIsAdminLevel(accessLevel)) return { settingsReader: false };
  if (!delegateOn("settings")) return { settingsReader: legacyIsManagerLevel(accessLevel) };
  // The same door decision the page gate and the reader APIs ask
  // (src/lib/access/settings-door.ts), page by page.
  const pages = await settingsReaderPagesFor(session);
  return { settingsReader: pages.length > 0, settingsReaderPages: pages };
}

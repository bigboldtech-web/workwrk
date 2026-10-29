// The goal page (spec-goals section 2 /okrs/[id]). Server rendered.
//
//   Title row   BackButton to the view this goal belongs to for the viewer
//               (Company goals for a company goal, Team goals when the viewer
//               manages the owner and neither owns nor contributes, else My
//               goals), the title, and "..." (Edit, Assign owner, Copy link,
//               Mark complete, Delete) for editors, or Copy link alone
//   Banner      a Can view viewer gets "View only. Ask {owner} for edit
//               access." with Request, and no write control anywhere below
//   Column 720  Summary (ring, title, description, the ONE verdict with its
//               pace line and next step) · Details (Owner, Contributors,
//               Level, Part of, Dates with the derived quarter, Check-ins) ·
//               Targets · Effort · Linked work · Supports this goal (only the
//               children the viewer can see) · Activity (paged)
//
// A REPEATING GOAL (docs/plans/recurring-goals.md E2): the Summary card's top
// line is the period control (‹ October 2026 ›, ?period=<key>) and what is
// left of the period; the ring, the On track? block, Targets and Activity
// show that period. The Dates row reads Repeats ("Every month, since October
// 2026"); Check-ins reads "Remind the owner to check in" and hides when every
// target is measured automatically. Past periods follows Targets once a
// period has closed. A one-time goal reads exactly as before, plus, while the
// RECURRING_GOALS switch is on, the Dates row's "Make this a monthly goal"
// (A5) and the target editor's doors (E3).
//
// Roles on a goal: whoever mayEditGoal allows (src/lib/goals/goal-rights.ts:
// the owner, Owner/Admin, the People team, and below Company level the
// creator and the owner's manager chain) edit everything; Contributors (GoalAssignee, resolved at
// read time) check in; everyone else who can see it (canSeeGoal: company
// goals, their department's, a manager's tree) reads it.

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireGoalPage } from "@/lib/page-gates";
import { canDeleteGoal, canEditGoal as canEditGoalFor } from "@/lib/alignment-scope";
import { listGoalAssigneeEntries, resolveGoalMembersBatch, canSeeGoal } from "@/lib/goal-audience";
import { computeGoalRollups, enrichKeyResults, goalRollupFor, KR_KPI_SELECT } from "@/lib/alignment";
import { goalsWithLinkedWork } from "@/lib/goal-effort";
import { goalQuarterLabel } from "@/lib/fiscal-quarter";
import { formatRelative } from "@/lib/format/date";
import { legacyIsManagerLevel } from "@/lib/access/legacy-levels";
import { getTeamUserIds } from "@/lib/team";
import { isGoalContributor } from "@/lib/goals/goal-contributor";
import { currentPeriodPayload, settleOnRead } from "@/lib/goals/goal-periods.server";
import { goalVerdicts } from "@/lib/goals/goal-verdicts.server";
import { closedPeriodsPage, goalPeriodsSummary, periodVerdict, periodView } from "@/lib/goals/goal-period-view.server";
import { recurringGoalsOn } from "@/lib/goals/recurring-flag";
import { describeTargetSources } from "@/lib/goals/goal-source.server";
import { isMeasuredAutomatically } from "@/lib/goals/goal-measure";
import { isGoalCadence, kpiMonths, periodSettingsOf, type GoalCadence } from "@/lib/goals/goal-period";
import { goalPageDoors, leftWords, periodTargetsLine, repeatsRowText, shortDay } from "@/lib/goals/goal-form";
import { pausedFromDay, pauseWordsFor } from "@/lib/goals/goal-source";
import { Avatar } from "@/components/ui/avatar-stack";
import { OkrLinkedWork } from "./okr-linked-work";
import { GoalDetailMenu, GoalEditLink } from "./goal-detail-menu";
import { CopyLinkButton, GoalChildUnlink, GoalDates, GoalReadOnlyStrip, GoalShareDoor, GoalSummaryAssessment, GoalWorkCards } from "./goal-page-bits";
import { GoalPeriodControl, PastPeriods } from "./goal-period-bits";
import { accessV2Tables } from "@/lib/access/flags";
import type { TargetRowData } from "./goal-targets";
import { OkrAudience } from "@/components/okrs/okr-audience";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import type { EditableGoal } from "@/components/okrs/create-goal-modal";

export const dynamic = "force-dynamic";

const LEVEL_WORD: Record<string, string> = { COMPANY: "Company", DEPARTMENT: "Department", INDIVIDUAL: "Individual" };
const PERIOD_WORD: Record<GoalCadence, string> = { WEEKLY: "This week", MONTHLY: "This month", QUARTERLY: "This quarter", YEARLY: "This year" };

export default async function OkrDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const askedPeriod = typeof sp.period === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.period) ? sp.period : null;
  // notFound() unless canSeeGoal: a goal is never discoverable, so a
  // guessed URL to someone else's goal is the in-shell 404.
  const viewer = await requireGoalPage(id);
  const orgId = viewer.organizationId;

  const okr = await prisma.oKR.findFirst({
    where: { id, organizationId: orgId },
    include: {
      keyResults: {
        orderBy: { createdAt: "asc" },
        include: {
          checkIns: { orderBy: { createdAt: "desc" }, take: 1 },
          kpi: { select: KR_KPI_SELECT },
        },
      },
      children: { select: { id: true, title: true, progress: true, level: true, status: true, ownerId: true, departmentId: true } },
    },
  });
  if (!okr) notFound();
  // A repeating goal opens any period it is missing first (docs/plans/recurring-goals.md B3).
  if (okr.repeat) await settleOnRead(orgId, [okr.id], "the goal page");

  const sessionLike = { user: { id: viewer.id, organizationId: viewer.organizationId, accessLevel: viewer.accessLevel } };
  const [keyResults, rollupCtx, linked, parent, owner, audienceEntries, membersByOkr, org, canDelete, canEditGoal, contributor] = await Promise.all([
    enrichKeyResults(okr.keyResults, { userId: okr.ownerId }),
    computeGoalRollups(orgId),
    goalsWithLinkedWork(orgId, [okr.id]),
    okr.parentId
      ? prisma.oKR.findFirst({ where: { id: okr.parentId, organizationId: orgId }, select: { id: true, title: true, level: true, ownerId: true, departmentId: true } })
      : Promise.resolve(null),
    okr.ownerId
      ? prisma.user.findUnique({ where: { id: okr.ownerId }, select: { id: true, firstName: true, lastName: true, avatar: true, email: true } })
      : Promise.resolve(null),
    listGoalAssigneeEntries(okr.id),
    resolveGoalMembersBatch(orgId, [{ id: okr.id, ownerId: okr.ownerId }]),
    prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } }),
    canDeleteGoal(sessionLike, okr),
    canEditGoalFor(sessionLike, okr),
    isGoalContributor(sessionLike, okr.id),
  ]);
  const rollup = goalRollupFor(rollupCtx, okr);
  // The ONE verdict, read as the list, the profile and assess read it
  // (goalVerdicts: a repeating goal paced over its period from trackedFrom).
  let verdict = (await goalVerdicts(rollupCtx, [okr], linked)).verdicts.get(okr.id)!.verdict;
  const audienceMembers = membersByOkr.get(okr.id) ?? [];
  const fiscalStart = (org?.settings as { fiscalYearStart?: unknown } | null)?.fiscalYearStart;
  const quarter = goalQuarterLabel(okr.endDate, fiscalStart);

  // Repeating goals (E2): the period on screen (?period=, else the one
  // running now), the control's choices, and the closed periods. A stale
  // ?period= falls back to the period running now.
  const recurringOn = recurringGoalsOn();
  const now = new Date();
  const periodSettings = rollupCtx.periodSettings ?? (recurringOn || okr.repeat ? periodSettingsOf(org?.settings) : null);
  const summary = okr.repeat && periodSettings ? await goalPeriodsSummary(okr, periodSettings, now) : null;
  const shown = summary && periodSettings
    ? (await periodView(rollupCtx, okr.id, askedPeriod, periodSettings, now)) ?? (askedPeriod ? await periodView(rollupCtx, okr.id, null, periodSettings, now) : null)
    : null;
  const past = summary && periodSettings && summary.closedCount > 0 ? await closedPeriodsPage(okr.id, periodSettings, 1, now) : null;
  // A period that has ended but still takes numbers is assessed over its own window.
  if (shown && shown.state !== "open" && shown.state !== "closed") verdict = (await periodVerdict(okr, shown, linked.has(okr.id), now)).verdict;
  const ringValue = shown ? shown.progress ?? 0 : rollup.progress;
  const measured = shown ? shown.progress != null : rollup.source !== "NONE";
  const currentPayload = okr.repeat && rollupCtx.periodSettings ? currentPeriodPayload(rollupCtx.periods.get(okr.id) ?? [], rollupCtx.periodSettings, now) : null;
  const recurring = { on: recurringOn, settings: periodSettings };

  // Part of shows only when the viewer can see the parent (never a leaked
  // title); Supports this goal lists only the children they can see.
  const parentVisible = parent && (await canSeeGoal(sessionLike, parent)) ? parent : null;
  const openable = await Promise.all(okr.children.map(async (c) => ({ c, open: await canSeeGoal(sessionLike, c) })));
  // This goal's editors see every goal under it (those goals move its number,
  // and are theirs to unlink); a goal they cannot open reads as plain text.
  // Everyone else sees the ones they may open, and a count of the rest.
  const children = openable.filter((x) => x.open || canEditGoal).map((x) => ({ ...x.c, open: x.open }));
  const hiddenChildren = okr.children.length - children.length;

  const isOwner = okr.ownerId === viewer.id;
  const canCheckIn = canEditGoal || contributor;
  const viewOnly = !canCheckIn;
  const mayAssign = legacyIsManagerLevel(viewer.accessLevel) && canEditGoal;

  // Back target (spec-goals section 1 back rule).
  let back = { fallbackHref: "/okrs", label: "My goals" };
  if (okr.level === "COMPANY") back = { fallbackHref: "/okrs?view=company", label: "Company goals" };
  else if (!isOwner && !contributor && okr.ownerId && (await getTeamUserIds(orgId, viewer.id)).includes(okr.ownerId)) {
    back = { fallbackHref: "/okrs?view=team", label: "Team goals" };
  }

  // The Work sidebar's active row (spec-goals section 1): My goals when the
  // viewer owns or contributes, else Company goals for a COMPANY goal, else
  // Team goals. The sidebar reads it from the Goals crumb's href, the one
  // declaration a page makes to the shell.
  const sidebarView = isOwner || contributor ? "/okrs" : okr.level === "COMPANY" ? "/okrs?view=company" : "/okrs?view=team";

  const editable: EditableGoal = {
    id: okr.id,
    title: okr.title,
    description: okr.description,
    level: okr.level,
    ownerId: okr.ownerId,
    owner: owner ? { id: owner.id, firstName: owner.firstName, lastName: owner.lastName, avatar: owner.avatar, email: owner.email } : null,
    quarter: okr.quarter,
    startDate: okr.startDate?.toISOString() ?? null,
    endDate: okr.endDate?.toISOString() ?? null,
    checkInCadence: okr.checkInCadence,
    parentId: okr.parentId,
    repeat: okr.repeat,
    repeatUntil: okr.repeatUntil,
    completedAt: okr.completedAt?.toISOString() ?? null,
  };

  // Targets counted from a List, as this viewer may see them (C9): the
  // number for everyone, the name and the link only for who can open it.
  // Read from the stored rows: an enriched target never carries its source.
  // Only an editor reads why a source paused and who connected a private one.
  const sources = await describeTargetSources(orgId, viewer.id, okr.keyResults, { canEdit: canEditGoal });
  const zone = periodSettings?.timezone ?? "UTC";
  const sourceFacts = (krId: string | null, row?: { pausedSince: string | null; pausedReason: string | null }) => {
    const v = krId ? sources.get(krId) : undefined;
    if (!v) return {};
    const paused = row ? pauseWordsFor(row.pausedReason, canEditGoal) : v.paused;
    // "Paused from 14 Oct" is the workspace's day, not the UTC one (C10).
    return { source: { ...v, paused, pausedSince: row?.pausedSince ?? null, pausedFrom: row?.pausedSince ? pausedFromDay(row.pausedSince, zone) : null } };
  };
  const editorFacts = (kr: (typeof keyResults)[number]) => ({
    kpiId: kr.kpiId ?? null,
    periodStart: kr.periodStart ?? null,
    kpiCombine: kr.kpiId && (okr.repeat === "QUARTERLY" || okr.repeat === "YEARLY") ? kr.kpiCombine ?? "LATEST" : null,
  });
  let targetRows: TargetRowData[] = keyResults.map((kr) => ({
    id: kr.id,
    title: kr.title,
    unit: kr.unit,
    startValue: kr.startValue,
    targetValue: kr.targetValue,
    currentValue: kr.currentValue,
    progress: kr.progress,
    isDerived: Boolean(kr.isDerived) || isMeasuredAutomatically(kr),
    kpiName: kr.kpi?.name ?? null,
    lastCheckIn: kr.checkIns[0] ? formatRelative(kr.checkIns[0].createdAt) : null,
    ...editorFacts(kr),
    ...sourceFacts(kr.id),
  }));
  if (shown) {
    // The period's own rows: its numbers, its carried targets, and the
    // targets deleted since that a closed period keeps (B5). The last
    // check-in is the newest one INTO this period.
    const lastIn = new Map((await prisma.kRCheckIn.groupBy({ by: ["keyResultId"], where: { periodId: shown.id }, _max: { createdAt: true } }))
      .map((r) => [r.keyResultId, r._max.createdAt]));
    const krById = new Map(keyResults.map((k) => [k.id, k]));
    targetRows = shown.targets.map((t) => {
      const kr = t.keyResultId ? krById.get(t.keyResultId) : undefined;
      const last = t.keyResultId ? lastIn.get(t.keyResultId) ?? null : null;
      return {
        id: t.keyResultId ?? t.rowId,
        title: t.title,
        unit: t.unit,
        startValue: t.startValue,
        targetValue: t.targetValue,
        currentValue: t.currentValue,
        progress: t.progress,
        isDerived: t.kpiLinked || (kr ? isMeasuredAutomatically(kr) : false),
        kpiName: kr?.kpi?.name ?? null,
        lastCheckIn: last ? formatRelative(last) : null,
        carriedFrom: t.carried ? shown.previousLabel?.replace(/ \d{4}$/, "") ?? null : null,
        deleted: !t.keyResultId,
        ...(kr ? editorFacts(kr) : {}),
        ...sourceFacts(t.keyResultId, t),
      };
    });
  }
  // Every door the switch closes, decided in one place (goal-form.ts goalPageDoors).
  const doors = goalPageDoors({
    recurringOn,
    canEdit: canEditGoal,
    repeat: okr.repeat,
    checkInCadence: okr.checkInCadence,
    allAutomatic: keyResults.length > 0 && keyResults.every((k) => isMeasuredAutomatically(k)),
    startDate: editable.startDate ?? null,
    endDate: editable.endDate ?? null,
    completedAt: editable.completedAt ?? null,
  });
  const cadence = isGoalCadence(okr.repeat) ? okr.repeat : null;
  // The target editor's doors (E3), only while the switch is on.
  const editor = doors.targetEditor
    ? {
        okrId: okr.id,
        repeat: cadence,
        ownerId: okr.ownerId,
        periodWord: cadence ? PERIOD_WORD[cadence] : null,
        kpiMonths: shown && periodSettings ? kpiMonths({ cadence: shown.cadence, startsAt: new Date(shown.startsAt), endsAt: new Date(shown.endsAt) }, periodSettings) : [],
      }
    : null;
  const fmtDay = (k: string) => shortDay(k);
  const targetsPeriod = shown
    ? { key: shown.key, label: shown.label, current: shown.current, state: shown.state, takesCheckIns: shown.takesCheckIns, line: periodTargetsLine(shown, fmtDay) }
    : null;
  const topLine = shown ? (shown.current && shown.state === "open" ? leftWords(shown.daysLeft) : shown.datesLabel) : null;

  const ownerName = owner ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || owner.email : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-raised">
      {/* bg-raised is the white canvas the list pages use; bg-surface is the
          legacy warm grey (#F7F7F6) and made this page float on grey. */}
      <Breadcrumb items={[{ label: "Goals", href: sidebarView }, { label: okr.title }]} />
      <OsPageHeader
        title={okr.title}
        back={back}
        actions={<>
          {/* The one share dialog, while it serves goals (ACCESS_V2_TABLES on, batch 7). */}
          {accessV2Tables() ? <GoalShareDoor okrId={okr.id} title={okr.title} canShare={canEditGoal && viewer.accessLevel !== "AGENT"} canEdit={canEditGoal} canCheckIn={canCheckIn} /> : null}
          {canEditGoal ? (
            <GoalDetailMenu goal={editable} canDelete={canDelete} canEdit={canEditGoal} canAssignOwner={mayAssign}
              completed={okr.completedAt != null} afterDelete={back.fallbackHref} recurring={recurring}
              repeating={okr.repeat ? { repeat: okr.repeat, repeatUntil: okr.repeatUntil, completedAt: editable.completedAt, period: currentPayload, closedPeriods: summary?.closedCount ?? 0 } : null} />
          ) : <CopyLinkButton okrId={okr.id} />}
        </>}
      />
      {viewOnly ? <GoalReadOnlyStrip okrId={okr.id} ownerFirstName={owner?.firstName ?? null} /> : null}

      <div className="os-chrome mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-6 md:px-6">
        {/* 1. Summary */}
        <section data-goal-hero className="rounded-lg border border-line bg-raised p-6" aria-label="Summary">
          {summary && shown ? (
            <GoalPeriodControl okrId={okr.id} choices={summary.choices} value={shown.key} currentKey={summary.currentKey} aside={topLine} />
          ) : null}
          <div className="flex gap-5">
            <GoalRing value={ringValue} measured={measured} />
            <div className="min-w-0 flex-1">
              <h1 className="m-0 text-xl font-semibold text-ink">{okr.title}</h1>
              {okr.description ? (
                <p className="m-0 mt-1 whitespace-pre-wrap text-base text-ink-2">{okr.description}</p>
              ) : canEditGoal ? (
                <p className="m-0 mt-1"><GoalEditLink goal={editable} label="Add a description" /></p>
              ) : null}
            </div>
          </div>
          <GoalSummaryAssessment okrId={okr.id} verdict={verdict} cadence={okr.checkInCadence} canCheckIn={canCheckIn} canEdit={canEditGoal}
            periodKey={shown && (!shown.current || shown.state !== "open") ? shown.key : null}
            closed={shown && shown.state === "closed" && shown.result ? { periodLabel: shown.label, result: shown.result, resultLabel: shown.resultLabel ?? "", attainment: shown.attainment } : null}
            goal={okr.repeat ? { repeat: okr.repeat, completedAt: editable.completedAt } : null} />
        </section>

        {/* 2. Details */}
        <dl className="m-0 flex flex-col" aria-label="Details">
          <DetailRow label="Owner">
            {owner ? <span className="flex min-w-0 items-center gap-2"><Avatar person={owner} size={24} /><span className="truncate">{ownerName}</span></span> : <span className="text-ink-2">No owner</span>}
            {mayAssign ? <span className="ms-2"><GoalEditLink goal={editable} label={owner ? "Change" : "Assign"} /></span> : null}
          </DetailRow>
          <DetailRow label="Contributors">
            <OkrAudience okrId={okr.id} canEdit={canEditGoal} initialEntries={audienceEntries} initialMembers={audienceMembers.slice(0, 5)} initialTotal={audienceMembers.length} />
          </DetailRow>
          <DetailRow label="Level"><span>{LEVEL_WORD[okr.level] ?? okr.level}</span></DetailRow>
          <DetailRow label="Part of">
            {parentVisible ? (
              <Link href={`/okrs/${parentVisible.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                <span className="truncate">{parentVisible.title}</span>
                <span className="shrink-0 text-xs text-ink-2">{LEVEL_WORD[parentVisible.level]}</span>
              </Link>
            ) : canEditGoal && !okr.parentId ? <GoalEditLink goal={editable} label="Add" focusParent /> : <span className="text-ink-2">{okr.parentId ? "A goal you can't see" : "None"}</span>}
          </DetailRow>
          {cadence && summary ? (
            <DetailRow label="Repeats">
              <span>{repeatsRowText(cadence, summary.startLabel, summary.untilLabel, summary.started)}{okr.completedAt ? " · ended" : ""}</span>
            </DetailRow>
          ) : (
            <DetailRow label="Dates">
              <GoalDates startDate={editable.startDate} endDate={editable.endDate} quarter={quarter} completed={verdict === "completed"} />
              {doors.migrationOffer ? (
                <span className="ms-2"><GoalEditLink goal={editable} label="Make this a monthly goal" initialRepeat="MONTHLY" recurring={recurring} /></span>
              ) : null}
            </DetailRow>
          )}
          {doors.remindHidden ? null : (
            <DetailRow label={doors.remindLabel}><span>{doors.remindWord}</span></DetailRow>
          )}
        </dl>

        {/* 3 to 7 */}
        <GoalWorkCards
          okrId={okr.id}
          canEdit={canEditGoal}
          canCheckIn={canCheckIn}
          targets={targetRows}
          period={targetsPeriod}
          editor={editor}
          past={past && summary ? <PastPeriods okrId={okr.id} initial={{ rows: past.rows, total: past.total }} selectedKey={shown?.key ?? null} currentKey={summary.currentKey} /> : null}
          linked={<OkrLinkedWork okrId={okr.id} canEdit={canEditGoal} />}
        >
          {children.length > 0 || hiddenChildren > 0 ? (
            <section className="rounded-lg border border-line bg-raised p-6" aria-labelledby="goal-children-h">
              <h2 id="goal-children-h" className="m-0 flex items-baseline gap-2 text-base font-semibold text-ink">
                Supports this goal <span className="text-xs font-medium text-ink-2">{children.length + hiddenChildren}</span>
              </h2>
              <ul className="m-0 mt-2 flex list-none flex-col p-0">
                {children.map((c) => {
                  const roll = goalRollupFor(rollupCtx, c);
                  const cm = roll.source !== "NONE";
                  return (
                    <li key={c.id} className="flex items-center gap-1 border-b border-line last:border-b-0">
                      <ChildRow open={c.open} href={`/okrs/${c.id}`}>
                        <span className="min-w-0 flex-1 truncate text-row text-ink" title={c.open ? undefined : "A goal you can't open. It counts toward this one."}>{c.title}</span>
                        <span className="shrink-0 text-xs text-ink-2">{LEVEL_WORD[c.level]}</span>
                        <span className="h-1 w-[72px] shrink-0 overflow-hidden rounded-full bg-active" aria-hidden>
                          {cm ? <span className="block h-full rounded-full bg-brand" style={{ width: `${roll.progress}%` }} /> : null}
                        </span>
                        <span className="w-20 shrink-0 text-end text-sm tabular-nums text-ink-2">{cm ? `${roll.progress}%` : "Not measured"}</span>
                      </ChildRow>
                      {canEditGoal ? <GoalChildUnlink childId={c.id} childTitle={c.title} /> : null}
                    </li>
                  );
                })}
              </ul>
              {hiddenChildren > 0 ? (
                <p className="m-0 mt-2 text-sm text-ink-2">{hiddenChildren === 1 ? "1 more goal you can't open also counts toward this one." : `${hiddenChildren} more goals you can't open also count toward this one.`}</p>
              ) : null}
            </section>
          ) : null}
        </GoalWorkCards>
      </div>
    </div>
  );
}

/** A row of "Supports this goal": a link when the viewer can open that goal. */
function ChildRow({ open, href, children }: { open: boolean; href: string; children: React.ReactNode }) {
  const cls = "os-row flex h-9 min-w-0 flex-1 items-center gap-3";
  return open ? <Link href={href} className={`${cls} hover:bg-hover`}>{children}</Link> : <div className={cls}>{children}</div>;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-3 py-1">
      <dt className="w-[120px] shrink-0 text-sm font-medium text-ink-2">{label}</dt>
      <dd className="m-0 flex min-w-0 flex-1 items-center text-row text-ink">{children}</dd>
    </div>
  );
}

/** The goal ring (design-system): 96px, stroke 6, brand on surface-2. */
function GoalRing({ value, measured }: { value: number; measured: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  const size = 96;
  const r = 44;
  const C = 2 * Math.PI * r;
  return (
    <div className="relative h-24 w-24 shrink-0" role="img" aria-label={measured ? `${pct}% complete` : "Not measured"}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={48} cy={48} r={r} fill="none" stroke="var(--os-surface-2)" strokeWidth="6" />
        {measured ? (
          <circle cx={48} cy={48} r={r} fill="none" stroke="var(--os-brand)" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} transform="rotate(-90 48 48)" />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-center">
        {measured ? <span className="text-xl font-semibold tabular-nums text-ink">{pct}%</span> : <span className="px-3 text-sm leading-tight text-ink-2">Not measured</span>}
      </span>
    </div>
  );
}

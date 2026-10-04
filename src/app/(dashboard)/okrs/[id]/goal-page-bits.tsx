"use client";

// Small client pieces of the goal page (spec-goals /okrs/[id]):
//   GoalReadOnlyStrip  the mandatory read-only banner for a Can view viewer,
//                      "View only. Ask {owner} for edit access." with Request
//                      (POST /api/access-requests at Can edit; the Inbox row
//                      goes to the owner, then the admins). After sending it
//                      reads "You asked {owner} for edit access.", and on a
//                      reload it reads the person's own latest request on
//                      this goal (GET /api/access-requests?scope=outgoing,
//                      as RequestAccessButton does): pending says when they
//                      asked and offers no second Request, declined says so
//                      and offers Request again.
//   CopyLinkButton     the title-row Copy link when "..." would hold nothing
//                      else.
//   GoalShareDoor      the title row's Share (batch 7, while the one share
//                      dialog serves goals): Share for whoever may edit the
//                      goal, the role chip ("Can check in", "Can view") for
//                      everyone else, read only.
//   GoalBody           the column the islands share, so "Check in" on the
//                      stale line and "View history" on a target can reach
//                      the Targets and Activity cards.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Link2, Unlink } from "lucide-react";
import { useConfirm } from "@/components/ui/dialog-provider";
import { ReadOnlyBanner } from "@/components/access/read-only-banner";
import { ShareDialog } from "@/components/access/share-dialog";
import { ShareOrRoleChip } from "@/components/access/share-or-role-chip";
import { shareRoleLabel } from "@/lib/access/access-panel";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { GoalTargets, type TargetRowData } from "./goal-targets";
import { GoalEffort } from "./goal-effort";
import { GoalActivity } from "./goal-activity";
import { GoalAssessment, markGoalServerRender, useGoalServerRender } from "./goal-assessment";
import type { GoalVerdict } from "@/lib/goal-verdict";
import { useFormat } from "@/lib/format/use-date-prefs";

/**
 * The Details strip's Dates line. A goal's dates are calendar days (stored
 * as UTC midnight), so they render through the wall-clock formatter in the
 * viewer's own date order, the same as the /okrs Due column: never shifted
 * a day by a timezone, and overdue only once the due day has ended for the
 * viewer.
 */
export function GoalDates({ startDate, endDate, quarter, completed }: { startDate?: string | null; endDate?: string | null; quarter: string | null; completed: boolean }) {
  const fmt = useFormat();
  const startKey = startDate ? startDate.slice(0, 10) : null;
  const endKey = endDate ? endDate.slice(0, 10) : null;
  const start = startKey ? fmt.wallDate(startKey) : null;
  const end = endKey ? fmt.wallDate(endKey) : null;
  const overdue = !completed && endKey != null && fmt.today() > endKey;
  return (
    <span className={overdue ? "text-danger-text" : ""} suppressHydrationWarning>
      {!start && !end ? "No dates" : `${start ?? "No start"} to ${end ?? "no due date"}`}{quarter ? ` · ${quarter}` : ""}{overdue ? " · overdue" : ""}
    </span>
  );
}

/** One row of GET /api/access-requests?scope=outgoing (newest first). */
export type OutgoingRequestRow = { objectType: string; objectId: string; status: string; createdAt: string; decidedAt: string | null };

/** Where the viewer's own ask for edit access on this goal stands. */
export type GoalRequestStanding =
  | { kind: "pending"; since: string }
  | { kind: "declined"; on: string | null }
  | null;

/**
 * The viewer's latest request on this goal decides the strip. The list is
 * newest first, so the first goal row for this id is the one that counts:
 * an old decline followed by a fresh ask is pending, not declined. Approved,
 * cancelled and expired rows leave the plain Request (an approval that was
 * later taken back must still let the person ask again).
 */
export function goalRequestStanding(outgoing: readonly OutgoingRequestRow[] | null | undefined, okrId: string): GoalRequestStanding {
  const mine = (outgoing ?? []).find((o) => o.objectType === "goal" && o.objectId === okrId);
  if (!mine) return null;
  if (mine.status === "PENDING") return { kind: "pending", since: mine.createdAt };
  if (mine.status === "DENIED") return { kind: "declined", on: mine.decidedAt };
  return null;
}

async function loadGoalRequestStanding(okrId: string): Promise<GoalRequestStanding | undefined> {
  const r = await apiFetch<{ outgoing?: OutgoingRequestRow[] }>(`/api/access-requests?scope=outgoing&objectType=goal&objectId=${encodeURIComponent(okrId)}`, { cache: "no-store" });
  return r.ok ? goalRequestStanding(r.data.outgoing, okrId) : undefined;
}

export function GoalReadOnlyStrip({ okrId, ownerFirstName }: { okrId: string; ownerFirstName: string | null }) {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  // What the server knows about this person's ask, read on mount. Kept apart
  // from `state` so a slow read never overwrites a Request pressed meanwhile.
  const [standing, setStanding] = useState<GoalRequestStanding>(null);
  const { toast } = useOsToast();
  const fmt = useFormat();
  useEffect(() => {
    let alive = true;
    void loadGoalRequestStanding(okrId).then((s) => { if (alive && s !== undefined) setStanding(s); });
    return () => { alive = false; };
  }, [okrId]);
  const request = async () => {
    if (state !== "idle") return;
    setState("busy");
    const r = await apiFetch<{ ok?: boolean; throttled?: boolean }>("/api/access-requests", { method: "POST", json: { objectType: "goal", objectId: okrId, role: "EDIT" } });
    if (!r.ok) { setState("idle"); toast(r.error || "Couldn't send the request", { tone: "danger" }); return; }
    if (r.data?.throttled) {
      // Throttled: this person already asked within 24 hours, so nobody was
      // told again. Say the ask is pending, with its real date, rather than a
      // fresh "sent" that suggests the owner just heard about it.
      const s = await loadGoalRequestStanding(okrId);
      setStanding(s?.kind === "pending" ? s : { kind: "pending", since: new Date().toISOString() });
      setState("idle");
      return;
    }
    setState("sent");
  };
  const who = ownerFirstName?.trim() || null;
  let message: string | undefined;
  let canRequest = state !== "sent";
  // A goal with no owner sends the ask to the admins, so these name nobody.
  if (state === "sent") {
    message = `View only. You asked ${who ? `${who} ` : ""}for edit access.`;
  } else if (standing?.kind === "pending") {
    message = `View only. You asked ${who ? `${who} ` : ""}for edit access on ${fmt.date(standing.since, "date")}.`;
    canRequest = false;
  } else if (standing?.kind === "declined") {
    message = `View only. Your request for edit access was declined${standing.on ? ` on ${fmt.date(standing.on, "date")}` : ""}. You can ask again.`;
  }
  return (
    <ReadOnlyBanner
      ownerName={ownerFirstName}
      message={message}
      onRequest={canRequest ? () => void request() : undefined}
      requestLabel={state === "busy" ? "Sending" : "Request"}
    />
  );
}

export function CopyLinkButton({ okrId }: { okrId: string }) {
  const { toast } = useOsToast();
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(`${window.location.origin}/okrs/${okrId}`); toast("Link copied"); }
        catch { toast("Couldn't copy the link", { tone: "danger" }); }
      }}
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink"
    >
      <Link2 className="h-4 w-4" aria-hidden /> Copy link
    </button>
  );
}

/**
 * The one share dialog on this goal: who contributes (Can check in), the
 * owner and the goal's rules. A change refreshes the page, so the Contributors
 * row and the check-in controls follow it.
 */
export function GoalShareDoor({ okrId, title, canShare, canCheckIn }: { okrId: string; title: string; canShare: boolean; canCheckIn: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"share" | "who" | null>(null);
  return (
    <>
      <ShareOrRoleChip
        role={canShare ? "FULL" : canCheckIn ? "EDIT" : "VIEW"}
        label={!canShare && canCheckIn ? shareRoleLabel("goal", "EDIT") : undefined}
        onOpen={setMode}
      />
      <ShareDialog
        open={mode !== null}
        onOpenChange={(o) => { if (!o) setMode(null); }}
        target={{ kind: "goal", id: okrId, name: title }}
        readOnly={mode === "who"}
        onChanged={() => router.refresh()}
      />
    </>
  );
}

/**
 * Unlink on a row of "Supports this goal": this goal's editors take a goal
 * out from under it even when they cannot edit that goal (PATCH /api/okrs
 * allows a bare { parentId: null } through mayUnlinkFromGoal). The goal
 * itself stays; only this goal's progress stops counting it.
 */
export function GoalChildUnlink({ childId, childTitle }: { childId: string; childTitle: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const { toast } = useOsToast();
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    setBusy(true);
    const r = await apiFetch("/api/okrs", { method: "PATCH", json: { id: childId, parentId: null } });
    setBusy(false);
    if (!r.ok) {
      toast(r.error || "Couldn't take it out of this goal", { tone: "danger", action: { label: "Try again", onClick: () => void send() } });
      return;
    }
    toast(`Took "${childTitle}" out of this goal`);
    router.refresh();
  };
  const unlink = async () => {
    const ok = await confirm({
      title: `Take "${childTitle}" out of this goal?`,
      description: "It stays a goal of its own. This goal's progress stops counting it, and the change is recorded in the activity log under your name.",
      confirmLabel: "Take it out",
    });
    if (ok) await send();
  };
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void unlink()}
      aria-label={`Take ${childTitle} out of this goal`}
      title="Take it out of this goal"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
    >
      <Unlink className="h-4 w-4" aria-hidden />
    </button>
  );
}

/** The summary's On track? block plus the cards that need to talk to each other. */
export function GoalSummaryAssessment(props: { okrId: string; verdict: GoalVerdict; cadence: string; canCheckIn: boolean; canEdit?: boolean }) {
  // Moves on every server render of this goal (GoalWorkCards marks it), so a
  // check-in, a target added or deleted, linked work or new dates refetch
  // the words beside the ring instead of leaving the first load's.
  const render = useGoalServerRender(props.okrId);
  return (
    <GoalAssessment
      okrId={props.okrId}
      initialVerdict={props.verdict}
      refreshKey={String(render)}
      cadence={props.cadence}
      canCheckIn={props.canCheckIn}
      canEdit={props.canEdit}
      onCheckIn={() => document.getElementById("goal-targets-h")?.scrollIntoView({ behavior: "smooth", block: "center" })}
    />
  );
}

export function GoalWorkCards({ okrId, canEdit, canCheckIn, targets, linked, children }: {
  okrId: string;
  canEdit: boolean;
  canCheckIn: boolean;
  targets: TargetRowData[];
  /** The server-rendered Linked work card. */
  linked: ReactNode;
  /** Supports this goal (server rendered), placed before Activity. */
  children?: ReactNode;
}) {
  const activityRef = useRef<HTMLElement>(null);
  const refreshKey = targets.map((t) => `${t.id}:${t.currentValue}`).join("|");
  // `targets` is a fresh array each time the server renders the page, and
  // only then, so a new one means router.refresh() delivered new numbers.
  // The first one is the page load itself (the Summary already fetched for
  // it), and the ref keeps a Strict Mode double effect from counting twice.
  const seenTargets = useRef(targets);
  useEffect(() => {
    if (seenTargets.current === targets) return;
    seenTargets.current = targets;
    markGoalServerRender(okrId);
  }, [okrId, targets]);
  return (
    <>
      <GoalTargets okrId={okrId} canEdit={canEdit} canCheckIn={canCheckIn} targets={targets}
        onHistory={() => activityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />
      <GoalEffort okrId={okrId} onLinkWork={canEdit ? () => document.getElementById("goal-linked-work")?.scrollIntoView({ behavior: "smooth", block: "center" }) : undefined} />
      {linked}
      {children}
      <GoalActivity ref={activityRef} okrId={okrId} refreshKey={refreshKey} />
    </>
  );
}

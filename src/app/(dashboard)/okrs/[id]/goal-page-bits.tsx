"use client";

// Small client pieces of the goal page (spec-goals /okrs/[id]):
//   GoalReadOnlyStrip  the mandatory read-only banner for a Can view viewer,
//                      "View only. Ask {owner} for edit access." with Request
//                      (POST /api/access-requests at Can edit; the Inbox row
//                      goes to the owner, then the admins). After sending it
//                      reads "Requested".
//   CopyLinkButton     the title-row Copy link when "..." would hold nothing
//                      else.
//   GoalBody           the column the islands share, so "Check in" on the
//                      stale line and "View history" on a target can reach
//                      the Targets and Activity cards.

import { useRef, useState, type ReactNode } from "react";
import { Link2 } from "lucide-react";
import { ReadOnlyBanner } from "@/components/access/read-only-banner";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { GoalTargets, type TargetRowData } from "./goal-targets";
import { GoalEffort } from "./goal-effort";
import { GoalActivity } from "./goal-activity";
import { GoalAssessment } from "./goal-assessment";
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

export function GoalReadOnlyStrip({ okrId, ownerFirstName }: { okrId: string; ownerFirstName: string | null }) {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const { toast } = useOsToast();
  const request = async () => {
    if (state !== "idle") return;
    setState("busy");
    const r = await apiFetch("/api/access-requests", { method: "POST", json: { objectType: "goal", objectId: okrId, role: "EDIT" } });
    if (!r.ok) { setState("idle"); toast(r.error || "Couldn't send the request", { tone: "danger" }); return; }
    setState("sent");
  };
  return (
    <ReadOnlyBanner
      ownerName={ownerFirstName}
      message={state === "sent" ? `View only. You asked ${ownerFirstName ?? "the owner"} for edit access.` : undefined}
      onRequest={state === "sent" ? undefined : () => void request()}
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

/** The summary's On track? block plus the cards that need to talk to each other. */
export function GoalSummaryAssessment(props: { okrId: string; verdict: GoalVerdict; cadence: string; canCheckIn: boolean }) {
  return (
    <GoalAssessment
      okrId={props.okrId}
      initialVerdict={props.verdict}
      cadence={props.cadence}
      canCheckIn={props.canCheckIn}
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

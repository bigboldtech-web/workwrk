"use client";

// The approval card (docs/plans/ai-teammates.md 5.4): what an AI teammate
// asked to do that waits for the person it works for. The server built every
// word of it from the stored input (previews.ts), and what runs is exactly
// what it shows. The chat renders one card per turn; the Inbox's approval
// pane reuses it, so it only shows and asks: `onDecide` sends the decisions
// (POST /api/agents/actions/decide) and answers how it went.
//
// One request:
//   Waiting for you chip, the title (14/500), the exact text in a quote block
//   (12 lines, then Show all), the facts, the undo, "Waits until {date}";
//   Approve (secondary), Edit (ghost, only for the one editable field), Deny
//   (ghost, danger text); "Approve and don't ask again" (or "... in #name")
//   only where the policy offers it.
// Several (one turn asked more than once):
//   "{n} things are waiting for your approval", a checkbox per request (all
//   ticked: unticking holds one back), Select all, each title opening its
//   text and facts, Edit per request, then "Approve {k}" and "Deny {k}".
// Edit: a textarea held to the field's length; Approve with changes, Cancel.
// In flight the buttons give way to "Approving…". Decided: a chip and the
// line the outcome reads as (teammate-thread.ts decidedLine), with what it
// made and Open.

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { StatusChip } from "@/components/ui/chip";
import { Dots } from "@/components/ui/dots";
import { clampText } from "@/lib/agents/clamp";
import { APPROVAL_CARD, approveCount, denyCount, thingsWaiting, waitsUntil } from "@/lib/agents/teammate-copy";
import {
  clipCardBody,
  decidedLine,
  editStartText,
  type ActionView,
  type AgentActionStatus,
  type DecideAnswer,
  type TeammateDecision,
} from "@/lib/agents/teammate-thread";
import { RUN_TONE_COLOR, type RunTone } from "@/lib/automation/run-status";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { cn } from "@/lib/utils";

const SECONDARY = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60";
const GHOST = "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60";
const DANGER_GHOST = "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-danger-text hover:bg-hover disabled:opacity-60";
const LINK = "text-sm font-medium text-brand-deep hover:underline";
const CHECKBOX = "h-[18px] w-[18px] shrink-0 rounded border-line-strong accent-[var(--os-brand)]";

/** The chip a card wears for each status. */
const CHIP: Record<AgentActionStatus, { label: string; tone: RunTone }> = {
  PENDING: { label: APPROVAL_CARD.waitingForYou, tone: "warning" },
  RUNNING: { label: APPROVAL_CARD.approving, tone: "info" },
  EXECUTED: { label: APPROVAL_CARD.approved, tone: "success" },
  FAILED: { label: APPROVAL_CARD.failed, tone: "danger" },
  DENIED: { label: APPROVAL_CARD.denied, tone: "neutral" },
  EXPIRED: { label: APPROVAL_CARD.expired, tone: "neutral" },
  CANCELLED: { label: APPROVAL_CARD.cancelled, tone: "neutral" },
};

export interface ApprovalCardProps {
  /** The card's requests, in the order the turn asked (teammate-thread.ts groupApprovals). */
  actions: readonly ActionView[];
  /** The teammate that asked: "Ask {name} again if you still want this." */
  agentName: string;
  /** The requests being decided now: "Approving…" instead of their buttons. */
  deciding: Readonly<Record<string, "approve" | "deny">>;
  onDecide: (decisions: TeammateDecision[], opts?: { always?: boolean }) => Promise<DecideAnswer>;
}

export function ApprovalCard(props: ApprovalCardProps) {
  if (props.actions.length === 0) return null;
  if (props.actions.length === 1) return <SingleCard {...props} action={props.actions[0]} />;
  return <BatchCard {...props} />;
}

/** Send decisions and say what went wrong: the request failing, or a request that could not be decided yet. */
function useDecide(onDecide: ApprovalCardProps["onDecide"]) {
  const { toast } = useOsToast();
  return async (decisions: TeammateDecision[], kind: "approve" | "deny", opts?: { always?: boolean }): Promise<boolean> => {
    const out = await onDecide(decisions, opts);
    if (!out.ok) {
      toast(out.error ?? (kind === "approve" ? APPROVAL_CARD.approveFailed : APPROVAL_CARD.denyFailed), { tone: "danger" });
      return false;
    }
    // Still waiting: its teammate is paused, or it cannot act for the person
    // now. The server says which.
    const held = out.results.find((r) => r.status === "PENDING" && r.error);
    if (held?.error) toast(held.error, { tone: "danger" });
    return true;
  };
}

function approval(id: string, edit?: string): TeammateDecision {
  return edit === undefined ? { id, decision: "approve" } : { id, decision: "approve", edit: { text: edit } };
}

/* ─────────────────────────── one request ─────────────────────────── */

function SingleCard({ action: a, agentName, deciding, onDecide }: ApprovalCardProps & { action: ActionView }) {
  const datePrefs = useDatePrefs();
  const decide = useDecide(onDecide);
  const [edit, setEdit] = useState<string | null>(null);
  const approving = a.status === "RUNNING" || deciding[a.id] === "approve";
  const denying = deciding[a.id] === "deny";
  const waiting = a.status === "PENDING" && !approving;
  const chip = approving ? CHIP.RUNNING : CHIP[a.status];
  const editable = a.preview.editable;

  async function approveWithChanges(text: string) {
    if (await decide([approval(a.id, text)], "approve")) setEdit(null);
  }

  return (
    <section data-action-id={a.id} aria-label={a.preview.title} className="rounded-lg border border-line bg-raised p-3">
      <StatusChip color={RUN_TONE_COLOR[chip.tone]} label={chip.label} />
      <h3 className="mt-2 break-words text-base font-medium text-ink">{a.preview.title}</h3>
      {waiting || approving ? <Details a={a} /> : <Outcome a={a} agentName={agentName} />}
      {waiting ? (
        <p className="mt-2 text-sm text-ink-2" title={formatDateTitle(a.expiresAt, datePrefs)}>
          {waitsUntil(formatDate(a.expiresAt, datePrefs, "datetime"))}
        </p>
      ) : null}
      {approving ? (
        <Approving />
      ) : waiting && edit !== null && editable ? (
        <EditBox
          label={editable.label}
          maxLength={editable.maxLength}
          value={edit}
          onChange={setEdit}
          onApprove={() => void approveWithChanges(edit)}
          onCancel={() => setEdit(null)}
        />
      ) : waiting ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={SECONDARY} disabled={denying} onClick={() => void decide([approval(a.id)], "approve")}>
              <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {APPROVAL_CARD.approve}
            </button>
            {editable ? (
              <button type="button" className={GHOST} disabled={denying} onClick={() => setEdit(clampText(editStartText(a), editable.maxLength))}>
                {APPROVAL_CARD.edit}
              </button>
            ) : null}
            <button type="button" className={DANGER_GHOST} disabled={denying} onClick={() => void decide([{ id: a.id, decision: "deny" }], "deny")}>
              {APPROVAL_CARD.deny}
            </button>
          </div>
          {a.always.allowed && a.always.label ? (
            <button type="button" className={cn(LINK, "mt-2 text-start")} disabled={denying} onClick={() => void decide([approval(a.id)], "approve", { always: true })}>
              {a.always.label}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/* ─────────────────────────── several requests ─────────────────────────── */

function BatchCard({ actions, agentName, deciding, onDecide }: ApprovalCardProps) {
  const datePrefs = useDatePrefs();
  const decide = useDecide(onDecide);
  // Every request starts ticked, so "Approve {n}" is the one click the card
  // is for; unticking one holds it back. A request that arrives later is
  // ticked too.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);

  const pending = actions.filter((a) => a.status === "PENDING");
  const pendingIds = pending.map((a) => a.id);
  const selected = pendingIds.filter((id) => !unticked.has(id));
  const approving = actions.some((a) => a.status === "RUNNING" || deciding[a.id] === "approve");
  const busy = approving || actions.some((a) => deciding[a.id] !== undefined);
  const soonest = pending.reduce<string | null>((at, a) => (at === null || a.expiresAt < at ? a.expiresAt : at), null);

  const tick = (id: string, on: boolean) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  const tickAll = (on: boolean) => setUnticked(on ? new Set() : new Set(pendingIds));
  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function approveWithChanges(id: string, text: string) {
    if (await decide([approval(id, text)], "approve")) setEdit(null);
  }

  return (
    <section aria-label={pending.length > 0 ? thingsWaiting(pending.length) : undefined} className="rounded-lg border border-line bg-raised">
      {pending.length > 0 ? (
        <header className="flex flex-wrap items-center gap-2 px-3 pt-3">
          <StatusChip color={RUN_TONE_COLOR.warning} label={APPROVAL_CARD.waitingForYou} />
          <h3 className="text-base font-medium text-ink">{thingsWaiting(pending.length)}</h3>
        </header>
      ) : null}
      {pending.length > 1 ? (
        <label className="mx-3 mt-2 flex h-8 w-fit cursor-pointer items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={selected.length === pendingIds.length}
            ref={(el) => {
              if (el) el.indeterminate = selected.length > 0 && selected.length < pendingIds.length;
            }}
            disabled={busy}
            onChange={(e) => tickAll(e.target.checked)}
            className={CHECKBOX}
          />
          {APPROVAL_CARD.selectAll}
        </label>
      ) : null}
      <ul className={cn("flex flex-col", pending.length > 0 ? "mt-1" : "py-1")}>
        {actions.map((a) => {
          const waiting = a.status === "PENDING" && deciding[a.id] !== "approve";
          const rowEdit = edit && edit.id === a.id && a.preview.editable ? edit : null;
          const hasDetails = Boolean(a.preview.body || a.preview.lines?.length || a.preview.undo);
          const chip = a.status === "RUNNING" || deciding[a.id] === "approve" ? CHIP.RUNNING : CHIP[a.status];
          return (
            <li key={a.id} data-action-id={a.id} className="border-t border-line-soft px-3 py-2 first:border-t-0">
              <div className="flex min-h-8 min-w-0 items-center gap-3">
                {waiting ? (
                  <input
                    type="checkbox"
                    aria-label={a.preview.title}
                    checked={!unticked.has(a.id)}
                    disabled={busy}
                    onChange={(e) => tick(a.id, e.target.checked)}
                    className={CHECKBOX}
                  />
                ) : (
                  <StatusChip color={RUN_TONE_COLOR[chip.tone]} label={chip.label} className="shrink-0" />
                )}
                {waiting && hasDetails ? (
                  <button
                    type="button"
                    onClick={() => toggleOpen(a.id)}
                    aria-expanded={open.has(a.id)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-start text-base text-ink"
                  >
                    {open.has(a.id) ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-2 rtl:rotate-180" strokeWidth={1.5} aria-hidden />
                    )}
                    <span className="min-w-0 truncate">{a.preview.title}</span>
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-base text-ink">{a.preview.title}</span>
                )}
                {waiting && a.preview.editable && !rowEdit ? (
                  <button
                    type="button"
                    className={GHOST}
                    disabled={busy}
                    onClick={() => setEdit({ id: a.id, text: clampText(editStartText(a), a.preview.editable?.maxLength ?? 0) })}
                  >
                    {APPROVAL_CARD.edit}
                  </button>
                ) : null}
              </div>
              {waiting && open.has(a.id) ? (
                <div className="ps-[30px]">
                  <Details a={a} />
                </div>
              ) : null}
              {!waiting && a.status !== "PENDING" && a.status !== "RUNNING" ? (
                <div className="ps-1">
                  <Outcome a={a} agentName={agentName} />
                </div>
              ) : null}
              {waiting && rowEdit && a.preview.editable ? (
                <div className="ps-[30px]">
                  <EditBox
                    label={a.preview.editable.label}
                    maxLength={a.preview.editable.maxLength}
                    value={rowEdit.text}
                    onChange={(text) => setEdit({ id: a.id, text })}
                    onApprove={() => void approveWithChanges(a.id, rowEdit.text)}
                    onCancel={() => setEdit(null)}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {pending.length > 0 ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-line-soft px-3 py-2">
          {approving ? (
            <Approving />
          ) : (
            <>
              <button
                type="button"
                className={SECONDARY}
                disabled={busy || selected.length === 0}
                onClick={() => void decide(selected.map((id) => approval(id)), "approve")}
              >
                <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {approveCount(selected.length)}
              </button>
              <button
                type="button"
                className={DANGER_GHOST}
                disabled={busy || selected.length === 0}
                onClick={() => void decide(selected.map((id) => ({ id, decision: "deny" as const })), "deny")}
              >
                {denyCount(selected.length)}
              </button>
            </>
          )}
          {soonest ? (
            <span className="ms-auto text-sm text-ink-2" title={formatDateTitle(soonest, datePrefs)}>
              {waitsUntil(formatDate(soonest, datePrefs, "datetime"))}
            </span>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}

/* ─────────────────────────── the parts ─────────────────────────── */

/** A waiting request's text and facts: the exact words in a quote block, then who sees it and the undo. */
function Details({ a }: { a: ActionView }) {
  const [all, setAll] = useState(false);
  const body = a.preview.body ? clipCardBody(a.preview.body) : null;
  return (
    <>
      {body ? (
        <div className="mt-2 rounded-md bg-subtle px-3 py-2">
          <p className="whitespace-pre-wrap break-words text-base text-ink">{all ? a.preview.body : body.text}</p>
          {body.clipped && !all ? (
            <button type="button" className={cn(LINK, "mt-1")} onClick={() => setAll(true)}>
              {APPROVAL_CARD.showAll}
            </button>
          ) : null}
        </div>
      ) : null}
      {a.preview.lines?.map((line, i) => (
        <p key={i} className="mt-1 text-sm text-ink-2">{line}</p>
      ))}
      {a.preview.undo ? <p className="mt-1 text-sm text-ink-2">{a.preview.undo}</p> : null}
    </>
  );
}

/** A decided request's line, and for one that ran, what it made and where it opens. */
function Outcome({ a, agentName }: { a: ActionView; agentName: string }) {
  const datePrefs = useDatePrefs();
  const decided = a.decidedAt ?? a.executedAt;
  const line = decidedLine(a, {
    time: decided ? formatDate(decided, datePrefs, "smart") : "",
    date: formatDate(decided ?? a.expiresAt, datePrefs, "date"),
    agentName,
  });
  if (!line) return null;
  return (
    <div className="mt-1 flex flex-col gap-0.5 text-sm text-ink-2">
      <p className="break-words" title={decided ? formatDateTitle(decided, datePrefs) : undefined}>{line}</p>
      {a.status === "EXECUTED" && a.result ? (
        <p className="break-words">
          {a.result.text}
          {a.result.href ? (
            <>
              {" · "}
              <Link href={a.result.href} className={LINK}>{APPROVAL_CARD.open}</Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function Approving() {
  return (
    <div className="mt-3 flex h-8 items-center gap-2 text-sm font-medium text-ink-2">
      <Dots variant="pending" label={APPROVAL_CARD.approving} />
      <span aria-hidden>{APPROVAL_CARD.approving}</span>
    </div>
  );
}

function EditBox({
  label,
  maxLength,
  value,
  onChange,
  onApprove,
  onCancel,
}: {
  label: string;
  maxLength: number;
  value: string;
  onChange: (text: string) => void;
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm font-medium text-ink-2">
        {label}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          rows={4}
          autoFocus
          className="block w-full resize-y rounded-md border border-line-strong bg-raised px-2 py-1.5 text-base font-normal text-ink outline-none focus:border-brand"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={SECONDARY} disabled={!value.trim()} onClick={onApprove}>
          <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {APPROVAL_CARD.approveWithChanges}
        </button>
        <button type="button" className={GHOST} onClick={onCancel}>{APPROVAL_CARD.cancel}</button>
      </div>
    </div>
  );
}

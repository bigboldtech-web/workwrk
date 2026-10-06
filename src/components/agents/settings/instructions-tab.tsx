"use client";

// The Instructions tab of a teammate's settings (docs/plans/ai-teammates.md
// 5.5): who it is and how it works.
//
// Whoever manages it (a workspace teammate's Owner and Admins, a private
// one's owner) edits Name, Colour, One job and Instructions and the Monthly
// limit (optional, in AI questions, on top of the plan), saved together with
// Save, or put back with Cancel, under the dirty guard; the On switch pauses
// it or turns it on at once; "Remove teammate" is at the foot. Everyone else
// reads the same words, and "An Owner or Admin manages this teammate."
// Everyone sees the usage line: AI questions, never a cost.
//
// A removed teammate's settings read only, with Add back for its managers.
// The save sends only what changed (teammate-setup.ts instructionsPatch); a
// change made elsewhere is taken in unless the person is typing.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { StatusChip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Switch } from "@/components/ui/switch";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { apiFetch } from "@/lib/api-fetch";
import {
  HUE_LABEL,
  NEW_TEAMMATE_DIALOG,
  TEAMMATE_CHAT,
  TEAMMATE_CHIPS,
  TEAMMATE_SETTINGS,
  backToast,
  pauseTeammate,
  pausedToast,
  removeTeammateTitle,
  removedComposer,
  removedToast,
  turnOnTeammate,
  turnedOnToast,
  usageLine,
} from "@/lib/agents/teammate-copy";
import { TEAMMATE_FIELD_MAX, instructionsFormOf, instructionsPatch, type InstructionsField, type InstructionsForm } from "@/lib/agents/teammate-setup";
import type { TeammateDetail } from "@/lib/agents/teammate-views";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { HuePicker } from "../hue-picker";
import { TeammateAvatar } from "../teammate-avatar";

const SECONDARY = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60";
const GHOST = "inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60";
const DANGER_GHOST = "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-danger-text hover:bg-hover disabled:opacity-60";
const INPUT = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none";
const LINK = "whitespace-nowrap font-medium text-brand-deep hover:underline";

function formOf(t: TeammateDetail): InstructionsForm {
  return instructionsFormOf({ name: t.name, hue: t.hue, job: t.job, instructions: t.instructions, monthlyQuestionCap: t.monthlyQuestionCap });
}

function sameForm(a: InstructionsForm, b: InstructionsForm): boolean {
  return a.name === b.name && a.hue === b.hue && a.job === b.job && a.instructions === b.instructions && a.monthlyLimit === b.monthlyLimit;
}

/** The month a usage line is for: the route sends its first day (UTC). */
function usageMonth(month: string): Date {
  const d = new Date(`${month}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function InstructionsTab({
  teammate: t,
  canManage,
  onSaved,
  onRemoved,
  onDirty,
}: {
  teammate: TeammateDetail;
  canManage: boolean;
  /** The route's answer after a change: the drawer, the list and the chat read it. */
  onSaved: (t: TeammateDetail) => void;
  onRemoved: () => void;
  /** Unsaved changes hold the drawer (Close, Esc, another tab ask first). */
  onDirty: (dirty: boolean) => void;
}) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fresh = formOf(t);
  const [saved, setSaved] = useState(fresh);
  const [form, setForm] = useState(fresh);
  const [problems, setProblems] = useState<Partial<Record<InstructionsField, string>>>({});
  const [busy, setBusy] = useState(false);
  const dirty = !sameForm(saved, form);

  // The teammate changed elsewhere (the chat's menu, another tab): take it
  // in, unless the person is typing (their save sends only what they changed).
  const freshKey = JSON.stringify(fresh);
  const [seen, setSeen] = useState(freshKey);
  if (seen !== freshKey) {
    setSeen(freshKey);
    if (!dirty) {
      setSaved(fresh);
      setForm(fresh);
    }
  }

  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  async function patch(body: Record<string, unknown>): Promise<TeammateDetail | null> {
    setBusy(true);
    const r = await apiFetch<{ teammate: TeammateDetail }>(`/api/agents/teammates/${encodeURIComponent(t.slug)}`, { method: "PATCH", json: body });
    setBusy(false);
    if (!r.ok) {
      // The route words its refusals (the plan's limit, not a manager).
      toast(r.code ? r.error : TEAMMATE_SETTINGS.saveFailed, { tone: "danger" });
      return null;
    }
    onSaved(r.data.teammate);
    return r.data.teammate;
  }

  async function save(): Promise<boolean> {
    const out = instructionsPatch(saved, form);
    if (!out.ok) {
      setProblems(out.problems);
      return false;
    }
    setProblems({});
    if (Object.keys(out.patch).length === 0) {
      setForm(saved);
      return true;
    }
    const next = await patch(out.patch);
    if (!next) return false;
    const now = formOf(next);
    setSaved(now);
    setForm(now);
    setSeen(JSON.stringify(now));
    toast(TEAMMATE_SETTINGS.saved);
    return true;
  }

  // The dirty guard holds one stable save; it always runs the latest one.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const onGuardSave = useCallback(() => saveRef.current(), []);
  useDirtyGuard(dirty, { onSave: onGuardSave, id: "teammate-instructions" });

  async function setOn(on: boolean) {
    const next = await patch({ status: on ? "ENABLED" : "DISABLED" });
    if (next) toast(on ? turnedOnToast(t.name) : pausedToast(t.name));
  }

  async function addBack() {
    const next = await patch({ restore: true });
    if (next) toast(backToast(t.name));
  }

  async function remove() {
    const ok = await confirm({
      title: removeTeammateTitle(t.name),
      description: TEAMMATE_SETTINGS.removeConfirmBody,
      confirmLabel: TEAMMATE_SETTINGS.remove,
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const r = await apiFetch(`/api/agents/teammates/${encodeURIComponent(t.slug)}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      toast(r.code ? r.error : TEAMMATE_CHAT.removeFailed, { tone: "danger" });
      return;
    }
    toast(removedToast(t.name));
    onRemoved();
  }

  const removed = t.status === "ARCHIVED";
  const usage = <p className="m-0 text-sm text-ink-2">{usageLine(t.usage.used, t.usage.cap, usageMonth(t.usage.month))}</p>;

  if (!canManage || removed) {
    // Read only: someone who does not manage it, or a removed teammate.
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <TeammateAvatar name={t.name} hue={t.hue} avatar={t.avatar} size="lg" />
          <div className="min-w-0 flex-1">
            <h3 className="m-0 truncate text-lg font-semibold text-ink">{t.name}</h3>
            {t.hue ? <p className="m-0 text-sm text-ink-2">{HUE_LABEL[t.hue]}</p> : null}
          </div>
          {removed || t.status === "DISABLED" ? (
            <StatusChip color={RUN_TONE_COLOR.neutral} label={removed ? TEAMMATE_CHIPS.removed : TEAMMATE_CHIPS.paused} className="shrink-0" />
          ) : null}
        </div>
        {removed ? (
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-base text-ink-2">
            {removedComposer(t.name)}
            {canManage ? (
              <button type="button" className={LINK} disabled={busy} onClick={() => void addBack()}>
                {TEAMMATE_CHAT.addBack}
              </button>
            ) : null}
          </p>
        ) : null}
        <ReadField label={NEW_TEAMMATE_DIALOG.job}>{t.job}</ReadField>
        <ReadField label={NEW_TEAMMATE_DIALOG.instructions}>
          {t.instructions.trim() ? <span className="whitespace-pre-wrap break-words">{t.instructions}</span> : <span className="text-ink-2">{TEAMMATE_SETTINGS.noInstructions}</span>}
        </ReadField>
        <ReadField label={TEAMMATE_SETTINGS.monthlyLimit}>{t.monthlyQuestionCap === null ? TEAMMATE_SETTINGS.noMonthlyLimit : String(t.monthlyQuestionCap)}</ReadField>
        {usage}
        {!canManage ? <p className="m-0 text-sm text-ink-2">{TEAMMATE_SETTINGS.managedByAdmins}</p> : null}
      </div>
    );
  }

  const on = t.status === "ENABLED";
  return (
    <div className="flex flex-col gap-4">
      <Field label={NEW_TEAMMATE_DIALOG.name} htmlFor="teammate-name" problem={problems.name}>
        <input
          id="teammate-name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          maxLength={TEAMMATE_FIELD_MAX.name}
          placeholder={NEW_TEAMMATE_DIALOG.namePlaceholder}
          aria-invalid={problems.name ? true : undefined}
          className={INPUT}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">{NEW_TEAMMATE_DIALOG.colour}</span>
        <HuePicker value={form.hue} onChange={(hue) => setForm({ ...form, hue })} label={NEW_TEAMMATE_DIALOG.colour} />
      </div>
      <Field label={NEW_TEAMMATE_DIALOG.job} htmlFor="teammate-job" problem={problems.job}>
        <input
          id="teammate-job"
          value={form.job}
          onChange={(e) => setForm({ ...form, job: e.target.value })}
          maxLength={TEAMMATE_FIELD_MAX.job}
          placeholder={NEW_TEAMMATE_DIALOG.jobPlaceholder}
          aria-invalid={problems.job ? true : undefined}
          className={INPUT}
        />
      </Field>
      <Field label={NEW_TEAMMATE_DIALOG.instructions} htmlFor="teammate-instructions" helper={NEW_TEAMMATE_DIALOG.instructionsHelper} problem={problems.instructions}>
        <textarea
          id="teammate-instructions"
          value={form.instructions}
          onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          maxLength={TEAMMATE_FIELD_MAX.instructions}
          rows={8}
          aria-invalid={problems.instructions ? true : undefined}
          className="block w-full resize-y rounded-md border border-line-strong bg-raised px-3 py-2 text-base text-ink focus:border-brand focus:outline-none"
        />
      </Field>
      <div className="flex min-h-9 items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink">{TEAMMATE_SETTINGS.on}</span>
        <Switch checked={on} disabled={busy} aria-label={on ? pauseTeammate(t.name) : turnOnTeammate(t.name)} onChange={(next) => void setOn(next)} />
      </div>
      <Field label={TEAMMATE_SETTINGS.monthlyLimit} htmlFor="teammate-monthly-limit" helper={TEAMMATE_SETTINGS.monthlyLimitHelper} problem={problems.monthlyLimit}>
        <input
          id="teammate-monthly-limit"
          value={form.monthlyLimit}
          onChange={(e) => setForm({ ...form, monthlyLimit: e.target.value })}
          inputMode="numeric"
          maxLength={6}
          aria-invalid={problems.monthlyLimit ? true : undefined}
          className={`${INPUT} max-w-[160px] tabular-nums`}
        />
      </Field>
      {usage}
      {dirty ? (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={GHOST}
            disabled={busy}
            onClick={() => {
              setForm(saved);
              setProblems({});
            }}
          >
            {TEAMMATE_SETTINGS.cancel}
          </button>
          <button type="button" className={SECONDARY} disabled={busy} onClick={() => void save()}>
            {TEAMMATE_SETTINGS.save}
          </button>
        </div>
      ) : null}
      <div className="mt-4 border-t border-line pt-4">
        <button type="button" className={DANGER_GHOST} disabled={busy} onClick={() => void remove()}>
          <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          {TEAMMATE_SETTINGS.removeTeammate}
        </button>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, helper, problem, children }: { label: string; htmlFor: string; helper?: string; problem?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {problem ? <span className="text-sm text-danger-text">{problem}</span> : helper ? <span className="text-sm text-ink-2">{helper}</span> : null}
    </div>
  );
}

function ReadField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <div className="text-base text-ink">{children}</div>
    </div>
  );
}

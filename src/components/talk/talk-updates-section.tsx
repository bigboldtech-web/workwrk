"use client";

// "Scheduled updates" in a conversation's Details panel (Batch 8,
// src/lib/talk-updates.ts): the AI updates that post here, who set each up,
// how its last run went, and, for the people allowed, Post now, Pause or
// Resume, Remove, and setting a new one up.
//
// Rendered only while the workspace has "Scheduled AI updates in Talk" on and
// this viewer has Ask AI, so every other workspace sees the panel exactly as
// before. What the server would refuse is said as one sentence instead of a
// button that fails.

import { useCallback, useContext, useEffect, useState } from "react";
import { Pause, Play, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useConfirm } from "@/components/ui/dialog-provider";
import { BootContext } from "@/components/layout/os/boot-context";
import { OsShellContext } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { readableListsUrl, type ReadableListsResponse } from "@/lib/readable-lists";
import { KIND_LABEL, REASON_TEXT, scheduleText, type RunReason, type TalkUpdateKind } from "@/lib/talk-updates";

interface UpdateView {
  id: string;
  kind: TalkUpdateKind;
  kindLabel: string;
  scopeKind: "list" | "space";
  scopeName: string | null;
  cadence: "weekdays" | "weekly";
  weekday: number | null;
  timeOfDay: string;
  timezone: string;
  status: "active" | "paused";
  pausedReason: RunReason | null;
  nextRunAt: string | null;
  createdBy: { id: string; name: string };
  lastRun: { status: string; reason: RunReason | null; at: string; taskCount: number | null } | null;
  canManage: boolean;
  canRunNow: boolean;
}

interface Listing {
  on: boolean;
  cronOn: boolean;
  canCreate: boolean;
  blocked: string | null;
  updates: UpdateView[];
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The panel shows this section: AI updates are on for the workspace and this viewer has Ask AI. */
export function useTalkUpdatesAvailable(): boolean {
  const boot = useContext(BootContext);
  const shell = useContext(OsShellContext);
  return Boolean(boot?.boot.org.aiTalkUpdates) && Boolean(shell?.askAiVisible);
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function TalkUpdatesSection({ conversationId }: { conversationId: string }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { date: fmtDate } = useFormat();
  const [data, setData] = useState<Listing | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Bumped to read the list again (after an action, or Retry).
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    void apiFetch<Listing>(`/api/conversations/${conversationId}/updates`, { cache: "no-store" }).then((r) => {
      if (!alive) return;
      if (r.ok && r.data) {
        setData(r.data);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
    return () => { alive = false; };
  }, [conversationId, round]);

  const load = useCallback(async () => { setRound((n) => n + 1); }, []);

  const act = async (key: string, run: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, done?: (d: unknown) => void) => {
    setBusy(key);
    const r = await run();
    setBusy(null);
    if (!r.ok) {
      toast(r.error ?? "Couldn't do that. Try again.");
      return;
    }
    done?.(r.data);
    await load();
  };

  const postNow = (u: UpdateView) =>
    act(`run:${u.id}`, () => apiFetch(`/api/conversations/${conversationId}/updates/${u.id}/run`, { method: "POST" }), (d) => {
      const res = d as { posted?: boolean; message?: string; taskCount?: number } | undefined;
      toast(res?.posted ? `Posted from ${res.taskCount ?? 0} ${res.taskCount === 1 ? "task" : "tasks"}.` : res?.message ?? "Nothing was posted.");
    });

  const setStatus = (u: UpdateView, status: "active" | "paused") =>
    act(`status:${u.id}`, () => apiFetch(`/api/conversations/${conversationId}/updates/${u.id}`, { method: "PATCH", json: { status } }));

  const remove = async (u: UpdateView) => {
    const ok = await confirm({
      title: `Remove the ${u.kindLabel.toLowerCase()}?`,
      description: "It stops posting. The updates it already posted stay in the conversation.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    await act(`del:${u.id}`, () => apiFetch(`/api/conversations/${conversationId}/updates/${u.id}`, { method: "DELETE" }));
  };

  const sectionLabel = "px-3 pt-4 pb-1 text-micro font-semibold uppercase tracking-wide text-ink-3";
  const ghost = "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50";

  return (
    <>
      <h3 className={sectionLabel}>Scheduled updates</h3>
      <div className="space-y-2 px-3">
        {failed ? (
          <p className="text-xs text-ink-2">
            Couldn&apos;t load the scheduled updates.{" "}
            <button type="button" onClick={() => void load()} className="font-medium text-[var(--os-brand-deep)] hover:underline">Retry</button>
          </p>
        ) : !data ? (
          <Dots variant="pending" label="Loading" className="text-ink-3" />
        ) : (
          <>
            {data.updates.length === 0 && !adding ? (
              <p className="text-xs text-ink-2">A daily standup or a weekly project update, written by AI from a List or a Space and posted here on a schedule.</p>
            ) : null}
            {data.updates.map((u) => {
              const last = u.lastRun;
              const lastText = !last
                ? "Not posted yet."
                : last.status === "posted"
                  ? `Posted ${fmtDate(last.at, "date")}${typeof last.taskCount === "number" ? ` from ${last.taskCount} ${last.taskCount === 1 ? "task" : "tasks"}` : ""}.`
                  : last.status === "running"
                    ? "Posting now."
                    : `Last run ${fmtDate(last.at, "date")}: ${last.reason ? REASON_TEXT[last.reason] : "Not posted."}`;
              return (
                <div key={u.id} className="rounded-lg border border-line px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--os-brand-deep)]" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-sm font-medium text-ink">
                        {u.kindLabel}
                        <span className="font-normal text-ink-2"> · {u.scopeName ?? (u.scopeKind === "list" ? "a List you can't open" : "a Space you can't open")}</span>
                      </p>
                      <p className="m-0 text-xs text-ink-2">{scheduleText(u)} · as {u.createdBy.name}</p>
                      <p className="m-0 text-xs text-ink-3">
                        {u.status === "paused" ? `Paused${u.pausedReason ? `: ${REASON_TEXT[u.pausedReason]}` : "."}` : lastText}
                      </p>
                    </div>
                  </div>
                  {u.canRunNow || u.canManage ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {u.canRunNow ? (
                        <button type="button" className={ghost} disabled={busy !== null} onClick={() => void postNow(u)}>
                          {busy === `run:${u.id}` ? <Dots variant="pending" label="Posting" /> : <Send className="h-3.5 w-3.5" aria-hidden />} Post now
                        </button>
                      ) : null}
                      {u.canManage ? (
                        <button type="button" className={ghost} disabled={busy !== null} onClick={() => void setStatus(u, u.status === "active" ? "paused" : "active")}>
                          {u.status === "active" ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                          {u.status === "active" ? "Pause" : "Resume"}
                        </button>
                      ) : null}
                      {u.canManage ? (
                        <button type="button" className={ghost} disabled={busy !== null} onClick={() => void remove(u)}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {adding ? (
              <NewUpdateForm
                conversationId={conversationId}
                onCancel={() => setAdding(false)}
                onCreated={async () => { setAdding(false); toast("Scheduled update set up."); await load(); }}
              />
            ) : data.canCreate ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex h-8 w-full items-center gap-2 rounded-md px-1 text-sm font-medium text-[var(--os-brand-deep)] hover:bg-hover"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> New scheduled update
              </button>
            ) : data.blocked ? (
              <p className="text-xs text-ink-3">{data.blocked}</p>
            ) : null}
            {!data.cronOn && (data.updates.length > 0 || adding) ? (
              <p className="text-xs text-ink-3">Scheduled posting isn&apos;t switched on for this server yet, so updates post only with Post now.</p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function NewUpdateForm({
  conversationId,
  onCancel,
  onCreated,
}: {
  conversationId: string;
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const [kind, setKind] = useState<TalkUpdateKind>("standup");
  const [scope, setScope] = useState("");
  const [cadence, setCadence] = useState<"weekdays" | "weekly">("weekdays");
  const [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState("09:00");
  const [zone] = useState(browserZone);
  const [options, setOptions] = useState<ReadableListsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void apiFetch<ReadableListsResponse>(readableListsUrl({ targets: true, limit: 100 }), { cache: "no-store" }).then((r) => {
      if (alive) setOptions(r.ok && r.data ? r.data : { boards: [], spaces: [], truncated: false });
    });
    return () => { alive = false; };
  }, []);

  const pickKind = (k: TalkUpdateKind) => {
    setKind(k);
    setCadence(k === "standup" ? "weekdays" : "weekly");
  };

  const submit = async () => {
    const [scopeKind, scopeId] = scope.split(":");
    if (!scopeId) {
      setError("Pick a List or a Space to report on.");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await apiFetch(`/api/conversations/${conversationId}/updates`, {
      method: "POST",
      json: { kind, scopeKind, scopeId, cadence, weekday: cadence === "weekly" ? weekday : null, timeOfDay: time, timezone: zone },
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error ?? "Couldn't set this up.");
      return;
    }
    await onCreated();
  };

  const field = "h-8 w-full rounded-md border border-line bg-raised px-2 text-sm text-ink outline-none focus:border-[var(--os-brand)]";
  const spaceName = new Map((options?.spaces ?? []).map((s) => [s.id, s.name] as const));
  return (
    <div className="space-y-2 rounded-lg border border-line bg-subtle px-2.5 py-2.5">
      <SegmentedControl
        label="Kind of update"
        size="sm"
        value={kind}
        onChange={pickKind}
        options={[
          { value: "standup", label: KIND_LABEL.standup },
          { value: "project", label: KIND_LABEL.project },
        ]}
      />
      <label className="block">
        <span className="mb-0.5 block text-xs font-medium text-ink">Report on</span>
        <select value={scope} onChange={(e) => setScope(e.target.value)} className={field} disabled={!options}>
          <option value="">{options ? "Pick a List or a Space" : "Loading"}</option>
          {options && options.spaces.length > 0 ? (
            <optgroup label="Spaces">
              {options.spaces.map((s) => <option key={`space:${s.id}`} value={`space:${s.id}`}>{s.name}</option>)}
            </optgroup>
          ) : null}
          {options && options.boards.length > 0 ? (
            <optgroup label="Lists">
              {options.boards.map((b) => (
                <option key={`list:${b.id}`} value={`list:${b.id}`}>
                  {b.spaceId && spaceName.get(b.spaceId) ? `${b.name} (${spaceName.get(b.spaceId)})` : b.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>
      <div className="flex items-end gap-2">
        <label className="block flex-1">
          <span className="mb-0.5 block text-xs font-medium text-ink">When</span>
          <select value={cadence} onChange={(e) => setCadence(e.target.value as "weekdays" | "weekly")} className={field}>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Once a week</option>
          </select>
        </label>
        {cadence === "weekly" ? (
          <label className="block flex-1">
            <span className="mb-0.5 block text-xs font-medium text-ink">Day</span>
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={field}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
            </select>
          </label>
        ) : null}
        <label className="block w-24">
          <span className="mb-0.5 block text-xs font-medium text-ink">Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} />
        </label>
      </div>
      <p className="m-0 text-xs text-ink-3">
        Times are in {zone}. AI writes it from the tasks that everyone here can open, sends those tasks to the AI provider, and posts it as you.
      </p>
      {error ? <p className="m-0 text-xs text-danger-text" role="alert">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-7 rounded-md px-2.5 text-xs text-ink-2 hover:bg-hover">Cancel</button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-brand px-2.5 text-xs font-medium text-ink-inv hover:bg-brand-hover disabled:opacity-50"
        >
          {saving ? <Dots variant="pending" label="Saving" /> : null} Set up
        </button>
      </div>
    </div>
  );
}

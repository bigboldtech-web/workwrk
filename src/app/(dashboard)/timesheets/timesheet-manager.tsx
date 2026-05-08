"use client";

// Week-grid timesheet UI. Live punch timer at the top (ticks every
// second when running). Day rows show entries grouped by day with
// inline add / edit / delete. Submit button at the bottom flips the
// week to SUBMITTED.
//
// Manager queue tab is a sibling — toggle to see SUBMITTED weeks
// waiting on me.

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
  Clock,
  Play,
  Square,
  Plus,
  Trash2,
  Send,
  CheckCircle2,
  XCircle,
} from "lucide-react";

export type TimeEntryRow = {
  id: string;
  day: string;
  hours: number | null;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  description: string | null;
  source: string;
  task: { id: string; title: string } | null;
};

export type TimesheetData = {
  id: string;
  weekStartDate: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  entries: TimeEntryRow[];
};

type ActivePunch = {
  id: string;
  day: string;
  clockedInAt: string;
  description: string | null;
  task: { id: string; title: string } | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "text-muted border-white/20",
  SUBMITTED: "text-blue-400 border-blue-400/30",
  APPROVED: "text-green-400 border-green-400/30",
  REJECTED: "text-red-400 border-red-400/30",
};

function fmtElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtHours(h: number | null): string {
  if (h === null || h === 0) return "—";
  return `${h.toFixed(2)}h`;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function TimesheetManager({
  initial,
  activePunch,
  isManager,
}: {
  initial: TimesheetData;
  activePunch: ActivePunch | null;
  isManager: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<"mine" | "approve">("mine");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Clock size={20} /> Timesheets
          </h1>
          <p className="text-muted text-sm mt-1">
            Log hours for the week or run a clock. Submit weekly for manager approval.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="mine">My week</TabsTrigger>
          {isManager && <TabsTrigger value="approve">Approval queue</TabsTrigger>}
        </TabsList>

        <TabsContent value="mine" className="mt-4 space-y-4">
          <MyWeek
            initial={initial}
            activePunch={activePunch}
            onChange={() => router.refresh()}
            toast={toast}
          />
        </TabsContent>

        {isManager && (
          <TabsContent value="approve" className="mt-4">
            <ApprovalQueue toast={toast} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ─── My week ───────────────────────────────────────────────────────

function MyWeek({
  initial,
  activePunch,
  onChange,
  toast,
}: {
  initial: TimesheetData;
  activePunch: ActivePunch | null;
  onChange: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [data, setData] = useState<TimesheetData>(initial);
  const [active, setActive] = useState<ActivePunch | null>(activePunch);
  const [busy, setBusy] = useState(false);

  // Live timer for the active punch — ticks once a second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const week = useMemo(() => {
    const start = new Date(data.weekStartDate);
    return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
  }, [data.weekStartDate]);

  const byDay = useMemo(() => {
    const m = new Map<string, TimeEntryRow[]>();
    for (const e of data.entries) {
      const k = dayKey(e.day);
      const arr = m.get(k) ?? [];
      arr.push(e);
      m.set(k, arr);
    }
    return m;
  }, [data.entries]);

  const totalWeekHours = useMemo(
    () =>
      data.entries.reduce(
        (acc, e) => acc + (e.hours ?? 0),
        0,
      ),
    [data.entries],
  );

  const isLocked = data.status !== "DRAFT";

  async function startPunch() {
    setBusy(true);
    try {
      const res = await fetch("/api/time-entries/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't start", description: json?.error });
        return;
      }
      setActive(json.active);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function stopPunch() {
    setBusy(true);
    try {
      const res = await fetch("/api/time-entries/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't stop", description: json?.error });
        return;
      }
      setActive(null);
      // Append the closed entry locally, then refresh server data.
      if (json.closed) {
        setData((prev) => ({
          ...prev,
          entries: [...prev.entries, mapClosed(json.closed)],
        }));
      }
      toast({ type: "success", title: `Logged ${json.closed?.hours ?? 0}h` });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function addEntry(day: Date, hours: number, description: string) {
    const res = await fetch("/api/time-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day: day.toISOString(),
        hours,
        description: description || undefined,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't save", description: json?.error });
      return;
    }
    setData((prev) => ({
      ...prev,
      entries: [...prev.entries, mapClosed(json)],
    }));
    onChange();
  }

  async function deleteEntry(id: string) {
    const res = await fetch(`/api/time-entries/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast({ type: "error", title: "Couldn't delete", description: json?.error });
      return;
    }
    setData((prev) => ({
      ...prev,
      entries: prev.entries.filter((e) => e.id !== id),
    }));
    onChange();
  }

  async function submitWeek() {
    if (!confirm(`Submit this week (${totalWeekHours.toFixed(2)}h) for approval?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/timesheets/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit" }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't submit", description: json?.error });
        return;
      }
      setData((prev) => ({ ...prev, status: "SUBMITTED" }));
      toast({ type: "success", title: "Week submitted" });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function retractWeek() {
    setBusy(true);
    try {
      const res = await fetch(`/api/timesheets/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retract" }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't retract", description: json?.error });
        return;
      }
      setData((prev) => ({ ...prev, status: "DRAFT" }));
      toast({ type: "success", title: "Retracted" });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Active punch banner / clock-in button */}
      <Card>
        <CardContent className="p-4 flex items-center gap-4 flex-wrap">
          {active ? (
            <>
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="w-2 h-2 rounded-full bg-[#d4ff2e] animate-pulse" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">Clocked in</div>
                  <div className="text-xs text-muted">
                    Started {new Date(active.clockedInAt).toLocaleTimeString()}
                    {active.task && ` · ${active.task.title}`}
                  </div>
                </div>
                <div className="text-2xl font-mono font-bold tabular-nums ml-auto">
                  {fmtElapsed((now - new Date(active.clockedInAt).getTime()) / 1000)}
                </div>
              </div>
              <Button onClick={stopPunch} disabled={busy} variant="outline" className="text-red-400">
                <Square size={14} className="mr-1.5" /> Stop
              </Button>
            </>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">Not clocked in</div>
                <div className="text-xs text-muted">
                  Start a punch and the timer runs until you stop.
                </div>
              </div>
              <Button onClick={startPunch} disabled={busy || isLocked}>
                <Play size={14} className="mr-1.5" /> Clock in
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Week status header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              Week of {week[0]?.toLocaleDateString()} → {week[6]?.toLocaleDateString()}
              <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[data.status]}`}>
                {data.status}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono">
                Total: <strong>{totalWeekHours.toFixed(2)}h</strong>
              </span>
              {data.status === "DRAFT" && (
                <Button onClick={submitWeek} disabled={busy || totalWeekHours === 0}>
                  <Send size={14} className="mr-1.5" /> Submit week
                </Button>
              )}
              {data.status === "SUBMITTED" && (
                <Button onClick={retractWeek} disabled={busy} variant="outline">
                  Retract
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-white/5">
            {week.map((day, i) => {
              const k = dayKey(day.toISOString());
              const entries = byDay.get(k) ?? [];
              const dayHours = entries.reduce(
                (acc, e) => acc + (e.hours ?? 0),
                0,
              );
              return (
                <DayRow
                  key={k}
                  day={day}
                  weekday={DAY_NAMES[i]!}
                  entries={entries}
                  totalHours={dayHours}
                  locked={isLocked}
                  onAdd={(hours, description) => addEntry(day, hours, description)}
                  onDelete={deleteEntry}
                />
              );
            })}
          </div>
        </CardContent>
      </Card>

      {data.status === "REJECTED" && (
        <Card>
          <CardContent className="p-4 border border-red-400/30 bg-red-400/5 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <XCircle size={14} className="text-red-400" />
              <span className="font-medium text-red-400">Week was rejected.</span>
              <span className="text-muted">Retract above to fix and resubmit.</span>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function DayRow({
  day,
  weekday,
  entries,
  totalHours,
  locked,
  onAdd,
  onDelete,
}: {
  day: Date;
  weekday: string;
  entries: TimeEntryRow[];
  totalHours: number;
  locked: boolean;
  onAdd: (hours: number, description: string) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-12 text-xs text-muted">{weekday}</div>
          <div className="text-sm font-medium">{day.toLocaleDateString()}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm tabular-nums">{fmtHours(totalHours)}</span>
          {!locked && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setAdding((v) => !v)}>
              <Plus size={14} />
            </Button>
          )}
        </div>
      </div>

      {entries.length > 0 && (
        <ul className="mt-2 space-y-1 pl-15">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 text-xs text-muted">
              <span className="font-mono w-16 tabular-nums">{fmtHours(e.hours)}</span>
              <span className="flex-1 truncate">
                {e.task && (
                  <span className="text-fg/80">{e.task.title}</span>
                )}
                {e.task && e.description && " · "}
                {e.description}
                {!e.task && !e.description && <span className="italic">(no description)</span>}
              </span>
              {e.source === "PUNCH" && (
                <span className="text-[10px] uppercase tracking-wide opacity-60">punched</span>
              )}
              {!locked && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Delete this entry?")) onDelete(e.id);
                  }}
                  className="text-muted hover:text-red-400"
                  aria-label="Delete entry"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && !locked && (
        <div className="mt-3 flex items-center gap-2 pl-15">
          <Input
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="hours"
            className="h-8 w-20 text-xs"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What did you work on?"
            className="h-8 text-xs flex-1"
          />
          <Button
            size="sm"
            disabled={!hours || Number(hours) <= 0}
            onClick={() => {
              const n = Number(hours);
              if (!Number.isFinite(n) || n <= 0) return;
              onAdd(n, description.trim());
              setHours("");
              setDescription("");
              setAdding(false);
            }}
          >
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Approval queue ────────────────────────────────────────────────

function ApprovalQueue({
  toast,
}: {
  toast: ReturnType<typeof useToast>["toast"];
}) {
  type Row = {
    id: string;
    weekStartDate: string;
    status: string;
    submittedAt: string | null;
    user: { id: string; firstName: string; lastName: string } | null;
    _count: { entries: number };
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/timesheets?scope=approve&limit=50");
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't load queue", description: data?.error });
        return;
      }
      setRows(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    let note: string | null = null;
    if (decision === "REJECT") {
      const reason = prompt("Reason for rejection?");
      if (reason === null) return;
      note = reason;
    }
    setBusy(id);
    try {
      const res = await fetch(`/api/timesheets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decide", decision, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't update", description: data?.error });
        return;
      }
      toast({ type: "success", title: `Week ${decision.toLowerCase()}d` });
      setRows((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="text-sm text-muted text-center py-8">Loading…</div>;
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted">
          Nothing waiting on you.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-white/5">
          {rows.map((r) => (
            <li key={r.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {r.user ? `${r.user.firstName} ${r.user.lastName}` : "—"}
                </div>
                <div className="text-xs text-muted">
                  Week of {new Date(r.weekStartDate).toLocaleDateString()} ·{" "}
                  {r._count.entries} {r._count.entries === 1 ? "entry" : "entries"}
                  {r.submittedAt && ` · submitted ${new Date(r.submittedAt).toLocaleDateString()}`}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Link href={`/timesheets/${r.id}`} className="text-xs text-muted hover:text-fg">
                  View
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-red-400"
                  disabled={busy === r.id}
                  onClick={() => decide(r.id, "REJECT")}
                >
                  <XCircle size={11} className="mr-1" /> Reject
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={busy === r.id}
                  onClick={() => decide(r.id, "APPROVE")}
                >
                  <CheckCircle2 size={11} className="mr-1" /> Approve
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── helpers ───────────────────────────────────────────────────────

function mapClosed(json: {
  id: string;
  day: string;
  hours: number | null;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  description: string | null;
  source: string;
}): TimeEntryRow {
  return {
    id: json.id,
    day: json.day,
    hours: json.hours,
    clockedInAt: json.clockedInAt,
    clockedOutAt: json.clockedOutAt,
    description: json.description,
    source: json.source,
    task: null,
  };
}

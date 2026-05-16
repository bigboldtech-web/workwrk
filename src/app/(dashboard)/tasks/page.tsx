"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, ChevronLeft, ChevronRight, Calendar, List, Clock,
  CheckCircle2, Circle, Play, Users, AlertCircle, Filter,
  CalendarDays, CalendarRange, GanttChart, Activity,
  Edit3, Trash2,
} from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuLabel,
} from "@/components/ui/context-menu";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorRetry } from "@/components/ui/error-retry";

import { TaskDialog } from "@/components/tasks/task-dialog";
import { DayView } from "@/components/tasks/view-day";
import { MonthView } from "@/components/tasks/view-month";
import { GanttView } from "@/components/tasks/view-gantt";
import { WorkloadHeatmap } from "@/components/tasks/workload-heatmap";
import type { Task, TeamMember, CalendarView } from "@/components/tasks/types";
import { formatISODate, isSameDay, startOfDay } from "@/components/tasks/types";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function mondayOfWeek(d: Date): Date {
  const day = d.getDay();
  const m = new Date(d);
  m.setDate(d.getDate() - ((day + 6) % 7));
  return startOfDay(m);
}

function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

interface MeetingRow {
  id: string;
  title: string;
  type: string;
  scheduledAt: string;
  duration: number;
  attendees: { userId: string }[];
}

/** Turn a MeetingRow into a Task-shaped object so the calendar views
 *  can render it alongside tasks without knowing about the meeting
 *  type. `externalSource = "MEETING"` signals "render as meeting pill,
 *  route clicks to /meetings/:id". */
function meetingToTask(m: MeetingRow): Task {
  const start = new Date(m.scheduledAt);
  const end = new Date(start.getTime() + (m.duration || 30) * 60 * 1000);
  return {
    id: `meeting:${m.id}`,
    title: m.title,
    date: start.toISOString(),
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allDay: false,
    status: "PLANNED",
    externalSource: "MEETING",
    // Stash the real meeting id here so the click handler can route.
    // (types.ts has externalId as an optional string on Task.)
    externalId: m.id,
  } as unknown as Task;
}

export default function TasksPage() {
  const { isManager } = useRole();
  const { success: toastSuccess, error: toastError } = useToast();
  const router = useRouter();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(new Date());

  // Team filtering (manager-only)
  const [teamView, setTeamView] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [showWorkload, setShowWorkload] = useState(false);

  // Dialogs
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [prefillDate, setPrefillDate] = useState<string | undefined>(undefined);
  const [prefillTime, setPrefillTime] = useState<string | undefined>(undefined);

  const [showReasonDialog, setShowReasonDialog] = useState(false);
  const [reasonTaskId, setReasonTaskId] = useState("");
  const [incompleteReason, setIncompleteReason] = useState("");

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  // Within-day DnD state. Active in the week view only; cross-day drops
  // are ignored for v1 (cross-day means a date change which needs a
  // different request shape than the reorder endpoint).
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropBeforeTaskId, setDropBeforeTaskId] = useState<string | null>(null);

  // Compute the fetch window per view. Day = 1 day; Week/List = 7 days;
  // Month = full 6-row calendar grid (42 days); Gantt = 28-day window
  // centered on the anchor.
  const { fromDate, toDate, headerLabel } = useMemo(() => {
    const a = startOfDay(anchor);
    if (view === "day") {
      return {
        fromDate: a,
        toDate: a,
        headerLabel: a.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" }),
      };
    }
    if (view === "week" || view === "list") {
      const start = mondayOfWeek(a);
      const end = new Date(start); end.setDate(start.getDate() + 6);
      return {
        fromDate: start,
        toDate: end,
        headerLabel: `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      };
    }
    if (view === "month") {
      const first = new Date(a.getFullYear(), a.getMonth(), 1);
      const gridStart = mondayOfWeek(first);
      const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 41);
      return {
        fromDate: gridStart,
        toDate: gridEnd,
        headerLabel: first.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      };
    }
    // Gantt: ±2 weeks around anchor week
    const start = mondayOfWeek(a); start.setDate(start.getDate() - 7);
    const end = new Date(start); end.setDate(start.getDate() + 27);
    return {
      fromDate: start,
      toDate: end,
      headerLabel: `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
    };
  }, [view, anchor]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams({
        startDate: formatISODate(fromDate),
        endDate: formatISODate(toDate),
      });
      const meetingParams = new URLSearchParams({
        from: formatISODate(fromDate),
        to: formatISODate(toDate),
      });
      if (teamView && isManager) {
        if (selectedMemberIds.length > 0) {
          params.set("userIds", selectedMemberIds.join(","));
          meetingParams.set("userIds", selectedMemberIds.join(","));
        } else {
          params.set("view", "team");
          meetingParams.set("view", "team");
        }
      }
      const [tRes, mRes] = await Promise.all([
        fetch(`/api/tasks?${params}`),
        fetch(`/api/calendar/meetings?${meetingParams}`),
      ]);
      if (!tRes.ok && !mRes.ok) throw new Error("both task + meeting fetches failed");
      const taskRows: Task[] = tRes.ok
        ? await tRes.json().then((d) => (Array.isArray(d) ? d : d.data || []))
        : [];
      const meetingRows: MeetingRow[] = mRes.ok
        ? await mRes.json().then((d) => (Array.isArray(d) ? d : d.data || []))
        : [];
      setTasks([...taskRows, ...meetingRows.map(meetingToTask)]);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, teamView, isManager, selectedMemberIds]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Task DnD drop handler. Two cases:
  //   1) Same-day drop on a task    → reorder within the day
  //   2) Cross-day drop on a task   → PATCH date, then reorder the target day
  //      (this also handles drops on an empty column when targetTaskId is null)
  // External tasks (GCAL, MEETING) refuse to drag — they're not owned by
  // the user and the reorder API would 403.
  const handleTaskReorderDrop = useCallback(async (targetTaskId: string | null, targetDateStr: string) => {
    const dragId = draggingTaskId;
    setDraggingTaskId(null);
    setDropBeforeTaskId(null);
    if (!dragId) return;
    const dragged = tasks.find((t) => t.id === dragId);
    if (!dragged) return;
    if (dragged.externalSource === "GCAL" || dragged.externalSource === "MEETING") return;
    if (dragged.id === targetTaskId) return;

    const draggedDay = dragged.date.split("T")[0];
    const isCrossDay = draggedDay !== targetDateStr;

    // Cross-day: PATCH the date so the task moves to the new column.
    // Keep startAt/endAt offsets intact by computing the day delta.
    if (isCrossDay) {
      const oldDate = new Date(dragged.date);
      const newDate = new Date(targetDateStr + "T00:00:00");
      // Preserve the time-of-day from the original anchor.
      newDate.setHours(oldDate.getHours(), oldDate.getMinutes(), oldDate.getSeconds(), 0);
      const dayMs = 24 * 60 * 60 * 1000;
      const deltaMs = Math.round((newDate.getTime() - oldDate.getTime()) / dayMs) * dayMs;
      const newStartAt = dragged.startAt ? new Date(new Date(dragged.startAt).getTime() + deltaMs).toISOString() : undefined;
      const newEndAt = dragged.endAt ? new Date(new Date(dragged.endAt).getTime() + deltaMs).toISOString() : undefined;

      // Optimistic — move the task locally before the PATCH lands.
      setTasks((prev) => prev.map((t) =>
        t.id === dragId
          ? { ...t, date: newDate.toISOString(), startAt: newStartAt ?? t.startAt, endAt: newEndAt ?? t.endAt, dayPosition: null }
          : t,
      ));

      try {
        const res = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: dragId,
            date: newDate.toISOString(),
            ...(newStartAt ? { startAt: newStartAt } : {}),
            ...(newEndAt ? { endAt: newEndAt } : {}),
          }),
        });
        if (!res.ok) throw new Error("date move failed");
      } catch {
        toastError("Couldn't move the task to that day");
        fetchTasks();
        return;
      }
    }

    // Reorder pass on the target day. We rebuild the target day's list
    // from local state (which is now optimistic for cross-day) and insert
    // the dragged task at the right spot.
    const targetDayList = (isCrossDay
      ? [
          ...tasks.filter((t) => t.id !== dragId && t.date.split("T")[0] === targetDateStr),
          { ...dragged, date: targetDateStr + "T00:00:00.000Z" }, // dragged just joined
        ]
      : tasks.filter((t) => t.date.split("T")[0] === targetDateStr)
    )
      .filter((t) => t.externalSource !== "GCAL" && t.externalSource !== "MEETING")
      .sort((a, b) => {
        const ap = a.dayPosition ?? Number.MAX_SAFE_INTEGER;
        const bp = b.dayPosition ?? Number.MAX_SAFE_INTEGER;
        if (ap !== bp) return ap - bp;
        return a.id.localeCompare(b.id);
      });

    // Drop position. null target = append to end (empty-column drop).
    let toIdx = targetTaskId === null
      ? targetDayList.length
      : targetDayList.findIndex((t) => t.id === targetTaskId);
    if (toIdx < 0) return;
    const fromIdx = targetDayList.findIndex((t) => t.id === dragId);
    if (fromIdx < 0) return;
    if (toIdx > fromIdx) toIdx -= 1;
    if (!isCrossDay && toIdx === fromIdx) return;

    const reordered = [...targetDayList];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const items = reordered.map((t, idx) => ({ id: t.id, dayPosition: (idx + 1) * 10 }));

    setTasks((prev) =>
      prev.map((t) => {
        const found = items.find((i) => i.id === t.id);
        return found ? { ...t, dayPosition: found.dayPosition } : t;
      }),
    );
    try {
      const res = await fetch("/api/tasks/reorder-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("reorder failed");
    } catch {
      toastError("Failed to save new order");
      fetchTasks();
    }
  }, [draggingTaskId, tasks, fetchTasks, toastError]);

  useEffect(() => {
    if (!isManager) return;
    fetch("/api/my-team")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.members) {
          setTeamMembers(d.members);
          setCurrentUserId(d.self?.id || "");
        }
      })
      .catch(() => {});
  }, [isManager]);

  function openNewTask(date?: string, time?: string) {
    setEditingTask(null);
    setPrefillDate(date);
    setPrefillTime(time);
    setDialogOpen(true);
  }

  function openEditTask(task: Task) {
    // Meetings are a separate surface — route to their detail page
    // instead of opening the task dialog. `externalId` holds the real
    // meeting id (stripped of the "meeting:" prefix we add for client
    // rendering).
    if (task.externalSource === "MEETING" && task.externalId) {
      router.push(`/meetings/${task.externalId}`);
      return;
    }
    setEditingTask(task);
    setPrefillDate(undefined);
    setPrefillTime(undefined);
    setDialogOpen(true);
  }

  async function toggleStatus(taskId: string, currentStatus: string) {
    const next = currentStatus === "COMPLETED" ? "PLANNED" : currentStatus === "PLANNED" ? "IN_PROGRESS" : "COMPLETED";
    const task = tasks.find((t) => t.id === taskId);
    if (task && next !== "COMPLETED" && new Date(task.date) < new Date() && !isToday(new Date(task.date))) {
      setReasonTaskId(taskId);
      setShowReasonDialog(true);
      return;
    }
    try {
      await fetch("/api/tasks", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: next }),
      });
      fetchTasks();
    } catch {}
  }

  async function handleSubmitReason() {
    if (!incompleteReason.trim()) return;
    try {
      await fetch("/api/tasks", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reasonTaskId, incompleteReason }),
      });
      setShowReasonDialog(false);
      setIncompleteReason("");
      fetchTasks();
    } catch {}
  }

  function confirmDelete(task: Task) {
    setDeleteTarget(task);
    setDialogOpen(false);
    setShowDeleteDialog(true);
  }

  async function handleDelete(deleteAll: boolean) {
    if (!deleteTarget) return;
    try {
      await fetch("/api/tasks", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id, deleteAll }),
      });
      setShowDeleteDialog(false);
      setDeleteTarget(null);
      fetchTasks();
      toastSuccess(deleteAll ? "All future recurring tasks deleted" : "Task deleted");
    } catch { toastError("Failed to delete"); }
  }

  // Navigation step depends on view.
  function stepBack() {
    const n = new Date(anchor);
    if (view === "day") n.setDate(n.getDate() - 1);
    else if (view === "month") n.setMonth(n.getMonth() - 1);
    else n.setDate(n.getDate() - 7);
    setAnchor(n);
  }
  function stepForward() {
    const n = new Date(anchor);
    if (view === "day") n.setDate(n.getDate() + 1);
    else if (view === "month") n.setMonth(n.getMonth() + 1);
    else n.setDate(n.getDate() + 7);
    setAnchor(n);
  }
  function goToday() { setAnchor(new Date()); }

  const totalHours = tasks.reduce((s, t) => s + (t.hoursSpent || 0), 0);
  const completedCount = tasks.filter((t) => t.status === "COMPLETED").length;

  // Week view grid dates
  const weekDates = useMemo(() => {
    const start = mondayOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i); return d;
    });
  }, [anchor]);

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Work calendar" }]}
        kicker="Tasks · auto-escalating"
        title="Work calendar"
        subtitle="Plan your day, schedule spans across the week, and see where time is going."
        stats={[
          { label: "Completed", value: `${completedCount}/${tasks.length}` },
          { label: "Hours this period", value: `${totalHours}h` },
        ]}
      />

      {/* Top controls */}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {isManager && (
            <>
              <Button
                variant={teamView ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setTeamView(!teamView);
                  if (teamView) { setSelectedMemberIds([]); setShowWorkload(false); }
                }}
              >
                <Users size={14} /> {teamView ? "Team" : "My tasks"}
              </Button>
              {teamView && teamMembers.length > 1 && (
                <div className="relative">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowMemberPicker(!showMemberPicker)}>
                    <Filter size={12} />
                    {selectedMemberIds.length === 0 ? `All (${teamMembers.length})` : `${selectedMemberIds.length} selected`}
                  </Button>
                  {showMemberPicker && (
                    <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-border bg-surface shadow-xl p-2 animate-in fade-in-0 zoom-in-95">
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-[10px] uppercase tracking-wider text-muted">Team members</span>
                        <button onClick={() => setSelectedMemberIds([])} className="text-[10px] text-[color:var(--accent-strong)] hover:text-[#e2ff6b]">
                          Show all
                        </button>
                      </div>
                      <div className="max-h-64 overflow-y-auto space-y-0.5">
                        {teamMembers.map((m) => {
                          const checked = selectedMemberIds.includes(m.id);
                          return (
                            <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => setSelectedMemberIds((prev) =>
                                  checked ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                                )}
                                className="accent-[#a8cc24]"
                              />
                              <span className="text-sm">
                                {m.firstName} {m.lastName}
                                {m.id === currentUserId && <span className="text-[10px] text-muted ml-1">(you)</span>}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="border-t border-border mt-2 pt-2 flex justify-end">
                        <Button size="sm" className="text-xs h-7" onClick={() => setShowMemberPicker(false)}>Done</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {teamView && (
                <Button
                  variant={showWorkload ? "default" : "outline"}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setShowWorkload(!showWorkload)}
                >
                  <Activity size={14} /> Workload
                </Button>
              )}
            </>
          )}
          <Button onClick={() => openNewTask()} className="gap-1.5"><Plus size={14} /> Add task</Button>
        </div>
      </div>

      {/* Optional workload panel */}
      {showWorkload && teamView && (
        <WorkloadHeatmap
          weekStart={mondayOfWeek(anchor)}
          teamMembers={selectedMemberIds.length > 0
            ? teamMembers.filter((m) => selectedMemberIds.includes(m.id))
            : teamMembers}
          onDrill={(userId, date) => {
            setSelectedMemberIds([userId]);
            setAnchor(new Date(date));
            setView("day");
          }}
        />
      )}

      {/* Date nav + view switcher */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={stepBack}><ChevronLeft size={14} /></Button>
          <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={stepForward}><ChevronRight size={14} /></Button>
          <span className="text-sm font-medium ml-2">{headerLabel}</span>
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as CalendarView)}>
          <TabsList className="h-8">
            <TabsTrigger value="day" className="text-xs gap-1 h-7"><Clock size={12} /> Day</TabsTrigger>
            <TabsTrigger value="week" className="text-xs gap-1 h-7"><Calendar size={12} /> Week</TabsTrigger>
            <TabsTrigger value="month" className="text-xs gap-1 h-7"><CalendarRange size={12} /> Month</TabsTrigger>
            <TabsTrigger value="list" className="text-xs gap-1 h-7"><List size={12} /> List</TabsTrigger>
            <TabsTrigger value="gantt" className="text-xs gap-1 h-7"><GanttChart size={12} /> Gantt</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loadError && !loading && (
        <ErrorRetry
          title="Couldn't load your calendar"
          description="Tasks + meetings failed to load. Try again — switching views will refetch."
          onRetry={fetchTasks}
          retrying={loading}
        />
      )}

      {/* ── Day ── */}
      {view === "day" && (
        <DayView
          date={anchor}
          tasks={tasks}
          onOpenTask={openEditTask}
          onNewTaskAt={(d, hhmm) => openNewTask(d, hhmm)}
        />
      )}

      {/* ── Week ── */}
      {view === "week" && (
        <div className="overflow-x-auto -mx-2 px-2 sm:mx-0 sm:px-0">
        <div className="grid grid-cols-7 gap-2 min-w-[760px] sm:min-w-0">
          {weekDates.map((date, i) => {
            const dateStr = formatISODate(date);
            const dayTasks = tasks
              .filter((t) => {
                // Show a task on this day if its date anchor matches OR its
                // multi-day span covers this day.
                if (t.date.split("T")[0] === dateStr) return true;
                if (t.startAt && t.endAt) {
                  const d = startOfDay(date);
                  const s = startOfDay(new Date(t.startAt));
                  const e = startOfDay(new Date(t.endAt));
                  return d >= s && d <= e;
                }
                return false;
              })
              .sort((a, b) => {
                // Within-day order: user-set dayPosition first, then
                // startAt/date tiebreaker for never-reordered tasks.
                const ap = a.dayPosition ?? Number.MAX_SAFE_INTEGER;
                const bp = b.dayPosition ?? Number.MAX_SAFE_INTEGER;
                if (ap !== bp) return ap - bp;
                const at = a.startAt ?? a.date;
                const bt = b.startAt ?? b.date;
                return at.localeCompare(bt);
              });
            const dayHours = dayTasks.reduce((sum, t) => sum + (t.hoursSpent || 0), 0);
            const today = isToday(date);
            const isPast = date < new Date() && !today;
            const isCrossDayDropTarget = (() => {
              if (!draggingTaskId) return false;
              const dragged = tasks.find((t) => t.id === draggingTaskId);
              if (!dragged) return false;
              if (dragged.externalSource === "GCAL" || dragged.externalSource === "MEETING") return false;
              return dragged.date.split("T")[0] !== dateStr;
            })();
            return (
              <div
                key={i}
                className={`min-h-[200px] rounded-lg border p-2 transition-colors ${today ? "border-[rgba(212,255,46,0.4)] bg-[rgba(212,255,46,0.06)]" : "border-border bg-surface"} ${isCrossDayDropTarget ? "ring-2 ring-[color:var(--accent-strong)] ring-offset-1 ring-offset-background" : ""}`}
                onDragOver={(e) => {
                  if (!draggingTaskId) return;
                  const dragged = tasks.find((t) => t.id === draggingTaskId);
                  if (!dragged) return;
                  if (dragged.externalSource === "GCAL" || dragged.externalSource === "MEETING") return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  if (!draggingTaskId) return;
                  e.preventDefault();
                  // Append to the end of this day. Same-day drops on the
                  // empty area below the last card also land here.
                  handleTaskReorderDrop(null, dateStr);
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className={`text-[10px] font-medium ${today ? "text-[color:var(--accent-strong)]" : "text-muted"}`}>{DAY_NAMES[i]}</p>
                    <p className={`text-lg font-bold ${today ? "text-[color:var(--accent-strong)]" : ""}`}>{date.getDate()}</p>
                  </div>
                  <button
                    onClick={() => openNewTask(dateStr)}
                    className="h-6 w-6 rounded-full flex items-center justify-center text-muted hover:bg-surface-2 hover:text-foreground"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="space-y-1">
                  {loading
                    ? <Skeleton className="h-8 w-full" />
                    : dayTasks.length === 0
                      ? <p className="text-[10px] text-muted-2 text-center py-4">No tasks</p>
                      : dayTasks.map((task) => {
                          const multiDay = !!(task.startAt && task.endAt) &&
                            !isSameDay(new Date(task.startAt!), new Date(task.endAt!));
                          const source = task.externalSource;
                          const borderBgCls = source === "GCAL"
                            ? "border-[rgba(74,158,255,0.35)] bg-[rgba(74,158,255,0.10)] hover:bg-[rgba(74,158,255,0.18)]"
                            : source === "MEETING"
                              ? "border-[rgba(255,153,51,0.35)] bg-[rgba(255,153,51,0.10)] hover:bg-[rgba(255,153,51,0.18)]"
                              : multiDay
                                ? "border-[rgba(212,255,46,0.35)] bg-[rgba(212,255,46,0.12)] hover:bg-[rgba(212,255,46,0.2)]"
                                : "border-border bg-background hover:bg-surface-2";
                          const titleAttr = source === "GCAL"
                            ? "From Google Calendar — read-only"
                            : source === "MEETING"
                              ? "Meeting — open in Meetings"
                              : undefined;
                          const isExternal = source === "GCAL" || source === "MEETING";
                          const draggable = !isExternal;
                          const isDragging = draggingTaskId === task.id;
                          const showDropLine = dropBeforeTaskId === task.id && draggingTaskId !== task.id && draggingTaskId !== null;
                          return (
                            <button
                              key={task.id}
                              onClick={() => openEditTask(task)}
                              draggable={draggable}
                              onDragStart={(e) => {
                                if (!draggable) return;
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", task.id);
                                setDraggingTaskId(task.id);
                              }}
                              onDragEnd={() => {
                                setDraggingTaskId(null);
                                setDropBeforeTaskId(null);
                              }}
                              onDragOver={(e) => {
                                if (!draggingTaskId) return;
                                const dragged = tasks.find((t) => t.id === draggingTaskId);
                                // External-source drops are refused at the
                                // handler too, but cut them off here so the
                                // drop line never appears.
                                if (!dragged || dragged.externalSource === "GCAL" || dragged.externalSource === "MEETING") return;
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                if (dropBeforeTaskId !== task.id) setDropBeforeTaskId(task.id);
                              }}
                              onDrop={(e) => {
                                if (!draggingTaskId) return;
                                e.preventDefault();
                                e.stopPropagation();
                                handleTaskReorderDrop(task.id, dateStr);
                              }}
                              className={`w-full text-left rounded-md border p-1.5 transition-colors ${borderBgCls} ${isDragging ? "opacity-40" : ""} ${showDropLine ? "border-t-2 border-[color:var(--accent-strong)] -mt-px" : ""}`}
                              title={titleAttr}
                            >
                              <div className="flex items-start gap-1.5">
                                {task.status === "COMPLETED" ? <CheckCircle2 size={11} className="mt-0.5 text-[color:var(--accent-strong)] shrink-0" />
                                  : task.status === "IN_PROGRESS" ? <Play size={11} className="mt-0.5 text-amber-400 shrink-0" />
                                  : <Circle size={11} className="mt-0.5 text-muted shrink-0" />}
                                <div className="flex-1 min-w-0">
                                  <p className={`text-[11px] font-medium truncate ${task.status === "COMPLETED" ? "line-through text-muted" : ""}`}>{task.title}</p>
                                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                    {task.hoursSpent != null && <span className="text-[9px] text-muted-2">{task.hoursSpent}h</span>}
                                    {task.category && <span className="text-[9px] text-[color:var(--accent-strong)]">{task.category}</span>}
                                    {teamView && task.assignee && <span className="text-[9px] text-muted-2">{task.assignee.firstName}</span>}
                                    {(task.labels || []).slice(0, 2).map((lb) => (
                                      <span key={lb.labelId} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: lb.label.color }} />
                                    ))}
                                    {task._count && task._count.subTasks > 0 && (
                                      <span className="text-[9px] text-muted-2">· {task._count.subTasks} sub</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {isPast && task.status !== "COMPLETED" && !task.incompleteReason && (
                                <div className="flex items-center gap-1 mt-1"><AlertCircle size={9} className="text-red-400" /><span className="text-[9px] text-red-400">Overdue</span></div>
                              )}
                            </button>
                          );
                        })}
                </div>
                {dayHours > 0 && (
                  <div className="mt-2 pt-1 border-t border-border">
                    <p className="text-[10px] text-muted flex items-center gap-1"><Clock size={10} /> {dayHours}h</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </div>
      )}

      {/* ── Month ── */}
      {view === "month" && (
        <MonthView
          month={anchor}
          tasks={tasks}
          onOpenTask={openEditTask}
          onPickDay={(d) => { setAnchor(new Date(d)); setView("day"); }}
        />
      )}

      {/* ── List ── */}
      {view === "list" && (
        <div className="space-y-4">
          {loading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <SkeletonRow key={i} />)}</div>
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No tasks this week"
              description="Schedule the work that drives your KRAs. Tasks roll into the right KPI automatically."
              actionLabel="Add task"
              onAction={() => openNewTask()}
            />
          ) : (
            Array.from(groupByDate(tasks).entries()).sort(([a], [b]) => a.localeCompare(b)).map(([dateStr, dayTasks]) => {
              const d = new Date(dateStr);
              const dayHours = dayTasks.reduce((s, t) => s + (t.hoursSpent || 0), 0);
              const done = dayTasks.filter((t) => t.status === "COMPLETED").length;
              return (
                <div key={dateStr}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-muted">
                      {d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                      {isToday(d) && <Badge variant="secondary" className="text-[9px] ml-2">Today</Badge>}
                    </p>
                    <p className="text-[10px] text-muted">{done}/{dayTasks.length} done · {dayHours}h</p>
                  </div>
                  <div className="space-y-2">
                    {dayTasks.map((task) => (
                      <ContextMenu key={task.id}>
                        <ContextMenuTrigger asChild>
                          <Card className="hover:border-muted-2 transition-colors cursor-pointer" onClick={() => openEditTask(task)}>
                            <CardContent className="p-3 flex items-center gap-3">
                              <button onClick={(e) => { e.stopPropagation(); toggleStatus(task.id, task.status); }} className="shrink-0">
                                {task.status === "COMPLETED" ? <CheckCircle2 size={18} className="text-[color:var(--accent-strong)]" />
                                  : task.status === "IN_PROGRESS" ? <Play size={18} className="text-amber-400" />
                                  : <Circle size={18} className="text-muted" />}
                              </button>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium ${task.status === "COMPLETED" ? "line-through text-muted" : ""}`}>{task.title}</p>
                                {task.description && <p className="text-xs text-muted truncate">{task.description}</p>}
                                {(task.labels || []).length > 0 && (
                                  <div className="flex items-center gap-1 mt-1">
                                    {task.labels!.map((lb) => (
                                      <span key={lb.labelId} className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: `${lb.label.color}22`, color: lb.label.color }}>
                                        {lb.label.name}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {task.category && <Badge variant="outline" className="text-[9px]">{task.category}</Badge>}
                                {task.hoursSpent != null && <span className="text-xs text-muted font-mono">{task.hoursSpent}h</span>}
                                {teamView && task.assignee && <span className="text-[10px] text-muted">{task.assignee.firstName}</span>}
                              </div>
                            </CardContent>
                          </Card>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuLabel>Task</ContextMenuLabel>
                          <ContextMenuItem onSelect={() => openEditTask(task)}>
                            <Edit3 size={14} /> Open / edit
                          </ContextMenuItem>
                          {task.status !== "COMPLETED" && (
                            <ContextMenuItem onSelect={async () => {
                              await fetch("/api/tasks", {
                                method: "PATCH", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: task.id, status: "COMPLETED" }),
                              });
                              fetchTasks();
                            }}>
                              <CheckCircle2 size={14} /> Mark complete
                            </ContextMenuItem>
                          )}
                          {task.status !== "IN_PROGRESS" && (
                            <ContextMenuItem onSelect={async () => {
                              await fetch("/api/tasks", {
                                method: "PATCH", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: task.id, status: "IN_PROGRESS" }),
                              });
                              fetchTasks();
                            }}>
                              <Play size={14} /> Mark in progress
                            </ContextMenuItem>
                          )}
                          {task.status !== "PLANNED" && (
                            <ContextMenuItem onSelect={() => toggleStatus(task.id, task.status)}>
                              <Circle size={14} /> Mark planned
                            </ContextMenuItem>
                          )}
                          <ContextMenuSeparator />
                          <ContextMenuItem destructive onSelect={() => confirmDelete(task)}>
                            <Trash2 size={14} /> Delete
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Gantt ── */}
      {view === "gantt" && (
        <GanttView
          from={fromDate}
          to={toDate}
          tasks={tasks}
          onOpenTask={openEditTask}
        />
      )}

      {/* Task dialog */}
      <TaskDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditingTask(null); }}
        task={editingTask}
        teamMembers={teamMembers}
        currentUserId={currentUserId}
        isManager={isManager}
        prefillDate={prefillDate}
        prefillTime={prefillTime}
        onSaved={() => { fetchTasks(); toastSuccess(editingTask ? "Task updated" : "Task created"); }}
        onRequestDelete={(t) => { setDeleteTarget(t); setDialogOpen(false); setShowDeleteDialog(true); }}
      />

      {/* Incomplete reason dialog */}
      <Dialog open={showReasonDialog} onOpenChange={setShowReasonDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Why was this task not completed?</DialogTitle></DialogHeader>
          <div className="py-4">
            <Textarea value={incompleteReason} onChange={(e) => setIncompleteReason(e.target.value)} placeholder="Explain…" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReasonDialog(false)}>Cancel</Button>
            <Button onClick={handleSubmitReason} disabled={!incompleteReason.trim()}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => { setShowDeleteDialog(open); if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete task</DialogTitle></DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm">Delete <strong>&quot;{deleteTarget?.title}&quot;</strong>?</p>
            {deleteTarget?.recurringGroupId && (
              <p className="text-xs text-muted">This is a recurring task. You can delete just this one or all future occurrences.</p>
            )}
          </div>
          <DialogFooter>
            <div className="flex items-center justify-between w-full">
              <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
              <div className="flex items-center gap-2">
                {(deleteTarget?.recurringGroupId || tasks.filter((t) => t.title === deleteTarget?.title).length > 1) && (
                  <Button variant="destructive" onClick={() => handleDelete(true)}>Delete all future</Button>
                )}
                <Button variant="outline" className="text-red-400 border-red-400/30 hover:bg-red-500/10" onClick={() => handleDelete(false)}>
                  Delete this only
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function groupByDate(tasks: Task[]): Map<string, Task[]> {
  const m = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.date.split("T")[0];
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(t);
  }
  return m;
}

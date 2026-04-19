"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, ChevronLeft, ChevronRight, Calendar, List, Clock,
  CheckCircle2, Circle, Play, Trash2, Users, AlertCircle, Filter,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";

const CATEGORIES = ["Development", "Meetings", "Admin", "Planning", "Review", "Communication", "Research", "Other"];

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekDates(baseDate: Date): Date[] {
  const day = baseDate.getDay();
  const monday = new Date(baseDate);
  monday.setDate(baseDate.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function isToday(d: Date): boolean {
  return d.toDateString() === new Date().toDateString();
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Task {
  id: string;
  title: string;
  description?: string;
  date: string;
  hoursSpent?: number | null;
  category?: string | null;
  status: string;
  incompleteReason?: string | null;
  recurringGroupId?: string | null;
  assignee?: { id: string; firstName: string; lastName: string };
  kra?: { id: string; name: string } | null;
}

export default function TasksPage() {
  const { isManager } = useRole();
  const { success: toastSuccess, error: toastError } = useToast();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekBase, setWeekBase] = useState(new Date());
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [teamView, setTeamView] = useState(false);

  // Team members (recursive reports) and per-member filtering
  const [teamMembers, setTeamMembers] = useState<Array<{ id: string; firstName: string; lastName: string; avatar?: string }>>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);  // empty = all team
  const [showMemberPicker, setShowMemberPicker] = useState(false);

  // Task dialog
  const [showDialog, setShowDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [form, setForm] = useState({
    title: "", description: "", date: formatDate(new Date()),
    hoursSpent: "", category: "", status: "PLANNED",
    assigneeId: "",  // empty = current user
    recurring: "none" as string,
    recurringDays: [] as number[],
    recurringDuration: "1month" as string, // 1month, 3months, 6months, 1year, forever
  });
  const [saving, setSaving] = useState(false);

  // Incomplete reason dialog
  const [showReasonDialog, setShowReasonDialog] = useState(false);
  const [reasonTaskId, setReasonTaskId] = useState("");
  const [incompleteReason, setIncompleteReason] = useState("");

  // Delete confirmation dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<Task | null>(null);

  const weekDates = getWeekDates(weekBase);
  const weekStart = formatDate(weekDates[0]);
  const weekEnd = formatDate(weekDates[6]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ startDate: weekStart, endDate: weekEnd });
      if (teamView && isManager) {
        if (selectedMemberIds.length > 0) {
          params.set("userIds", selectedMemberIds.join(","));
        } else {
          params.set("view", "team");
        }
      }
      const res = await fetch(`/api/tasks?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTasks(Array.isArray(data) ? data : data.data || []);
      }
    } catch {} finally { setLoading(false); }
  }, [weekStart, weekEnd, teamView, isManager, selectedMemberIds]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Load team (self + recursive reports) for managers
  useEffect(() => {
    if (!isManager) return;
    fetch("/api/my-team")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.members) {
          setTeamMembers(d.members);
          setCurrentUserId(d.self?.id || "");
        }
      })
      .catch(() => {});
  }, [isManager]);

  function openNewTask(date?: string) {
    setEditingTask(null);
    setForm({ title: "", description: "", date: date || formatDate(new Date()), hoursSpent: "", category: "", status: "PLANNED", assigneeId: "", recurring: "none", recurringDays: [], recurringDuration: "1month" });
    setShowDialog(true);
  }

  function openEditTask(task: Task) {
    setEditingTask(task);
    setForm({
      title: task.title, description: task.description || "", date: task.date.split("T")[0],
      hoursSpent: task.hoursSpent != null ? String(task.hoursSpent) : "",
      category: task.category || "", status: task.status,
      assigneeId: task.assignee?.id || "",
      recurring: "none", recurringDays: [], recurringDuration: "1month",
    });
    setShowDialog(true);
  }

  function getRecurringDates(startDate: string, recurring: string, recurringDays: number[], duration: string): string[] {
    const dates: string[] = [];
    const start = new Date(startDate);

    if (recurring === "none") return [startDate];

    // Calculate total days based on duration
    const durationDays: Record<string, number> = {
      "1month": 30, "3months": 90, "6months": 180, "1year": 365,
    };
    const totalDays = durationDays[duration] || 30;

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dayOfWeek = d.getDay();

      if (recurring === "daily") {
        dates.push(formatDate(d));
      } else if (recurring === "weekdays") {
        if (dayOfWeek >= 1 && dayOfWeek <= 5) dates.push(formatDate(d));
      } else if (recurring === "weekly") {
        if (dayOfWeek === start.getDay()) dates.push(formatDate(d));
      } else if (recurring === "monthly") {
        if (d.getDate() === start.getDate()) dates.push(formatDate(d));
      } else if (recurring === "custom" && recurringDays.length > 0) {
        if (recurringDays.includes(dayOfWeek)) dates.push(formatDate(d));
      }
    }

    return dates.length > 0 ? dates : [startDate];
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      if (editingTask) {
        // Update existing task
        const payload: any = {
          id: editingTask.id,
          title: form.title, description: form.description || null, date: form.date,
          hoursSpent: form.hoursSpent ? Number(form.hoursSpent) : null,
          category: form.category || null, status: form.status,
          ...(form.assigneeId && { assigneeId: form.assigneeId }),
        };
        const res = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          setShowDialog(false);
          fetchTasks();
          toastSuccess("Task updated");
        }
      } else {
        // Create — handle recurring with batch API
        const dates = getRecurringDates(form.date, form.recurring, form.recurringDays, form.recurringDuration);

        if (dates.length === 1) {
          // Single task — use regular API
          const res = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: form.title, description: form.description || null, date: dates[0],
              hoursSpent: form.hoursSpent ? Number(form.hoursSpent) : null,
              category: form.category || null, status: form.status,
              assigneeId: form.assigneeId || undefined,
            }),
          });
          if (res.ok) {
            setShowDialog(false);
            fetchTasks();
            toastSuccess("Task created");
          }
        } else {
          // Batch create for recurring
          const tasks = dates.map((date) => ({
            title: form.title, description: form.description || null, date,
            hoursSpent: form.hoursSpent ? Number(form.hoursSpent) : null,
            category: form.category || null, status: form.status,
            assigneeId: form.assigneeId || undefined,
          }));
          const res = await fetch("/api/tasks/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tasks }),
          });
          if (res.ok) {
            const data = await res.json();
            const count = (data.data || data).created;
            setShowDialog(false);
            fetchTasks();
            toastSuccess(`${count} recurring tasks created`);
          }
        }
      }
    } catch { toastError("Failed to save task"); } finally { setSaving(false); }
  }

  async function toggleStatus(taskId: string, currentStatus: string) {
    const newStatus = currentStatus === "COMPLETED" ? "PLANNED" : currentStatus === "PLANNED" ? "IN_PROGRESS" : "COMPLETED";
    const task = tasks.find((t) => t.id === taskId);
    if (task && newStatus !== "COMPLETED" && new Date(task.date) < new Date() && !isToday(new Date(task.date))) {
      setReasonTaskId(taskId);
      setShowReasonDialog(true);
      return;
    }
    try {
      await fetch("/api/tasks", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: newStatus }),
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
    setDeleteTaskTarget(task);
    setShowDialog(false);
    setShowDeleteDialog(true);
  }

  async function handleDelete(deleteAll: boolean) {
    if (!deleteTaskTarget) return;
    try {
      await fetch("/api/tasks", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTaskTarget.id, deleteAll }),
      });
      setShowDeleteDialog(false);
      setDeleteTaskTarget(null);
      fetchTasks();
      toastSuccess(deleteAll ? "All future recurring tasks deleted" : "Task deleted");
    } catch { toastError("Failed to delete"); }
  }

  function prevWeek() { const d = new Date(weekBase); d.setDate(d.getDate() - 7); setWeekBase(d); }
  function nextWeek() { const d = new Date(weekBase); d.setDate(d.getDate() + 7); setWeekBase(d); }
  function goToday() { setWeekBase(new Date()); }

  // Group tasks by date for list view
  const tasksByDate = new Map<string, Task[]>();
  tasks.forEach((t) => {
    const key = t.date.split("T")[0];
    if (!tasksByDate.has(key)) tasksByDate.set(key, []);
    tasksByDate.get(key)!.push(t);
  });

  const totalHours = tasks.reduce((sum, t) => sum + (t.hoursSpent || 0), 0);
  const completedCount = tasks.filter((t) => t.status === "COMPLETED").length;

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        kicker="Tasks · auto-escalating"
        title="Work calendar"
        subtitle="Tasks born from SOPs, reviews, and KR drift — with SLA timers and escalation paths."
        stats={[
          { label: "Completed", value: `${completedCount}/${tasks.length}` },
          { label: "Hours this week", value: `${totalHours}h` },
        ]}
      />
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
                  if (teamView) setSelectedMemberIds([]);
                }}
              >
                <Users size={14} /> {teamView ? "Team" : "My Tasks"}
              </Button>
              {teamView && teamMembers.length > 1 && (
                <div className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setShowMemberPicker(!showMemberPicker)}
                  >
                    <Filter size={12} />
                    {selectedMemberIds.length === 0
                      ? `All (${teamMembers.length})`
                      : `${selectedMemberIds.length} selected`}
                  </Button>
                  {showMemberPicker && (
                    <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-border bg-surface shadow-xl p-2 animate-in fade-in-0 zoom-in-95">
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-[10px] uppercase tracking-wider text-muted">Team Members</span>
                        <button
                          onClick={() => setSelectedMemberIds([])}
                          className="text-[10px] text-[#d4ff2e] hover:text-[#e2ff6b]"
                        >
                          Show all
                        </button>
                      </div>
                      <div className="max-h-64 overflow-y-auto space-y-0.5">
                        {teamMembers.map((m) => {
                          const checked = selectedMemberIds.includes(m.id);
                          return (
                            <label
                              key={m.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-2 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setSelectedMemberIds((prev) =>
                                    checked ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                                  );
                                }}
                                className="accent-[#d4ff2e]"
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
            </>
          )}
          <Button onClick={() => openNewTask()} className="gap-1.5"><Plus size={14} /> Add Task</Button>
        </div>
      </div>

      {/* Week Nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevWeek}><ChevronLeft size={14} /></Button>
          <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextWeek}><ChevronRight size={14} /></Button>
          <span className="text-sm font-medium ml-2">
            {weekDates[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {weekDates[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </div>
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
          <TabsList className="h-8">
            <TabsTrigger value="calendar" className="text-xs gap-1 h-7"><Calendar size={12} /> Week</TabsTrigger>
            <TabsTrigger value="list" className="text-xs gap-1 h-7"><List size={12} /> List</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Calendar View */}
      {viewMode === "calendar" && (
        <div className="grid grid-cols-7 gap-2">
          {weekDates.map((date, i) => {
            const dateStr = formatDate(date);
            const dayTasks = tasks.filter((t) => t.date.split("T")[0] === dateStr);
            const dayHours = dayTasks.reduce((sum, t) => sum + (t.hoursSpent || 0), 0);
            const today = isToday(date);
            const isPast = date < new Date() && !today;

            return (
              <div key={i} className={`min-h-[200px] rounded-lg border p-2 ${today ? "border-[rgba(212,255,46,0.4)] bg-[rgba(212,255,46,0.06)]" : "border-border bg-surface"}`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className={`text-[10px] font-medium ${today ? "text-[#d4ff2e]" : "text-muted"}`}>{DAY_NAMES[i]}</p>
                    <p className={`text-lg font-bold ${today ? "text-[#d4ff2e]" : ""}`}>{date.getDate()}</p>
                  </div>
                  <button onClick={() => openNewTask(dateStr)} className="h-6 w-6 rounded-full flex items-center justify-center text-muted hover:bg-surface-2 hover:text-foreground">
                    <Plus size={12} />
                  </button>
                </div>
                <div className="space-y-1">
                  {loading ? <div className="h-8 bg-surface-2 rounded animate-pulse" /> : dayTasks.length === 0 ? (
                    <p className="text-[10px] text-muted-2 text-center py-4">No tasks</p>
                  ) : dayTasks.map((task) => (
                    <button key={task.id} onClick={() => openEditTask(task)} className="w-full text-left rounded-md border border-border bg-background p-1.5 hover:bg-surface-2 transition-colors">
                      <div className="flex items-start gap-1.5">
                        {task.status === "COMPLETED" ? <CheckCircle2 size={11} className="mt-0.5 text-green-400 shrink-0" /> :
                         task.status === "IN_PROGRESS" ? <Play size={11} className="mt-0.5 text-blue-400 shrink-0" /> :
                         <Circle size={11} className="mt-0.5 text-muted shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <p className={`text-[11px] font-medium truncate ${task.status === "COMPLETED" ? "line-through text-muted" : ""}`}>{task.title}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            {task.hoursSpent != null && <span className="text-[9px] text-muted-2">{task.hoursSpent}h</span>}
                            {task.category && <span className="text-[9px] text-[#d4ff2e]">{task.category}</span>}
                            {teamView && task.assignee && <span className="text-[9px] text-muted-2">{task.assignee.firstName}</span>}
                          </div>
                        </div>
                      </div>
                      {isPast && task.status !== "COMPLETED" && !task.incompleteReason && (
                        <div className="flex items-center gap-1 mt-1"><AlertCircle size={9} className="text-red-400" /><span className="text-[9px] text-red-400">Overdue</span></div>
                      )}
                    </button>
                  ))}
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
      )}

      {/* List View */}
      {viewMode === "list" && (
        <div className="space-y-4">
          {loading ? (
            <Card><CardContent className="p-4"><div className="h-24 bg-surface-2 rounded animate-pulse" /></CardContent></Card>
          ) : tasks.length === 0 ? (
            <Card><CardContent className="p-8 text-center">
              <Calendar size={32} className="mx-auto text-muted mb-2" />
              <p className="text-sm text-muted">No tasks this week.</p>
              <Button variant="outline" size="sm" className="mt-3 gap-1" onClick={() => openNewTask()}><Plus size={14} /> Add Task</Button>
            </CardContent></Card>
          ) : (
            Array.from(tasksByDate.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([dateStr, dayTasks]) => {
              const date = new Date(dateStr);
              const dayHours = dayTasks.reduce((sum, t) => sum + (t.hoursSpent || 0), 0);
              const dayCompleted = dayTasks.filter((t) => t.status === "COMPLETED").length;
              return (
                <div key={dateStr}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-muted">
                      {date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                      {isToday(date) && <Badge variant="secondary" className="text-[9px] ml-2">Today</Badge>}
                    </p>
                    <p className="text-[10px] text-muted">{dayCompleted}/{dayTasks.length} done &middot; {dayHours}h</p>
                  </div>
                  <div className="space-y-2">
                    {dayTasks.map((task) => (
                      <Card key={task.id} className="hover:border-muted-2 transition-colors cursor-pointer" onClick={() => openEditTask(task)}>
                        <CardContent className="p-3 flex items-center gap-3">
                          <button onClick={(e) => { e.stopPropagation(); toggleStatus(task.id, task.status); }} className="shrink-0">
                            {task.status === "COMPLETED" ? <CheckCircle2 size={18} className="text-green-400" /> :
                             task.status === "IN_PROGRESS" ? <Play size={18} className="text-blue-400" /> :
                             <Circle size={18} className="text-muted" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${task.status === "COMPLETED" ? "line-through text-muted" : ""}`}>{task.title}</p>
                            {task.description && <p className="text-xs text-muted truncate">{task.description}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {task.category && <Badge variant="outline" className="text-[9px]">{task.category}</Badge>}
                            {task.hoursSpent != null && <span className="text-xs text-muted font-mono">{task.hoursSpent}h</span>}
                            {teamView && task.assignee && <span className="text-[10px] text-muted">{task.assignee.firstName}</span>}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Task Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { setShowDialog(open); if (!open) setEditingTask(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingTask ? "Edit Task" : "Add Task"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title <span className="text-red-400">*</span></Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Task name" />
            </div>
            {isManager && teamMembers.length > 1 && (
              <div className="space-y-2">
                <Label>Assign To</Label>
                <Select value={form.assigneeId || "self"} onValueChange={(v) => setForm({ ...form, assigneeId: v === "self" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select assignee" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">Myself</SelectItem>
                    {teamMembers.filter((m) => m.id !== currentUserId).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.firstName} {m.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted">Leave as "Myself" for personal tasks. Select a team member to delegate.</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Time Spent (hours)</Label>
                <Input type="number" step="0.5" min="0" max="24" placeholder="e.g., 2" value={form.hoursSpent} onChange={(e) => setForm({ ...form, hoursSpent: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLANNED">Planned</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Recurring — only for new tasks */}
            {!editingTask && (
              <div className="space-y-2">
                <Label>Repeat</Label>
                <Select value={form.recurring} onValueChange={(v) => setForm({ ...form, recurring: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No repeat (one-time)</SelectItem>
                    <SelectItem value="daily">Daily (every day for 4 weeks)</SelectItem>
                    <SelectItem value="weekdays">Weekdays (Mon-Fri for 4 weeks)</SelectItem>
                    <SelectItem value="weekly">Weekly (same day for 4 weeks)</SelectItem>
                    <SelectItem value="monthly">Monthly (same date)</SelectItem>
                    <SelectItem value="custom">Custom days</SelectItem>
                  </SelectContent>
                </Select>
                {form.recurring === "custom" && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const days = form.recurringDays.includes(i)
                            ? form.recurringDays.filter((d) => d !== i)
                            : [...form.recurringDays, i];
                          setForm({ ...form, recurringDays: days });
                        }}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          form.recurringDays.includes(i)
                            ? "bg-[#d4ff2e] text-[#0a0a0a]"
                            : "bg-surface-2 text-muted hover:text-foreground"
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                )}
                {form.recurring !== "none" && (
                  <div className="space-y-2 mt-2">
                    <Label>Duration</Label>
                    <Select value={form.recurringDuration} onValueChange={(v) => setForm({ ...form, recurringDuration: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1month">1 Month</SelectItem>
                        <SelectItem value="3months">3 Months</SelectItem>
                        <SelectItem value="6months">6 Months</SelectItem>
                        <SelectItem value="1year">1 Year</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted">
                      {(() => {
                        const count = getRecurringDates(form.date, form.recurring, form.recurringDays, form.recurringDuration).length;
                        return `${count} tasks will be created starting from the selected date.`;
                      })()}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Add notes or details about this task..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <div className="flex items-center justify-between w-full">
              {editingTask && (
                <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => confirmDelete(editingTask)}>
                  <Trash2 size={14} className="mr-1" /> Delete
                </Button>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving || !form.title.trim()}>
                  {saving ? "Saving..." : editingTask ? "Update" : "Add Task"}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Incomplete Reason Dialog */}
      <Dialog open={showReasonDialog} onOpenChange={setShowReasonDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Why was this task not completed?</DialogTitle></DialogHeader>
          <div className="py-4">
            <Textarea value={incompleteReason} onChange={(e) => setIncompleteReason(e.target.value)} placeholder="Explain why this task was not completed..." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReasonDialog(false)}>Cancel</Button>
            <Button onClick={handleSubmitReason} disabled={!incompleteReason.trim()}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => { setShowDeleteDialog(open); if (!open) setDeleteTaskTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete Task</DialogTitle></DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm">
              Delete <strong>&quot;{deleteTaskTarget?.title}&quot;</strong>?
            </p>
            {deleteTaskTarget?.recurringGroupId && (
              <p className="text-xs text-muted">
                This is a recurring task. You can delete just this one or all future occurrences.
              </p>
            )}
          </div>
          <DialogFooter>
            <div className="flex items-center justify-between w-full">
              <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
              <div className="flex items-center gap-2">
                {(deleteTaskTarget?.recurringGroupId || tasks.filter((t) => t.title === deleteTaskTarget?.title).length > 1) && (
                  <Button variant="destructive" onClick={() => handleDelete(true)}>
                    Delete All Future
                  </Button>
                )}
                <Button variant="outline" className="text-red-400 border-red-400/30 hover:bg-red-500/10" onClick={() => handleDelete(false)}>
                  Delete This Only
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

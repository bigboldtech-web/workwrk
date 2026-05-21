"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, CheckCircle2, Circle } from "lucide-react";
import type { Task, TeamMember } from "./types";
import { formatISODate } from "./types";
import { LabelPicker } from "./label-picker";
import { NotesThread } from "./notes-thread";
import { useToast } from "@/components/ui/toast";
import { CustomFieldsPanel } from "@/components/custom-fields/custom-fields-panel";

const CATEGORIES = ["Development", "Meetings", "Admin", "Planning", "Review", "Communication", "Research", "Other"];

export interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;                 // null = new task
  teamMembers: TeamMember[];
  currentUserId: string;
  isManager: boolean;
  prefillDate?: string;              // YYYY-MM-DD
  prefillTime?: string;              // HH:MM (triggers timed mode)
  onSaved: () => void;
  onRequestDelete: (task: Task) => void;
}

/** Recurring-date generator — copied from the legacy page so the new
 *  dialog keeps the existing batch-create behavior for "repeat daily /
 *  weekly / custom" flows. */
function getRecurringDates(startDate: string, recurring: string, recurringDays: number[], duration: string): string[] {
  if (recurring === "none") return [startDate];
  const durationDays: Record<string, number> = { "1month": 30, "3months": 90, "6months": 180, "1year": 365 };
  const totalDays = durationDays[duration] || 30;
  const start = new Date(startDate);
  const dates: string[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dow = d.getDay();
    if (recurring === "daily") dates.push(formatISODate(d));
    else if (recurring === "weekdays" && dow >= 1 && dow <= 5) dates.push(formatISODate(d));
    else if (recurring === "weekly" && dow === start.getDay()) dates.push(formatISODate(d));
    else if (recurring === "monthly" && d.getDate() === start.getDate()) dates.push(formatISODate(d));
    else if (recurring === "custom" && recurringDays.includes(dow)) dates.push(formatISODate(d));
  }
  return dates.length > 0 ? dates : [startDate];
}

export function TaskDialog({
  open, onOpenChange, task, teamMembers, currentUserId, isManager,
  prefillDate, prefillTime, onSaved, onRequestDelete,
}: TaskDialogProps) {
  const editing = task !== null;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(prefillDate || formatISODate(new Date()));
  const [endDate, setEndDate] = useState("");        // empty = single day
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [estimateHours, setEstimateHours] = useState("");
  const [hoursSpent, setHoursSpent] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<Task["status"]>("PLANNED");
  const [assigneeId, setAssigneeId] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [recurring, setRecurring] = useState("none");
  const [recurringDays, setRecurringDays] = useState<number[]>([]);
  const [recurringDuration, setRecurringDuration] = useState("1month");
  const [subTasks, setSubTasks] = useState<Task[]>([]);
  const [newSubTaskTitle, setNewSubTaskTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const { error: toastError } = useToast();

  // Populate from `task` when editing, or reset on new task.
  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title);
      setDescription(task.description || "");
      setDate(task.date.split("T")[0]);
      setEndDate(task.endAt ? task.endAt.split("T")[0] : "");
      setAllDay(task.allDay !== false);
      if (task.startAt) {
        const s = new Date(task.startAt);
        setStartTime(`${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`);
      }
      if (task.endAt) {
        const e = new Date(task.endAt);
        setEndTime(`${String(e.getHours()).padStart(2, "0")}:${String(e.getMinutes()).padStart(2, "0")}`);
      }
      setEstimateHours(task.estimateHours != null ? String(task.estimateHours) : "");
      setHoursSpent(task.hoursSpent != null ? String(task.hoursSpent) : "");
      setCategory(task.category || "");
      setStatus(task.status);
      setAssigneeId(task.assignee?.id || "");
      setLabelIds((task.labels || []).map((l) => l.labelId));
      setRecurring("none"); setRecurringDays([]); setRecurringDuration("1month");
    } else {
      setTitle(""); setDescription("");
      setDate(prefillDate || formatISODate(new Date()));
      setEndDate("");
      setAllDay(!prefillTime);
      setStartTime(prefillTime || "09:00");
      setEndTime(prefillTime ? addMinutesToHHMM(prefillTime, 30) : "10:00");
      setEstimateHours(""); setHoursSpent("");
      setCategory(""); setStatus("PLANNED"); setAssigneeId("");
      setLabelIds([]);
      setRecurring("none"); setRecurringDays([]); setRecurringDuration("1month");
    }
  }, [open, task, prefillDate, prefillTime]);

  // Load sub-tasks for existing parent tasks.
  useEffect(() => {
    if (!open || !task || task.parentTaskId) { setSubTasks([]); return; }
    fetch(`/api/tasks?userIds=${task.assignee?.id || ""}&startDate=&endDate=`)
      .catch(() => {});
    // Lighter: use a filter endpoint via the existing GET — but since we
    // don't have a "by parent" filter yet, piggyback on the task list's
    // labels-returning response by doing a targeted fetch of this one
    // task with include=subTasks would be cleaner; for now we refetch
    // the same day and pluck matches.
    fetch(`/api/tasks?startDate=${task.date.split("T")[0]}&endDate=${task.endAt?.split("T")[0] || task.date.split("T")[0]}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: Task[] = Array.isArray(d) ? d : d?.data || [];
        setSubTasks(list.filter((t) => t.parentTaskId === task.id));
      })
      .catch(() => {});
  }, [open, task]);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const payload: any = {
        title,
        description: description || null,
        date,
        allDay,
        estimateHours: estimateHours ? Number(estimateHours) : null,
        hoursSpent: hoursSpent ? Number(hoursSpent) : null,
        category: category || null,
        status,
        labelIds,
        ...(assigneeId ? { assigneeId } : {}),
      };

      // Timed: merge date + HH:MM into ISO; otherwise leave startAt/endAt null.
      if (!allDay) {
        payload.startAt = new Date(`${date}T${startTime}:00`).toISOString();
        const endD = endDate || date;
        payload.endAt = new Date(`${endD}T${endTime}:00`).toISOString();
      } else if (endDate && endDate !== date) {
        // All-day multi-day span.
        payload.startAt = new Date(`${date}T00:00:00`).toISOString();
        payload.endAt = new Date(`${endDate}T23:59:59`).toISOString();
      } else {
        payload.startAt = null;
        payload.endAt = null;
      }

      const reportFailure = async (res: Response) => {
        const err = await res.json().catch(() => ({}));
        toastError(err?.error || `Failed to save task (HTTP ${res.status})`);
      };

      if (editing && task) {
        const res = await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: task.id, ...payload }),
        });
        if (res.ok) { onSaved(); onOpenChange(false); }
        else await reportFailure(res);
      } else {
        const dates = getRecurringDates(date, recurring, recurringDays, recurringDuration);
        if (dates.length === 1) {
          const res = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (res.ok) { onSaved(); onOpenChange(false); }
          else await reportFailure(res);
        } else {
          // Batch create — recurring tasks are all-day single-day copies.
          const batch = dates.map((d) => ({
            ...payload,
            date: d,
            startAt: null,
            endAt: null,
            allDay: true,
          }));
          const res = await fetch("/api/tasks/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tasks: batch }),
          });
          if (res.ok) { onSaved(); onOpenChange(false); }
          else await reportFailure(res);
        }
      }
    } catch (err: any) {
      toastError(err?.message || "Failed to save task");
    } finally { setSaving(false); }
  }

  async function addSubTask() {
    const t = newSubTaskTitle.trim();
    if (!t || !task) return;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t,
          date: task.date.split("T")[0],
          parentTaskId: task.id,
          assigneeId: task.assignee?.id,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setSubTasks((prev) => [...prev, created.data ?? created]);
        setNewSubTaskTitle("");
      }
    } catch {}
  }

  async function toggleSubTask(st: Task) {
    const next = st.status === "COMPLETED" ? "PLANNED" : "COMPLETED";
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: st.id, status: next }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSubTasks((prev) => prev.map((x) => (x.id === st.id ? (updated.data ?? updated) : x)));
      }
    } catch {}
  }

  async function removeSubTask(st: Task) {
    try {
      const res = await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: st.id }),
      });
      if (res.ok) setSubTasks((prev) => prev.filter((x) => x.id !== st.id));
    } catch {}
  }

  const showSubTasks = editing && task && !task.parentTaskId;
  const isGcal = editing && task?.externalSource === "GCAL";

  async function saveStatusOnly(next: Task["status"]) {
    if (!task) return;
    setSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, status: next }),
      });
      if (res.ok) { onSaved(); onOpenChange(false); }
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isGcal ? "Google Calendar event" : editing ? "Edit Task" : "Add Task"}
          </DialogTitle>
        </DialogHeader>

        {isGcal && (
          <div className="rounded-md border border-[rgba(74,158,255,0.35)] bg-[rgba(74,158,255,0.08)] px-3 py-2 text-xs text-[#4a9eff]">
            This is a Google Calendar event. Title, time and description are synced from Google and read-only here —
            edit them on Google and they'll update on next sync. You can still mark it done and leave notes.
          </div>
        )}

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Title <span className="text-red-400">*</span></Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task name" disabled={isGcal} />
          </div>

          {isManager && teamMembers.length > 1 && !isGcal && (
            <div className="space-y-2">
              <Label>Assign to</Label>
              <Select value={assigneeId || "self"} onValueChange={(v) => setAssigneeId(v === "self" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Myself</SelectItem>
                  {teamMembers.filter((m) => m.id !== currentUserId).map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.firstName} {m.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Scheduling */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Schedule</Label>
              <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                  className="accent-[#a8cc24]"
                  disabled={isGcal}
                />
                All-day
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-muted">Start date</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={isGcal} />
              </div>
              <div>
                <label className="text-[10px] text-muted">End date (optional)</label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={date} disabled={isGcal} />
              </div>
              {!allDay && (
                <>
                  <div>
                    <label className="text-[10px] text-muted">Start time</label>
                    <Input type="time" step="1800" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={isGcal} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted">End time</label>
                    <Input type="time" step="1800" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={isGcal} />
                  </div>
                </>
              )}
            </div>
          </div>

          {!isGcal && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Estimate (hours)</Label>
                <Input
                  type="number" step="0.5" min="0" max="100"
                  placeholder="e.g. 3"
                  value={estimateHours}
                  onChange={(e) => setEstimateHours(e.target.value)}
                />
                <p className="text-[10px] text-muted">Given time to finish. Shown on the manager&apos;s Gantt.</p>
              </div>
              <div className="space-y-2">
                <Label>Time spent</Label>
                <Input
                  type="number" step="0.5" min="0" max="100"
                  placeholder="e.g. 2.5"
                  value={hoursSpent}
                  onChange={(e) => setHoursSpent(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {!isGcal && (
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category || "none"} onValueChange={(v) => setCategory(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={isGcal ? "col-span-2 space-y-2" : "space-y-2"}>
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Task["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLANNED">Planned</SelectItem>
                  <SelectItem value="IN_PROGRESS">In progress</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isGcal && (
            <div className="space-y-2">
              <Label>Labels</Label>
              <LabelPicker selectedIds={labelIds} onChange={setLabelIds} />
            </div>
          )}

          {/* Recurring (new tasks only) */}
          {!editing && (
            <div className="space-y-2">
              <Label>Repeat</Label>
              <Select value={recurring} onValueChange={setRecurring}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No repeat</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekdays">Weekdays (Mon–Fri)</SelectItem>
                  <SelectItem value="weekly">Weekly (same day)</SelectItem>
                  <SelectItem value="monthly">Monthly (same date)</SelectItem>
                  <SelectItem value="custom">Custom days</SelectItem>
                </SelectContent>
              </Select>
              {recurring === "custom" && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => {
                    const on = recurringDays.includes(i);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setRecurringDays((prev) => on ? prev.filter((x) => x !== i) : [...prev, i])}
                        className={`px-2.5 py-1 rounded-full text-xs ${on ? "bg-[#a8cc24] text-[#0a0a0a]" : "bg-surface-2 text-muted hover:text-foreground"}`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              )}
              {recurring !== "none" && (
                <div className="mt-1">
                  <Select value={recurringDuration} onValueChange={setRecurringDuration}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1month">1 month</SelectItem>
                      <SelectItem value="3months">3 months</SelectItem>
                      <SelectItem value="6months">6 months</SelectItem>
                      <SelectItem value="1year">1 year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What's this task about?"
              disabled={isGcal}
            />
          </div>

          {/* Sub-tasks */}
          {showSubTasks && !isGcal && (
            <div className="space-y-2">
              <Label>Sub-tasks <span className="text-[10px] text-muted font-normal">(one level)</span></Label>
              <div className="space-y-1">
                {subTasks.map((st) => (
                  <div key={st.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                    <button type="button" onClick={() => toggleSubTask(st)} aria-label="Toggle sub-task">
                      {st.status === "COMPLETED"
                        ? <CheckCircle2 size={14} className="text-[#d4ff2e]" />
                        : <Circle size={14} className="text-muted" />}
                    </button>
                    <span className={`flex-1 text-xs ${st.status === "COMPLETED" ? "line-through text-muted" : ""}`}>
                      {st.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSubTask(st)}
                      className="text-muted hover:text-red-400"
                      aria-label="Delete sub-task"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <Input
                    value={newSubTaskTitle}
                    onChange={(e) => setNewSubTaskTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubTask(); } }}
                    placeholder="Add sub-task…"
                    className="h-8 text-xs"
                  />
                  <Button type="button" size="sm" onClick={addSubTask} disabled={!newSubTaskTitle.trim()}>
                    <Plus size={12} />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Notes thread — existing tasks only */}
          {editing && task && (
            <div className="space-y-2">
              <Label>Notes</Label>
              <NotesThread taskId={task.id} />
            </div>
          )}

          {/* Custom fields — only when the org has defined any for TASK */}
          {editing && task && (
            <div className="space-y-2">
              <CustomFieldsPanel entityType="TASK" entityId={task.id} />
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex items-center justify-between w-full">
            {editing && task && !isGcal && (
              <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => onRequestDelete(task)}>
                <Trash2 size={14} className="mr-1" /> Delete
              </Button>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              {isGcal ? (
                <Button onClick={() => saveStatusOnly(status)} disabled={saving}>
                  {saving ? "Saving…" : "Save status"}
                </Button>
              ) : (
                <Button onClick={handleSave} disabled={saving || !title.trim()}>
                  {saving ? "Saving…" : editing ? "Update" : "Add task"}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function addMinutesToHHMM(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

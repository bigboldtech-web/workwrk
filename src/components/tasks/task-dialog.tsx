"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Trash2, Plus, CheckCircle2, Circle, ArrowDownRight, X,
  ListChecks, CircleDot, Wand2, User, Calendar, Flag, Tag,
  MoreHorizontal, LayoutTemplate, Paperclip, Bell, ChevronDown, Ban
} from "lucide-react";
import type { Task, TeamMember } from "./types";
import { formatISODate } from "./types";
import { LabelPicker } from "./label-picker";
import { NotesThread } from "./notes-thread";
import { useToast } from "@/components/ui/toast";
import { CustomFieldsPanel } from "@/components/custom-fields/custom-fields-panel";

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
  open, onOpenChange, task, teamMembers, currentUserId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isManager, prefillDate, prefillTime, onSaved, onRequestDelete,
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
  const [priority, setPriority] = useState<Task["priority"]>();
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
      setPriority(task.priority);
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
      setPriority(undefined);
      setLabelIds([]);
      setRecurring("none"); setRecurringDays([]); setRecurringDuration("1month");
    }
  }, [open, task, prefillDate, prefillTime]);

  // Load sub-tasks for existing parent tasks.
  useEffect(() => {
    if (!open || !task || task.parentTaskId) { setSubTasks([]); return; }
    fetch(`/api/tasks?userIds=${task.assignee?.id || ""}&startDate=&endDate=`)
      .catch(() => {});
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = {
        title,
        description: description || null,
        date,
        allDay,
        estimateHours: estimateHours ? Number(estimateHours) : null,
        hoursSpent: hoursSpent ? Number(hoursSpent) : null,
        category: category || null,
        priority: priority || null,
        status,
        labelIds,
        ...(assigneeId ? { assigneeId } : {}),
      };

      if (!allDay) {
        payload.startAt = new Date(`${date}T${startTime}:00`).toISOString();
        const endD = endDate || date;
        payload.endAt = new Date(`${endD}T${endTime}:00`).toISOString();
      } else if (endDate && endDate !== date) {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      <DialogContent className="max-w-[750px] p-0 border-0 rounded-[16px] bg-surface shadow-2xl overflow-hidden [&>button:last-child]:hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface/50">
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-1.5 text-xs font-medium text-red-500 bg-red-500/10 px-2.5 py-1.5 rounded-md hover:bg-red-500/20 transition-colors border border-red-500/20">
              <ListChecks size={14} />
              Select List...
              <ChevronDown size={12} className="ml-0.5 opacity-70" />
            </button>
            <button className="flex items-center gap-1.5 text-xs font-medium text-foreground bg-surface-2 px-2.5 py-1.5 rounded-md hover:bg-surface-3 transition-colors border border-border/50">
              <CircleDot size={14} className="text-muted-foreground" />
              Task
              <ChevronDown size={12} className="ml-0.5 opacity-70" />
            </button>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <button onClick={() => onOpenChange(false)} className="p-1.5 hover:bg-surface-2 hover:text-foreground rounded-md transition-colors" aria-label="Minimize">
              <ArrowDownRight size={16} />
            </button>
            <button onClick={() => onOpenChange(false)} className="p-1.5 hover:bg-surface-2 hover:text-foreground rounded-md transition-colors" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          <input
            type="text"
            className="w-full text-[28px] font-semibold bg-transparent border-none outline-none placeholder:text-muted-foreground/40 text-foreground"
            placeholder="Task Name or type '/' for commands"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isGcal}
            autoFocus
          />

          <div className="relative group">
            <textarea
              className="w-full min-h-[120px] text-[15px] bg-surface-2/30 border border-transparent hover:border-border/50 focus:border-border focus:bg-surface-2/50 rounded-xl outline-none placeholder:text-muted-foreground p-4 transition-all resize-none"
              placeholder="Add description, or write with AI"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isGcal}
            />
            {!description && (
              <div className="absolute left-[200px] top-[17px] pointer-events-none text-muted-foreground flex items-center gap-1.5">
                <Wand2 size={14} className="opacity-70" />
                <span className="text-[15px]">AI</span>
              </div>
            )}
          </div>

          {/* Action Pills */}
          <div className="flex flex-wrap items-center gap-2.5 pt-2">
            {/* Status Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 hover:bg-surface-3 border border-transparent hover:border-border rounded-md text-xs font-semibold text-foreground transition-all uppercase tracking-wide shadow-sm">
                  {status === "COMPLETED" ? <CheckCircle2 size={14} className="text-[#a8cc24]" /> : <Circle size={14} className="text-muted-foreground" />}
                  {status === "PLANNED" ? "TO DO" : status === "IN_PROGRESS" ? "IN PROGRESS" : "COMPLETE"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[200px]">
                <DropdownMenuLabel>Statuses</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setStatus("PLANNED")}>
                  <Circle size={14} className="text-muted-foreground" />
                  <span>TO DO</span>
                  {status === "PLANNED" && <CheckCircle2 size={14} className="ml-auto" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatus("IN_PROGRESS")}>
                  <CircleDot size={14} className="text-blue-500" />
                  <span>IN PROGRESS</span>
                  {status === "IN_PROGRESS" && <CheckCircle2 size={14} className="ml-auto" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatus("COMPLETED")}>
                  <CheckCircle2 size={14} className="text-[#a8cc24]" />
                  <span>COMPLETE</span>
                  {status === "COMPLETED" && <CheckCircle2 size={14} className="ml-auto" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Assignee Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-transparent hover:bg-surface-2 border border-border rounded-md text-xs font-medium text-foreground transition-all shadow-sm">
                  {assigneeId && assigneeId !== "self" ? (
                    <div className="flex -space-x-1">
                       <span className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-[10px] text-white">
                         {teamMembers.find(m => m.id === assigneeId)?.firstName[0]}
                       </span>
                    </div>
                  ) : assigneeId === "self" ? (
                    <div className="flex -space-x-1">
                       <span className="w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center text-[10px] text-white">M</span>
                    </div>
                  ) : (
                    <User size={14} className="text-muted-foreground" />
                  )}
                  Assignee
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[220px]">
                <div className="p-2">
                  <Input placeholder="Search or enter email..." className="h-8 text-xs bg-surface-2 border-transparent" />
                </div>
                <DropdownMenuLabel>People</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setAssigneeId("self")}>
                  <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center text-[11px] text-white">M</div>
                  <span>Me</span>
                </DropdownMenuItem>
                {teamMembers.filter((m) => m.id !== currentUserId).map((m) => (
                  <DropdownMenuItem key={m.id} onClick={() => setAssigneeId(m.id)}>
                    <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-[11px] text-white">
                      {m.firstName[0]}{m.lastName[0]}
                    </div>
                    <span>{m.firstName} {m.lastName}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Due Date Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-transparent hover:bg-surface-2 border border-border rounded-md text-xs font-medium text-foreground transition-all shadow-sm">
                  <Calendar size={14} className="text-muted-foreground" />
                  {date !== formatISODate(new Date()) ? date : "Due date"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[280px] p-4">
                 <div className="grid grid-cols-2 gap-4 mb-4">
                   <div>
                     <label className="text-[11px] text-muted-foreground mb-1.5 block">Start date</label>
                     <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm bg-surface-2 border border-transparent hover:border-border rounded-md px-2 py-1.5 outline-none w-full transition-colors" />
                   </div>
                   <div>
                     <label className="text-[11px] text-muted-foreground mb-1.5 block">Due date</label>
                     <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={date} className="text-sm bg-surface-2 border border-transparent hover:border-border rounded-md px-2 py-1.5 outline-none w-full transition-colors" />
                   </div>
                 </div>
                 <div className="flex items-center justify-between border-t border-border pt-3">
                    <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                      <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-[#a8cc24] w-4 h-4 rounded" />
                      All-day
                    </label>
                 </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Priority Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={`flex items-center gap-2 px-3 py-1.5 border rounded-md text-xs font-medium transition-all shadow-sm ${priority ? 'bg-surface-2 border-border/50 text-foreground' : 'bg-transparent hover:bg-surface-2 border-border text-foreground'}`}>
                  <Flag size={14} className={priority === 'URGENT' ? 'text-red-500' : priority === 'HIGH' ? 'text-yellow-500' : priority === 'NORMAL' ? 'text-blue-500' : 'text-muted-foreground'} />
                  {priority === 'URGENT' ? 'Urgent' : priority === 'HIGH' ? 'High' : priority === 'NORMAL' ? 'Normal' : priority === 'LOW' ? 'Low' : 'Priority'}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[180px]">
                <DropdownMenuLabel>Priority</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setPriority("URGENT")}>
                  <Flag size={14} className="text-red-500" />
                  <span>Urgent</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPriority("HIGH")}>
                  <Flag size={14} className="text-yellow-500" />
                  <span>High</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPriority("NORMAL")}>
                  <Flag size={14} className="text-blue-500" />
                  <span>Normal</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPriority("LOW")}>
                  <Flag size={14} className="text-muted-foreground" />
                  <span>Low</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setPriority(undefined)}>
                  <Ban size={14} className="text-muted-foreground" />
                  <span>Clear</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Tags Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-1.5 bg-transparent hover:bg-surface-2 border border-border rounded-md text-xs font-medium text-foreground transition-all shadow-sm">
                  <Tag size={14} className="text-muted-foreground" />
                  Tags
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[200px] p-2">
                 <LabelPicker selectedIds={labelIds} onChange={setLabelIds} />
              </DropdownMenuContent>
            </DropdownMenu>

            {/* More options button */}
            <button className="flex items-center justify-center px-2 py-1.5 bg-transparent hover:bg-surface-2 border border-border rounded-md transition-all text-muted-foreground hover:text-foreground shadow-sm">
              <MoreHorizontal size={14} />
            </button>
          </div>

          {/* Subtasks and Notes - Only show when editing to keep UI clean during creation */}
          {editing && (
            <div className="pt-6 border-t border-border/40 space-y-6">
              {showSubTasks && !isGcal && (
                <div className="space-y-3">
                  <span className="text-xs font-semibold uppercase text-muted-foreground tracking-widest">Sub-tasks</span>
                  <div className="space-y-2">
                    {subTasks.map((st) => (
                      <div key={st.id} className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface-2/40 px-3 py-2.5 transition-colors hover:bg-surface-2/80 group">
                        <button type="button" onClick={() => toggleSubTask(st)} aria-label="Toggle sub-task">
                          {st.status === "COMPLETED" ? <CheckCircle2 size={16} className="text-[#a8cc24]" /> : <Circle size={16} className="text-muted-foreground" />}
                        </button>
                        <span className={`flex-1 text-sm ${st.status === "COMPLETED" ? "line-through text-muted-foreground" : "text-foreground font-medium"}`}>
                          {st.title}
                        </span>
                        <button type="button" onClick={() => removeSubTask(st)} className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 mt-3">
                      <Input
                        value={newSubTaskTitle}
                        onChange={(e) => setNewSubTaskTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubTask(); } }}
                        placeholder="Add sub-task…"
                        className="h-9 text-sm bg-surface-2/40 border-transparent focus-visible:ring-1"
                      />
                      <Button type="button" size="sm" variant="secondary" onClick={addSubTask} disabled={!newSubTaskTitle.trim()} className="h-9">
                        <Plus size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {task && (
                <div className="space-y-3">
                   <span className="text-xs font-semibold uppercase text-muted-foreground tracking-widest">Notes</span>
                   <NotesThread taskId={task.id} />
                </div>
              )}
              {task && (
                <div className="space-y-3">
                  <span className="text-xs font-semibold uppercase text-muted-foreground tracking-widest">Custom Fields</span>
                  <CustomFieldsPanel entityType="TASK" entityId={task.id} />
                </div>
              )}
              {editing && task && !isGcal && (
                <div className="pt-2">
                  <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-500/10 border-red-500/20" onClick={() => onRequestDelete(task)}>
                    <Trash2 size={14} className="mr-2" /> Delete Task
                  </Button>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 bg-surface-2/30 border-t border-border mt-2">
          <div className="flex items-center gap-2">
             <button className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-surface-2 rounded-lg border border-border transition-colors shadow-sm bg-surface">
               <LayoutTemplate size={14} className="text-muted-foreground" />
               Templates
             </button>
          </div>
          <div className="flex items-center gap-4">
             <button className="text-muted-foreground hover:text-foreground transition-colors p-1" aria-label="Attach file">
               <Paperclip size={18} />
             </button>
             <button className="text-muted-foreground hover:text-foreground transition-colors p-1 flex items-center" aria-label="Notifications">
               <Bell size={18} />
               <span className="ml-1 text-xs font-medium">1</span>
             </button>
             <div className="flex items-center shadow-md rounded-lg overflow-hidden ml-2">
               <Button onClick={handleSave} disabled={saving || !title.trim()} className="bg-[#a37965] hover:bg-[#8f6a58] text-white rounded-none h-9 px-4 font-medium">
                 {saving ? "Saving…" : editing ? "Update Task" : "Create Task"}
               </Button>
               <div className="w-[1px] h-9 bg-white/20"></div>
               <Button className="bg-[#a37965] hover:bg-[#8f6a58] text-white rounded-none h-9 px-2.5">
                 <ChevronDown size={16} />
               </Button>
             </div>
          </div>
        </div>
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

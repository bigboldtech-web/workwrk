"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  Clock,
  Target,
  Check,
  Play,
  User,
} from "lucide-react";

interface Task {
  id: string;
  title: string;
  description: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  assignee: { id: string; firstName: string; lastName: string; avatar: string | null };
  kra: { id: string; name: string } | null;
}

interface KRA {
  id: string;
  name: string;
}

interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_COLORS: Record<string, string> = {
  PLANNED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  IN_PROGRESS: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  COMPLETED: "bg-green-500/10 text-green-400 border-green-500/20",
};

function getWeekDates(date: Date): Date[] {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [kras, setKras] = useState<KRA[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [selectedUser, setSelectedUser] = useState<string>("me");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    date: "",
    startTime: "",
    endTime: "",
    kraId: "",
    assigneeId: "",
  });

  const weekDates = getWeekDates(currentWeek);
  const weekStart = formatDate(weekDates[0]);
  const weekEnd = formatDate(weekDates[6]);

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams({ startDate: weekStart, endDate: weekEnd });
    if (selectedUser && selectedUser !== "all") {
      if (selectedUser !== "me") params.set("userId", selectedUser);
    }
    const res = await fetch(`/api/tasks?${params}`);
    if (res.ok) {
      const json = await res.json();
      setTasks(json.data || json || []);
    }
    setLoading(false);
  }, [weekStart, weekEnd, selectedUser]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    fetch("/api/kras").then((r) => r.json()).then((d) => setKras(Array.isArray(d) ? d : d.data || [])).catch(() => {});
    fetch("/api/users?limit=200").then((r) => r.json()).then((d) => {
      const users = d.data || d || [];
      setTeam(Array.isArray(users) ? users : []);
    }).catch(() => {});
  }, []);

  function prevWeek() {
    const d = new Date(currentWeek);
    d.setDate(d.getDate() - 7);
    setCurrentWeek(d);
  }

  function nextWeek() {
    const d = new Date(currentWeek);
    d.setDate(d.getDate() + 7);
    setCurrentWeek(d);
  }

  function goToday() {
    setCurrentWeek(new Date());
  }

  function openAddForDate(dateStr: string) {
    setSelectedDate(dateStr);
    setNewTask({ title: "", description: "", date: dateStr, startTime: "", endTime: "", kraId: "", assigneeId: "" });
    setShowAddDialog(true);
  }

  async function createTask() {
    if (!newTask.title.trim() || !newTask.date) return;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newTask,
        kraId: newTask.kraId || undefined,
        assigneeId: newTask.assigneeId || undefined,
      }),
    });
    if (res.ok) {
      setShowAddDialog(false);
      fetchTasks();
    }
  }

  async function updateTaskStatus(taskId: string, status: string) {
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId, status }),
    });
    fetchTasks();
  }

  async function deleteTask(taskId: string) {
    await fetch("/api/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId }),
    });
    fetchTasks();
  }

  function getTasksForDate(dateStr: string): Task[] {
    return tasks.filter((t) => t.date.startsWith(dateStr));
  }

  const today = formatDate(new Date());
  const monthYear = weekDates[3].toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Work Calendar</h1>
          <p className="text-muted">Plan and track daily work activities</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedUser} onValueChange={setSelectedUser}>
            <SelectTrigger className="w-[180px]">
              <User size={14} className="text-muted" />
              <SelectValue placeholder="View" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="me">My Calendar</SelectItem>
              <SelectItem value="all">All Team</SelectItem>
              {team.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.firstName} {m.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => openAddForDate(today)}>
            <Plus size={16} className="mr-2" /> Add Task
          </Button>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Task</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input
                    placeholder="What are you working on?"
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    placeholder="Details (optional)"
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={newTask.date}
                      onChange={(e) => setNewTask({ ...newTask, date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Start Time</Label>
                    <Input
                      type="time"
                      value={newTask.startTime}
                      onChange={(e) => setNewTask({ ...newTask, startTime: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Time</Label>
                    <Input
                      type="time"
                      value={newTask.endTime}
                      onChange={(e) => setNewTask({ ...newTask, endTime: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Link to KRA</Label>
                  <Select value={newTask.kraId} onValueChange={(v) => setNewTask({ ...newTask, kraId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="None (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {kras.map((k) => (
                        <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {team.length > 0 && (
                  <div className="space-y-2">
                    <Label>Assign to</Label>
                    <Select value={newTask.assigneeId} onValueChange={(v) => setNewTask({ ...newTask, assigneeId: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Myself" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Myself</SelectItem>
                        {team.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.firstName} {m.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button onClick={createTask} className="w-full" disabled={!newTask.title.trim() || !newTask.date}>
                  Add Task
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Week Navigation */}
      <Card className="border-border bg-surface">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={prevWeek}>
                <ChevronLeft size={16} />
              </Button>
              <h2 className="text-lg font-semibold">{monthYear}</h2>
              <Button variant="outline" size="sm" onClick={nextWeek}>
                <ChevronRight size={16} />
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={goToday}>
              Today
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-3">
            {weekDates.map((date, i) => {
              const dateStr = formatDate(date);
              const isToday = dateStr === today;
              const dayTasks = getTasksForDate(dateStr);

              return (
                <div
                  key={dateStr}
                  className={`min-h-[200px] rounded-lg border p-3 transition-colors ${
                    isToday
                      ? "border-purple-500/40 bg-purple-500/5"
                      : "border-border bg-background hover:border-muted-2"
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <span className="text-xs text-muted">{DAYS[i]}</span>
                      <p className={`text-lg font-semibold ${isToday ? "text-purple-400" : ""}`}>
                        {date.getDate()}
                      </p>
                    </div>
                    <button
                      onClick={() => openAddForDate(dateStr)}
                      className="rounded-md p-1 text-muted-2 hover:bg-surface-2 hover:text-foreground"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {dayTasks.map((task) => (
                      <div
                        key={task.id}
                        className={`group relative rounded-md border p-2 text-xs ${STATUS_COLORS[task.status]}`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="font-medium leading-tight">{task.title}</span>
                          <div className="hidden shrink-0 gap-0.5 group-hover:flex">
                            {task.status === "PLANNED" && (
                              <button
                                onClick={() => updateTaskStatus(task.id, "IN_PROGRESS")}
                                className="rounded p-0.5 hover:bg-white/10"
                                title="Start"
                              >
                                <Play size={10} />
                              </button>
                            )}
                            {task.status === "IN_PROGRESS" && (
                              <button
                                onClick={() => updateTaskStatus(task.id, "COMPLETED")}
                                className="rounded p-0.5 hover:bg-white/10"
                                title="Complete"
                              >
                                <Check size={10} />
                              </button>
                            )}
                          </div>
                        </div>
                        {task.startTime && (
                          <span className="mt-0.5 flex items-center gap-1 opacity-70">
                            <Clock size={8} />
                            {task.startTime}{task.endTime ? `–${task.endTime}` : ""}
                          </span>
                        )}
                        {task.kra && (
                          <span className="mt-0.5 flex items-center gap-1 opacity-70">
                            <Target size={8} />
                            {task.kra.name}
                          </span>
                        )}
                        {selectedUser === "all" && (
                          <span className="mt-0.5 opacity-70">
                            {task.assignee.firstName}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

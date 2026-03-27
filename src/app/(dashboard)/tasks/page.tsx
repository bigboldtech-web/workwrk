"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CheckSquare, Plus, Search, Clock, Calendar, User, AlertTriangle,
  ChevronRight, Filter, LayoutList, LayoutGrid, Download,
} from "lucide-react";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";

interface Task {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  progress: number;
  deadline: string;
  completedAt: string | null;
  assignee: { firstName: string; lastName: string } | null;
  creator: { firstName: string; lastName: string } | null;
  tags: { name?: string }[];
  createdAt: string;
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
}

function getPriorityStyle(p: string) {
  switch (p) {
    case "P0": return "bg-red-500/20 text-red-400 border-red-500/30";
    case "P1": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "P2": return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    default: return "bg-slate-500/20 text-slate-400 border-slate-500/30";
  }
}

function getStatusStyle(s: string) {
  switch (s) {
    case "COMPLETED": return "bg-green-500/20 text-green-400";
    case "IN_PROGRESS": return "bg-blue-500/20 text-blue-400";
    case "IN_REVIEW": return "bg-purple-500/20 text-purple-400";
    case "BLOCKED": return "bg-red-500/20 text-red-400";
    default: return "bg-slate-500/20 text-slate-400";
  }
}

function getStatusLabel(s: string) {
  return s.replace(/_/g, " ");
}

function isOverdue(deadline: string, status: string) {
  if (status === "COMPLETED") return false;
  return new Date(deadline) < new Date();
}

function getInitials(assignee: { firstName: string; lastName: string } | null) {
  if (!assignee) return "??";
  return `${assignee.firstName?.[0] ?? ""}${assignee.lastName?.[0] ?? ""}`.toUpperCase();
}

function SkeletonCard() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-4 animate-pulse">
          <div className="mt-1 h-5 w-5 rounded bg-[#2A2A3A] flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-[#2A2A3A] rounded w-2/3" />
            <div className="h-3 bg-[#2A2A3A] rounded w-1/2" />
            <div className="flex gap-2 mt-2">
              <div className="h-4 w-8 bg-[#2A2A3A] rounded" />
              <div className="h-4 w-16 bg-[#2A2A3A] rounded" />
              <div className="h-4 w-20 bg-[#2A2A3A] rounded" />
            </div>
          </div>
          <div className="h-7 w-7 rounded-full bg-[#2A2A3A] flex-shrink-0" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function TasksPage() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") || "my";

  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [creating, setCreating] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // New task form state
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  const [newAssigneeId, setNewAssigneeId] = useState("");

  const { success: toastSuccess, error: toastError } = useToast();

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, priorityFilter, statusFilter]);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ view, page: String(page), limit: String(limit) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/tasks?${params}`);
      if (res.ok) {
        const json = await res.json();
        setTasks(json.data || []);
        setTotal(json.pagination?.total || 0);
        setTotalPages(json.pagination?.totalPages || 0);
      }
    } catch (err) {
      console.error("Failed to fetch tasks:", err);
    } finally {
      setLoading(false);
    }
  }, [view, page, limit, debouncedSearch, priorityFilter, statusFilter]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users?limit=100");
      if (res.ok) {
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : data.data ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch users:", err);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreateTask = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          description: newDescription,
          priority: newPriority || "P2",
          assigneeId: newAssigneeId || undefined,
          deadline: newDeadline || undefined,
        }),
      });
      if (res.ok) {
        setShowAddDialog(false);
        setNewTitle("");
        setNewDescription("");
        setNewPriority("");
        setNewDeadline("");
        setNewAssigneeId("");
        await fetchTasks();
        toastSuccess("Task created successfully");
      }
    } catch (err) {
      toastError("Failed to create task", "Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        await fetchTasks();
        toastSuccess(newStatus === "COMPLETED" ? "Task completed!" : "Task status updated");
      }
    } catch (err) {
      toastError("Failed to update task status");
    }
  };

  const filtered = tasks; // Server-side filtering now

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-[#8888A0] text-sm mt-1">{total} tasks</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => window.open("/api/export/tasks", "_blank")}
          >
            <Download size={16} /> Export
          </Button>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus size={16} /> New Task</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Task</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Title <span className="text-red-400">*</span></Label>
                <Input placeholder="What needs to be done?" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea placeholder="Add details..." value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Priority</Label>
                  <Select value={newPriority} onValueChange={setNewPriority}>
                    <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="P0">P0 - Critical</SelectItem>
                      <SelectItem value="P1">P1 - High</SelectItem>
                      <SelectItem value="P2">P2 - Medium</SelectItem>
                      <SelectItem value="P3">P3 - Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Deadline</Label>
                  <Input type="date" value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Assign To</Label>
                <Select value={newAssigneeId} onValueChange={setNewAssigneeId}>
                  <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button onClick={handleCreateTask} disabled={creating || !newTitle.trim()}>
                {creating ? "Creating..." : "Create Task"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8888A0]" />
          <Input placeholder="Search tasks..." className="pl-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="P0">P0</SelectItem>
            <SelectItem value="P1">P1</SelectItem>
            <SelectItem value="P2">P2</SelectItem>
            <SelectItem value="P3">P3</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="NOT_STARTED">Not Started</SelectItem>
            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
            <SelectItem value="IN_REVIEW">In Review</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="BLOCKED">Blocked</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="All clear!"
            description="No tasks yet. Create one to get started."
            actionLabel="Create Task"
            onAction={() => setShowAddDialog(true)}
          />
        ) : (
          filtered.map((task) => (
            <Card key={task.id} className="hover:border-[#3A3A4A] transition-all cursor-pointer group">
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Checkbox area */}
                  <button
                    onClick={() => {
                      const nextStatus = task.status === "COMPLETED" ? "IN_PROGRESS" : "COMPLETED";
                      handleStatusChange(task.id, nextStatus);
                    }}
                    className={`mt-1 h-5 w-5 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                      task.status === "COMPLETED" ? "border-green-500 bg-green-500" : "border-[#2A2A3A] hover:border-[#8888A0]"
                    }`}
                  >
                    {task.status === "COMPLETED" && <span className="text-white text-xs font-bold">&#10003;</span>}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className={`text-sm font-medium ${task.status === "COMPLETED" ? "line-through text-[#8888A0]" : ""}`}>
                        {task.title}
                      </h3>
                      {isOverdue(task.deadline, task.status) && (
                        <Badge variant="destructive" className="text-[10px] gap-1">
                          <AlertTriangle size={10} /> Overdue
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-[#8888A0] mt-0.5 line-clamp-1">{task.description}</p>

                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${getPriorityStyle(task.priority)}`}>
                        {task.priority}
                      </span>
                      <Badge className={`text-[10px] ${getStatusStyle(task.status)}`}>
                        {getStatusLabel(task.status)}
                      </Badge>
                      {task.deadline && (
                        <span className="text-[10px] text-[#8888A0] flex items-center gap-1">
                          <Calendar size={10} /> {task.deadline.slice(0, 10)}
                        </span>
                      )}
                      {task.tags?.map((tag, i) => (
                        <span key={i} className="text-[10px] text-[#8888A0] bg-[#1A1A26] px-1.5 py-0.5 rounded">
                          {typeof tag === "string" ? tag : tag.name ?? ""}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Assignee */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-[10px]">{getInitials(task.assignee)}</AvatarFallback>
                    </Avatar>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Pagination */}
      {!loading && (
        <PaginationControls
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={(l) => { setLimit(l); setPage(1); }}
        />
      )}
    </div>
  );
}

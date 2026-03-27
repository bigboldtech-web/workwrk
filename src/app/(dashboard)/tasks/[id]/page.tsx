"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  MessageSquare,
  Plus,
  Send,
  ListTodo,
  User,
  Tag,
} from "lucide-react";
import { getInitials, formatDate, formatDateTime, getPriorityColor, getStatusColor } from "@/lib/utils";

interface TaskUser {
  id: string;
  firstName: string;
  lastName: string;
  avatar?: string | null;
}

interface SubTask {
  id: string;
  title: string;
  status: string;
  priority: string;
}

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  author: TaskUser;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  progress: number;
  deadline: string | null;
  completedAt: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  assignee: TaskUser | null;
  creator: TaskUser;
  subTasks: SubTask[];
  comments: Comment[];
}

const STATUSES = ["NOT_STARTED", "IN_PROGRESS", "IN_REVIEW", "COMPLETED", "BLOCKED"] as const;
const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  IN_REVIEW: "In Review",
  COMPLETED: "Completed",
  BLOCKED: "Blocked",
};

const TAG_COLORS = [
  "bg-purple-500/20 text-purple-400",
  "bg-blue-500/20 text-blue-400",
  "bg-green-500/20 text-green-400",
  "bg-orange-500/20 text-orange-400",
  "bg-pink-500/20 text-pink-400",
  "bg-cyan-500/20 text-cyan-400",
];

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);

  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${id}`);
      if (!res.ok) {
        router.push("/tasks");
        return;
      }
      const data = await res.json();
      setTask(data);
      setDescription(data.description || "");
      setComments(data.comments || []);
    } catch {
      router.push("/tasks");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  const fetchComments = async () => {
    try {
      const res = await fetch(`/api/tasks/${id}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data);
      }
    } catch {
      // silent
    }
  };

  const updateTask = async (updates: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const updated = await res.json();
        setTask((prev) => (prev ? { ...prev, ...updated } : prev));
      }
    } catch {
      // silent
    }
  };

  const handleStatusChange = (status: string) => {
    updateTask({ status });
  };

  const handlePriorityChange = (priority: string) => {
    updateTask({ priority });
  };

  const handleDescriptionSave = () => {
    updateTask({ description });
    setEditingDescription(false);
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/tasks/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newComment }),
      });
      if (res.ok) {
        setNewComment("");
        await fetchComments();
      }
    } catch {
      // silent
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) return;
    setAddingSubtask(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newSubtaskTitle, parentId: id }),
      });
      if (res.ok) {
        setNewSubtaskTitle("");
        setShowSubtaskForm(false);
        await fetchTask();
      }
    } catch {
      // silent
    } finally {
      setAddingSubtask(false);
    }
  };

  const toggleSubtaskStatus = async (subtask: SubTask) => {
    const newStatus = subtask.status === "COMPLETED" ? "NOT_STARTED" : "COMPLETED";
    try {
      await fetch(`/api/tasks/${subtask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchTask();
    } catch {
      // silent
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="text-[#8888A0]">Loading task...</div>
      </div>
    );
  }

  if (!task) return null;

  return (
    <div className="min-h-screen bg-[#0A0A0F] p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/tasks"
          className="inline-flex items-center gap-2 text-[#8888A0] hover:text-[#E8E8F0] transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Tasks
        </Link>
        <div className="flex items-start gap-3">
          <h1 className="text-2xl font-bold text-[#E8E8F0] flex-1">{task.title}</h1>
          <Badge className={getPriorityColor(task.priority)}>{task.priority}</Badge>
          <Badge className={getStatusColor(task.status)}>
            {STATUS_LABELS[task.status] || task.status}
          </Badge>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - 2/3 */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <Card className="bg-[#12121A] border-[#2A2A3A]">
            <CardHeader>
              <CardTitle className="text-[#E8E8F0] text-base">Description</CardTitle>
            </CardHeader>
            <CardContent>
              {editingDescription ? (
                <div className="space-y-3">
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Add a description..."
                    rows={4}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleDescriptionSave}>
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-[#2A2A3A] text-[#8888A0]"
                      onClick={() => {
                        setDescription(task.description || "");
                        setEditingDescription(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className="text-[#C0C0D0] cursor-pointer hover:bg-[#1A1A26] rounded-lg p-3 -m-3 transition-colors min-h-[60px]"
                  onClick={() => setEditingDescription(true)}
                >
                  {task.description || (
                    <span className="text-[#8888A0] italic">No description. Click to add one.</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tabs for Subtasks and Comments */}
          <Tabs defaultValue="subtasks" className="w-full">
            <TabsList className="bg-[#12121A] border border-[#2A2A3A]">
              <TabsTrigger value="subtasks" className="data-[state=active]:bg-[#2A2A3A]">
                <ListTodo className="h-4 w-4 mr-2" />
                Subtasks ({task.subTasks.length})
              </TabsTrigger>
              <TabsTrigger value="comments" className="data-[state=active]:bg-[#2A2A3A]">
                <MessageSquare className="h-4 w-4 mr-2" />
                Comments ({comments.length})
              </TabsTrigger>
            </TabsList>

            {/* Subtasks Tab */}
            <TabsContent value="subtasks">
              <Card className="bg-[#12121A] border-[#2A2A3A]">
                <CardContent className="pt-6">
                  {task.subTasks.length === 0 && !showSubtaskForm && (
                    <p className="text-[#8888A0] text-sm mb-4">No subtasks yet.</p>
                  )}
                  <div className="space-y-2">
                    {task.subTasks.map((subtask) => (
                      <div
                        key={subtask.id}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-[#1A1A26] transition-colors group"
                      >
                        <button
                          onClick={() => toggleSubtaskStatus(subtask)}
                          className="flex-shrink-0"
                        >
                          {subtask.status === "COMPLETED" ? (
                            <CheckCircle2 className="h-5 w-5 text-green-400" />
                          ) : (
                            <Circle className="h-5 w-5 text-[#8888A0] group-hover:text-purple-400 transition-colors" />
                          )}
                        </button>
                        <Link
                          href={`/tasks/${subtask.id}`}
                          className={`flex-1 text-sm hover:text-purple-400 transition-colors ${
                            subtask.status === "COMPLETED"
                              ? "line-through text-[#8888A0]"
                              : "text-[#E8E8F0]"
                          }`}
                        >
                          {subtask.title}
                        </Link>
                        <Badge className={`text-xs ${getPriorityColor(subtask.priority)}`}>
                          {subtask.priority}
                        </Badge>
                      </div>
                    ))}
                  </div>

                  {showSubtaskForm ? (
                    <div className="flex items-center gap-2 mt-4">
                      <Input
                        value={newSubtaskTitle}
                        onChange={(e) => setNewSubtaskTitle(e.target.value)}
                        placeholder="Subtask title..."
                        className="flex-1"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddSubtask();
                          if (e.key === "Escape") {
                            setShowSubtaskForm(false);
                            setNewSubtaskTitle("");
                          }
                        }}
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={handleAddSubtask}
                        disabled={addingSubtask || !newSubtaskTitle.trim()}
                      >
                        {addingSubtask ? "Adding..." : "Add"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-[#2A2A3A] text-[#8888A0]"
                        onClick={() => {
                          setShowSubtaskForm(false);
                          setNewSubtaskTitle("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 border-[#2A2A3A] text-[#8888A0] hover:text-[#E8E8F0]"
                      onClick={() => setShowSubtaskForm(true)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add subtask
                    </Button>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Comments Tab */}
            <TabsContent value="comments">
              <Card className="bg-[#12121A] border-[#2A2A3A]">
                <CardContent className="pt-6">
                  {/* Comment List */}
                  <div className="space-y-4 mb-6">
                    {comments.length === 0 && (
                      <p className="text-[#8888A0] text-sm">No comments yet. Be the first to comment.</p>
                    )}
                    {comments.map((comment) => (
                      <div key={comment.id} className="flex gap-3">
                        <Avatar className="h-8 w-8 flex-shrink-0">
                          <AvatarFallback className="bg-purple-500/20 text-purple-400 text-xs">
                            {getInitials(comment.author.firstName, comment.author.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-[#E8E8F0]">
                              {comment.author.firstName} {comment.author.lastName}
                            </span>
                            <span className="text-xs text-[#8888A0]">
                              {formatDateTime(comment.createdAt)}
                            </span>
                          </div>
                          <p className="text-sm text-[#C0C0D0] whitespace-pre-wrap">
                            {comment.content}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* New Comment Form */}
                  <div className="border-t border-[#2A2A3A] pt-4">
                    <Textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Write a comment..."
                      rows={3}
                      className="mb-3"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={handleAddComment}
                        disabled={submittingComment || !newComment.trim()}
                      >
                        <Send className="h-4 w-4 mr-1" />
                        {submittingComment ? "Sending..." : "Submit"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Status & Priority */}
          <Card className="bg-[#12121A] border-[#2A2A3A]">
            <CardContent className="pt-6 space-y-5">
              {/* Status */}
              <div className="space-y-2">
                <Label className="text-[#8888A0] text-xs uppercase tracking-wider">Status</Label>
                <Select value={task.status} onValueChange={handleStatusChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Priority */}
              <div className="space-y-2">
                <Label className="text-[#8888A0] text-xs uppercase tracking-wider">Priority</Label>
                <Select value={task.priority} onValueChange={handlePriorityChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Progress */}
              <div className="space-y-2">
                <Label className="text-[#8888A0] text-xs uppercase tracking-wider">
                  Progress ({task.progress}%)
                </Label>
                <Progress value={task.progress} />
              </div>
            </CardContent>
          </Card>

          {/* People */}
          <Card className="bg-[#12121A] border-[#2A2A3A]">
            <CardContent className="pt-6 space-y-5">
              {/* Assignee */}
              <div className="space-y-2">
                <Label className="text-[#8888A0] text-xs uppercase tracking-wider flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Assignee
                </Label>
                {task.assignee ? (
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-blue-500/20 text-blue-400 text-xs">
                        {getInitials(task.assignee.firstName, task.assignee.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-[#E8E8F0]">
                      {task.assignee.firstName} {task.assignee.lastName}
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-[#8888A0]">Unassigned</span>
                )}
              </div>

              {/* Creator */}
              <div className="space-y-2">
                <Label className="text-[#8888A0] text-xs uppercase tracking-wider flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Creator
                </Label>
                <div className="flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-green-500/20 text-green-400 text-xs">
                      {getInitials(task.creator.firstName, task.creator.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-[#E8E8F0]">
                    {task.creator.firstName} {task.creator.lastName}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Dates */}
          <Card className="bg-[#12121A] border-[#2A2A3A]">
            <CardContent className="pt-6 space-y-4">
              {/* Deadline */}
              <div className="space-y-1">
                <Label className="text-[#8888A0] text-xs uppercase tracking-wider flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Deadline
                </Label>
                <p className="text-sm text-[#E8E8F0]">
                  {task.deadline ? formatDate(task.deadline) : "No deadline"}
                </p>
              </div>

              {/* Created */}
              <div className="space-y-1">
                <Label className="text-[#8888A0] text-xs uppercase tracking-wider flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Created
                </Label>
                <p className="text-sm text-[#E8E8F0]">{formatDateTime(task.createdAt)}</p>
              </div>

              {/* Updated */}
              <div className="space-y-1">
                <Label className="text-[#8888A0] text-xs uppercase tracking-wider flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Updated
                </Label>
                <p className="text-sm text-[#E8E8F0]">{formatDateTime(task.updatedAt)}</p>
              </div>
            </CardContent>
          </Card>

          {/* Tags */}
          {task.tags.length > 0 && (
            <Card className="bg-[#12121A] border-[#2A2A3A]">
              <CardContent className="pt-6">
                <Label className="text-[#8888A0] text-xs uppercase tracking-wider flex items-center gap-1 mb-3">
                  <Tag className="h-3 w-3" />
                  Tags
                </Label>
                <div className="flex flex-wrap gap-2">
                  {task.tags.map((tag, i) => (
                    <Badge
                      key={tag}
                      className={TAG_COLORS[i % TAG_COLORS.length]}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

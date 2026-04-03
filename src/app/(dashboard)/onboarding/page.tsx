"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, GraduationCap, Users, BookOpen, Clock, CheckCircle, AlertTriangle, Play,
  CheckCircle2, Circle, LayoutList, ChevronDown, ChevronUp,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";

function getStatusStyle(status: string) {
  switch (status) {
    case "COMPLETED": return "bg-green-500/20 text-green-400";
    case "IN_PROGRESS": return "bg-blue-500/20 text-blue-400";
    case "OVERDUE": return "bg-red-500/20 text-red-400";
    default: return "bg-slate-500/20 text-slate-400";
  }
}

export default function OnboardingPage() {
  const [instances, setInstances] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [expandedInstance, setExpandedInstance] = useState<string | null>(null);
  const [togglingStep, setTogglingStep] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("onboarding");

  const { success: toastSuccess, error: toastError } = useToast();

  // Form states
  const [templateForm, setTemplateForm] = useState({ name: "", description: "", steps: "", durationDays: 30 });
  const [assignForm, setAssignForm] = useState({ templateId: "", userId: "", buddyId: "" });
  const [courseForm, setCourseForm] = useState({ title: "", description: "", category: "", duration: 60, mandatory: false });

  const fetchData = useCallback(async () => {
    try {
      const [instRes, tmplRes, courseRes, userRes] = await Promise.all([
        fetch("/api/onboarding?type=instances"),
        fetch("/api/onboarding?type=templates"),
        fetch("/api/training?type=courses"),
        fetch("/api/users"),
      ]);
      const [instData, tmplData, courseData, userData] = await Promise.all([
        instRes.json(), tmplRes.json(), courseRes.json(), userRes.json(),
      ]);
      setInstances(Array.isArray(instData) ? instData : []);
      setTemplates(Array.isArray(tmplData) ? tmplData : []);
      setCourses(Array.isArray(courseData) ? courseData : []);
      setUsers(Array.isArray(userData) ? userData : []);
    } catch (err) {
      console.error("Failed to fetch onboarding data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function createTemplate() {
    try {
      const steps = templateForm.steps.split("\n").filter((s) => s.trim()).map((s, i) => ({ order: i + 1, title: s.trim(), description: "" }));
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "template", name: templateForm.name, description: templateForm.description, steps, durationDays: templateForm.durationDays }),
      });
      if (res.ok) {
        setTemplateDialogOpen(false);
        setTemplateForm({ name: "", description: "", steps: "", durationDays: 30 });
        fetchData();
        toastSuccess("Template created");
      }
    } catch (err) {
      toastError("Failed to create template");
    }
  }

  async function assignOnboarding() {
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: assignForm.templateId, userId: assignForm.userId, buddyId: assignForm.buddyId || undefined }),
      });
      if (res.ok) {
        setAssignDialogOpen(false);
        setAssignForm({ templateId: "", userId: "", buddyId: "" });
        fetchData();
        toastSuccess("Onboarding assigned");
      }
    } catch (err) {
      toastError("Failed to assign onboarding");
    }
  }

  async function createCourse() {
    try {
      const res = await fetch("/api/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "course", ...courseForm }),
      });
      if (res.ok) {
        setCourseDialogOpen(false);
        setCourseForm({ title: "", description: "", category: "", duration: 60, mandatory: false });
        fetchData();
        toastSuccess("Course created");
      }
    } catch (err) {
      toastError("Failed to create course");
    }
  }

  async function toggleStep(instanceId: string, stepIndex: number, currentCompleted: boolean) {
    const key = `${instanceId}-${stepIndex}`;
    setTogglingStep(key);
    try {
      const res = await fetch(`/api/onboarding/${instanceId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepIndex, completed: !currentCompleted }),
      });
      if (res.ok) {
        const updated = await res.json();
        setInstances((prev) => prev.map((inst) => inst.id === instanceId ? { ...inst, progress: updated.progress, status: updated.status } : inst));
        toastSuccess(!currentCompleted ? "Step completed" : "Step marked incomplete");
      }
    } catch (err) {
      toastError("Failed to update step");
    } finally {
      setTogglingStep(null);
    }
  }

  const activeOnboarding = instances.filter((i) => i.status !== "COMPLETED");
  const completedOnboarding = instances.filter((i) => i.status === "COMPLETED");

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-64 bg-surface-2 rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-surface rounded-lg border border-border animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Onboarding & Training</h1>
          <p className="text-muted text-sm mt-1">Manage employee onboarding and training programs</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm"><Plus size={14} className="mr-1" /> Template</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Onboarding Template</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Template Name</Label>
                  <Input value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} placeholder="e.g. Engineering Onboarding" />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input value={templateForm.description} onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })} placeholder="Brief description" />
                </div>
                <div className="space-y-2">
                  <Label>Steps (one per line)</Label>
                  <Textarea value={templateForm.steps} onChange={(e) => setTemplateForm({ ...templateForm, steps: e.target.value })} placeholder={"IT Setup\nTeam Introductions\nRole Briefing\nFirst Project Assignment"} rows={5} />
                </div>
                <div className="space-y-2">
                  <Label>Duration (days)</Label>
                  <Input type="number" value={templateForm.durationDays} onChange={(e) => setTemplateForm({ ...templateForm, durationDays: parseInt(e.target.value) || 30 })} />
                </div>
                <Button onClick={createTemplate} className="w-full">Create Template</Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Play size={14} className="mr-1" /> Start Onboarding</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Assign Onboarding</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Template</Label>
                  <select className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-purple-500" value={assignForm.templateId} onChange={(e) => setAssignForm({ ...assignForm, templateId: e.target.value })}>
                    <option value="">Select template...</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>New Employee</Label>
                  <select className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-purple-500" value={assignForm.userId} onChange={(e) => setAssignForm({ ...assignForm, userId: e.target.value })}>
                    <option value="">Select person...</option>
                    {users.map((u: any) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Buddy (optional)</Label>
                  <select className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-purple-500" value={assignForm.buddyId} onChange={(e) => setAssignForm({ ...assignForm, buddyId: e.target.value })}>
                    <option value="">No buddy</option>
                    {users.map((u: any) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                  </select>
                </div>
                <Button onClick={assignOnboarding} className="w-full">Start Onboarding</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2.5 bg-blue-500/10"><Users className="h-5 w-5 text-blue-400" /></div>
              <div>
                <p className="text-2xl font-bold">{activeOnboarding.length}</p>
                <p className="text-xs text-muted">Active Onboardings</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2.5 bg-green-500/10"><CheckCircle className="h-5 w-5 text-green-400" /></div>
              <div>
                <p className="text-2xl font-bold">{completedOnboarding.length}</p>
                <p className="text-xs text-muted">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2.5 bg-purple-500/10"><BookOpen className="h-5 w-5 text-purple-400" /></div>
              <div>
                <p className="text-2xl font-bold">{templates.length}</p>
                <p className="text-xs text-muted">Templates</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2.5 bg-orange-500/10"><GraduationCap className="h-5 w-5 text-orange-400" /></div>
              <div>
                <p className="text-2xl font-bold">{courses.length}</p>
                <p className="text-xs text-muted">Training Courses</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="manager">Manager View</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="training">Training Courses</TabsTrigger>
        </TabsList>

        {/* Onboarding instances with step checkboxes */}
        <TabsContent value="onboarding" className="mt-4 space-y-3">
          {instances.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="No onboarding programs"
              description="Create onboarding templates to help new hires get up to speed."
              actionLabel="Start Onboarding"
              onAction={() => setAssignDialogOpen(true)}
            />
          ) : (
            instances.map((inst) => {
              const steps = Array.isArray(inst.template?.steps) ? inst.template.steps : [];
              const progressArr = Array.isArray(inst.progress) ? inst.progress : [];
              const completedSteps = progressArr.filter((p: any) => p.completed).length;
              const progressPct = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;
              const isOverdue = inst.targetDate && new Date(inst.targetDate) < new Date() && inst.status !== "COMPLETED";
              const isExpanded = expandedInstance === inst.id;

              return (
                <Card key={inst.id} className={isOverdue ? "border-red-500/30" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-12 w-12">
                        <AvatarFallback className="bg-purple-600/20 text-purple-400">
                          {inst.user?.firstName?.[0]}{inst.user?.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{inst.user?.firstName} {inst.user?.lastName}</p>
                          <Badge className={getStatusStyle(inst.status)}>{inst.status.replace(/_/g, " ")}</Badge>
                          {isOverdue && <Badge className="bg-red-500/20 text-red-400"><AlertTriangle size={10} className="mr-1" /> Overdue</Badge>}
                        </div>
                        <p className="text-xs text-muted">{inst.template?.name} · {inst.user?.department?.name || "No dept"}</p>
                        {inst.buddy && <p className="text-xs text-muted">Buddy: {inst.buddy.firstName} {inst.buddy.lastName}</p>}
                      </div>
                      <div className="text-right mr-2">
                        <p className="text-sm font-mono font-bold">{completedSteps}/{steps.length}</p>
                        <p className="text-xs text-muted">{progressPct}%</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedInstance(isExpanded ? null : inst.id)}
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </Button>
                    </div>
                    <Progress value={progressPct} className="h-1.5 mt-3" indicatorClassName={progressPct >= 80 ? "bg-green-500" : progressPct >= 50 ? "bg-blue-500" : "bg-orange-500"} />
                    {inst.targetDate && (
                      <p className="text-[10px] text-muted mt-2 flex items-center gap-1">
                        <Clock size={10} /> Target: {new Date(inst.targetDate).toLocaleDateString()}
                      </p>
                    )}

                    {/* Expandable step checklist */}
                    {isExpanded && steps.length > 0 && (
                      <div className="mt-4 border-t border-border pt-3 space-y-2">
                        {steps.map((step: any, i: number) => {
                          const p = progressArr.find((pr: any) => pr.stepIndex === i);
                          const isCompleted = p?.completed || false;
                          const isToggling = togglingStep === `${inst.id}-${i}`;

                          return (
                            <button
                              key={i}
                              onClick={() => toggleStep(inst.id, i, isCompleted)}
                              disabled={isToggling}
                              className="flex items-center gap-3 w-full text-left rounded-lg p-2.5 hover:bg-surface-2 transition-colors disabled:opacity-50"
                            >
                              {isCompleted ? (
                                <CheckCircle2 size={18} className="text-green-400 flex-shrink-0" />
                              ) : (
                                <Circle size={18} className="text-muted flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm ${isCompleted ? "line-through text-muted" : ""}`}>
                                  {step.title || step}
                                </p>
                                {step.description && <p className="text-[10px] text-muted">{step.description}</p>}
                              </div>
                              {p?.completedAt && (
                                <span className="text-[10px] text-green-400/70 flex-shrink-0">
                                  {new Date(p.completedAt).toLocaleDateString()}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Manager View - Table format */}
        <TabsContent value="manager" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <LayoutList size={16} /> Onboarding Tracker
                </CardTitle>
                <Badge variant="secondary">{activeOnboarding.length} active</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {instances.length === 0 ? (
                <EmptyState
                  icon={LayoutList}
                  title="No onboarding instances"
                  description="Assign onboarding templates to new employees to track their progress."
                  actionLabel="Start Onboarding"
                  onAction={() => setAssignDialogOpen(true)}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted text-xs">
                        <th className="text-left pb-3 font-medium">Employee</th>
                        <th className="text-left pb-3 font-medium">Workflow</th>
                        <th className="text-left pb-3 font-medium">Start Date</th>
                        <th className="text-left pb-3 font-medium">Progress</th>
                        <th className="text-left pb-3 font-medium">Days</th>
                        <th className="text-left pb-3 font-medium">Status</th>
                        <th className="text-left pb-3 font-medium">Buddy</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {instances.map((inst) => {
                        const steps = Array.isArray(inst.template?.steps) ? inst.template.steps : [];
                        const progressArr = Array.isArray(inst.progress) ? inst.progress : [];
                        const completedSteps = progressArr.filter((p: any) => p.completed).length;
                        const progressPct = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;
                        const daysSinceStart = Math.floor((Date.now() - new Date(inst.createdAt).getTime()) / (1000 * 60 * 60 * 24));
                        const isOverdue = inst.targetDate && new Date(inst.targetDate) < new Date() && inst.status !== "COMPLETED";
                        const durationDays = inst.template?.durationDays || 30;

                        return (
                          <tr key={inst.id} className={`${isOverdue ? "bg-red-500/5" : ""}`}>
                            <td className="py-3">
                              <div className="flex items-center gap-2">
                                <Avatar className="h-7 w-7">
                                  <AvatarFallback className="bg-purple-600/20 text-purple-400 text-[10px]">
                                    {inst.user?.firstName?.[0]}{inst.user?.lastName?.[0]}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium text-xs">{inst.user?.firstName} {inst.user?.lastName}</p>
                                  <p className="text-[10px] text-muted">{inst.user?.department?.name || "—"}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 text-xs">{inst.template?.name}</td>
                            <td className="py-3 text-xs text-muted">{new Date(inst.createdAt).toLocaleDateString()}</td>
                            <td className="py-3">
                              <div className="flex items-center gap-2">
                                <Progress value={progressPct} className="h-1.5 w-20" indicatorClassName={progressPct >= 80 ? "bg-green-500" : progressPct >= 50 ? "bg-blue-500" : "bg-orange-500"} />
                                <span className="text-xs font-mono">{completedSteps}/{steps.length}</span>
                              </div>
                            </td>
                            <td className="py-3">
                              <span className={`text-xs font-mono ${daysSinceStart > durationDays ? "text-red-400" : "text-muted"}`}>
                                {daysSinceStart}d / {durationDays}d
                              </span>
                            </td>
                            <td className="py-3">
                              <Badge className={`text-[10px] ${getStatusStyle(inst.status)}`}>
                                {inst.status.replace(/_/g, " ")}
                              </Badge>
                            </td>
                            <td className="py-3 text-xs text-muted">
                              {inst.buddy ? `${inst.buddy.firstName} ${inst.buddy.lastName}` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          {templates.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No templates created yet"
              description="Create onboarding templates to standardize your new hire process."
              actionLabel="Create Template"
              onAction={() => setTemplateDialogOpen(true)}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {templates.map((t) => {
                const steps = Array.isArray(t.steps) ? t.steps : [];
                return (
                  <Card key={t.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium">{t.name}</p>
                          {t.description && <p className="text-xs text-muted mt-1">{t.description}</p>}
                        </div>
                        <Badge variant="secondary">{t._count?.instances || 0} assigned</Badge>
                      </div>
                      <div className="mt-3 space-y-1">
                        {steps.slice(0, 5).map((s: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-muted">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-2 text-[10px] font-mono">{i + 1}</span>
                            {s.title || s}
                          </div>
                        ))}
                        {steps.length > 5 && <p className="text-[10px] text-muted pl-7">+{steps.length - 5} more steps</p>}
                      </div>
                      <div className="flex items-center gap-3 mt-3 text-xs text-muted">
                        <span className="flex items-center gap-1"><Clock size={10} /> {t.durationDays} days</span>
                        <span>{steps.length} steps</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="training" className="mt-4">
          <div className="flex justify-end mb-4">
            <Dialog open={courseDialogOpen} onOpenChange={setCourseDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus size={14} className="mr-1" /> New Course</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create Training Course</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Course Title</Label>
                    <Input value={courseForm.title} onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })} placeholder="e.g. Security Awareness Training" />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} placeholder="Course description" rows={3} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Input value={courseForm.category} onChange={(e) => setCourseForm({ ...courseForm, category: e.target.value })} placeholder="e.g. Compliance" />
                    </div>
                    <div className="space-y-2">
                      <Label>Duration (minutes)</Label>
                      <Input type="number" value={courseForm.duration} onChange={(e) => setCourseForm({ ...courseForm, duration: parseInt(e.target.value) || 60 })} />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={courseForm.mandatory} onChange={(e) => setCourseForm({ ...courseForm, mandatory: e.target.checked })} className="rounded" />
                    Mandatory for all employees
                  </label>
                  <Button onClick={createCourse} className="w-full">Create Course</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          {courses.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="No training courses yet"
              description="Create training courses to upskill your team."
              actionLabel="New Course"
              onAction={() => setCourseDialogOpen(true)}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {courses.map((c) => {
                const enrolled = c._count?.enrollments || 0;
                const completions = c.enrollments?.filter((e: any) => e.completedAt).length || 0;
                return (
                  <Card key={c.id} className="hover:border-muted-2 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-medium">{c.title}</p>
                          {c.description && <p className="text-xs text-muted mt-1 line-clamp-2">{c.description}</p>}
                        </div>
                        {c.mandatory && <Badge variant="destructive" className="text-[10px] ml-2">Required</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-3 text-xs text-muted">
                        {c.category && <Badge variant="secondary" className="text-[10px]">{c.category}</Badge>}
                        {c.duration && <span className="flex items-center gap-1"><Clock size={10} /> {c.duration} min</span>}
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-muted">{enrolled} enrolled</span>
                        <span className="text-green-400">{completions} completed</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

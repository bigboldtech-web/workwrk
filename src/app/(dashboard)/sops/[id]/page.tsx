"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Edit3,
  Save,
  Send,
  Archive,
  Plus,
  X,
  GripVertical,
  FileText,
  Users,
  Clock,
  CheckCircle,
  AlertCircle,
  Calendar,
  Tag,
  Hash,
  Activity,
  UserPlus,
  Trash2,
  Play,
  Link2,
  Copy,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { ChecklistBuilder, ChecklistSection } from "@/components/checklist-builder";
import { useRole } from "@/hooks/use-role";

interface ComplianceUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
}

interface SOPCompliance {
  id: string;
  stepsTotal: number;
  stepsCompleted: number;
  score: number | null;
  completedAt: string | null;
  createdAt: string;
  period: string;
  user: ComplianceUser;
}

interface SOPStep {
  id: string;
  title: string;
  description?: string;
}

interface RecordedStep {
  order: number;
  action: string;
  description: string;
  url: string;
  screenshot: string | null;
  elementText: string;
  elementTag: string;
}

interface SOP {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  sopType: "WRITTEN" | "RECORDED" | "CHECKLIST";
  content: { type?: string; steps?: SOPStep[] | RecordedStep[]; sections?: ChecklistSection[] };
  version: number;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  compliance: SOPCompliance[];
}

function getStatusBadge(status: string) {
  switch (status) {
    case "PUBLISHED":
      return <Badge variant="success">Published</Badge>;
    case "IN_REVIEW":
      return <Badge variant="warning">In Review</Badge>;
    case "DRAFT":
      return <Badge variant="secondary">Draft</Badge>;
    case "ARCHIVED":
      return <Badge variant="outline">Archived</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "---";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function generateStepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function SOPDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { canManageSOPs } = useRole();
  const [sop, setSop] = useState<SOP | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();
  const [activeTab, setActiveTab] = useState("content");

  // Editable fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<SOPStep[]>([]);
  const [checklistSections, setChecklistSections] = useState<ChecklistSection[]>([]);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);

  // Process run state
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [runTitle, setRunTitle] = useState("");
  const [runDueDate, setRunDueDate] = useState("");
  const [runAssigneeId, setRunAssigneeId] = useState("");
  const [creatingRun, setCreatingRun] = useState(false);
  const [shareLink, setShareLink] = useState("");

  // Assignment state
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [orgUsers, setOrgUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [assignDueDate, setAssignDueDate] = useState("");
  const [assignMandatory, setAssignMandatory] = useState(true);
  const [assigning, setAssigning] = useState(false);

  const fetchAssignments = useCallback(async () => {
    try {
      const res = await fetch(`/api/sop-assignments?sopId=${id}`);
      if (res.ok) {
        const data = await res.json();
        setAssignments(data);
      }
    } catch (err) {
      console.error("Error fetching assignments:", err);
    }
  }, [id]);

  const fetchOrgUsers = useCallback(async () => {
    try {
      const [usersRes, deptsRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/departments"),
      ]);
      if (usersRes.ok) {
        const data = await usersRes.json();
        setOrgUsers(Array.isArray(data) ? data : data.users || []);
      }
      if (deptsRes.ok) {
        const data = await deptsRes.json();
        setDepartments(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Error fetching users:", err);
    }
  }, []);

  const handleAssign = async () => {
    if (selectedUserIds.length === 0 && !selectedDeptId) return;
    setAssigning(true);
    try {
      const res = await fetch("/api/sop-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sopId: id,
          userIds: selectedUserIds.length > 0 ? selectedUserIds : undefined,
          departmentId: selectedDeptId || undefined,
          dueDate: assignDueDate || undefined,
          mandatory: assignMandatory,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        toastError(err.error || "Failed to assign");
        return;
      }
      toastSuccess("SOP assigned successfully");
      setShowAssignDialog(false);
      setSelectedUserIds([]);
      setSelectedDeptId("");
      setAssignDueDate("");
      fetchAssignments();
    } catch (err) {
      toastError("Failed to assign SOP");
    } finally {
      setAssigning(false);
    }
  };

  const handleRemoveAssignment = async (assignmentId: string) => {
    if (!confirm("Remove this assignment?")) return;
    try {
      await fetch(`/api/sop-assignments/${assignmentId}`, { method: "DELETE" });
      toastSuccess("Assignment removed");
      fetchAssignments();
    } catch (err) {
      toastError("Failed to remove assignment");
    }
  };

  const fetchSOP = useCallback(async () => {
    try {
      const res = await fetch(`/api/sops/${id}`);
      if (!res.ok) throw new Error("Failed to fetch SOP");
      const data: SOP = await res.json();
      setSop(data);
      setTitle(data.title);
      setDescription(data.description || "");
      if (data.sopType === "CHECKLIST") {
        setChecklistSections((data.content?.sections || []) as ChecklistSection[]);
      } else {
        setSteps((data.content?.type === "recorded" ? [] : data.content?.steps || []) as SOPStep[]);
      }
    } catch (err) {
      console.error("Error fetching SOP:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchSOP();
    fetchAssignments();
    fetchOrgUsers();
  }, [fetchSOP, fetchAssignments, fetchOrgUsers]);

  const getContentPayload = () => {
    if (sop?.sopType === "CHECKLIST") {
      return { sections: checklistSections };
    }
    return { steps };
  };

  const handleSave = async () => {
    if (!sop) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          content: getContentPayload(),
        }),
      });
      if (!res.ok) throw new Error("Failed to save SOP");
      const updated = await res.json();
      setSop(updated);
      setEditing(false);
      toastSuccess("Saved successfully");
    } catch (err) {
      console.error("Error saving SOP:", err);
      toastError("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!sop) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          content: getContentPayload(),
          status: "PUBLISHED",
          version: sop.version + 1,
        }),
      });
      if (!res.ok) throw new Error("Failed to publish SOP");
      const updated = await res.json();
      setSop(updated);
      setEditing(false);
      setShowPublishDialog(false);
      toastSuccess("Published successfully");
    } catch (err) {
      console.error("Error publishing SOP:", err);
      toastError("Failed to publish");
    } finally {
      setSaving(false);
    }
  };

  const handleAiGenerate = async () => {
    if (!sop) return;
    setAiGenerating(true);
    try {
      const res = await fetch("/api/sops/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: sop.title, context: description }),
      });
      if (!res.ok) throw new Error("AI generation failed");
      const data = await res.json();
      const generated = data.data || data;
      if (generated.sections) {
        // Map AI sections to have proper inputs/contentBlocks arrays
        const mapped: ChecklistSection[] = generated.sections.map((s: any) => ({
          id: s.id,
          title: s.title,
          steps: (s.steps || []).map((st: any) => ({
            id: st.id,
            title: st.title,
            description: st.description || "",
            type: st.type || "task",
            inputs: st.inputs || [],
            contentBlocks: st.contentBlocks || [],
          })),
        }));
        setChecklistSections(mapped);
        toastSuccess("Checklist generated! Review and customize the steps.");
      }
    } catch (err) {
      console.error("AI generation error:", err);
      toastError("Failed to generate checklist. Try again.");
    } finally {
      setAiGenerating(false);
    }
  };

  const handleArchive = async () => {
    if (!sop) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      if (!res.ok) throw new Error("Failed to archive SOP");
      const updated = await res.json();
      setSop(updated);
      setShowArchiveDialog(false);
    } catch (err) {
      console.error("Error archiving SOP:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleStartRun = async () => {
    if (!sop) return;
    setCreatingRun(true);
    try {
      const res = await fetch("/api/process-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sopId: sop.id,
          title: runTitle || sop.title,
          assigneeId: runAssigneeId || undefined,
          dueDate: runDueDate || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        toastError(err.error || "Failed to start process");
        return;
      }
      const data = await res.json();
      const result = data.data || data;
      setShareLink(result.shareLink || "");
      toastSuccess("Process run started!");
    } catch (err) {
      toastError("Failed to start process run");
    } finally {
      setCreatingRun(false);
    }
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    toastSuccess("Link copied to clipboard!");
  };

  const addStep = () => {
    const newStep: SOPStep = {
      id: generateStepId(),
      title: "",
      description: "",
    };
    setSteps([...steps, newStep]);
    setEditingStepId(newStep.id);
  };

  const removeStep = (stepId: string) => {
    setSteps(steps.filter((s) => s.id !== stepId));
    if (editingStepId === stepId) setEditingStepId(null);
  };

  const updateStep = (stepId: string, field: keyof SOPStep, value: string) => {
    setSteps(steps.map((s) => (s.id === stepId ? { ...s, [field]: value } : s)));
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 bg-[#1A1A26] rounded animate-pulse" />
          <div className="h-6 w-64 bg-[#1A1A26] rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="h-64 bg-[#1A1A26] rounded-lg animate-pulse" />
            <div className="h-48 bg-[#1A1A26] rounded-lg animate-pulse" />
          </div>
          <div className="h-80 bg-[#1A1A26] rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (!sop) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <AlertCircle size={48} className="text-[#8888A0]" />
        <p className="text-[#8888A0]">SOP not found</p>
        <Button variant="outline" onClick={() => router.push("/sops")}>
          Back to SOPs
        </Button>
      </div>
    );
  }

  const complianceCompleted = sop.compliance.filter((c) => c.completedAt);
  const compliancePending = sop.compliance.filter((c) => !c.completedAt);
  const assignCompleted = assignments.filter((a: any) => a.status === "COMPLETED").length;
  const assignOverdue = assignments.filter((a: any) => a.status !== "COMPLETED" && a.dueDate && new Date(a.dueDate) < new Date()).length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/sops")}
            className="shrink-0"
          >
            <ArrowLeft size={18} />
          </Button>
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-lg bg-purple-500/10 p-2 shrink-0">
              <FileText size={20} className="text-purple-400" />
            </div>
            <div className="min-w-0">
              {editing ? (
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="text-lg font-bold bg-transparent border-[#2A2A3A] h-auto py-1"
                />
              ) : (
                <h1 className="text-xl font-bold tracking-tight truncate">
                  {sop.title}
                </h1>
              )}
              <div className="flex items-center gap-2 mt-1">
                {getStatusBadge(sop.status)}
                <Badge variant="outline" className="text-[10px]">
                  v{sop.version}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!canManageSOPs ? null : editing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setTitle(sop.title);
                  setDescription(sop.description || "");
                  if (sop.sopType === "CHECKLIST") {
                    setChecklistSections((sop.content?.sections || []) as ChecklistSection[]);
                  } else {
                    setSteps((sop.content?.type === "recorded" ? [] : sop.content?.steps || []) as SOPStep[]);
                  }
                  setEditingStepId(null);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
                <Save size={14} />
                {saving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              className="gap-1.5"
            >
              <Edit3 size={14} />
              Edit
            </Button>
          )}

          {/* Run Process - only for published checklists */}
          {sop.status === "PUBLISHED" && sop.sopType === "CHECKLIST" && (
            <Dialog open={showRunDialog} onOpenChange={(open) => {
              setShowRunDialog(open);
              if (!open) { setShareLink(""); setRunTitle(""); setRunDueDate(""); setRunAssigneeId(""); }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700">
                  <Play size={14} /> Run Process
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{shareLink ? "Process Started!" : "Start Process Run"}</DialogTitle></DialogHeader>
                {shareLink ? (
                  <div className="space-y-4 py-4">
                    <p className="text-sm text-[#8888A0]">
                      Share this link with anyone who needs to complete this process:
                    </p>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-[#0D0D14] border border-[#2A2A3A]">
                      <Link2 size={14} className="text-purple-400 shrink-0" />
                      <code className="text-xs text-purple-300 flex-1 break-all">{shareLink}</code>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={copyShareLink}>
                        <Copy size={12} />
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setShowRunDialog(false)} className="flex-1">
                        Close
                      </Button>
                      <Button size="sm" onClick={() => window.open(shareLink, "_blank")} className="flex-1 gap-1.5">
                        <ExternalLink size={14} /> Open
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Run Title</Label>
                      <Input
                        value={runTitle}
                        onChange={(e) => setRunTitle(e.target.value)}
                        placeholder={sop.title}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Assign To</Label>
                      <Select value={runAssigneeId} onValueChange={setRunAssigneeId}>
                        <SelectTrigger><SelectValue placeholder="Anyone (optional)" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Anyone</SelectItem>
                          {orgUsers.map((u: any) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.firstName} {u.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Due Date</Label>
                      <Input type="date" value={runDueDate} onChange={(e) => setRunDueDate(e.target.value)} />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setShowRunDialog(false)}>Cancel</Button>
                      <Button onClick={handleStartRun} disabled={creatingRun} className="gap-1.5">
                        <Play size={14} /> {creatingRun ? "Starting..." : "Start Run"}
                      </Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          )}

          {sop.status === "PUBLISHED" && (
            <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <UserPlus size={14} /> Assign
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Assign SOP to People</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                  {/* Department bulk assign */}
                  <div className="space-y-2">
                    <Label>Assign to Department</Label>
                    <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
                      <SelectTrigger><SelectValue placeholder="Select department (optional)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {departments.map((d: any) => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Individual user selection */}
                  <div className="space-y-2">
                    <Label>Or Select Individuals</Label>
                    <div className="max-h-48 overflow-y-auto border border-[#2A2A3A] rounded-md p-2 space-y-1">
                      {orgUsers.map((u: any) => {
                        const alreadyAssigned = assignments.some((a: any) => a.userId === u.id);
                        return (
                          <label key={u.id} className={`flex items-center gap-2 p-1.5 rounded hover:bg-[#1A1A26] text-sm ${alreadyAssigned ? "opacity-40" : "cursor-pointer"}`}>
                            <input
                              type="checkbox"
                              disabled={alreadyAssigned}
                              checked={selectedUserIds.includes(u.id)}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedUserIds([...selectedUserIds, u.id]);
                                else setSelectedUserIds(selectedUserIds.filter((id) => id !== u.id));
                              }}
                              className="rounded"
                            />
                            {u.firstName} {u.lastName}
                            {u.department?.name && <span className="text-[#8888A0] text-xs ml-auto">{u.department.name}</span>}
                            {alreadyAssigned && <span className="text-[10px] text-[#8888A0] ml-auto">Already assigned</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Due Date</Label>
                      <Input type="date" value={assignDueDate} onChange={(e) => setAssignDueDate(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Mandatory</Label>
                      <Select value={assignMandatory ? "yes" : "no"} onValueChange={(v) => setAssignMandatory(v === "yes")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No (Optional)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
                  <Button onClick={handleAssign} disabled={assigning || (selectedUserIds.length === 0 && !selectedDeptId)}>
                    {assigning ? "Assigning..." : "Assign SOP"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}

          {sop.status !== "PUBLISHED" && (
            <Dialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Send size={14} />
                  Publish
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Publish SOP</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-[#8888A0] py-4">
                  Publishing will increment the version to v{sop.version + 1} and
                  make this SOP available to all team members. Are you sure?
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowPublishDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handlePublish} disabled={saving}>
                    {saving ? "Publishing..." : "Publish"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}

          {sop.status !== "ARCHIVED" && (
            <Dialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Archive size={14} />
                  Archive
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Archive SOP</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-[#8888A0] py-4">
                  Archiving will hide this SOP from active lists. You can
                  restore it later. Are you sure?
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowArchiveDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleArchive}
                    disabled={saving}
                  >
                    {saving ? "Archiving..." : "Archive"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Tabs */}
        <div className="lg:col-span-2">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full justify-start">
              <TabsTrigger value="content" className="gap-1.5">
                <FileText size={14} /> Content
              </TabsTrigger>
              <TabsTrigger value="compliance" className="gap-1.5">
                <Users size={14} /> Compliance
              </TabsTrigger>
              <TabsTrigger value="assignments" className="gap-1.5">
                <UserPlus size={14} /> Assignments ({assignments.length})
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <Clock size={14} /> History
              </TabsTrigger>
            </TabsList>

            {/* Content Tab */}
            <TabsContent value="content" className="space-y-4 mt-4">
              {/* Description */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Description</CardTitle>
                </CardHeader>
                <CardContent>
                  {editing ? (
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Describe what this SOP covers..."
                      rows={3}
                      className="bg-transparent border-[#2A2A3A]"
                    />
                  ) : (
                    <p className="text-sm text-[#8888A0]">
                      {sop.description || "No description provided."}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Steps / Checklist Builder */}
              {sop.sopType === "CHECKLIST" ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Checklist Builder</h3>
                    {aiGenerating && (
                      <span className="text-xs text-purple-400 animate-pulse">Generating with AI...</span>
                    )}
                  </div>
                  <ChecklistBuilder
                    sections={checklistSections}
                    onChange={setChecklistSections}
                    editing={editing}
                    onAiGenerate={handleAiGenerate}
                  />
                </div>
              ) : (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">
                      Steps ({steps.length})
                    </CardTitle>
                    {editing && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={addStep}
                        className="gap-1.5"
                      >
                        <Plus size={14} /> Add Step
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {steps.length === 0 ? (
                    <div className="text-center py-8">
                      <FileText
                        size={32}
                        className="mx-auto text-[#8888A0] mb-2"
                      />
                      <p className="text-sm text-[#8888A0]">
                        No steps defined yet.
                      </p>
                      {editing && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 gap-1.5"
                          onClick={addStep}
                        >
                          <Plus size={14} /> Add First Step
                        </Button>
                      )}
                    </div>
                  ) : sop?.content?.type === "recorded" ? (
                    /* Recorded SOP Steps with Screenshots */
                    ((sop.content.steps || []) as RecordedStep[]).map((step, index) => (
                      <div
                        key={index}
                        className="rounded-lg border border-[#2A2A3A] bg-[#0D0D14] overflow-hidden"
                      >
                        <div className="flex items-center gap-3 p-4">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-500/10 text-purple-400 text-sm font-bold shrink-0">
                            {step.order || index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{step.description}</p>
                            {step.url && (
                              <p className="text-xs text-[#6B6B80] mt-0.5 truncate">{step.url}</p>
                            )}
                          </div>
                        </div>
                        {step.screenshot && (
                          <div className="px-4 pb-4">
                            <img
                              src={step.screenshot}
                              alt={`Step ${step.order || index + 1}: ${step.description}`}
                              className="w-full rounded-lg border border-[#2A2A3A]"
                            />
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    steps.map((step, index) => (
                      <div
                        key={step.id}
                        className="flex items-start gap-3 p-3 rounded-lg border border-[#2A2A3A] bg-[#0D0D14] group"
                      >
                        <div className="pt-0.5 text-[#8888A0] opacity-30">
                          <GripVertical size={16} />
                        </div>
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-500/10 text-purple-400 text-xs font-bold shrink-0 mt-0.5">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          {editing && editingStepId === step.id ? (
                            <div className="space-y-2">
                              <Input
                                value={step.title}
                                onChange={(e) =>
                                  updateStep(step.id, "title", e.target.value)
                                }
                                placeholder="Step title..."
                                className="bg-transparent border-[#2A2A3A] h-8 text-sm"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") setEditingStepId(null);
                                }}
                              />
                              <Textarea
                                value={step.description || ""}
                                onChange={(e) =>
                                  updateStep(step.id, "description", e.target.value)
                                }
                                placeholder="Step description (optional)..."
                                rows={2}
                                className="bg-transparent border-[#2A2A3A] text-sm"
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingStepId(null)}
                                className="text-xs"
                              >
                                Done
                              </Button>
                            </div>
                          ) : (
                            <div
                              className={editing ? "cursor-pointer" : ""}
                              onClick={() => editing && setEditingStepId(step.id)}
                            >
                              <p className="text-sm font-medium">
                                {step.title || (
                                  <span className="text-[#8888A0] italic">Untitled step</span>
                                )}
                              </p>
                              {step.description && (
                                <p className="text-xs text-[#8888A0] mt-0.5">{step.description}</p>
                              )}
                            </div>
                          )}
                        </div>
                        {editing && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-red-400 hover:text-red-300"
                            onClick={() => removeStep(step.id)}
                          >
                            <X size={14} />
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
              )}
            </TabsContent>

            {/* Compliance Tab */}
            <TabsContent value="compliance" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">
                    Compliance Records ({sop.compliance.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {sop.compliance.length === 0 ? (
                    <div className="text-center py-8">
                      <Users
                        size={32}
                        className="mx-auto text-[#8888A0] mb-2"
                      />
                      <p className="text-sm text-[#8888A0]">
                        No compliance records yet.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[#2A2A3A] text-[#8888A0]">
                            <th className="text-left py-2 pr-4 font-medium">
                              User
                            </th>
                            <th className="text-left py-2 pr-4 font-medium">
                              Status
                            </th>
                            <th className="text-left py-2 pr-4 font-medium">
                              Progress
                            </th>
                            <th className="text-left py-2 pr-4 font-medium">
                              Score
                            </th>
                            <th className="text-left py-2 font-medium">
                              Completed
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sop.compliance.map((record) => {
                            const isComplete = !!record.completedAt;
                            const progress =
                              record.stepsTotal > 0
                                ? Math.round(
                                    (record.stepsCompleted /
                                      record.stepsTotal) *
                                      100
                                  )
                                : 0;
                            return (
                              <tr
                                key={record.id}
                                className="border-b border-[#2A2A3A]/50"
                              >
                                <td className="py-3 pr-4">
                                  <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-purple-500/10 flex items-center justify-center text-xs font-bold text-purple-400">
                                      {record.user.firstName[0]}
                                      {record.user.lastName[0]}
                                    </div>
                                    <div>
                                      <p className="font-medium text-xs">
                                        {record.user.firstName}{" "}
                                        {record.user.lastName}
                                      </p>
                                      <p className="text-[10px] text-[#8888A0]">
                                        {record.user.email}
                                      </p>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 pr-4">
                                  {isComplete ? (
                                    <Badge variant="success" className="text-[10px]">
                                      Completed
                                    </Badge>
                                  ) : (
                                    <Badge variant="warning" className="text-[10px]">
                                      Pending
                                    </Badge>
                                  )}
                                </td>
                                <td className="py-3 pr-4">
                                  <span className="text-xs font-mono">
                                    {record.stepsCompleted}/{record.stepsTotal}{" "}
                                    ({progress}%)
                                  </span>
                                </td>
                                <td className="py-3 pr-4">
                                  <span className="text-xs font-mono">
                                    {record.score != null
                                      ? `${record.score}%`
                                      : "---"}
                                  </span>
                                </td>
                                <td className="py-3">
                                  <span className="text-xs text-[#8888A0]">
                                    {formatDate(record.completedAt)}
                                  </span>
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

            {/* Assignments Tab */}
            <TabsContent value="assignments" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Assigned People ({assignments.length})</CardTitle>
                    {sop.status === "PUBLISHED" && (
                      <Button variant="outline" size="sm" onClick={() => setShowAssignDialog(true)} className="gap-1.5">
                        <UserPlus size={14} /> Assign More
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {assignments.length === 0 ? (
                    <div className="text-center py-8">
                      <Users size={32} className="mx-auto text-[#8888A0] mb-2" />
                      <p className="text-sm text-[#8888A0]">No one assigned yet.</p>
                      {sop.status === "PUBLISHED" && (
                        <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setShowAssignDialog(true)}>
                          <UserPlus size={14} /> Assign People
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[#2A2A3A] text-[#8888A0]">
                            <th className="text-left py-2 pr-4 font-medium">Person</th>
                            <th className="text-left py-2 pr-4 font-medium">Status</th>
                            <th className="text-left py-2 pr-4 font-medium">Progress</th>
                            <th className="text-left py-2 pr-4 font-medium">Due Date</th>
                            <th className="text-left py-2 font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assignments.map((a: any) => {
                            const pct = a.stepsTotal > 0 ? Math.round((a.stepsCompleted / a.stepsTotal) * 100) : 0;
                            const isOverdue = a.status !== "COMPLETED" && a.dueDate && new Date(a.dueDate) < new Date();
                            return (
                              <tr key={a.id} className="border-b border-[#2A2A3A]/50">
                                <td className="py-3 pr-4">
                                  <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-purple-500/10 flex items-center justify-center text-xs font-bold text-purple-400">
                                      {a.user.firstName[0]}{a.user.lastName[0]}
                                    </div>
                                    <div>
                                      <p className="font-medium text-xs">{a.user.firstName} {a.user.lastName}</p>
                                      <p className="text-[10px] text-[#8888A0]">{a.user.department?.name || "—"}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 pr-4">
                                  {a.status === "COMPLETED" ? (
                                    <Badge variant="success" className="text-[10px]">Completed</Badge>
                                  ) : isOverdue ? (
                                    <Badge variant="destructive" className="text-[10px]">Overdue</Badge>
                                  ) : a.status === "IN_PROGRESS" ? (
                                    <Badge variant="warning" className="text-[10px]">In Progress</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-[10px]">Assigned</Badge>
                                  )}
                                  {a.mandatory && <Badge variant="outline" className="text-[10px] ml-1">Required</Badge>}
                                </td>
                                <td className="py-3 pr-4 min-w-[120px]">
                                  <div className="flex items-center gap-2">
                                    <Progress value={pct} className="h-1.5 flex-1" />
                                    <span className="text-xs font-mono text-[#8888A0]">{pct}%</span>
                                  </div>
                                </td>
                                <td className="py-3 pr-4">
                                  <span className={`text-xs ${isOverdue ? "text-red-400 font-medium" : "text-[#8888A0]"}`}>
                                    {a.dueDate ? formatDate(a.dueDate) : "—"}
                                  </span>
                                </td>
                                <td className="py-3">
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-300" onClick={() => handleRemoveAssignment(a.id)}>
                                    <Trash2 size={12} />
                                  </Button>
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

            {/* History Tab */}
            <TabsContent value="history" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Version History</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Array.from({ length: sop.version }, (_, i) => {
                      const ver = sop.version - i;
                      const isCurrent = ver === sop.version;
                      return (
                        <div
                          key={ver}
                          className="flex items-center gap-3 p-3 rounded-lg border border-[#2A2A3A] bg-[#0D0D14]"
                        >
                          <div
                            className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
                              isCurrent
                                ? "bg-purple-500/20 text-purple-400"
                                : "bg-[#1A1A26] text-[#8888A0]"
                            }`}
                          >
                            v{ver}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium">
                              Version {ver}
                              {isCurrent && (
                                <span className="text-purple-400 ml-2 text-xs">
                                  (Current)
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-[#8888A0]">
                              {isCurrent
                                ? formatDate(sop.updatedAt)
                                : formatDate(sop.createdAt)}
                            </p>
                          </div>
                          {isCurrent && (
                            <Badge variant="outline" className="text-[10px]">
                              Latest
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Tag size={14} className="text-[#8888A0] shrink-0" />
                <div>
                  <Label className="text-[10px] text-[#8888A0] uppercase tracking-wider">
                    Category
                  </Label>
                  <p className="text-sm">{sop.category || "Uncategorized"}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Activity size={14} className="text-[#8888A0] shrink-0" />
                <div>
                  <Label className="text-[10px] text-[#8888A0] uppercase tracking-wider">
                    Status
                  </Label>
                  <div className="mt-0.5">{getStatusBadge(sop.status)}</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Hash size={14} className="text-[#8888A0] shrink-0" />
                <div>
                  <Label className="text-[10px] text-[#8888A0] uppercase tracking-wider">
                    Version
                  </Label>
                  <p className="text-sm font-mono">v{sop.version}</p>
                </div>
              </div>

              <div className="border-t border-[#2A2A3A] pt-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Calendar size={14} className="text-[#8888A0] shrink-0" />
                  <div>
                    <Label className="text-[10px] text-[#8888A0] uppercase tracking-wider">
                      Created
                    </Label>
                    <p className="text-sm">{formatDate(sop.createdAt)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Calendar size={14} className="text-[#8888A0] shrink-0" />
                  <div>
                    <Label className="text-[10px] text-[#8888A0] uppercase tracking-wider">
                      Published
                    </Label>
                    <p className="text-sm">{formatDate(sop.publishedAt)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Clock size={14} className="text-[#8888A0] shrink-0" />
                  <div>
                    <Label className="text-[10px] text-[#8888A0] uppercase tracking-wider">
                      Last Updated
                    </Label>
                    <p className="text-sm">{formatDate(sop.updatedAt)}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Compliance Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#8888A0]">Total Assigned</span>
                <span className="text-sm font-mono font-bold">
                  {sop.compliance.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#8888A0] flex items-center gap-1">
                  <CheckCircle size={12} className="text-green-400" /> Completed
                </span>
                <span className="text-sm font-mono font-bold text-green-400">
                  {complianceCompleted.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#8888A0] flex items-center gap-1">
                  <AlertCircle size={12} className="text-orange-400" /> Pending
                </span>
                <span className="text-sm font-mono font-bold text-orange-400">
                  {compliancePending.length}
                </span>
              </div>
              {sop.compliance.length > 0 && (
                <div className="pt-2 border-t border-[#2A2A3A]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#8888A0]">
                      Completion Rate
                    </span>
                    <span className="text-sm font-mono font-bold text-purple-400">
                      {Math.round(
                        (complianceCompleted.length / sop.compliance.length) *
                          100
                      )}
                      %
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

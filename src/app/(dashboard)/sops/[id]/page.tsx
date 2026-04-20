"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  GitBranch,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { ChecklistBuilder, ChecklistSection } from "@/components/checklist-builder";
import { ProcessFlowBuilder, type ProcessFlow } from "@/components/process-flow-builder";
import { RichEditor } from "@/components/ui/rich-editor";
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
  content: { type?: string; steps?: SOPStep[] | RecordedStep[]; sections?: ChecklistSection[]; flow?: ProcessFlow };
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

function RichTextSopEditor({ content, editable, onSave }: { content: string; editable: boolean; onSave: (html: string) => void }) {
  const [html, setHtml] = useState(content);
  const [dirty, setDirty] = useState(false);

  return (
    <div>
      <RichEditor
        content={html}
        onChange={(newHtml) => { setHtml(newHtml); setDirty(true); }}
        editable={editable}
        placeholder="Write your SOP content here... Use headings, lists, bold text, links, and images."
        minHeight="400px"
      />
      {editable && dirty && (
        <div className="flex justify-end p-3 border-t border-border">
          <Button size="sm" onClick={() => { onSave(html); setDirty(false); }} className="gap-1.5">
            <Save size={14} /> Save Content
          </Button>
        </div>
      )}
    </div>
  );
}

function VersionHistoryTab({ sopId, currentVersion, onRollback }: { sopId: string; currentVersion: number; onRollback: () => void }) {
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState(false);
  const { success: ts, error: te } = useToast();

  useEffect(() => {
    fetch(`/api/sops/${sopId}/versions`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.data?.versions) setVersions(d.data.versions); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sopId]);

  async function handleRollback(versionId: string, ver: number) {
    if (!confirm(`Rollback to v${ver}? Current content will be saved as a new version.`)) return;
    setRolling(true);
    try {
      const res = await fetch(`/api/sops/${sopId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      if (res.ok) {
        ts(`Rolled back to v${ver}`);
        onRollback();
      } else {
        const err = await res.json();
        te(err.error || "Rollback failed");
      }
    } catch { te("Rollback failed"); } finally { setRolling(false); }
  }

  if (loading) return <Card><CardContent className="p-4"><div className="h-32 bg-surface-2 rounded animate-pulse" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Version History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Current version */}
          <div className="flex items-center gap-3 p-3 rounded-lg border border-[rgba(212,255,46,0.3)] bg-[rgba(212,255,46,0.06)]">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[rgba(212,255,46,0.12)] text-[#d4ff2e] text-xs font-bold">v{currentVersion}</div>
            <div className="flex-1">
              <p className="text-sm font-medium">Current Version</p>
              <p className="text-xs text-muted">Live version</p>
            </div>
            <Badge variant="outline" className="text-[10px]">Latest</Badge>
          </div>

          {/* Past versions */}
          {versions.length === 0 ? (
            <p className="text-xs text-muted text-center py-4">No previous versions. Versions are saved when you publish.</p>
          ) : (
            versions.map((v: any) => (
              <div key={v.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-2 text-muted text-xs font-bold">v{v.version}</div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{v.title}</p>
                  <p className="text-xs text-muted">{new Date(v.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => handleRollback(v.id, v.version)} disabled={rolling}>
                  Rollback
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SOPDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { canManageSOPs } = useRole();
  const [sop, setSop] = useState<SOP | null>(null);

  // Debounced server persistence for recorded-SOP step mutations
  // (reorder / edit description / add / delete). Reorders and edits
  // update local state immediately and collapse rapid-fire PATCH
  // requests into one trailing save, so the UI feels instant even when
  // S3 URL regeneration makes the server round-trip slow.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef<any>(null);

  const persistRecordedStepsDebounced = useCallback((newSteps: RecordedStep[]) => {
    setSop((prev) => {
      if (!prev) return prev;
      const nextContent = { ...(prev.content as any), steps: newSteps };
      pendingContentRef.current = nextContent;
      return { ...prev, content: nextContent } as SOP;
    });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const content = pendingContentRef.current;
      pendingContentRef.current = null;
      saveTimerRef.current = null;
      if (!content) return;
      fetch(`/api/sops/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }).catch(() => {});
    }, 400);
  }, [id]);

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
  const [processFlow, setProcessFlow] = useState<ProcessFlow>({ type: "process_flow", steps: [] });
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
        fetch("/api/users?limit=500"),
        fetch("/api/departments"),
      ]);
      if (usersRes.ok) {
        const data = await usersRes.json();
        setOrgUsers(Array.isArray(data) ? data : data.data || data.users || []);
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
      } else if (data.content?.type === "process_flow") {
        setProcessFlow({
          type: "process_flow",
          steps: Array.isArray(data.content?.flow?.steps) ? data.content.flow.steps : [],
        });
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
    // For richtext SOPs, preserve existing content (it's saved via its own Save button)
    if (sop?.content && (sop.content as any).type === "richtext") {
      return sop.content;
    }
    if (sop?.content && (sop.content as any).type === "process_flow") {
      return { type: "process_flow", flow: processFlow };
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
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 bg-surface-2 rounded animate-pulse" />
          <div className="h-6 w-64 bg-surface-2 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="h-64 bg-surface-2 rounded-lg animate-pulse" />
            <div className="h-48 bg-surface-2 rounded-lg animate-pulse" />
          </div>
          <div className="h-80 bg-surface-2 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (!sop) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <AlertCircle size={48} className="text-muted" />
        <p className="text-muted">SOP not found</p>
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
    <div className="space-y-4 animate-fade-in">
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
            <div className="rounded-lg bg-[rgba(212,255,46,0.08)] p-2 shrink-0">
              <FileText size={20} className="text-[#d4ff2e]" />
            </div>
            <div className="min-w-0">
              {editing ? (
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="text-lg font-bold bg-transparent border-border h-auto py-1"
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
                    <p className="text-sm text-muted">
                      Share this link with anyone who needs to complete this process:
                    </p>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-3 border border-border">
                      <Link2 size={14} className="text-[#d4ff2e] shrink-0" />
                      <code className="text-xs text-[#d4ff2e] flex-1 break-all">{shareLink}</code>
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
                    <div className="max-h-48 overflow-y-auto border border-border rounded-md p-2 space-y-1">
                      {orgUsers.map((u: any) => {
                        const alreadyAssigned = assignments.some((a: any) => a.userId === u.id);
                        return (
                          <label key={u.id} className={`flex items-center gap-2 p-1.5 rounded hover:bg-surface-2 text-sm ${alreadyAssigned ? "opacity-40" : "cursor-pointer"}`}>
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
                            {u.department?.name && <span className="text-muted text-xs ml-auto">{u.department.name}</span>}
                            {alreadyAssigned && <span className="text-[10px] text-muted ml-auto">Already assigned</span>}
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
                <p className="text-sm text-muted py-4">
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
                <p className="text-sm text-muted py-4">
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
                      className="bg-transparent border-border"
                    />
                  ) : (
                    <p className="text-sm text-muted">
                      {sop.description || "No description provided."}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Rich Text Editor for "Write" type SOPs */}
              {sop.content && (sop.content as any).type === "richtext" && (
                <Card>
                  <CardContent className="p-0">
                    <RichTextSopEditor
                      content={(sop.content as any).html || ""}
                      editable={editing}
                      onSave={async (html) => {
                        await fetch(`/api/sops/${id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ content: { type: "richtext", html } }),
                        });
                        fetchSOP();
                      }}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Steps / Checklist Builder */}
              {sop.sopType === "CHECKLIST" ? (
                <div>
                  {aiGenerating && (
                    <p className="text-xs text-[#d4ff2e] animate-pulse mb-2">Generating with AI...</p>
                  )}
                  <ChecklistBuilder
                    sections={checklistSections}
                    onChange={setChecklistSections}
                    editing={editing}
                    onAiGenerate={handleAiGenerate}
                  />
                </div>
              ) : sop.content?.type === "process_flow" ? (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">
                        Process flow ({processFlow.steps.length} step{processFlow.steps.length === 1 ? "" : "s"})
                      </CardTitle>
                      {editing && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const converted: SOPStep[] = processFlow.steps.map((s) => ({
                              id: s.id,
                              title: s.title,
                              description: s.description,
                            }));
                            setSteps(converted);
                            setSop({ ...(sop as SOP), content: { ...(sop.content || {}), type: undefined, flow: undefined } });
                          }}
                          className="gap-1.5 text-xs"
                        >
                          Convert to simple steps
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ProcessFlowBuilder
                      flow={processFlow}
                      onChange={setProcessFlow}
                      editing={editing}
                    />
                  </CardContent>
                </Card>
              ) : (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-sm">
                      Steps ({sop?.content?.type === "recorded" ? (sop.content.steps as any[])?.length || 0 : steps.length})
                    </CardTitle>
                    {editing && sop?.sopType === "WRITTEN" && sop?.content?.type !== "recorded" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const flowSteps = steps.map((s) => ({
                            id: s.id,
                            title: s.title || "Untitled",
                            description: s.description,
                            type: "action" as const,
                          }));
                          setProcessFlow({ type: "process_flow", steps: flowSteps });
                          setSop({ ...(sop as SOP), content: { ...(sop.content || {}), type: "process_flow", flow: { type: "process_flow", steps: flowSteps } } });
                        }}
                        className="gap-1.5 text-xs text-muted hover:text-[#d4ff2e]"
                      >
                        <GitBranch size={12} /> Switch to process flow
                      </Button>
                    )}
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
                  {sop?.content?.type === "recorded" && Array.isArray(sop.content.steps) && sop.content.steps.length > 0 ? (
                    <>
                    {/* Recorded SOP — editable steps with add/delete/reorder */}
                    {((sop.content.steps || []) as RecordedStep[]).map((step, index) => {
                      const totalSteps = (sop.content.steps as RecordedStep[]).length;
                      return (
                      <div key={index} className="rounded-lg border border-border bg-surface-3 overflow-hidden group">
                        <div className="flex items-start gap-3 p-4">
                          {/* Move up/down + step number */}
                          <div className="flex flex-col items-center gap-1 shrink-0">
                            {editing && index > 0 && (
                              <button className="text-muted hover:text-foreground text-xs" onClick={() => {
                                const s = [...(sop.content.steps as RecordedStep[])];
                                [s[index - 1], s[index]] = [s[index], s[index - 1]];
                                s.forEach((st, i) => { st.order = i + 1; });
                                persistRecordedStepsDebounced(s);
                              }}>▲</button>
                            )}
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[rgba(212,255,46,0.08)] text-[#d4ff2e] text-sm font-bold">
                              {index + 1}
                            </div>
                            {editing && index < totalSteps - 1 && (
                              <button className="text-muted hover:text-foreground text-xs" onClick={() => {
                                const s = [...(sop.content.steps as RecordedStep[])];
                                [s[index], s[index + 1]] = [s[index + 1], s[index]];
                                s.forEach((st, i) => { st.order = i + 1; });
                                persistRecordedStepsDebounced(s);
                              }}>▼</button>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            {editing ? (
                              <input
                                type="text"
                                defaultValue={step.description || `Step ${index + 1}`}
                                className="w-full text-sm font-medium bg-transparent border-b border-border pb-1 focus:border-[#d4ff2e] focus:outline-none"
                                onBlur={(e) => {
                                  const newSteps = [...(sop.content.steps as RecordedStep[])];
                                  newSteps[index] = { ...newSteps[index], description: e.target.value };
                                  persistRecordedStepsDebounced(newSteps);
                                }}
                              />
                            ) : (
                              <p className="text-sm font-medium">{step.description || `Step ${index + 1}`}</p>
                            )}
                            {step.url && <p className="text-xs text-muted-2 mt-0.5 truncate">{step.url}</p>}
                          </div>
                          {/* Delete button */}
                          {editing && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 shrink-0" onClick={() => {
                              const newSteps = (sop.content.steps as RecordedStep[]).filter((_, i) => i !== index);
                              newSteps.forEach((st, i) => { st.order = i + 1; });
                              persistRecordedStepsDebounced(newSteps);
                            }}>
                              <X size={14} />
                            </Button>
                          )}
                        </div>
                        {step.screenshot && (
                          <div className="px-4 pb-4">
                            <img src={step.screenshot} alt={`Step ${index + 1}`} loading="lazy" decoding="async" className="w-full rounded-lg border border-border" />
                          </div>
                        )}
                      </div>
                      );
                    })}
                    {/* Add Step button for recorded SOPs */}
                    {editing && (
                      <Button variant="ghost" size="sm" className="w-full border border-dashed border-border text-muted hover:text-[#e2ff6b] gap-1.5 mt-2" onClick={() => {
                        const newSteps = [...(sop.content.steps as RecordedStep[]), {
                          order: (sop.content.steps as RecordedStep[]).length + 1,
                          action: "manual",
                          description: "New step — click to edit",
                          url: "",
                          screenshot: null,
                          elementText: "",
                          elementTag: "",
                        }];
                        persistRecordedStepsDebounced(newSteps);
                      }}>
                        <Plus size={14} /> Add Step
                      </Button>
                    )}
                    </>
                  ) : steps.length === 0 ? (
                    <div className="text-center py-8">
                      <FileText
                        size={32}
                        className="mx-auto text-muted mb-2"
                      />
                      <p className="text-sm text-muted">
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
                  ) : (
                    steps.map((step, index) => (
                      <div
                        key={step.id}
                        className="flex items-start gap-3 p-3 rounded-lg border border-border bg-surface-3 group"
                      >
                        <div className="pt-0.5 text-muted opacity-30">
                          <GripVertical size={16} />
                        </div>
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-[rgba(212,255,46,0.08)] text-[#d4ff2e] text-xs font-bold shrink-0 mt-0.5">
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
                                className="bg-transparent border-border h-8 text-sm"
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
                                className="bg-transparent border-border text-sm"
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
                                  <span className="text-muted italic">Untitled step</span>
                                )}
                              </p>
                              {step.description && (
                                <p className="text-xs text-muted mt-0.5">{step.description}</p>
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
                        className="mx-auto text-muted mb-2"
                      />
                      <p className="text-sm text-muted">
                        No compliance records yet.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-muted">
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
                                className="border-b border-border/50"
                              >
                                <td className="py-3 pr-4">
                                  <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-[rgba(212,255,46,0.08)] flex items-center justify-center text-xs font-bold text-[#d4ff2e]">
                                      {record.user.firstName[0]}
                                      {record.user.lastName[0]}
                                    </div>
                                    <div>
                                      <p className="font-medium text-xs">
                                        {record.user.firstName}{" "}
                                        {record.user.lastName}
                                      </p>
                                      <p className="text-[10px] text-muted">
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
                                  <span className="text-xs text-muted">
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
                      <Users size={32} className="mx-auto text-muted mb-2" />
                      <p className="text-sm text-muted">No one assigned yet.</p>
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
                          <tr className="border-b border-border text-muted">
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
                              <tr key={a.id} className="border-b border-border/50">
                                <td className="py-3 pr-4">
                                  <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-[rgba(212,255,46,0.08)] flex items-center justify-center text-xs font-bold text-[#d4ff2e]">
                                      {a.user.firstName[0]}{a.user.lastName[0]}
                                    </div>
                                    <div>
                                      <p className="font-medium text-xs">{a.user.firstName} {a.user.lastName}</p>
                                      <p className="text-[10px] text-muted">{a.user.department?.name || "—"}</p>
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
                                    <span className="text-xs font-mono text-muted">{pct}%</span>
                                  </div>
                                </td>
                                <td className="py-3 pr-4">
                                  <span className={`text-xs ${isOverdue ? "text-red-400 font-medium" : "text-muted"}`}>
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
              <VersionHistoryTab sopId={id} currentVersion={sop.version} onRollback={fetchSOP} />
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
                <Tag size={14} className="text-muted shrink-0" />
                <div>
                  <Label className="text-[10px] text-muted uppercase tracking-wider">
                    Category
                  </Label>
                  <p className="text-sm">
                    {sop.category || "Uncategorized"}
                    {(sop as any).subcategory && <span className="text-muted"> / {(sop as any).subcategory}</span>}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Activity size={14} className="text-muted shrink-0" />
                <div>
                  <Label className="text-[10px] text-muted uppercase tracking-wider">
                    Status
                  </Label>
                  <div className="mt-0.5">{getStatusBadge(sop.status)}</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Hash size={14} className="text-muted shrink-0" />
                <div>
                  <Label className="text-[10px] text-muted uppercase tracking-wider">
                    Version
                  </Label>
                  <p className="text-sm font-mono">v{sop.version}</p>
                </div>
              </div>

              <div className="border-t border-border pt-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Calendar size={14} className="text-muted shrink-0" />
                  <div>
                    <Label className="text-[10px] text-muted uppercase tracking-wider">
                      Created
                    </Label>
                    <p className="text-sm">{formatDate(sop.createdAt)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Calendar size={14} className="text-muted shrink-0" />
                  <div>
                    <Label className="text-[10px] text-muted uppercase tracking-wider">
                      Published
                    </Label>
                    <p className="text-sm">{formatDate(sop.publishedAt)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Clock size={14} className="text-muted shrink-0" />
                  <div>
                    <Label className="text-[10px] text-muted uppercase tracking-wider">
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
                <span className="text-xs text-muted">Total Assigned</span>
                <span className="text-sm font-mono font-bold">
                  {sop.compliance.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted flex items-center gap-1">
                  <CheckCircle size={12} className="text-green-400" /> Completed
                </span>
                <span className="text-sm font-mono font-bold text-green-400">
                  {complianceCompleted.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted flex items-center gap-1">
                  <AlertCircle size={12} className="text-orange-400" /> Pending
                </span>
                <span className="text-sm font-mono font-bold text-orange-400">
                  {compliancePending.length}
                </span>
              </div>
              {sop.compliance.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">
                      Completion Rate
                    </span>
                    <span className="text-sm font-mono font-bold text-[#d4ff2e]">
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

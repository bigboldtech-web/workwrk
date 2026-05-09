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
  ChevronUp,
  ChevronDown,
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
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { ChecklistBuilder, ChecklistSection } from "@/components/checklist-builder";
import { ProcessFlowBuilder, type ProcessFlow } from "@/components/process-flow-builder";
import { RichEditor } from "@/components/ui/rich-editor";
import { useRole } from "@/hooks/use-role";
import {
  useAutosave,
  readAutosaveBackup,
  clearAutosaveBackup,
} from "@/hooks/use-autosave";

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
  /**
   * Rich HTML. Legacy steps with plain text still work — TipTap treats
   * raw strings as paragraphs, and the read-only renderer below falls
   * back to `whitespace-pre-wrap` for anything that doesn't contain tags.
   */
  description?: string;
  /** Optional inline image for the step (URL or data URI). */
  image?: string;
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
  subcategory: string | null;
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

// DB `sopType` only knows WRITTEN / RECORDED / CHECKLIST — the UI splits
// WRITTEN further into "Write" (rich-text body) and "Step-by-step"
// (ordered steps with no html), keyed off `content.type`. This helper
// collapses both axes into a single human label so every surface that
// needs to say "what kind of SOP is this?" stays in sync.
function getSopKindLabel(sop: SOP): string {
  if (sop.sopType === "CHECKLIST") return "Checklist";
  if (sop.sopType === "RECORDED") return "Recording";
  if ((sop.content as { type?: string } | null)?.type === "richtext") return "Write";
  if ((sop.content as { type?: string } | null)?.type === "recorded") return "Recording";
  return "Step-by-step";
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

// Small header pill reflecting the autosave state. Renders nothing when
// idle — the user only needs to know something is happening once they've
// actually changed something.
function AutosaveIndicator({
  status,
  lastSavedAt,
}: {
  status: "idle" | "dirty" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
}) {
  const [, tick] = useState(0);
  // Re-render every 15s while showing "Saved Xs ago" so the label stays fresh.
  useEffect(() => {
    if (status !== "saved") return;
    const id = setInterval(() => tick((v) => v + 1), 15_000);
    return () => clearInterval(id);
  }, [status]);

  if (status === "idle") return null;

  const common = "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border";
  if (status === "saving") {
    return <span className={`${common} border-[rgba(212,255,46,0.3)] bg-[rgba(212,255,46,0.08)] text-[color:var(--accent-strong)]`}>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#d4ff2e] animate-pulse" />
      Saving…
    </span>;
  }
  if (status === "dirty") {
    return <span className={`${common} border-orange-500/30 bg-orange-500/10 text-orange-400`}>
      Unsaved changes
    </span>;
  }
  if (status === "error") {
    return <span className={`${common} border-red-500/30 bg-red-500/10 text-red-400`}>
      Save failed — retrying
    </span>;
  }
  // saved
  return <span className={`${common} border-green-500/30 bg-green-500/10 text-green-400`}>
    <CheckCircle size={10} /> Saved {lastSavedAt ? formatSavedAgo(lastSavedAt) : "just now"}
  </span>;
}

function formatSavedAgo(at: Date): string {
  const s = Math.max(1, Math.floor((Date.now() - at.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

// Per-step image picker. Reuses the file->data-URI pattern the rich
// editor uses, so we don't need an upload endpoint before images can be
// attached. If the user later wants to host images externally, they can
// paste a URL instead of uploading.
function StepImageEditor({ image, onChange }: { image?: string; onChange: (img: string) => void }) {
  const prompt = usePrompt();
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      if (src) onChange(src);
    };
    reader.readAsDataURL(file);
  }

  async function handleUrl() {
    const url = await prompt({
      title: "Paste image URL",
      description: "Leave blank to remove the current image.",
      defaultValue: image || "",
      placeholder: "https://…",
      submitLabel: image ? "Save" : "Add image",
      required: false,
    });
    if (url === null) return;
    onChange(url);
  }

  if (image) {
    return (
      <div className="relative inline-block">
        <img src={image} alt="" className="max-h-40 rounded-md border border-border" />
        <div className="absolute top-1 right-1 flex gap-1">
          <button
            type="button"
            onClick={handleUrl}
            className="text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white hover:bg-black/80"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white hover:bg-black/80"
            aria-label="Remove image"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="text-[11px] px-2 py-1 rounded border border-dashed border-border text-muted hover:text-[#e2ff6b] hover:border-[#d4ff2e]"
      >
        + Upload image
      </button>
      <button
        type="button"
        onClick={handleUrl}
        className="text-[11px] px-2 py-1 rounded text-muted hover:text-[#e2ff6b]"
      >
        or paste URL
      </button>
    </div>
  );
}

// Read-only step description renderer. Old steps stored plain text in
// `description`; new steps store rich HTML. We sniff for tags so both
// shapes render correctly without converting legacy data.
function StepDescriptionView({ html }: { html?: string }) {
  if (!html) return null;
  const looksLikeHtml = /<[a-z][^>]*>/i.test(html);
  if (looksLikeHtml) {
    return (
      <div
        className="prose prose-sm dark:prose-invert max-w-none text-xs text-muted mt-0.5 [&_p]:my-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return <p className="text-xs text-muted mt-0.5 whitespace-pre-wrap">{html}</p>;
}

// Thin pass-through around the generic RichEditor — the parent holds
// the HTML state so the main "Save" button picks it up. An inline save
// button used to live here; it lied about what was persisted because the
// top-of-page Save would clobber the staged content with the pre-edit
// version. Now there is one save path, not two.
function RichTextSopEditor({ content, editable, onChange }: { content: string; editable: boolean; onChange: (html: string) => void }) {
  return (
    <RichEditor
      content={content}
      onChange={onChange}
      editable={editable}
      placeholder="Write your SOP content here. Press / for commands — headings, lists, callouts, tables, and more."
      minHeight="400px"
    />
  );
}

function VersionHistoryTab({ sopId, currentVersion, onRollback }: { sopId: string; currentVersion: number; onRollback: () => void }) {
  const confirm = useConfirm();
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
    if (!(await confirm({
      title: `Rollback to v${ver}?`,
      description: "Your current content will be saved as a new version, then v" + ver + " will be restored as the active draft.",
      confirmLabel: "Rollback",
      destructive: false,
    }))) return;
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
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[rgba(212,255,46,0.12)] text-[color:var(--accent-strong)] text-xs font-bold">v{currentVersion}</div>
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
  // Org-wide list of saved categories (with their subcategories) so the
  // detail page's editor mirrors the create dialog. Refreshed only when
  // the user opens a Select; cheap on the server.
  const [savedCategories, setSavedCategories] = useState<Array<{ id: string; name: string; subcategories: { id: string; name: string }[] }>>([]);
  const [savingCategory, setSavingCategory] = useState(false);
  // Category/subcategory are read-only by default. The pencil button
  // flips this to true so the dropdowns appear; saving auto-exits.
  const [editingCategory, setEditingCategory] = useState(false);
  useEffect(() => {
    fetch("/api/sop-categories")
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((d) => setSavedCategories(Array.isArray(d) ? d : d?.data || []))
      .catch(() => {});
  }, []);

  // Persist a category / subcategory change. Optimistic UI: we set the
  // local state first so the picker reflects the choice instantly, then
  // round-trip to the server to actually save. If the request fails we
  // roll back.
  async function patchCategory(partial: { category?: string | null; subcategory?: string | null }) {
    if (!sop) return;
    const previous = { category: sop.category, subcategory: sop.subcategory };
    setSop({ ...sop, ...partial } as SOP);
    setSavingCategory(true);
    try {
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      if (!res.ok) {
        setSop({ ...sop, ...previous } as SOP);
      }
    } catch {
      setSop({ ...sop, ...previous } as SOP);
    } finally {
      setSavingCategory(false);
    }
  }

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
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState("content");

  // Editable fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<SOPStep[]>([]);
  const [checklistSections, setChecklistSections] = useState<ChecklistSection[]>([]);
  const [processFlow, setProcessFlow] = useState<ProcessFlow>({ type: "process_flow", steps: [] });
  // Rich-text body for WRITTEN "write" SOPs. Lifted into the parent so
  // the main Save button includes it — previously the editor kept its
  // own draft in local state and the top-bar Save would overwrite it
  // with the pre-edit version, silently eating the user's changes.
  const [richtextHtml, setRichtextHtml] = useState("");
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  // DnD bookkeeping: which step is currently being dragged (by id), and
  // which step is being hovered as a drop target. We only track target
  // for visual feedback — the drop index is derived from the target id.
  const [draggingStepId, setDraggingStepId] = useState<string | null>(null);
  const [dragOverStepId, setDragOverStepId] = useState<string | null>(null);
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
    if (!(await confirm({
      title: "Remove this assignment?",
      description: "The assignee will no longer see this SOP in their assigned list. Their compliance history is kept.",
      confirmLabel: "Remove",
      destructive: true,
    }))) return;
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
      } else if (data.content?.type === "richtext") {
        setRichtextHtml((data.content as { html?: string })?.html || "");
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

  // Offer to restore an unsaved local backup if one exists and is newer
  // than the server's `updatedAt`. Backups older than a week are treated
  // as stale and cleaned up silently — stale drafts do more harm than
  // good.
  const MAX_BACKUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  interface SopAutosaveSnapshot { title: string; description: string; content: unknown }
  const [restorePrompt, setRestorePrompt] = useState<{ key: string; at: number; data: SopAutosaveSnapshot } | null>(null);

  useEffect(() => {
    if (!sop) return;
    const key = `sop-autosave:${sop.id}`;
    const backup = readAutosaveBackup<SopAutosaveSnapshot>(key);
    if (!backup) return;
    const age = Date.now() - backup.at;
    const serverTime = new Date(sop.updatedAt).getTime();
    if (age > MAX_BACKUP_AGE_MS || backup.at <= serverTime) {
      clearAutosaveBackup(key);
      return;
    }
    setRestorePrompt({ key, at: backup.at, data: backup.data });
    // Run only when the SOP id or its server updatedAt changes — we
    // don't want this firing on every autosave tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sop?.id, sop?.updatedAt]);

  const applyRestoredSnapshot = (snap: SopAutosaveSnapshot) => {
    setTitle(snap.title || "");
    setDescription(snap.description || "");
    const c = (snap.content || {}) as any;
    if (sop?.sopType === "CHECKLIST") {
      setChecklistSections((c.sections || []) as ChecklistSection[]);
    } else if (c.type === "richtext") {
      setRichtextHtml(c.html || "");
    } else if (c.type === "process_flow") {
      setProcessFlow({
        type: "process_flow",
        steps: Array.isArray(c.flow?.steps) ? c.flow.steps : [],
      });
    } else if (Array.isArray(c.steps)) {
      setSteps(c.steps as SOPStep[]);
    }
  };

  const getContentPayload = () => {
    if (sop?.sopType === "CHECKLIST") {
      return { sections: checklistSections };
    }
    if (sop?.content && (sop.content as any).type === "richtext") {
      return { type: "richtext", html: richtextHtml };
    }
    if (sop?.content && (sop.content as any).type === "process_flow") {
      return { type: "process_flow", flow: processFlow };
    }
    return { steps };
  };

  // Autosave snapshot — the shape that gets watched for changes and
  // written to localStorage as a crash-recovery backup. Kept flat so
  // JSON.stringify comparison is cheap and deterministic.
  const autosaveSnapshot = {
    title,
    description,
    content: getContentPayload(),
  };

  // Only autosave DRAFT SOPs. Published SOPs shouldn't drift live because
  // someone typed — those need explicit Save (and ideally Publish → new
  // version).
  const autosaveEnabled = editing && !!sop && sop.status === "DRAFT";
  const autosaveKey = sop ? `sop-autosave:${sop.id}` : undefined;

  const autosave = useAutosave({
    snapshot: autosaveSnapshot,
    enabled: autosaveEnabled,
    localKey: autosaveKey,
    delay: 1500,
    save: async (snap) => {
      const res = await fetch(`/api/sops/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snap),
      });
      if (!res.ok) throw new Error("Autosave failed");
      const updated = await res.json();
      // Keep local sop in sync so updatedAt / content are current. We
      // avoid touching the edit-buffer state here — the user may still
      // be typing, and overwriting it would clobber in-flight keystrokes.
      setSop((prev) => (prev ? { ...prev, ...updated, content: prev.content } : prev));
    },
  });

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
      // Explicit save succeeded — drop the local crash backup so the next
      // page load doesn't offer to restore stale content.
      if (autosaveKey) clearAutosaveBackup(autosaveKey);
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

  // Move a step to a new index. Used by both drag-and-drop (drop target)
  // and the up/down buttons (+1 / -1 neighbor swap).
  const moveStep = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= steps.length || toIndex >= steps.length) return;
    const next = steps.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    setSteps(next);
  };

  if (loading) {
    return (
      <div className="space-y-3 animate-fade-in">
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
    <div className="space-y-3 animate-fade-in">
      {/* Unsaved-backup restore banner */}
      {restorePrompt && (
        <Card className="border-[rgba(212,255,46,0.3)] bg-[rgba(212,255,46,0.04)]">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertCircle size={18} className="text-[color:var(--accent-strong)] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Unsaved changes found</p>
              <p className="text-xs text-muted">
                Local backup from {formatSavedAgo(new Date(restorePrompt.at))} that wasn&apos;t
                synced to the server. Restore it to keep editing, or discard to use the saved version.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (restorePrompt) clearAutosaveBackup(restorePrompt.key);
                setRestorePrompt(null);
              }}
            >
              Discard
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!restorePrompt) return;
                applyRestoredSnapshot(restorePrompt.data);
                // Drop into edit mode so autosave picks up from here.
                setEditing(true);
                setRestorePrompt(null);
                toastSuccess("Restored unsaved changes — autosaving now");
              }}
              className="gap-1.5"
            >
              Restore
            </Button>
          </CardContent>
        </Card>
      )}

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
              <FileText size={20} className="text-[color:var(--accent-strong)]" />
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
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {getStatusBadge(sop.status)}
                <Badge variant="secondary" className="text-[10px]">
                  {getSopKindLabel(sop)}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  v{sop.version}
                </Badge>
                {editing && sop.status === "DRAFT" && (
                  <AutosaveIndicator status={autosave.status} lastSavedAt={autosave.lastSavedAt} />
                )}
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
                  } else if (sop.content?.type === "richtext") {
                    setRichtextHtml((sop.content as { html?: string })?.html || "");
                  } else {
                    setSteps((sop.content?.type === "recorded" ? [] : sop.content?.steps || []) as SOPStep[]);
                  }
                  setEditingStepId(null);
                  // User explicitly cancelled — drop any autosaved draft
                  // so it doesn't re-surface as a restore prompt later.
                  if (autosaveKey) clearAutosaveBackup(autosaveKey);
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
                      <Link2 size={14} className="text-[color:var(--accent-strong)] shrink-0" />
                      <code className="text-xs text-[color:var(--accent-strong)] flex-1 break-all">{shareLink}</code>
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

              {/* Rich Text Editor for "Write" type SOPs — parent owns the
                  html so the top-bar Save persists it along with title /
                  description / type-specific content in one request. */}
              {sop.content && (sop.content as any).type === "richtext" && (
                <Card>
                  <CardContent className="p-0">
                    <RichTextSopEditor
                      content={richtextHtml}
                      editable={editing}
                      onChange={setRichtextHtml}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Steps / Checklist Builder */}
              {sop.sopType === "CHECKLIST" ? (
                <div>
                  {aiGenerating && (
                    <p className="text-xs text-[color:var(--accent-strong)] animate-pulse mb-2">Generating with AI...</p>
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
                        className="gap-1.5 text-xs text-muted hover:text-[color:var(--accent-strong)]"
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
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[rgba(212,255,46,0.08)] text-[color:var(--accent-strong)] text-sm font-bold">
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
                    steps.map((step, index) => {
                      const isDragging = draggingStepId === step.id;
                      const isDropTarget = dragOverStepId === step.id && draggingStepId && draggingStepId !== step.id;
                      return (
                      <div
                        key={step.id}
                        draggable={editing && editingStepId !== step.id}
                        onDragStart={(e) => {
                          setDraggingStepId(step.id);
                          e.dataTransfer.effectAllowed = "move";
                          // Some browsers need data to be set for a drag to begin.
                          e.dataTransfer.setData("text/plain", step.id);
                        }}
                        onDragOver={(e) => {
                          if (!draggingStepId || draggingStepId === step.id) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (dragOverStepId !== step.id) setDragOverStepId(step.id);
                        }}
                        onDragLeave={() => {
                          if (dragOverStepId === step.id) setDragOverStepId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const fromId = draggingStepId || e.dataTransfer.getData("text/plain");
                          if (!fromId || fromId === step.id) return;
                          const from = steps.findIndex((s) => s.id === fromId);
                          if (from === -1) return;
                          moveStep(from, index);
                          setDraggingStepId(null);
                          setDragOverStepId(null);
                        }}
                        onDragEnd={() => {
                          setDraggingStepId(null);
                          setDragOverStepId(null);
                        }}
                        className={`flex items-start gap-3 p-3 rounded-lg border bg-surface-3 group transition-all ${
                          isDragging ? "opacity-40" : ""
                        } ${
                          isDropTarget ? "border-[#d4ff2e] ring-1 ring-[rgba(212,255,46,0.35)]" : "border-border"
                        }`}
                      >
                        <div
                          className={`pt-0.5 text-muted transition-opacity ${editing ? "opacity-60 hover:opacity-100 cursor-grab active:cursor-grabbing" : "opacity-30"}`}
                          aria-label="Drag to reorder"
                          title={editing ? "Drag to reorder" : undefined}
                        >
                          <GripVertical size={16} />
                        </div>
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-[rgba(212,255,46,0.08)] text-[color:var(--accent-strong)] text-xs font-bold shrink-0 mt-0.5">
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
                                  if (e.key === "Enter" && e.metaKey) setEditingStepId(null);
                                }}
                              />
                              <RichEditor
                                content={step.description || ""}
                                onChange={(html) => updateStep(step.id, "description", html)}
                                placeholder="Add details, links, lists, or formatting… Press / for commands."
                                editable
                                compact
                                minHeight="80px"
                              />
                              <StepImageEditor
                                image={step.image}
                                onChange={(img) => updateStep(step.id, "image", img)}
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
                              <StepDescriptionView html={step.description} />
                              {step.image && (
                                <img
                                  src={step.image}
                                  alt=""
                                  loading="lazy"
                                  className="mt-2 rounded-md border border-border max-h-48"
                                />
                              )}
                            </div>
                          )}
                        </div>
                        {editing && (
                          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted hover:text-foreground disabled:opacity-30"
                              onClick={() => moveStep(index, index - 1)}
                              disabled={index === 0}
                              aria-label="Move step up"
                              title="Move up"
                            >
                              <ChevronUp size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted hover:text-foreground disabled:opacity-30"
                              onClick={() => moveStep(index, index + 1)}
                              disabled={index === steps.length - 1}
                              aria-label="Move step down"
                              title="Move down"
                            >
                              <ChevronDown size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-red-400 hover:text-red-300 ml-1"
                              onClick={() => removeStep(step.id)}
                              aria-label="Remove step"
                            >
                              <X size={14} />
                            </Button>
                          </div>
                        )}
                      </div>
                      );
                    })
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
                                    <div className="w-7 h-7 rounded-full bg-[rgba(212,255,46,0.08)] flex items-center justify-center text-xs font-bold text-[color:var(--accent-strong)]">
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
                                    <div className="w-7 h-7 rounded-full bg-[rgba(212,255,46,0.08)] flex items-center justify-center text-xs font-bold text-[color:var(--accent-strong)]">
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
              <div className="flex items-start gap-3">
                <Tag size={14} className="text-muted shrink-0 mt-1" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] text-muted uppercase tracking-wider">
                      Category {savingCategory && <span className="text-muted-2 normal-case ml-1">· saving…</span>}
                    </Label>
                    {canManageSOPs && (
                      editingCategory ? (
                        <button
                          type="button"
                          onClick={() => setEditingCategory(false)}
                          className="text-[10px] text-muted hover:text-foreground inline-flex items-center gap-1"
                        >
                          <CheckCircle size={11} /> Done
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingCategory(true)}
                          className="text-[10px] text-muted hover:text-foreground inline-flex items-center gap-1"
                          aria-label="Edit category"
                        >
                          <Edit3 size={11} /> Edit
                        </button>
                      )
                    )}
                  </div>
                  {canManageSOPs && editingCategory ? (
                    <div className="space-y-1.5 mt-1">
                      <Select
                        value={sop.category ?? "__none__"}
                        onValueChange={(v) => patchCategory({
                          category: v === "__none__" ? null : v,
                          // Reset subcategory when the parent category changes,
                          // since subcategory names live under a parent.
                          subcategory: v === sop.category ? sop.subcategory : null,
                        })}
                        disabled={savingCategory}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="No category" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No category</SelectItem>
                          {savedCategories.map((c) => (
                            <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {sop.category && (
                        <Select
                          value={sop.subcategory ?? "__none__"}
                          onValueChange={(v) => patchCategory({ subcategory: v === "__none__" ? null : v })}
                          disabled={savingCategory}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="No subcategory" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No subcategory</SelectItem>
                            {(savedCategories.find((c) => c.name === sop.category)?.subcategories ?? []).map((s) => (
                              <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm mt-0.5">
                      {sop.category || <span className="text-muted">Uncategorized</span>}
                      {sop.subcategory && <span className="text-muted"> / {sop.subcategory}</span>}
                    </p>
                  )}
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
                <FileText size={14} className="text-muted shrink-0" />
                <div>
                  <Label className="text-[10px] text-muted uppercase tracking-wider">
                    Type
                  </Label>
                  <p className="text-sm">{getSopKindLabel(sop)}</p>
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
                    <span className="text-sm font-mono font-bold text-[color:var(--accent-strong)]">
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

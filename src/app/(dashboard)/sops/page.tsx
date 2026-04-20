"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BookOpen, Plus, Search, FileText, Clock, CheckCircle, AlertTriangle,
  Eye, Edit3, Users, BarChart3, ClipboardList, ShieldCheck,
  PenLine, Video, ListChecks, Download, Archive, RotateCcw, Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";

interface SOPCompliance {
  stepsTotal: number;
  stepsCompleted: number;
  user: Record<string, unknown>;
}

interface SOP {
  id: string;
  title: string;
  description: string;
  category: string;
  subcategory?: string | null;
  content: { steps: unknown[] };
  version: number;
  status: string;
  publishedAt: string | null;
  compliance: SOPCompliance[];
  createdAt: string;
}

function getComplianceScore(sop: SOP): number {
  if (!sop.compliance || sop.compliance.length === 0) return 0;
  const totalSteps = sop.compliance.reduce((acc, c) => acc + c.stepsTotal, 0);
  const completedSteps = sop.compliance.reduce((acc, c) => acc + c.stepsCompleted, 0);
  if (totalSteps === 0) return 0;
  return Math.round((completedSteps / totalSteps) * 100);
}

function getAssignedCount(sop: SOP): number {
  return sop.compliance?.length ?? 0;
}

function getStepsCount(sop: SOP): number {
  return sop.content?.steps?.length ?? 0;
}

function getComplianceColor(score: number) {
  if (score >= 90) return "bg-green-500";
  if (score >= 70) return "bg-[#d4ff2e]";
  if (score >= 50) return "bg-orange-500";
  return "bg-red-500";
}

function getComplianceText(score: number) {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-[#d4ff2e]";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

function getStatusBadge(status: string) {
  switch (status) {
    case "PUBLISHED": return <Badge variant="success">Published</Badge>;
    case "IN_REVIEW": return <Badge variant="warning">In Review</Badge>;
    case "DRAFT": return <Badge variant="secondary">Draft</Badge>;
    case "ARCHIVED": return <Badge variant="outline">Archived</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toISOString().split("T")[0];
}

function SkeletonCard() {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-surface-2 p-2 h-8 w-8 animate-pulse" />
            <div className="h-5 w-16 bg-surface-2 rounded animate-pulse" />
          </div>
          <div className="h-5 w-10 bg-surface-2 rounded animate-pulse" />
        </div>
        <div className="h-4 w-3/4 bg-surface-2 rounded animate-pulse" />
        <div className="h-3 w-16 bg-surface-2 rounded animate-pulse" />
        <div className="h-1.5 w-full bg-surface-2 rounded animate-pulse mt-3" />
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          <div className="h-3 w-24 bg-surface-2 rounded animate-pulse" />
          <div className="h-3 w-16 bg-surface-2 rounded animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}

function ExtensionSetupContent({ onClose }: { onClose: () => void }) {
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Announce our origin back to the extension. On staging / localhost /
    // self-hosted, this tells the recorder popup which server to POST to
    // so users don't have to configure it manually.
    const announceOrigin = () => {
      try {
        window.postMessage({ type: "WORKWRK_APP_ORIGIN", origin: window.location.origin }, "*");
      } catch {}
    };

    const check = () => {
      const detected = document.documentElement.getAttribute("data-workwrk-extension") === "true";
      setExtensionDetected(detected);
      setChecking(false);
      if (detected) announceOrigin();
    };

    const handler = (event: MessageEvent) => {
      if (event.data?.type === "WORKWRK_EXTENSION_INSTALLED") {
        setExtensionDetected(true);
        setChecking(false);
        announceOrigin();
      }
    };
    window.addEventListener("message", handler);

    setTimeout(check, 500);

    return () => window.removeEventListener("message", handler);
  }, []);

  async function downloadExtension() {
    try {
      const res = await fetch("/api/extension/download");
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "workwrk-sop-recorder.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  }

  if (extensionDetected) {
    return (
      <div className="space-y-4 py-4">
        <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/10 text-center">
          <CheckCircle size={32} className="mx-auto text-green-400 mb-2" />
          <p className="text-sm font-semibold text-green-400">Extension Detected!</p>
          <p className="text-xs text-muted mt-1">WorkwrK SOP Recorder is installed and ready.</p>
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-medium">How to record:</p>
          <div className="flex items-start gap-2 p-2 rounded bg-surface">
            <span className="text-[#d4ff2e] font-bold">1.</span>
            <span>Click the <strong>WorkwrK icon</strong> in your browser toolbar</span>
          </div>
          <div className="flex items-start gap-2 p-2 rounded bg-surface">
            <span className="text-[#d4ff2e] font-bold">2.</span>
            <span>Click <strong>Start Recording</strong></span>
          </div>
          <div className="flex items-start gap-2 p-2 rounded bg-surface">
            <span className="text-[#d4ff2e] font-bold">3.</span>
            <span>Navigate through the process — each click captures a step with screenshot</span>
          </div>
          <div className="flex items-start gap-2 p-2 rounded bg-surface">
            <span className="text-[#d4ff2e] font-bold">4.</span>
            <span>Click <strong>Stop Recording</strong> — SOP is saved automatically</span>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Got it</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-4">
      {checking ? (
        <div className="p-4 text-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#d4ff2e] border-t-transparent mx-auto mb-2" />
          <p className="text-xs text-muted">Checking for extension...</p>
        </div>
      ) : (
        <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/10 text-center">
          <AlertTriangle size={32} className="mx-auto text-amber-400 mb-2" />
          <p className="text-sm font-semibold">Extension Not Found</p>
          <p className="text-xs text-muted mt-1">Install the WorkwrK SOP Recorder to start recording.</p>
        </div>
      )}

      <div className="space-y-2 text-sm">
        <p className="font-medium">Setup Instructions:</p>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-[#d4ff2e] font-bold">1.</span>
          <span>Click <strong>Download Extension</strong> below to get the ZIP file</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-[#d4ff2e] font-bold">2.</span>
          <span>Extract/unzip the downloaded file — you will get an <strong>extension</strong> folder</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-[#d4ff2e] font-bold">3.</span>
          <span>Open Chrome and type <code className="text-xs bg-surface-2 px-1 rounded">chrome://extensions</code> in the address bar</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-[#d4ff2e] font-bold">4.</span>
          <span>Enable <strong>Developer mode</strong> toggle (top right corner)</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-[#d4ff2e] font-bold">5.</span>
          <span>Click <strong>Load unpacked</strong> → select the <strong>extension</strong> folder from the extracted ZIP</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-[#d4ff2e] font-bold">6.</span>
          <span>Refresh this page — the extension will be detected automatically</span>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={downloadExtension} className="gap-1.5">
          <Download size={14} /> Download Extension
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function SOPsPage() {
  const router = useRouter();
  const { canManageSOPs, isEmployee } = useRole();
  const [sops, setSops] = useState<SOP[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [creating, setCreating] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Form state
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newSubcategory, setNewSubcategory] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [sopType, setSopType] = useState<"WRITTEN" | "STEPS" | "RECORDED" | "CHECKLIST">("WRITTEN");
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [archivedSops, setArchivedSops] = useState<SOP[]>([]);
  const [loadingArchive, setLoadingArchive] = useState(false);

  // Categories from DB
  const [savedCategories, setSavedCategories] = useState<any[]>([]);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAddSubcategory, setShowAddSubcategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newSubcatName, setNewSubcatName] = useState("");

  const { success: toastSuccess, error: toastError } = useToast();

  // Fetch saved categories
  useEffect(() => {
    fetch("/api/sop-categories")
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((d) => setSavedCategories(Array.isArray(d) ? d : d?.data || []))
      .catch(() => {});
  }, []);

  const selectedCategoryObj = savedCategories.find((c: any) => c.name === newCategory);
  const subcategories = selectedCategoryObj?.subcategories || [];

  async function handleAddCategory() {
    if (!newCatName.trim()) return;
    try {
      const res = await fetch("/api/sop-categories", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCatName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        const created = data.data || data;
        setSavedCategories([...savedCategories, created]);
        setNewCategory(created.name);
        setNewCatName("");
        setShowAddCategory(false);
        toastSuccess("Category added");
      } else {
        const err = await res.json();
        toastError(err.error || "Failed");
      }
    } catch { toastError("Failed to add category"); }
  }

  async function handleAddSubcategory() {
    if (!newSubcatName.trim() || !newCategory) { toastError("Select a category first"); return; }

    // Always fetch fresh categories to get the latest IDs
    let catObj: any = null;
    try {
      const freshRes = await fetch("/api/sop-categories");
      if (freshRes.ok) {
        const freshData = await freshRes.json();
        const freshCats = Array.isArray(freshData) ? freshData : freshData.data || [];
        setSavedCategories(freshCats);
        catObj = freshCats.find((c: any) => c.name === newCategory);
      }
    } catch {}

    // If still not found, create the category first
    if (!catObj) {
      try {
        const catRes = await fetch("/api/sop-categories", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newCategory }),
        });
        if (catRes.ok) {
          const catData = await catRes.json();
          catObj = catData.data || catData;
        } else {
          // Category might already exist — re-fetch to get its ID
          const retryRes = await fetch("/api/sop-categories");
          if (retryRes.ok) {
            const retryData = await retryRes.json();
            const retryCats = Array.isArray(retryData) ? retryData : retryData.data || [];
            setSavedCategories(retryCats);
            catObj = retryCats.find((c: any) => c.name === newCategory);
          }
        }
      } catch {}
    }

    if (!catObj?.id) { toastError("Failed to find or create category"); return; }

    try {
      const res = await fetch("/api/sop-categories", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSubcatName.trim(), categoryId: catObj.id }),
      });
      if (res.ok) {
        const data = await res.json();
        const created = data.data || data;
        // Refresh categories from server to get latest subcategories
        const refreshRes = await fetch("/api/sop-categories");
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          setSavedCategories(Array.isArray(refreshData) ? refreshData : refreshData.data || []);
        }
        setNewSubcategory(created.name);
        setNewSubcatName("");
        setShowAddSubcategory(false);
        toastSuccess("Subcategory added");
      } else {
        const err = await res.json();
        toastError(err.error || "Failed");
      }
    } catch { toastError("Failed to add subcategory"); }
  }

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, categoryFilter]);

  const fetchSOPs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      const res = await fetch(`/api/sops?${params}`);
      if (!res.ok) throw new Error("Failed to fetch SOPs");
      const json = await res.json();
      setSops(json.data || []);
      setTotal(json.pagination?.total || 0);
      setTotalPages(json.pagination?.totalPages || 0);
    } catch (err) {
      console.error("Error fetching SOPs:", err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, debouncedSearch, categoryFilter]);

  useEffect(() => {
    fetchSOPs();
  }, [fetchSOPs]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;

    // For recorded SOPs, the extension owns the recording mechanics but
    // the app owns the metadata — title, category (via the picker), etc.
    // If the extension is installed, we post the metadata across and tell
    // it to start recording immediately. Otherwise fall back to the setup
    // dialog so the user can install it.
    if (sopType === "RECORDED") {
      const extensionInstalled =
        document.documentElement.getAttribute("data-workwrk-extension") === "true";

      if (!extensionInstalled) {
        setShowAddDialog(false);
        setShowExtensionDialog(true);
        return;
      }

      window.postMessage({
        type: "WORKWRK_START_RECORDING",
        sop: {
          title: newTitle.trim(),
          category: newCategory || null,
          subcategory: newSubcategory || null,
          description: newDescription || null,
        },
      }, "*");

      setShowAddDialog(false);
      setNewTitle("");
      setNewCategory("");
      setNewSubcategory("");
      setNewDescription("");
      setSopType("WRITTEN");
      toastSuccess("Recording started — perform your workflow, then click the extension to stop & save.");
      return;
    }

    setCreating(true);
    try {
      // Map STEPS to WRITTEN sopType in DB (both use same model)
      const dbSopType = sopType === "STEPS" ? "WRITTEN" : sopType;
      const initialContent = sopType === "CHECKLIST"
        ? { sections: [] }
        : sopType === "WRITTEN"
        ? { type: "richtext", html: "" }
        : { steps: [] };

      const res = await fetch("/api/sops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          description: newDescription,
          category: newCategory,
          subcategory: newSubcategory || undefined,
          sopType: dbSopType,
          content: initialContent,
          status: "DRAFT",
        }),
      });
      if (!res.ok) throw new Error("Failed to create SOP");
      const created = await res.json();
      setShowAddDialog(false);
      setNewTitle("");
      setNewCategory("");
      setNewSubcategory("");
      setNewDescription("");
      setSopType("WRITTEN");
      toastSuccess("SOP created successfully");
      // Navigate to the detail page to start building
      router.push(`/sops/${created.id}`);
    } catch (err) {
      toastError("Failed to create SOP");
    } finally {
      setCreating(false);
    }
  };

  // Fetch archived SOPs
  const fetchArchivedSops = useCallback(async () => {
    setLoadingArchive(true);
    try {
      const res = await fetch("/api/sops?status=ARCHIVED&limit=100");
      if (res.ok) {
        const json = await res.json();
        setArchivedSops(json.data || []);
      }
    } catch {} finally { setLoadingArchive(false); }
  }, []);

  // Load archived count on mount, full list when archive is opened
  useEffect(() => {
    fetchArchivedSops();
  }, [fetchArchivedSops]);

  useEffect(() => {
    if (showArchive) fetchArchivedSops();
  }, [showArchive, fetchArchivedSops]);

  async function handleRestore(sopId: string) {
    try {
      const res = await fetch(`/api/sops/${sopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DRAFT" }),
      });
      if (res.ok) {
        setArchivedSops(archivedSops.filter((s) => s.id !== sopId));
        toastSuccess("SOP restored to Drafts");
        fetchSOPs(); // refresh main list
      } else { toastError("Failed to restore"); }
    } catch { toastError("Failed to restore"); }
  }

  async function handlePermanentDelete(sopId: string) {
    if (!confirm("Permanently delete this SOP? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/sops/${sopId}`, { method: "DELETE" });
      if (res.ok) {
        setArchivedSops(archivedSops.filter((s) => s.id !== sopId));
        toastSuccess("SOP permanently deleted");
      } else { toastError("Failed to delete"); }
    } catch { toastError("Failed to delete"); }
  }

  const savedCatNames = savedCategories.map((c: any) => c.name);
  const existingCategories = [...new Set(sops.map((s) => s.category).filter(Boolean))];
  const categories = [...new Set([...savedCatNames, ...existingCategories])].sort();

  const filtered = sops; // Server-side filtering now

  // Employees go directly to My SOPs
  useEffect(() => {
    if (isEmployee) router.replace("/sops/my-sops");
  }, [isEmployee, router]);

  if (isEmployee) {
    return <div className="flex items-center justify-center h-64"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[#d4ff2e] border-t-transparent" /></div>;
  }

  const publishedSops = sops.filter(s => s.status === "PUBLISHED");
  const avgCompliance = publishedSops.length > 0
    ? Math.round(publishedSops.reduce((acc, s) => acc + getComplianceScore(s), 0) / publishedSops.length)
    : 0;

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        kicker="SOPs · written · recorded · flows"
        title="SOPs"
        subtitle="Standard operating procedures — versioned, assignable, and nightly-audited."
        stats={[
          { label: "Published", value: total },
          { label: "Avg compliance", value: `${avgCompliance}%` },
        ]}
      />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div />
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/sops/my-sops">
            <Button variant="outline" className="gap-2"><ClipboardList size={16} /> My SOPs</Button>
          </Link>
          <Link href="/sops/compliance">
            <Button variant="outline" className="gap-2"><ShieldCheck size={16} /> Compliance</Button>
          </Link>
          {canManageSOPs && (
            <Button variant={showArchive ? "default" : "outline"} className="gap-2" onClick={() => setShowArchive(!showArchive)}>
              <Archive size={16} /> Archive{archivedSops.length > 0 ? ` (${archivedSops.length})` : ""}
            </Button>
          )}
          {canManageSOPs && <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus size={16} /> New SOP</Button>
            </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create SOP</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              {/* SOP Type Selector */}
              <div className="space-y-2">
                <Label>Type</Label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: "WRITTEN" as const, icon: PenLine, label: "Write", desc: "Rich text editor" },
                    { value: "STEPS" as const, icon: FileText, label: "Step-by-Step", desc: "Numbered steps" },
                    { value: "RECORDED" as const, icon: Video, label: "Record", desc: "Screen recording" },
                    { value: "CHECKLIST" as const, icon: ListChecks, label: "Checklist", desc: "Runnable process" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSopType(opt.value)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all text-center ${
                        sopType === opt.value
                          ? "border-[#d4ff2e] bg-[rgba(212,255,46,0.08)] text-[#d4ff2e]"
                          : "border-border hover:border-muted-2 text-muted"
                      }`}
                    >
                      <opt.icon size={20} />
                      <span className="text-xs font-medium">{opt.label}</span>
                      <span className="text-[10px] opacity-70">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2"><Label>Title <span className="text-red-400">*</span></Label><Input placeholder="e.g., Client Onboarding Process" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /></div>
              <div className="space-y-2">
                <Label>Category</Label>
                {showAddCategory ? (
                  <div className="flex items-center gap-2">
                    <Input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="Category name" onKeyDown={(e) => e.key === "Enter" && handleAddCategory()} autoFocus />
                    <Button size="sm" onClick={handleAddCategory} disabled={!newCatName.trim()}>Add</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowAddCategory(false); setNewCatName(""); }}>Cancel</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Select value={newCategory} onValueChange={async (v) => {
                      setNewCategory(v);
                      setNewSubcategory("");
                      // Auto-create in DB if it's an old category not yet saved
                      const exists = savedCategories.find((c: any) => c.name === v);
                      if (!exists) {
                        try {
                          await fetch("/api/sop-categories", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: v }),
                          });
                          // Refetch all categories to get fresh data with IDs
                          const refreshRes = await fetch("/api/sop-categories");
                          if (refreshRes.ok) {
                            const refreshData = await refreshRes.json();
                            setSavedCategories(Array.isArray(refreshData) ? refreshData : refreshData.data || []);
                          }
                        } catch {}
                      }
                    }}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="shrink-0 text-xs" onClick={() => setShowAddCategory(true)}>+ Add</Button>
                  </div>
                )}
              </div>
              {newCategory && (
                <div className="space-y-2">
                  <Label>Subcategory</Label>
                  {showAddSubcategory ? (
                    <div className="flex items-center gap-2">
                      <Input value={newSubcatName} onChange={(e) => setNewSubcatName(e.target.value)} placeholder="Subcategory name" onKeyDown={(e) => e.key === "Enter" && handleAddSubcategory()} autoFocus />
                      <Button size="sm" onClick={handleAddSubcategory} disabled={!newSubcatName.trim()}>Add</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setShowAddSubcategory(false); setNewSubcatName(""); }}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Select value={newSubcategory} onValueChange={setNewSubcategory}>
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Select subcategory (optional)" /></SelectTrigger>
                        <SelectContent>
                          {subcategories.length === 0 ? (
                            <div className="p-2 text-xs text-muted text-center">No subcategories yet</div>
                          ) : (
                            subcategories.map((s: any) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)
                          )}
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" className="shrink-0 text-xs" onClick={() => setShowAddSubcategory(true)}>+ Add</Button>
                    </div>
                  )}
                </div>
              )}
              <div className="space-y-2"><Label>Description</Label><Textarea placeholder="What does this SOP cover?" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={creating || !newTitle.trim()}>
                {creating ? "Creating..." : sopType === "RECORDED" ? "Start Recording" : "Create SOP"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>}
        </div>
      </div>

      {/* Archive View */}
      {showArchive ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2"><Archive size={14} className="text-muted" /> Archived SOPs</h2>
              <p className="text-xs text-muted mt-0.5">Archived SOPs are hidden from the main page. Restore them to make them active again.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowArchive(false)}>Back to SOPs</Button>
          </div>

          {loadingArchive ? (
            <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-14 bg-surface rounded-lg border border-border animate-pulse" />)}</div>
          ) : archivedSops.length === 0 ? (
            <div className="py-12 text-center">
              <Archive size={32} className="mx-auto text-muted mb-2" />
              <p className="text-sm font-medium">No archived SOPs</p>
              <p className="text-xs text-muted mt-1">Archived SOPs will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {archivedSops.map((sop) => (
                <div key={sop.id} className="rounded-lg border border-border bg-surface p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <FileText size={14} className="text-muted shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{sop.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {sop.category && <Badge variant="outline" className="text-[9px]">{sop.category}</Badge>}
                        {sop.subcategory && <Badge variant="outline" className="text-[9px] text-[#d4ff2e]">{sop.subcategory}</Badge>}
                        <span className="text-[9px] text-muted">v{sop.version}</span>
                        <span className="text-[9px] text-muted">&middot; {formatDate(sop.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-3">
                    <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={() => handleRestore(sop.id)}>
                      <RotateCcw size={11} /> Restore
                    </Button>
                    <Button size="sm" variant="ghost" className="gap-1 text-xs h-7 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => handlePermanentDelete(sop.id)}>
                      <Trash2 size={11} /> Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
      <>
      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4 text-center">
              <div className="h-8 w-12 bg-surface-2 rounded animate-pulse mx-auto mb-1" />
              <div className="h-3 w-16 bg-surface-2 rounded animate-pulse mx-auto" />
            </CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card><CardContent className="p-3 text-center">
            <p className="text-lg font-bold">{sops.length}</p>
            <p className="text-[10px] text-muted">Total SOPs</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-green-400">{publishedSops.length}</p>
            <p className="text-[10px] text-muted">Published</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <p className={`text-lg font-bold ${getComplianceText(avgCompliance)}`}>{avgCompliance}%</p>
            <p className="text-[10px] text-muted">Avg Compliance</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-red-400">{publishedSops.filter(s => getComplianceScore(s) < 70).length}</p>
            <p className="text-[10px] text-muted">Below Target</p>
          </CardContent></Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input placeholder="Search SOPs..." className="pl-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 ml-auto">
          <Button variant={viewMode === "grid" ? "default" : "outline"} size="icon" className="h-8 w-8" onClick={() => setViewMode("grid")} title="Grid view">
            <BarChart3 size={14} className="rotate-90" />
          </Button>
          <Button variant={viewMode === "list" ? "default" : "outline"} size="icon" className="h-8 w-8" onClick={() => setViewMode("list")} title="List view">
            <ClipboardList size={14} />
          </Button>
        </div>
      </div>

      {/* SOP Grid / List */}
      {viewMode === "list" && !loading && filtered.length > 0 && (
        <div className="hidden md:grid grid-cols-[minmax(0,1fr)_140px_100px_80px_80px_100px] items-center gap-4 px-4 pb-2 text-[10px] font-mono uppercase tracking-wider text-muted">
          <span>SOP</span>
          <span>Category</span>
          <span className="text-right">Compliance</span>
          <span className="text-right">Steps</span>
          <span className="text-right">Version</span>
          <span className="text-right">Published</span>
        </div>
      )}

      <div className={viewMode === "grid" ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "flex flex-col gap-1.5"}>
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
          : filtered.length === 0 ? (
            <div className="col-span-full">
              <EmptyState
                icon={BookOpen}
                title="No SOPs documented"
                description="Document your first standard operating procedure to start building your knowledge base."
                actionLabel="Create SOP"
                onAction={() => setShowAddDialog(true)}
              />
            </div>
          ) : viewMode === "list" ? filtered.map((sop) => {
              const compliance = getComplianceScore(sop);
              const steps = getStepsCount(sop);
              const assigned = getAssignedCount(sop);
              return (
                <Link
                  key={sop.id}
                  href={`/sops/${sop.id}`}
                  className="grid grid-cols-[1fr] md:grid-cols-[minmax(0,1fr)_140px_100px_80px_80px_100px] items-center gap-4 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2 hover:border-[color:var(--b-line-2)]"
                >
                  {/* Title + status */}
                  <div className="min-w-0 flex items-center gap-3">
                    <FileText size={16} className="text-muted shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-sm truncate">{sop.title}</span>
                        {getStatusBadge(sop.status)}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted">
                        <span>{assigned > 0 ? `${assigned} assigned` : "Not assigned"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Category */}
                  <div className="hidden md:flex items-center gap-1 min-w-0">
                    {sop.category ? (
                      <Badge variant="outline" className="text-[10px] truncate">{sop.category}</Badge>
                    ) : (
                      <span className="text-[11px] text-muted">—</span>
                    )}
                  </div>

                  {/* Compliance */}
                  <div className="hidden md:flex items-center gap-2 justify-end">
                    {sop.status === "PUBLISHED" ? (
                      <>
                        <Progress value={compliance} className="h-1 w-12" indicatorClassName={getComplianceColor(compliance)} />
                        <span className={`text-xs font-mono tabular-nums ${getComplianceText(compliance)}`}>{compliance}%</span>
                      </>
                    ) : (
                      <span className="text-[11px] text-muted">—</span>
                    )}
                  </div>

                  {/* Steps */}
                  <div className="hidden md:block text-right text-xs font-mono tabular-nums text-muted">{steps}</div>

                  {/* Version */}
                  <div className="hidden md:block text-right">
                    <Badge variant="outline" className="text-[10px]">v{sop.version}</Badge>
                  </div>

                  {/* Date */}
                  <div className="hidden md:block text-right text-[11px] font-mono tabular-nums text-muted">{formatDate(sop.publishedAt || sop.createdAt)}</div>
                </Link>
              );
            }) : filtered.map((sop) => {
              const compliance = getComplianceScore(sop);
              const steps = getStepsCount(sop);
              const assigned = getAssignedCount(sop);
              return (
                <Link key={sop.id} href={`/sops/${sop.id}`}><Card className="hover:border-muted-2 transition-all cursor-pointer group">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <FileText size={14} className="text-muted shrink-0" />
                        {getStatusBadge(sop.status)}
                      </div>
                      <Badge variant="outline" className="text-[9px]">v{sop.version}</Badge>
                    </div>
                    <h3 className="font-semibold text-xs mb-1 truncate">{sop.title}</h3>
                    <div className="flex items-center gap-1 mb-2">
                      {sop.category && <Badge variant="outline" className="text-[9px]">{sop.category}</Badge>}
                      {sop.subcategory && <Badge variant="outline" className="text-[9px]">{sop.subcategory}</Badge>}
                    </div>
                    {sop.status === "PUBLISHED" && (
                      <div className="flex items-center gap-2 mb-2">
                        <Progress value={compliance} className="h-1 flex-1" indicatorClassName={getComplianceColor(compliance)} />
                        <span className={`text-[10px] font-mono ${getComplianceText(compliance)}`}>{compliance}%</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[9px] text-muted">
                      <div className="flex items-center gap-2">
                        <span>{steps} steps</span>
                        {assigned > 0 && <span>{assigned} assigned</span>}
                      </div>
                      <span>{formatDate(sop.publishedAt || sop.createdAt)}</span>
                    </div>
                  </CardContent>
                </Card></Link>
              );
            })
        }
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

      </>
      )}

      {/* Extension Download Dialog */}
      <Dialog open={showExtensionDialog} onOpenChange={setShowExtensionDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>WorkwrK SOP Recorder</DialogTitle></DialogHeader>
          <ExtensionSetupContent onClose={() => setShowExtensionDialog(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

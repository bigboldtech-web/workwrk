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
  PenLine, Video, ListChecks, Download,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import { EmptyState } from "@/components/ui/empty-state";

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
  if (score >= 70) return "bg-purple-500";
  if (score >= 50) return "bg-orange-500";
  return "bg-red-500";
}

function getComplianceText(score: number) {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-purple-400";
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
    // Check if extension is installed by looking for the data attribute
    const check = () => {
      const detected = document.documentElement.getAttribute("data-workwrk-extension") === "true";
      setExtensionDetected(detected);
      setChecking(false);
    };

    // Listen for extension message
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "WORKWRK_EXTENSION_INSTALLED") {
        setExtensionDetected(true);
        setChecking(false);
      }
    };
    window.addEventListener("message", handler);

    // Check after a short delay (extension might take time to inject)
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
            <span className="text-purple-400 font-bold">1.</span>
            <span>Click the <strong>WorkwrK icon</strong> in your browser toolbar</span>
          </div>
          <div className="flex items-start gap-2 p-2 rounded bg-surface">
            <span className="text-purple-400 font-bold">2.</span>
            <span>Click <strong>Start Recording</strong></span>
          </div>
          <div className="flex items-start gap-2 p-2 rounded bg-surface">
            <span className="text-purple-400 font-bold">3.</span>
            <span>Navigate through the process — each click captures a step with screenshot</span>
          </div>
          <div className="flex items-start gap-2 p-2 rounded bg-surface">
            <span className="text-purple-400 font-bold">4.</span>
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
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent mx-auto mb-2" />
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
          <span className="text-purple-400 font-bold">1.</span>
          <span>Click <strong>Download Extension</strong> below to get the ZIP file</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-purple-400 font-bold">2.</span>
          <span>Extract/unzip the downloaded file — you will get an <strong>extension</strong> folder</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-purple-400 font-bold">3.</span>
          <span>Open Chrome and type <code className="text-xs bg-surface-2 px-1 rounded">chrome://extensions</code> in the address bar</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-purple-400 font-bold">4.</span>
          <span>Enable <strong>Developer mode</strong> toggle (top right corner)</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-purple-400 font-bold">5.</span>
          <span>Click <strong>Load unpacked</strong> → select the <strong>extension</strong> folder from the extracted ZIP</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-purple-400 font-bold">6.</span>
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

  // Employees go directly to My SOPs
  useEffect(() => {
    if (isEmployee) router.replace("/sops/my-sops");
  }, [isEmployee, router]);

  if (isEmployee) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
      </div>
    );
  }

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
  const [sopType, setSopType] = useState<"WRITTEN" | "RECORDED" | "CHECKLIST">("WRITTEN");
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);

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
      .then((d) => setSavedCategories(d.data || []))
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
    if (!newSubcatName.trim()) return;

    // Find or wait for category to be in DB
    let catObj = savedCategories.find((c: any) => c.name === newCategory);

    // If category not yet in DB, create it first
    if (!catObj && newCategory) {
      try {
        const catRes = await fetch("/api/sop-categories", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newCategory }),
        });
        if (catRes.ok) {
          const catData = await catRes.json();
          catObj = catData.data || catData;
          setSavedCategories([...savedCategories, catObj]);
        }
      } catch {}
    }

    if (!catObj?.id) { toastError("Please select a category first"); return; }

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
          setSavedCategories(refreshData.data || []);
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

    // For recorded SOPs, show extension instructions
    if (sopType === "RECORDED") {
      setShowAddDialog(false);
      setShowExtensionDialog(true);
      return;
    }

    setCreating(true);
    try {
      const initialContent = sopType === "CHECKLIST"
        ? { sections: [] }
        : { steps: [] };

      const res = await fetch("/api/sops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          description: newDescription,
          category: newCategory,
          subcategory: newSubcategory || undefined,
          sopType,
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

  const savedCatNames = savedCategories.map((c: any) => c.name);
  const existingCategories = [...new Set(sops.map((s) => s.category).filter(Boolean))];
  const categories = [...new Set([...savedCatNames, ...existingCategories])].sort();

  const filtered = sops; // Server-side filtering now

  const publishedSops = sops.filter(s => s.status === "PUBLISHED");
  const avgCompliance = publishedSops.length > 0
    ? Math.round(publishedSops.reduce((acc, s) => acc + getComplianceScore(s), 0) / publishedSops.length)
    : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SOPs</h1>
          <p className="text-muted text-sm mt-1">{total} standard operating procedures &middot; {avgCompliance}% avg compliance</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sops/my-sops">
            <Button variant="outline" className="gap-2"><ClipboardList size={16} /> My SOPs</Button>
          </Link>
          <Link href="/sops/compliance">
            <Button variant="outline" className="gap-2"><ShieldCheck size={16} /> Compliance</Button>
          </Link>
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
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "WRITTEN" as const, icon: PenLine, label: "Write", desc: "Manual rich text" },
                    { value: "RECORDED" as const, icon: Video, label: "Record", desc: "Screen recording" },
                    { value: "CHECKLIST" as const, icon: ListChecks, label: "Checklist", desc: "Runnable process" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSopType(opt.value)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all text-center ${
                        sopType === opt.value
                          ? "border-purple-500 bg-purple-500/10 text-purple-400"
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
                            setSavedCategories(refreshData.data || []);
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Card><CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{sops.length}</p>
            <p className="text-xs text-muted">Total SOPs</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{publishedSops.length}</p>
            <p className="text-xs text-muted">Published</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className={`text-2xl font-bold ${getComplianceText(avgCompliance)}`}>{avgCompliance}%</p>
            <p className="text-xs text-muted">Avg Compliance</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{publishedSops.filter(s => getComplianceScore(s) < 70).length}</p>
            <p className="text-xs text-muted">Below Target</p>
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
      <div className={viewMode === "grid" ? "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" : "space-y-2"}>
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
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
          ) : filtered.map((sop) => {
              const compliance = getComplianceScore(sop);
              const steps = getStepsCount(sop);
              const assigned = getAssignedCount(sop);
              return (
                <Link key={sop.id} href={`/sops/${sop.id}`}><Card className="hover:border-muted-2 transition-all cursor-pointer group">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="rounded-lg bg-purple-500/10 p-2">
                          <FileText size={16} className="text-purple-400" />
                        </div>
                        {getStatusBadge(sop.status)}
                      </div>
                      <Badge variant="outline" className="text-[10px]">v{sop.version}</Badge>
                    </div>

                    <h3 className="font-semibold text-sm mb-1">{sop.title}</h3>
                    <div className="flex items-center gap-1 mb-3">
                      {sop.category && <Badge variant="outline" className="text-[10px]">{sop.category}</Badge>}
                      {sop.subcategory && <Badge variant="outline" className="text-[10px] text-purple-400">{sop.subcategory}</Badge>}
                    </div>

                    {sop.status === "PUBLISHED" && (
                      <div className="space-y-2 mt-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted">Compliance</span>
                          <span className={`font-mono font-bold ${getComplianceText(compliance)}`}>{compliance}%</span>
                        </div>
                        <Progress value={compliance} className="h-1.5" indicatorClassName={getComplianceColor(compliance)} />
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-[10px] text-muted">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1"><CheckCircle size={10} /> {steps} steps</span>
                        {assigned > 0 && <span className="flex items-center gap-1"><Users size={10} /> {assigned}</span>}
                      </div>
                      <span className="flex items-center gap-1"><Clock size={10} /> {formatDate(sop.publishedAt || sop.createdAt)}</span>
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

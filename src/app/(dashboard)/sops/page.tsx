"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuLabel, ContextMenuSub, ContextMenuSubTrigger,
  ContextMenuSubContent, ContextMenuRadioGroup, ContextMenuRadioItem,
} from "@/components/ui/context-menu";
import {
  BookOpen, Plus, Search, FileText, CheckCircle, AlertTriangle,
  Eye, BarChart3, ClipboardList, ShieldCheck,
  PenLine, Video, ListChecks, Download, Archive, RotateCcw, Trash2,
  FolderOpen, FolderInput, Link2, ExternalLink, Tag, Settings2, X,
  ChevronDown,
} from "lucide-react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { FolderTree, type FolderNode } from "@/components/sops/folder-tree";
import { CategoryTree, type CategoryNode } from "@/components/sops/category-tree";
import { TagChips, type TagOption } from "@/components/sops/tag-chips";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { useToast } from "@/components/ui/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { useRole } from "@/hooks/use-role";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard as SharedSkeletonCard, Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/page-header";
import { ListPage } from "@/components/layout/page-shells";
import { FolderManager } from "@/components/sops/folder-manager";
import { DocEditorDialog } from "@/components/notes/doc-editor-dialog";

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
  folderId?: string | null;
  folder?: { id: string; name: string; color: string | null; parentId: string | null } | null;
  tags?: string[];
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
  if (score >= 70) return "bg-violet-600";
  if (score >= 50) return "bg-orange-500";
  return "bg-red-500";
}

function getComplianceText(score: number) {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-[color:var(--accent-strong)]";
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

/**
 * Build a "Root / Child / Leaf" path for a folder by walking up
 * `parentId`. Cheap O(depth) lookup against the flat folders list
 * the page already has in memory.
 */
function folderBreadcrumb(folderId: string | null | undefined, folders: FolderNode[]): { name: string; color: string | null } | null {
  if (!folderId) return null;
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: FolderNode[] = [];
  let cursor: FolderNode | undefined = byId.get(folderId);
  while (cursor) {
    parts.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  if (parts.length === 0) return null;
  return {
    name: parts.map((p) => p.name).join(" / "),
    color: parts[parts.length - 1].color,
  };
}

const SkeletonCard = SharedSkeletonCard;

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
            <span className="text-[color:var(--accent-strong)] font-bold">1.</span>
            <span>Click the <strong>WorkwrK icon</strong> in your browser toolbar</span>
          </div>
          <div className="flex items-start gap-2 p-2 rounded bg-surface">
            <span className="text-[color:var(--accent-strong)] font-bold">2.</span>
            <span>Click <strong>Start Recording</strong></span>
          </div>
          <div className="flex items-start gap-2 p-2 rounded bg-surface">
            <span className="text-[color:var(--accent-strong)] font-bold">3.</span>
            <span>Navigate through the process — each click captures a step with screenshot</span>
          </div>
          <div className="flex items-start gap-2 p-2 rounded bg-surface">
            <span className="text-[color:var(--accent-strong)] font-bold">4.</span>
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
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent mx-auto mb-2" />
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
          <span className="text-[color:var(--accent-strong)] font-bold">1.</span>
          <span>Click <strong>Download Extension</strong> below to get the ZIP file</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-[color:var(--accent-strong)] font-bold">2.</span>
          <span>Extract/unzip the downloaded file — you will get an <strong>extension</strong> folder</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-[color:var(--accent-strong)] font-bold">3.</span>
          <span>Open Chrome and type <code className="text-xs bg-surface-2 px-1 rounded">chrome://extensions</code> in the address bar</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-[color:var(--accent-strong)] font-bold">4.</span>
          <span>Enable <strong>Developer mode</strong> toggle (top right corner)</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-[color:var(--accent-strong)] font-bold">5.</span>
          <span>Click <strong>Load unpacked</strong> → select the <strong>extension</strong> folder from the extracted ZIP</span>
        </div>
        <div className="flex items-start gap-2 p-2 rounded bg-surface">
          <span className="text-[color:var(--accent-strong)] font-bold">6.</span>
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
  const searchParams = useSearchParams();
  const { canManageSOPs, isEmployee, accessLevel } = useRole();
  const isOrgAdmin = accessLevel === "SUPER_ADMIN" || accessLevel === "COMPANY_ADMIN";
  const [sops, setSops] = useState<SOP[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  // Initial folder filter is seeded from `?folderId=<id>` so links from
  // the sidebar's SOPs sub-nav land in the matching folder view.
  const initialFolderFilter = searchParams?.get("folderId") ?? "all";
  const [folderFilter, setFolderFilter] = useState<string>(initialFolderFilter); // "all" | "none" | folderId
  // Category filter — primary navigation. Values:
  //   "all" → no filter
  //   "uncategorized" → category IS NULL
  //   "<name>" → category=<name>
  //   "<cat>::<sub>" → category=<cat> AND subcategory=<sub>
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [allTags, setAllTags] = useState<TagOption[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newFolderId, setNewFolderId] = useState<string>("none");      // for Create SOP dialog
  const [newSopTags, setNewSopTags] = useState<string[]>([]);
  const [newSopTagInput, setNewSopTagInput] = useState("");
  const [showFolderManager, setShowFolderManager] = useState(false);
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
  // Doc-popup overlay state — keyed to the SOP whose chrome the user
  // most recently clicked. Clicking a row title now opens this popup
  // instead of navigating to /sops/[id]; the route is still available
  // for direct deep-links + the "Open in full page" action.
  const [popupSop, setPopupSop] = useState<SOP | null>(null);
  const [popupBody, setPopupBody] = useState<string>("");
  const [popupLoading, setPopupLoading] = useState(false);

  // Categories from DB (with sopCount, includes unsaved/legacy names)
  const [savedCategories, setSavedCategories] = useState<any[]>([]);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAddSubcategory, setShowAddSubcategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newSubcatName, setNewSubcatName] = useState("");

  const { success: toastSuccess, error: toastError } = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();

  // Fetch categories with live SOP counts. Called on mount and re-called
  // whenever the SOP list changes so the filter dropdown stays in sync
  // after create / move / archive.
  const fetchCategories = useCallback(async () => {
    try {
      const r = await fetch("/api/sop-categories");
      if (!r.ok) return;
      const d = await r.json();
      setSavedCategories(Array.isArray(d) ? d : d?.data || []);
    } catch {}
  }, []);
  useEffect(() => { fetchCategories(); }, [fetchCategories]);

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

  // Sync filter when the URL's ?folderId= changes — navigating between
  // folders via the sidebar sub-nav should re-filter without a reload.
  useEffect(() => {
    const next = searchParams?.get("folderId") ?? "all";
    setFolderFilter((prev) => (prev === next ? prev : next));
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, folderFilter, categoryFilter, selectedTags]);

  const fetchSOPs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (folderFilter !== "all") params.set("folderId", folderFilter);
      if (categoryFilter !== "all") {
        if (categoryFilter === "uncategorized") {
          params.set("category", "__none__");
        } else if (categoryFilter.includes("::")) {
          const [cat, sub] = categoryFilter.split("::");
          params.set("category", cat);
          params.set("subcategory", sub);
        } else {
          params.set("category", categoryFilter);
        }
      }
      if (selectedTags.length > 0) params.set("tags", selectedTags.join(","));
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
  }, [page, limit, debouncedSearch, folderFilter, categoryFilter, selectedTags]);

  // Keep category counts fresh after SOPs change (move/archive/create).
  useEffect(() => { if (!loading) fetchCategories(); }, [sops, loading, fetchCategories]);

  // Fetch folders the caller can see (admins get all; others get their
  // assigned folders + descendants). Returns the full tree as a flat
  // list with parentId, plus rolled-up sopCountDeep on each node.
  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/sop-folders");
      if (res.ok) {
        const data = await res.json();
        setFolders(Array.isArray(data) ? data : data.data || []);
      }
    } catch {}
  }, []);
  useEffect(() => { fetchFolders(); }, [fetchFolders]);

  // Fetch tags in use across the org so we can render the chip filter
  // and the autocomplete in the Create dialog.
  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch("/api/sop-tags");
      if (res.ok) {
        const data = await res.json();
        setAllTags(Array.isArray(data) ? data : data.data || []);
      }
    } catch {}
  }, []);
  useEffect(() => { fetchTags(); }, [fetchTags]);

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
          folderId: newFolderId === "none" ? null : newFolderId,
          tags: newSopTags,
          sopType: dbSopType,
          content: initialContent,
          status: "DRAFT",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to create SOP");
      }
      const created = await res.json();
      setShowAddDialog(false);
      setNewTitle("");
      setNewCategory("");
      setNewSubcategory("");
      setNewDescription("");
      setNewFolderId("none");
      setNewSopTags([]);
      setNewSopTagInput("");
      setSopType("WRITTEN");
      toastSuccess("SOP created successfully");
      fetchTags();
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
    if (!(await confirm({
      title: "Permanently delete this SOP?",
      description: "The SOP, its content, and all its compliance records will be removed. This cannot be undone.",
      confirmLabel: "Delete forever",
      destructive: true,
    }))) return;
    try {
      const res = await fetch(`/api/sops/${sopId}`, { method: "DELETE" });
      if (res.ok) {
        setArchivedSops(archivedSops.filter((s) => s.id !== sopId));
        setSops((prev) => prev.filter((s) => s.id !== sopId));
        toastSuccess("SOP permanently deleted");
      } else { toastError("Failed to delete"); }
    } catch { toastError("Failed to delete"); }
  }

  async function handleMoveToFolder(sopId: string, folderId: string | null) {
    const target = folderId ? folders.find((f) => f.id === folderId)?.name || "folder" : "Unfoldered";
    try {
      const res = await fetch(`/api/sops/${sopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      if (res.ok) {
        setSops((prev) => prev.map((s) => (s.id === sopId ? { ...s, folderId } : s)));
        fetchFolders();
        toastSuccess(`Moved to ${target}`);
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to move SOP");
      }
    } catch { toastError("Failed to move SOP"); }
  }

  // Folder admin actions used by the sidebar tree's right-click menu.
  async function handleCreateFolder(parentId: string | null) {
    const parentName = parentId ? folders.find((f) => f.id === parentId)?.name : null;
    const name = await prompt({
      title: parentId ? `New sub-folder in "${parentName}"` : "New folder",
      description: parentId
        ? "Sub-folders inherit access from their parent unless you grant access explicitly."
        : "Top-level folder. Visible to everyone in the org until you set an access list.",
      placeholder: parentId ? "e.g. Hiring" : "e.g. HR",
      submitLabel: "Create",
    });
    if (!name) return;
    try {
      const res = await fetch("/api/sop-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId }),
      });
      if (res.ok) {
        toastSuccess("Folder created");
        fetchFolders();
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to create folder");
      }
    } catch { toastError("Failed to create folder"); }
  }
  async function handleRenameFolder(folder: FolderNode) {
    const next = await prompt({
      title: "Rename folder",
      description: `Currently named "${folder.name}".`,
      defaultValue: folder.name,
      submitLabel: "Save",
    });
    if (!next || next === folder.name) return;
    try {
      const res = await fetch(`/api/sop-folders/${folder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (res.ok) {
        toastSuccess("Folder renamed");
        fetchFolders();
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to rename folder");
      }
    } catch { toastError("Failed to rename folder"); }
  }
  async function handleDeleteFolder(folder: FolderNode) {
    if (folder._count.sops > 0) {
      toastError(`"${folder.name}" still has ${folder._count.sops} SOP${folder._count.sops === 1 ? "" : "s"}. Move them out before deleting.`);
      return;
    }
    if (!(await confirm({
      title: `Delete "${folder.name}"?`,
      description: "The folder will be removed. SOPs are not deleted — anything inside it will need to be moved first.",
      confirmLabel: "Delete folder",
      destructive: true,
    }))) return;
    try {
      const res = await fetch(`/api/sop-folders/${folder.id}`, { method: "DELETE" });
      if (res.ok) {
        toastSuccess("Folder deleted");
        if (folderFilter === folder.id) setFolderFilter("all");
        fetchFolders();
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to delete folder");
      }
    } catch { toastError("Failed to delete folder"); }
  }
  // Open the existing folder-manager dialog for access changes.
  // Cheap reuse of the existing UI (admin can pick the folder inside).
  function handleManageAccess() {
    setShowFolderManager(true);
  }

  async function handleArchiveSOP(sopId: string) {
    try {
      const res = await fetch(`/api/sops/${sopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      if (res.ok) {
        setSops((prev) => prev.filter((s) => s.id !== sopId));
        fetchArchivedSops();
        toastSuccess("SOP archived");
      } else { toastError("Failed to archive"); }
    } catch { toastError("Failed to archive"); }
  }

  // Open the doc-popup overlay for an SOP. Fetches the freshest body
  // from the API so a stale list-row doesn't show old content. The
  // overlay autosaves through /api/sops/[id] on title/body blur.
  async function openSopPopup(sop: SOP) {
    setPopupSop(sop);
    setPopupBody("");
    setPopupLoading(true);
    try {
      const r = await fetch(`/api/sops/${sop.id}`);
      if (r.ok) {
        const d = await r.json();
        // Description holds the prose body. Steps live elsewhere and
        // aren't editable from the popup — that's still the dedicated
        // route's job. Once we migrate body-as-HTML, swap to d.body.
        setPopupBody(d.description || "");
      }
    } finally { setPopupLoading(false); }
  }

  function handleCopyLink(sopId: string) {
    const url = `${window.location.origin}/sops/${sopId}`;
    navigator.clipboard.writeText(url).then(
      () => toastSuccess("Link copied"),
      () => toastError("Couldn't copy link"),
    );
  }

  // For the Create-SOP dialog's category Select: every known category name.
  const categories = savedCategories.map((c: { name: string }) => c.name).sort();

  // Tree shape for the sidebar. Counts come from the API response so
  // they always agree with the ARCHIVED-excluded list rule. We hide:
  //   · the "__uncategorized__" sentinel (surfaced as its own pill)
  //   · saved categories with zero SOPs that *also* have no
  //     populated subcategories — those are "defined but unused" and
  //     would just be visual noise in the sidebar. Admins can still
  //     see/edit them in Settings → SOPs.
  // Subcategories with zero SOPs are also hidden inside their parent.
  const categoryNodes: CategoryNode[] = savedCategories
    .filter((c: any) => c.id !== "__uncategorized__")
    .map((c: any) => {
      const subs = (c.subcategories ?? [])
        .filter((s: any) => (s.sopCount ?? 0) > 0)
        .map((s: any) => ({ id: s.id, name: s.name, sopCount: s.sopCount ?? 0 }));
      return {
        id: c.id,
        name: c.name,
        sopCount: c.sopCount ?? 0,
        subcategories: subs,
      };
    })
    .filter((c) => (c.sopCount ?? 0) > 0 || c.subcategories.length > 0);
  const uncategorizedCount =
    savedCategories.find((c: any) => c.id === "__uncategorized__")?.sopCount ?? 0;
  // Total active (non-archived) SOPs across the whole org. Drives
  // the "All SOPs" pill so it stays stable when filters narrow.
  const totalActiveSops =
    categoryNodes.reduce((sum, c) => sum + (c.sopCount ?? 0), 0) + uncategorizedCount;

  const filtered = sops; // Server-side filtering now

  // Employees go directly to My SOPs
  useEffect(() => {
    if (isEmployee) router.replace("/sops/my-sops");
  }, [isEmployee, router]);

  if (isEmployee) {
    return <div className="flex items-center justify-center h-64"><div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" /></div>;
  }

  const publishedSops = sops.filter(s => s.status === "PUBLISHED");

  const hasActiveFilters =
    folderFilter !== "all" || categoryFilter !== "all" || selectedTags.length > 0 || debouncedSearch.length > 0;

  const filtersRail = (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <Input
          placeholder="Search SOPs..."
          className="pl-8 h-8 text-xs"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted">Folders</span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => { setFolderFilter("all"); setCategoryFilter("all"); setSelectedTags([]); setSearchQuery(""); }}
              className="text-[10px] text-muted hover:text-foreground transition-fast"
            >
              Clear
            </button>
          )}
        </div>
        <FolderTree
          folders={folders}
          totalSops={totalActiveSops}
          selected={folderFilter}
          onSelect={setFolderFilter}
          onDropSop={canManageSOPs ? (folderId, sopId) => handleMoveToFolder(sopId, folderId) : undefined}
          onCreateChild={canManageSOPs ? handleCreateFolder : undefined}
          onRename={canManageSOPs ? handleRenameFolder : undefined}
          onManageAccess={isOrgAdmin ? handleManageAccess : undefined}
          onDelete={canManageSOPs ? handleDeleteFolder : undefined}
          canManage={canManageSOPs}
        />
      </div>

      {(categoryNodes.length > 0 || uncategorizedCount > 0) && (
        <details className="group">
          <summary className="flex items-center justify-between px-1 cursor-pointer list-none select-none">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted group-hover:text-foreground">
              Browse by category
            </span>
            <ChevronDown size={12} className="text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-0.5 mt-2">
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md transition-fast flex items-center justify-between ${
                categoryFilter === "all"
                  ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)] font-medium"
                  : "text-muted hover:bg-[color:var(--surface-elevated)] hover:text-foreground"
              }`}
            >
              <span>All categories</span>
              <span className="tabular-nums text-muted-2">{totalActiveSops}</span>
            </button>
            {uncategorizedCount > 0 && (
              <button
                type="button"
                onClick={() => setCategoryFilter("uncategorized")}
                className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md transition-fast flex items-center justify-between ${
                  categoryFilter === "uncategorized"
                    ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)] font-medium"
                    : "text-muted hover:bg-[color:var(--surface-elevated)] hover:text-foreground"
                }`}
              >
                <span>Uncategorized</span>
                <span className="tabular-nums text-muted-2">{uncategorizedCount}</span>
              </button>
            )}
            {categoryNodes.map((cat) => (
              <div key={cat.id ?? cat.name}>
                <button
                  type="button"
                  onClick={() => setCategoryFilter(cat.name)}
                  className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md transition-fast flex items-center justify-between ${
                    categoryFilter === cat.name
                      ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)] font-medium"
                      : "text-muted hover:bg-[color:var(--surface-elevated)] hover:text-foreground"
                  }`}
                >
                  <span className="truncate">{cat.name}</span>
                  <span className="tabular-nums text-muted-2">{cat.sopCount ?? 0}</span>
                </button>
                {cat.subcategories.map((sub) => {
                  const value = `${cat.name}::${sub.name}`;
                  const active = categoryFilter === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCategoryFilter(value)}
                      className={`w-full text-left text-[11px] pl-5 pr-2.5 py-1 rounded-md transition-fast flex items-center justify-between ${
                        active
                          ? "bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)] font-medium"
                          : "text-muted hover:bg-[color:var(--surface-elevated)] hover:text-foreground"
                      }`}
                    >
                      <span className="truncate"><span className="text-muted-2 mr-1">↳</span>{sub.name}</span>
                      <span className="tabular-nums text-muted-2">{sub.sopCount ?? 0}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );

  const headerNode = (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "SOPs" }]}
        kicker="SOPs · written · recorded · flows"
        title="SOPs"
        subtitle="Standard operating procedures — versioned and assignable. Compliance is tracked per-run, not here."
        stats={[
          { label: "Total", value: totalActiveSops },
          { label: "Published", value: publishedSops.length },
        ]}
      />
      <div className="flex items-center justify-end flex-wrap gap-2">
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
          {canManageSOPs && <Dialog
            open={showAddDialog}
            onOpenChange={(open) => {
              setShowAddDialog(open);
              if (open) {
                // Seed the folder picker from the current sidebar selection
                // so creating an SOP while a folder is filtered drops it
                // straight into that folder.
                if (folderFilter && folderFilter !== "all" && folderFilter !== "none") {
                  setNewFolderId(folderFilter);
                } else if (folderFilter === "none") {
                  setNewFolderId("none");
                }
              }
            }}
          >
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
                          ? "border-violet-500 bg-[rgba(212,255,46,0.08)] text-[color:var(--accent-strong)]"
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
              {folders.length > 0 && (
                <div className="space-y-2">
                  <Label>Folder</Label>
                  <Select value={newFolderId} onValueChange={setNewFolderId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No folder (visible to everyone)</SelectItem>
                      {folders.map((f) => {
                        const bc = folderBreadcrumb(f.id, folders);
                        return (
                          <SelectItem key={f.id} value={f.id}>
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: f.color || "#d4ff2e" }}
                              />
                              {bc?.name || f.name}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted">
                    Pick a folder to scope who sees this SOP. Leave empty and everyone in the org can see it.
                  </p>
                </div>
              )}

              {/* Tags — free-form chips. Suggestions come from existing
                  tags in the org; pressing Enter or comma adds a new one. */}
              <div className="space-y-2">
                <Label>Tags <span className="text-muted text-[10px]">(optional)</span></Label>
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-2 p-2 min-h-[40px]">
                  {newSopTags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[rgba(212,255,46,0.10)] text-[color:var(--accent-strong)] px-2 py-0.5 text-[11px]">
                      #{t}
                      <button
                        type="button"
                        onClick={() => setNewSopTags((prev) => prev.filter((x) => x !== t))}
                        className="opacity-70 hover:opacity-100"
                        aria-label={`Remove ${t}`}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  <Input
                    value={newSopTagInput}
                    onChange={(e) => setNewSopTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const v = newSopTagInput.trim().replace(/^#/, "");
                        if (v && !newSopTags.includes(v)) {
                          setNewSopTags((prev) => [...prev, v]);
                        }
                        setNewSopTagInput("");
                      } else if (e.key === "Backspace" && !newSopTagInput && newSopTags.length > 0) {
                        setNewSopTags((prev) => prev.slice(0, -1));
                      }
                    }}
                    placeholder={newSopTags.length === 0 ? "Add tags (Enter to confirm)" : ""}
                    className="border-0 bg-transparent flex-1 min-w-[120px] h-6 px-1 focus-visible:ring-0 focus-visible:border-0"
                  />
                </div>
                {allTags.length > 0 && newSopTagInput && (
                  <div className="flex flex-wrap gap-1">
                    {allTags
                      .filter((t) =>
                        t.name.toLowerCase().includes(newSopTagInput.toLowerCase()) &&
                        !newSopTags.includes(t.name),
                      )
                      .slice(0, 8)
                      .map((t) => (
                        <button
                          key={t.name}
                          type="button"
                          onClick={() => {
                            setNewSopTags((prev) => [...prev, t.name]);
                            setNewSopTagInput("");
                          }}
                          className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted hover:text-foreground hover:border-muted-2"
                        >
                          #{t.name}
                        </button>
                      ))}
                  </div>
                )}
              </div>

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
    </>
  );

  return (
    <ListPage
      header={headerNode}
      filters={undefined}
    >
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
            <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : archivedSops.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="No archived SOPs"
              description="Archived SOPs will appear here when you remove them from the active list."
            />
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
                        {sop.subcategory && <Badge variant="outline" className="text-[9px] text-[color:var(--accent-strong)]">{sop.subcategory}</Badge>}
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
      {/* Compact toolbar — search + folder dropdown live on top now
          instead of a left rail, so the SOP list claims full width. */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search SOPs by title or description…"
            className="pl-8 h-9 text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          value={folderFilter}
          onChange={(e) => setFolderFilter(e.target.value)}
          className="h-9 px-3 rounded-md border border-border bg-surface text-xs"
          aria-label="Filter by folder"
        >
          <option value="all">All folders ({totalActiveSops})</option>
          <option value="unfoldered">Unfoldered</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        {(categoryNodes.length > 0 || uncategorizedCount > 0) && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 px-3 rounded-md border border-border bg-surface text-xs"
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {uncategorizedCount > 0 && <option value="uncategorized">Uncategorized</option>}
            {categoryNodes.map((cat) => (
              <option key={cat.id ?? cat.name} value={cat.name}>{cat.name}</option>
            ))}
          </select>
        )}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => { setFolderFilter("all"); setCategoryFilter("all"); setSelectedTags([]); setSearchQuery(""); }}
            className="text-xs text-muted hover:text-foreground"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-3 text-center">
              <Skeleton className="h-6 w-10 mx-auto mb-1" />
              <Skeleton className="h-3 w-16 mx-auto" />
            </CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card><CardContent className="p-3 text-center">
            <p className="text-lg font-bold">{total}</p>
            <p className="text-[10px] text-muted">Total SOPs</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-green-400">{publishedSops.length}</p>
            <p className="text-[10px] text-muted">Published</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <p className="text-lg font-bold text-muted">{sops.filter(s => s.status === "DRAFT").length}</p>
            <p className="text-[10px] text-muted">Drafts</p>
          </CardContent></Card>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap min-h-[2rem]">
          {selectedTags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSelectedTags((prev) => prev.filter((x) => x !== t))}
              className="inline-flex items-center gap-1 rounded-full border border-[#d4ff2e] bg-[rgba(212,255,46,0.10)] px-2 py-0.5 text-[11px] text-[#d4ff2e] hover:bg-[rgba(212,255,46,0.18)] transition-colors"
              title="Remove tag filter"
            >
              <span>{t}</span>
              <X size={10} />
            </button>
          ))}
          {selectedTags.length > 1 && (
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              className="text-[10px] text-muted hover:text-foreground transition-fast"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {allTags.length > 0 && (
            <PopoverPrimitive.Root>
              <PopoverPrimitive.Trigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Tag size={13} />
                  Tag
                  {selectedTags.length > 0 && (
                    <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-[color:var(--accent-soft)] px-1.5 text-[10px] font-medium text-[color:var(--accent-strong)] min-w-[16px] h-[16px]">
                      {selectedTags.length}
                    </span>
                  )}
                  <ChevronDown size={12} className="text-muted" />
                </Button>
              </PopoverPrimitive.Trigger>
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                  align="end"
                  sideOffset={6}
                  className="z-50 w-72 rounded-xl border border-border bg-surface p-3 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.35)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted">Filter by tag</span>
                    {selectedTags.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedTags([])}
                        className="text-[10px] text-muted hover:text-foreground transition-fast"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <TagChips
                    tags={allTags}
                    selected={selectedTags}
                    onToggle={(t) => setSelectedTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}
                    maxVisible={50}
                  />
                </PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
          )}
          {isOrgAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowFolderManager(true)}
              title="Folders are an access-scope mechanism. Most users won't need to touch them."
            >
              <Settings2 size={13} /> Access
            </Button>
          )}
          <div className="flex items-center gap-1">
            <Button variant={viewMode === "grid" ? "default" : "outline"} size="icon" className="h-8 w-8" onClick={() => setViewMode("grid")} title="Grid view">
              <BarChart3 size={14} className="rotate-90" />
            </Button>
            <Button variant={viewMode === "list" ? "default" : "outline"} size="icon" className="h-8 w-8" onClick={() => setViewMode("list")} title="List view">
              <ClipboardList size={14} />
            </Button>
          </div>
        </div>
      </div>

      {/* SOP Grid / List. Compliance % isn't shown here — that's a
          per-assignment / per-process-run concern. The hub list
          stays focused on what each SOP *is*, not how it's being
          executed. */}
      {viewMode === "list" && !loading && filtered.length > 0 && (
        <div className="hidden md:grid grid-cols-[minmax(220px,2.4fr)_minmax(140px,1.2fr)_64px_64px_100px] items-center gap-3 px-4 pb-2 text-[10px] font-mono uppercase tracking-wider text-muted">
          <span>SOP</span>
          <span>Category · tags</span>
          <span className="text-right">Steps</span>
          <span className="text-right">Version</span>
          <span className="text-right">Published</span>
        </div>
      )}

      <div className={viewMode === "grid" ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-1.5"}>
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
          : filtered.length === 0 ? (
            <div className="col-span-full">
              <EmptyState
                icon={BookOpen}
                title={
                  folderFilter !== "all" || categoryFilter !== "all" || selectedTags.length > 0 || debouncedSearch
                    ? "No SOPs match these filters"
                    : "No SOPs yet"
                }
                description={
                  folderFilter !== "all" || categoryFilter !== "all" || selectedTags.length > 0 || debouncedSearch
                    ? "Try clearing the search box, tag chips, or folder selection to widen the view."
                    : "Document your first standard operating procedure — pick a folder on the left to scope access, add tags so people can find it, and start writing."
                }
                actionLabel={
                  folderFilter !== "all" || categoryFilter !== "all" || selectedTags.length > 0 || debouncedSearch
                    ? "Clear filters"
                    : (canManageSOPs ? "Create your first SOP" : undefined)
                }
                onAction={
                  folderFilter !== "all" || categoryFilter !== "all" || selectedTags.length > 0 || debouncedSearch
                    ? () => { setFolderFilter("all"); setCategoryFilter("all"); setSelectedTags([]); setSearchQuery(""); }
                    : (canManageSOPs ? () => setShowAddDialog(true) : undefined)
                }
              />
            </div>
          ) : viewMode === "list" ? filtered.map((sop) => {
              const steps = getStepsCount(sop);
              const assigned = getAssignedCount(sop);
              return (
                <SOPContextMenu
                  key={sop.id}
                  sop={sop}
                  folders={folders}
                  canManage={canManageSOPs}
                  isOrgAdmin={isOrgAdmin}
                  onMove={handleMoveToFolder}
                  onArchive={handleArchiveSOP}
                  onDelete={handlePermanentDelete}
                  onCopyLink={handleCopyLink}
                >
                  <Link
                    href={`/sops/${sop.id}`}
                    draggable={canManageSOPs}
                    onDragStart={(e) => {
                      if (!canManageSOPs) return;
                      e.dataTransfer.setData("application/x-sop-id", sop.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={(e) => {
                      // Plain left-click opens the doc-popup overlay.
                      // ⌘/Ctrl/shift/middle-click still navigate to the
                      // full route so users can open it in a new tab.
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                      e.preventDefault();
                      openSopPopup(sop);
                    }}
                    className="grid grid-cols-[1fr] md:grid-cols-[minmax(220px,2.4fr)_minmax(140px,1.2fr)_64px_64px_100px] items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2 hover:border-[color:var(--b-line-2)]"
                  >
                    {/* Title + status. Title gets full width; status sits
                        under it as a small badge so it never squeezes
                        the title down to two characters. */}
                    <div className="min-w-0 flex items-center gap-3">
                      <FileText size={16} className="text-muted shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="block font-medium text-sm truncate">{sop.title}</span>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted">
                          {getStatusBadge(sop.status)}
                          <span className="truncate">{assigned > 0 ? `${assigned} assigned` : "Not assigned"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Category / subcategory (primary) + tags */}
                    <div className="hidden md:flex items-center gap-1 min-w-0 flex-wrap">
                      {sop.category ? (
                        <Badge variant="outline" className="text-[10px] truncate gap-1">
                          <Tag size={9} className="text-muted shrink-0" />
                          {sop.category}{sop.subcategory ? ` / ${sop.subcategory}` : ""}
                        </Badge>
                      ) : (
                        <span className="text-[11px] text-muted">Uncategorized</span>
                      )}
                      {sop.tags?.slice(0, 2).map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px] truncate">
                          #{t}
                        </Badge>
                      ))}
                      {sop.tags && sop.tags.length > 2 && (
                        <span className="text-[10px] text-muted">+{sop.tags.length - 2}</span>
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
                </SOPContextMenu>
              );
            }) : filtered.map((sop) => {
              const steps = getStepsCount(sop);
              const assigned = getAssignedCount(sop);
              return (
                <SOPContextMenu
                  key={sop.id}
                  sop={sop}
                  folders={folders}
                  canManage={canManageSOPs}
                  isOrgAdmin={isOrgAdmin}
                  onMove={handleMoveToFolder}
                  onArchive={handleArchiveSOP}
                  onDelete={handlePermanentDelete}
                  onCopyLink={handleCopyLink}
                >
                  <Link
                    href={`/sops/${sop.id}`}
                    draggable={canManageSOPs}
                    onDragStart={(e) => {
                      if (!canManageSOPs) return;
                      e.dataTransfer.setData("application/x-sop-id", sop.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                      e.preventDefault();
                      openSopPopup(sop);
                    }}
                  ><Card className="hover:border-muted-2 transition-all cursor-pointer group">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <FileText size={14} className="text-muted shrink-0" />
                          {getStatusBadge(sop.status)}
                        </div>
                        <Badge variant="outline" className="text-[9px]">v{sop.version}</Badge>
                      </div>
                      <h3 className="font-semibold text-xs mb-1 truncate">{sop.title}</h3>
                      <div className="flex items-center gap-1 mb-2 flex-wrap">
                        {sop.category && (
                          <Badge variant="outline" className="text-[9px] gap-1">
                            <Tag size={8} className="text-muted shrink-0" />
                            {sop.category}{sop.subcategory ? ` / ${sop.subcategory}` : ""}
                          </Badge>
                        )}
                        {sop.tags?.slice(0, 3).map((t) => (
                          <Badge key={t} variant="outline" className="text-[9px]">#{t}</Badge>
                        ))}
                        {sop.tags && sop.tags.length > 3 && (
                          <span className="text-[9px] text-muted">+{sop.tags.length - 3}</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[9px] text-muted">
                        <div className="flex items-center gap-2">
                          <span>{steps} steps</span>
                          {assigned > 0 && <span>{assigned} assigned</span>}
                        </div>
                        <span>{formatDate(sop.publishedAt || sop.createdAt)}</span>
                      </div>
                    </CardContent>
                  </Card></Link>
                </SOPContextMenu>
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

      {/* Folder manager — org admins only. Mount unconditionally so the
          dialog state stays tied to React; the trigger button is gated
          above. */}
      {isOrgAdmin && (
        <FolderManager
          open={showFolderManager}
          onOpenChange={(o) => { setShowFolderManager(o); if (!o) fetchFolders(); }}
        />
      )}

      {/* Doc-popup overlay — opens when a user clicks an SOP row. Edits
          autosave through /api/sops/[id] on blur + ⌘S. */}
      <DocEditorDialog
        open={!!popupSop}
        onClose={() => setPopupSop(null)}
        breadcrumb={["SOPs", popupSop?.category ?? "Uncategorized"]}
        title={popupSop?.title ?? ""}
        body={popupLoading ? "" : popupBody}
        shareUrl={popupSop ? `${typeof window !== "undefined" ? window.location.origin : ""}/sops/${popupSop.id}` : undefined}
        readOnly={!canManageSOPs}
        onSave={async ({ title, body }) => {
          if (!popupSop) return;
          await fetch(`/api/sops/${popupSop.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, description: body }),
          });
          setSops((prev) => prev.map((s) => s.id === popupSop.id ? { ...s, title, description: body } : s));
        }}
      />
    </ListPage>
  );
}

type SOPFolder = { id: string; name: string; color: string | null; _count: { sops: number; access: number } };

function SOPContextMenu({
  sop,
  folders,
  canManage,
  isOrgAdmin,
  onMove,
  onArchive,
  onDelete,
  onCopyLink,
  children,
}: {
  sop: SOP;
  folders: SOPFolder[];
  canManage: boolean;
  isOrgAdmin: boolean;
  onMove: (sopId: string, folderId: string | null) => void;
  onArchive: (sopId: string) => void;
  onDelete: (sopId: string) => void;
  onCopyLink: (sopId: string) => void;
  children: React.ReactNode;
}) {
  const isArchived = sop.status === "ARCHIVED";
  const href = `/sops/${sop.id}`;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>SOP</ContextMenuLabel>
        <ContextMenuItem onSelect={() => window.location.assign(href)}>
          <Eye size={14} /> Open
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => window.open(href, "_blank", "noopener,noreferrer")}>
          <ExternalLink size={14} /> Open in new tab
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onCopyLink(sop.id)}>
          <Link2 size={14} /> Copy link
        </ContextMenuItem>
        {canManage && !isArchived && (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderInput size={14} /> Move to folder
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={sop.folderId ?? "__none__"}
                  onValueChange={(v) => onMove(sop.id, v === "__none__" ? null : v)}
                >
                  <ContextMenuRadioItem value="__none__">
                    <FolderOpen size={13} className="text-muted" /> Unfoldered
                  </ContextMenuRadioItem>
                  {folders.length === 0 ? (
                    <div className="px-2.5 py-2 text-[11px] text-muted">No folders yet</div>
                  ) : (
                    folders.map((f) => (
                      <ContextMenuRadioItem key={f.id} value={f.id}>
                        <FolderOpen size={13} style={{ color: f.color || undefined }} />
                        {f.name}
                      </ContextMenuRadioItem>
                    ))
                  )}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem onSelect={() => onArchive(sop.id)}>
              <Archive size={14} /> Archive
            </ContextMenuItem>
          </>
        )}
        {isOrgAdmin && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem destructive onSelect={() => onDelete(sop.id)}>
              <Trash2 size={14} /> Delete permanently
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

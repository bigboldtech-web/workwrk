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
} from "lucide-react";
import Link from "next/link";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { useToast } from "@/components/ui/toast";
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
            <div className="rounded-lg bg-[#1A1A26] p-2 h-8 w-8 animate-pulse" />
            <div className="h-5 w-16 bg-[#1A1A26] rounded animate-pulse" />
          </div>
          <div className="h-5 w-10 bg-[#1A1A26] rounded animate-pulse" />
        </div>
        <div className="h-4 w-3/4 bg-[#1A1A26] rounded animate-pulse" />
        <div className="h-3 w-16 bg-[#1A1A26] rounded animate-pulse" />
        <div className="h-1.5 w-full bg-[#1A1A26] rounded animate-pulse mt-3" />
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#2A2A3A]">
          <div className="h-3 w-24 bg-[#1A1A26] rounded animate-pulse" />
          <div className="h-3 w-16 bg-[#1A1A26] rounded animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function SOPsPage() {
  const [sops, setSops] = useState<SOP[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [newDescription, setNewDescription] = useState("");

  const { success: toastSuccess, error: toastError } = useToast();

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
    setCreating(true);
    try {
      const res = await fetch("/api/sops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          description: newDescription,
          category: newCategory,
          content: { steps: [] },
          status: "DRAFT",
        }),
      });
      if (!res.ok) throw new Error("Failed to create SOP");
      setShowAddDialog(false);
      setNewTitle("");
      setNewCategory("");
      setNewDescription("");
      await fetchSOPs();
      toastSuccess("SOP created successfully");
    } catch (err) {
      toastError("Failed to create SOP");
    } finally {
      setCreating(false);
    }
  };

  const categories = [...new Set(sops.map((s) => s.category).filter(Boolean))];

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
          <p className="text-[#8888A0] text-sm mt-1">{total} standard operating procedures &middot; {avgCompliance}% avg compliance</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sops/my-sops">
            <Button variant="outline" className="gap-2"><ClipboardList size={16} /> My SOPs</Button>
          </Link>
          <Link href="/sops/compliance">
            <Button variant="outline" className="gap-2"><ShieldCheck size={16} /> Compliance</Button>
          </Link>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus size={16} /> New SOP</Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create SOP</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2"><Label>Title <span className="text-red-400">*</span></Label><Input placeholder="e.g., Client Onboarding Process" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /></div>
              <div className="space-y-2"><Label>Category</Label>
                <Select value={newCategory} onValueChange={setNewCategory}><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Description</Label><Textarea placeholder="What does this SOP cover?" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={creating || !newTitle.trim()}>{creating ? "Creating..." : "Create SOP"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4 text-center">
              <div className="h-8 w-12 bg-[#1A1A26] rounded animate-pulse mx-auto mb-1" />
              <div className="h-3 w-16 bg-[#1A1A26] rounded animate-pulse mx-auto" />
            </CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Card><CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{sops.length}</p>
            <p className="text-xs text-[#8888A0]">Total SOPs</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{publishedSops.length}</p>
            <p className="text-xs text-[#8888A0]">Published</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className={`text-2xl font-bold ${getComplianceText(avgCompliance)}`}>{avgCompliance}%</p>
            <p className="text-xs text-[#8888A0]">Avg Compliance</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{publishedSops.filter(s => getComplianceScore(s) < 70).length}</p>
            <p className="text-xs text-[#8888A0]">Below Target</p>
          </CardContent></Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8888A0]" />
          <Input placeholder="Search SOPs..." className="pl-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* SOP Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                <Link key={sop.id} href={`/sops/${sop.id}`}><Card className="hover:border-[#3A3A4A] transition-all cursor-pointer group">
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
                    <Badge variant="outline" className="text-[10px] mb-3">{sop.category}</Badge>

                    {sop.status === "PUBLISHED" && (
                      <div className="space-y-2 mt-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[#8888A0]">Compliance</span>
                          <span className={`font-mono font-bold ${getComplianceText(compliance)}`}>{compliance}%</span>
                        </div>
                        <Progress value={compliance} className="h-1.5" indicatorClassName={getComplianceColor(compliance)} />
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#2A2A3A] text-[10px] text-[#8888A0]">
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
    </div>
  );
}

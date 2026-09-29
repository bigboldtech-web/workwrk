"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { formatDate } from "@/lib/format/date";

import { useConsole } from "../../console-context";

import { Dots } from "@/components/ui/dots";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import {
  Building2, Search, ChevronLeft, ChevronRight, Eye,
  Users, CheckSquare, BookOpen, Target, Star,
} from "lucide-react";

interface Company {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  plan: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    users: number;
    tasks: number;
    sops: number;
    reviewCycles: number;
    kras: number;
  };
}

const plans = ["STARTER", "GROWTH", "SCALE", "ENTERPRISE"];
const statuses = ["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"];
/** Statuses that sign everyone out: set only from the company page. */
const REVOKING = ["SUSPENDED", "CANCELLED"];

function getStatusBadge(status: string) {
  switch (status) {
    case "ACTIVE": return <Badge variant="success">Active</Badge>;
    case "TRIAL": return <Badge variant="warning">Trial</Badge>;
    case "SUSPENDED": return <Badge variant="destructive">Suspended</Badge>;
    case "CANCELLED": return <Badge variant="secondary">Cancelled</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

function getPlanColor(plan: string) {
  switch (plan) {
    // Every plan reads the same: a plan is a fact, not a status.
    case "STARTER":
    case "GROWTH":
    case "SCALE":
    case "ENTERPRISE":
    default: return "text-ink";
  }
}

export default function AdminCompaniesPage() {
  const { datePrefs } = useConsole();
  // ?search= arrives from Search (Cmd+K) "See all in Companies", and the
  // box writes back to it, so the URL is the list's search both ways: a
  // second "See all" while this page is open replaces the query, and
  // browser back restores the previous one.
  const router = useRouter();
  const pathname = usePathname();
  const urlSearch = useSearchParams().get("search") ?? "";
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(urlSearch);
  // The last value this page wrote to the URL: its echo is not a new query.
  const wroteSearch = useRef(urlSearch);
  useEffect(() => {
    if (urlSearch === wroteSearch.current) return;
    wroteSearch.current = urlSearch;
    setSearch(urlSearch);
    setPage(1);
  }, [urlSearch]);
  useEffect(() => {
    if (search === wroteSearch.current) return;
    const t = window.setTimeout(() => {
      wroteSearch.current = search;
      const next = search ? `${pathname}?search=${encodeURIComponent(search)}` : pathname;
      router.replace(next, { scroll: false });
    }, 300);
    return () => window.clearTimeout(t);
  }, [search, pathname, router]);
  const [filterPlan, setFilterPlan] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Company | null>(null);
  const [editPlan, setEditPlan] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const { success: toastSuccess, error: toastError } = useToast();

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "15" });
      if (search) params.set("search", search);
      if (filterPlan) params.set("plan", filterPlan);
      if (filterStatus) params.set("status", filterStatus);

      const res = await fetch(`/api/admin/companies?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.companies || []);
        setTotalPages(data.totalPages || 1);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, filterPlan, filterStatus]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  const openDetail = (company: Company) => {
    setSelected(company);
    setEditPlan(company.plan);
    setEditStatus(company.status);
  };

  // Quick edit changes the plan, and moves a company between Active and
  // Trial. Suspending or cancelling signs everyone at the company out, so it
  // happens only on the company page, behind a typed confirmation; the list
  // endpoint refuses it too (src/app/api/admin/companies/route.ts), so this
  // dialog is never the way around that confirm.
  const handleUpdate = async () => {
    if (!selected) return;
    const body: Record<string, string> = { id: selected.id };
    if (editPlan !== selected.plan) body.plan = editPlan;
    if (editStatus !== selected.status) body.status = editStatus;
    if (!body.plan && !body.status) {
      toastSuccess("Nothing changed");
      setSelected(null);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/companies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const changed: string[] = Array.isArray(d?.changed) ? d.changed : [];
        toastSuccess(
          changed.length === 0
            ? "Nothing changed"
            : `${selected.name}: ${changed.map((c) => (c === "plan" ? "plan" : "status")).join(" and ")} updated`,
        );
        setSelected(null);
        fetchCompanies();
      } else {
        toastError("Couldn't update the company", typeof d?.error === "string" ? d.error : "Please try again.");
      }
    } catch {
      toastError("Couldn't update the company", "Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
        <p className="text-ink-2 text-base mt-1">{total} companies</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" />
          <Input
            placeholder="Search companies..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={filterPlan} onValueChange={(v) => { setFilterPlan(v === "ALL" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="All Plans" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Plans</SelectItem>
            {plans.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v === "ALL" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Dots variant="pending" label="Loading" />
            </div>
          ) : companies.length === 0 ? (
            <div className="p-8 text-center text-base text-ink-2">
              No companies found.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Company</th>
                  <th className="text-center p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Plan</th>
                  <th className="text-center p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Users</th>
                  <th className="text-center p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Status</th>
                  <th className="text-center p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Activity</th>
                  <th className="text-right p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Joined</th>
                  <th className="text-center p-4 text-sm font-medium text-ink-2 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-b border-line/50 hover:bg-hover transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Building2 size={14} className="text-ink-2" />
                        <div>
                          <span className="text-base font-medium">{c.name}</span>
                          <p className="text-xs text-ink-2">{c.slug}{c.domain ? ` · ${c.domain}` : ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <span className={`text-sm font-semibold ${getPlanColor(c.plan)}`}>{c.plan}</span>
                    </td>
                    <td className="p-4 text-center text-base">{c._count.users}</td>
                    <td className="p-4 text-center">{getStatusBadge(c.status)}</td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-3 text-xs text-ink-2">
                        <span title="Tasks"><CheckSquare size={10} className="inline mr-0.5" />{c._count.tasks}</span>
                        <span title="KRAs"><Target size={10} className="inline mr-0.5" />{c._count.kras}</span>
                        <span title="SOPs"><BookOpen size={10} className="inline mr-0.5" />{c._count.sops}</span>
                        <span title="Reviews"><Star size={10} className="inline mr-0.5" />{c._count.reviewCycles}</span>
                      </div>
                    </td>
                    <td className="p-4 text-right text-sm text-ink-2">
                      {formatDate(c.createdAt, datePrefs, "date")}
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center gap-1 justify-center">
                        <Button variant="ghost" size="sm" onClick={() => openDetail(c)} title="Quick edit">
                          <Eye size={14} />
                        </Button>
                        <Button asChild variant="outline" size="sm" title="Open detail / manage Enterprise add-ons">
                          <a href={`/admin/companies/${c.id}`}>Manage</a>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-ink-2">
            Page {page} of {totalPages} ({total} companies)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft size={14} />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Detail / Edit Dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 size={18} className="text-ink-2" />
              {selected?.name}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-5 gap-3 text-center">
                <div className="rounded-lg bg-hover p-3">
                  <Users size={14} className="mx-auto mb-1 text-ink-2" />
                  <p className="text-lg font-semibold">{selected._count.users}</p>
                  <p className="text-xs text-ink-2">Users</p>
                </div>
                <div className="rounded-lg bg-hover p-3">
                  <CheckSquare size={14} className="mx-auto mb-1 text-success-text" />
                  <p className="text-lg font-semibold">{selected._count.tasks}</p>
                  <p className="text-xs text-ink-2">Tasks</p>
                </div>
                <div className="rounded-lg bg-hover p-3">
                  <Target size={14} className="mx-auto mb-1 text-ink-2" />
                  <p className="text-lg font-semibold">{selected._count.kras}</p>
                  <p className="text-xs text-ink-2">KRAs</p>
                </div>
                <div className="rounded-lg bg-hover p-3">
                  <BookOpen size={14} className="mx-auto mb-1 text-ink-2" />
                  <p className="text-lg font-semibold">{selected._count.sops}</p>
                  <p className="text-xs text-ink-2">SOPs</p>
                </div>
                <div className="rounded-lg bg-hover p-3">
                  <Star size={14} className="mx-auto mb-1 text-ink-2" />
                  <p className="text-lg font-semibold">{selected._count.reviewCycles}</p>
                  <p className="text-xs text-ink-2">Reviews</p>
                </div>
              </div>

              {/* Info */}
              <div className="space-y-2 text-base">
                <div className="flex justify-between">
                  <span className="text-ink-2">Slug</span>
                  <span className="font-mono text-sm">{selected.slug}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-2">Domain</span>
                  <span>{selected.domain || "None"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-2">Joined</span>
                  <span>{formatDate(selected.createdAt, datePrefs, "date")}</span>
                </div>
              </div>

              {/* Editable fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-ink-2 mb-1 block">Plan</label>
                  <Select value={editPlan} onValueChange={setEditPlan}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {plans.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-ink-2 mb-1 block">Status</label>
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {statuses.map((s) => (
                        <SelectItem key={s} value={s} disabled={REVOKING.includes(s) && s !== selected.status}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-sm text-ink-2">
                To suspend or cancel this company, open{" "}
                <a href={`/admin/companies/${selected.id}`} className="underline underline-offset-4 hover:text-ink">
                  its company page
                </a>
                , which asks you to type the company name first.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

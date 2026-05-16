"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Check, X, CheckSquare, Square, Loader2, Filter, DollarSign, ShoppingCart, Receipt, CalendarOff, Clock, Sparkles } from "lucide-react";

interface AiSuggestion {
  id: string;
  action: "approve" | "hold" | "reassign" | "do" | "review";
  rationale: string;
  confidence: number;
}

const AI_ACTION_COLOR: Record<AiSuggestion["action"], string> = {
  approve: "text-green-400 border-green-400/30 bg-green-400/10",
  hold: "text-amber-400 border-amber-400/30 bg-amber-400/10",
  reassign: "text-blue-400 border-blue-400/30 bg-blue-400/10",
  do: "text-[color:var(--accent-strong)] border-[rgba(212,255,46,0.3)] bg-[rgba(212,255,46,0.06)]",
  review: "text-muted border-white/20 bg-surface-2",
};

const AI_ACTION_LABEL: Record<AiSuggestion["action"], string> = {
  approve: "AI: approve",
  hold: "AI: hold",
  reassign: "AI: reassign",
  do: "AI: do",
  review: "AI: review",
};

export type ApprovalKind = "expense" | "po" | "invoice" | "time_off" | "timesheet";

export interface ApprovalItem {
  id: string;
  kind: ApprovalKind;
  title: string;
  subtitle: string;
  link: string;
  // Optional context for AI / hover. Trimmed string only — no PII beyond
  // what the inbox already shows.
  context?: string;
}

interface Props {
  items: ApprovalItem[];
}

const KIND_META: Record<ApprovalKind, { label: string; icon: typeof DollarSign; color: string }> = {
  expense: { label: "Expenses", icon: DollarSign, color: "text-green-400" },
  po: { label: "Purchase orders", icon: ShoppingCart, color: "text-blue-400" },
  invoice: { label: "Invoices", icon: Receipt, color: "text-violet-400" },
  time_off: { label: "Time off", icon: CalendarOff, color: "text-amber-400" },
  timesheet: { label: "Timesheets", icon: Clock, color: "text-cyan-400" },
};

/** Build the fetch params for an approve/reject action against a given item. */
function decisionCall(item: ApprovalItem, decision: "APPROVE" | "REJECT"): { url: string; init: RequestInit } {
  const dLower = decision.toLowerCase() as "approve" | "reject";
  if (item.kind === "expense") {
    return {
      url: `/api/expenses/${item.id}/decision`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    };
  }
  if (item.kind === "po") {
    return {
      url: `/api/purchase-orders/${item.id}`,
      init: {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: dLower }),
      },
    };
  }
  if (item.kind === "invoice") {
    return {
      url: `/api/invoices/${item.id}`,
      init: {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: dLower }),
      },
    };
  }
  if (item.kind === "time_off") {
    return {
      url: `/api/time-off/${item.id}/decide`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    };
  }
  // timesheet
  return {
    url: `/api/timesheets/${item.id}`,
    init: {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decide", decision }),
    },
  };
}

const FILTER_STORAGE_KEY = "inbox.approvalQueue.filters.v1";

function readSavedFilters(): Set<ApprovalKind> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is ApprovalKind => typeof k === "string" && k in KIND_META));
  } catch {
    return new Set();
  }
}

export function InboxApprovalQueue({ items }: Props) {
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();

  // Active filter chips. Empty set = "show all" (default).
  // Saved-filters: persist the user's last filter choice in localStorage
  // so the queue opens to the same triage scope across visits. We hydrate
  // post-mount (not in the initial useState arg) to avoid an SSR/CSR
  // markup mismatch.
  const [activeFilters, setActiveFilters] = useState<Set<ApprovalKind>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const restored = readSavedFilters();
    if (restored.size > 0) setActiveFilters(restored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(Array.from(activeFilters)));
    } catch {
      // Quota / private mode — non-fatal.
    }
  }, [activeFilters, hydrated]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActioning, setBulkActioning] = useState(false);
  const [, startTransition] = useTransition();

  // AI triage state. Suggestions live alongside the queue, indexed by
  // item id (which encodes kind:id so per-stream items don't collide).
  const [aiSuggestions, setAiSuggestions] = useState<Map<string, AiSuggestion>>(new Map());
  const [aiLoading, setAiLoading] = useState(false);

  async function runAiTriage() {
    if (filteredItems.length === 0) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/inbox-suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: filteredItems.slice(0, 20).map((it) => ({
            id: `${it.kind}:${it.id}`,
            type: it.kind,
            title: it.title,
            context: it.subtitle,
            link: it.link,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toastError(json?.error ?? "AI triage unavailable");
        return;
      }
      const data = json?.data ?? json;
      const next = new Map<string, AiSuggestion>();
      for (const s of (data?.suggestions ?? []) as AiSuggestion[]) {
        next.set(s.id, s);
      }
      setAiSuggestions(next);
    } catch {
      toastError("Couldn't reach the AI service");
    } finally {
      setAiLoading(false);
    }
  }

  function selectAiRecommended(action: AiSuggestion["action"]) {
    const ids = new Set<string>();
    for (const it of filteredItems) {
      const sug = aiSuggestions.get(`${it.kind}:${it.id}`);
      if (sug?.action === action) ids.add(it.id);
    }
    if (ids.size === 0) {
      toastError(`No items match AI action "${action}".`);
      return;
    }
    setSelectedIds(ids);
  }

  const allKinds = useMemo(() => {
    const s = new Set<ApprovalKind>();
    for (const it of items) s.add(it.kind);
    return Array.from(s).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    if (activeFilters.size === 0) return items;
    return items.filter((it) => activeFilters.has(it.kind));
  }, [items, activeFilters]);

  const allSelected = filteredItems.length > 0 && filteredItems.every((it) => selectedIds.has(it.id));
  const someSelected = filteredItems.some((it) => selectedIds.has(it.id));

  function toggleFilter(kind: ApprovalKind) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
    // Selection scope changed — drop any selections that just dropped out.
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const visibleIds = new Set(items.filter((it) => activeFilters.size === 0 || activeFilters.has(it.kind)).map((it) => it.id));
      for (const id of next) if (!visibleIds.has(id)) next.delete(id);
      return next;
    });
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((it) => it.id)));
    }
  }

  async function bulkDecide(decision: "APPROVE" | "REJECT") {
    const selected = filteredItems.filter((it) => selectedIds.has(it.id));
    if (selected.length === 0) return;
    if (!confirm(`${decision === "APPROVE" ? "Approve" : "Reject"} ${selected.length} item${selected.length === 1 ? "" : "s"}?`)) return;

    setBulkActioning(true);
    let ok = 0;
    const failures: ApprovalItem[] = [];
    // Parallel — most approval endpoints are independent of each other,
    // and any per-row failure is captured separately so the others still
    // complete.
    await Promise.all(selected.map(async (item) => {
      const { url, init } = decisionCall(item, decision);
      try {
        const res = await fetch(url, init);
        if (res.ok) ok += 1;
        else failures.push(item);
      } catch {
        failures.push(item);
      }
    }));

    if (ok > 0) {
      toastSuccess(`${decision === "APPROVE" ? "Approved" : "Rejected"} ${ok} item${ok === 1 ? "" : "s"}.`);
    }
    if (failures.length > 0) {
      toastError(`${failures.length} item${failures.length === 1 ? "" : "s"} couldn't be ${decision === "APPROVE" ? "approved" : "rejected"}.`);
    }
    setSelectedIds(new Set());
    setBulkActioning(false);
    // Refetch the server-rendered inbox so the rows we just acted on
    // drop off the page.
    startTransition(() => router.refresh());
  }

  if (items.length === 0) return null;

  const totalShown = filteredItems.length;
  const selectedCount = filteredItems.filter((it) => selectedIds.has(it.id)).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <CheckSquare size={16} /> Approval queue
          <span className="text-xs text-muted font-normal">({items.length})</span>
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            <button
              onClick={runAiTriage}
              disabled={aiLoading || filteredItems.length === 0}
              className="text-[10px] inline-flex items-center gap-1 rounded-full border border-[rgba(212,255,46,0.3)] px-2 py-0.5 text-[color:var(--accent-strong)] bg-[rgba(212,255,46,0.06)] hover:bg-[rgba(212,255,46,0.12)] disabled:opacity-50 transition-colors"
              title="Ask AI to suggest an action per row"
            >
              {aiLoading ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
              {aiSuggestions.size > 0 ? "Re-run AI triage" : "Suggest with AI"}
            </button>
            {aiSuggestions.size > 0 && (
              <button
                onClick={() => selectAiRecommended("approve")}
                className="text-[10px] rounded-full border border-green-400/30 px-2 py-0.5 text-green-400 bg-green-400/10 hover:bg-green-400/20 transition-colors"
                title="Select all rows the AI suggested approving"
              >
                Select AI approves
              </button>
            )}
            <Filter size={11} className="text-muted-2" />
            {allKinds.map((kind) => {
              const meta = KIND_META[kind];
              const Icon = meta.icon;
              const active = activeFilters.has(kind);
              const count = items.filter((it) => it.kind === kind).length;
              return (
                <button
                  key={kind}
                  onClick={() => toggleFilter(kind)}
                  className={`text-[10px] inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors ${
                    active
                      ? `${meta.color} border-current bg-current/10`
                      : "text-muted border-white/20 hover:text-foreground"
                  }`}
                  title={`${active ? "Hide" : "Show only"} ${meta.label}`}
                >
                  <Icon size={9} />
                  {meta.label} <span className="font-mono">{count}</span>
                </button>
              );
            })}
            {activeFilters.size > 0 && (
              <button
                onClick={() => setActiveFilters(new Set())}
                className="text-[10px] text-muted hover:text-foreground underline ml-1"
              >
                clear
              </button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Bulk action bar — appears whenever something is selected. */}
        {someSelected && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-[rgba(212,255,46,0.3)] bg-[rgba(212,255,46,0.06)] px-3 py-2">
            <span className="text-xs">
              {selectedCount} of {totalShown} selected
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 text-green-400 border-green-400/30 hover:bg-green-400/10"
                onClick={() => bulkDecide("APPROVE")}
                disabled={bulkActioning}
              >
                {bulkActioning ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Approve {selectedCount}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 text-red-400 border-red-400/30 hover:bg-red-400/10"
                onClick={() => bulkDecide("REJECT")}
                disabled={bulkActioning}
              >
                {bulkActioning ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                Reject {selectedCount}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setSelectedIds(new Set())}
                disabled={bulkActioning}
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 px-2 py-1 border-b border-border text-[10px] text-muted-2 uppercase tracking-wide">
          <button
            onClick={toggleSelectAll}
            className="flex items-center text-muted hover:text-foreground transition-colors"
            aria-label={allSelected ? "Clear selection" : "Select all visible"}
          >
            {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
          </button>
          <span className="flex-1">Item</span>
          <span>Kind</span>
        </div>

        <ul className="divide-y divide-border">
          {filteredItems.map((item) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            const selected = selectedIds.has(item.id);
            const sug = aiSuggestions.get(`${item.kind}:${item.id}`);
            return (
              <li key={`${item.kind}:${item.id}`} className={`flex items-start gap-2 py-2 px-2 -mx-2 rounded transition-colors ${selected ? "bg-[rgba(212,255,46,0.06)]" : "hover:bg-surface-2"}`}>
                <button
                  onClick={() => toggleRow(item.id)}
                  className="mt-0.5 text-muted hover:text-foreground transition-colors"
                  aria-label={selected ? "Deselect" : "Select"}
                >
                  {selected ? (
                    <CheckSquare size={14} className="text-[color:var(--accent-strong)]" />
                  ) : (
                    <Square size={14} />
                  )}
                </button>
                <Link href={item.link} className="flex-1 min-w-0 group">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate group-hover:underline">{item.title}</span>
                    {sug && (
                      <span
                        className={`text-[9px] uppercase tracking-wide inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${AI_ACTION_COLOR[sug.action]}`}
                        title={`AI ${(sug.confidence * 100).toFixed(0)}% confidence — ${sug.rationale}`}
                      >
                        <Sparkles size={8} />
                        {AI_ACTION_LABEL[sug.action]}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted truncate">
                    {sug ? sug.rationale : item.subtitle}
                  </p>
                </Link>
                <span className={`text-[10px] uppercase tracking-wide inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${meta.color} border-current/30 bg-current/5 shrink-0`}>
                  <Icon size={9} />
                  {meta.label.replace(/s$/, "")}
                </span>
              </li>
            );
          })}
        </ul>

        {filteredItems.length === 0 && (
          <p className="text-xs text-muted text-center py-6">No items match the current filter.</p>
        )}
      </CardContent>
    </Card>
  );
}

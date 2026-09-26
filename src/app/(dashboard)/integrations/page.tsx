"use client";

// Integrations (spec-tools-misc 2.6): the catalogue of other people's tools
// WorkwrK can talk to, said honestly, for every Member.
//
// Every card has ONE footer control, and it is always real:
//   ready, you can set it up     "Set up", to the page where that happens
//   ready, somebody else's job   "Ask an admin to connect this"
//   connected                    "Connected", with Manage for those who can
//   not built                    "Request this", which counts people
//
// What went: the KPI tiles (Catalog / Categories / Status: Preview), the
// inline banner, the Settings and Calendar header links, the Stripe and
// QuickBooks rows (finance left the product), and the static "Coming soon"
// on every card. Looker and Metabase render only with Show upcoming features
// on. The search that filtered one loaded page is the filter panel's row
// search with a real ?q= on GET /api/integrations, and "/" opens it.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays, MessageCircle, Mail, HardDrive, Code2, KeyRound, BarChart3, Plus, Plug, type LucideIcon,
} from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterGroup, FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { SkeletonCard } from "@/components/ui/skeleton";
import { RequestButton } from "@/components/ui/request-button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { useShortcut } from "@/lib/shortcuts";
import { CONNECTOR_CATEGORIES, type ConnectorCategory } from "@/lib/integrations/registry";

type Row = {
  key: string;
  name: string;
  category: ConnectorCategory;
  blurb: string;
  status: "ready" | "connected" | "not_built" | "upcoming";
  setupHref: string | null;
  canSetUp: boolean;
  requestCount: number;
  requestedByMe: boolean;
};

const CATEGORY_ICON: Record<ConnectorCategory, LucideIcon> = {
  Calendar: CalendarDays,
  Messaging: MessageCircle,
  Email: Mail,
  Storage: HardDrive,
  Development: Code2,
  Identity: KeyRound,
  Analytics: BarChart3,
};

type Tab = "all" | "ready" | "requested";

export default function IntegrationsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const showUpcoming = useShowUpcoming();
  const { toast } = useOsToast();

  const q = sp?.get("q") ?? "";
  const category = sp?.get("category") ?? "";
  const tab: Tab = sp?.get("status") === "ready" ? "ready" : sp?.get("status") === "requested" ? "requested" : "all";

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(Boolean(q || category));
  const [draftQ, setDraftQ] = useState(q);
  const [requestOpen, setRequestOpen] = useState(false);

  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  // The row search writes ?q= after a short pause, so the URL (and a shared
  // link) carries it.
  useEffect(() => {
    if (draftQ === q) return;
    const t = setTimeout(() => setParams({ q: draftQ.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [draftQ, q, setParams]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (tab !== "all") params.set("status", tab === "ready" ? "ready" : "requested");
    if (showUpcoming) params.set("upcoming", "1");
    const r = await apiFetch<{ connectors: Row[] }>(`/api/integrations?${params}`, { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setRows(r.data.connectors);
  }, [q, category, tab, showUpcoming]);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  useShortcut({ id: "integrations.search", keys: "/", label: "Search connectors", scope: "page", group: "On this page", run: (e) => {
    e.preventDefault();
    setFilterOpen(true);
    requestAnimationFrame(() => (document.querySelector(".os-filter-panel input[type=search]") as HTMLInputElement | null)?.focus());
  } });

  const activeFilters = (q ? 1 : 0) + (category ? 1 : 0);
  const patchRow = (key: string, next: { requestCount: number; requestedByMe: boolean }) =>
    setRows((prev) => (prev ? prev.map((r) => (r.key === key ? { ...r, ...next } : r)) : prev));

  const sorted = useMemo(() => {
    if (!rows) return null;
    // Ready first, then the most-requested, the only honest ordering signal.
    const rank = (r: Row) => (r.status === "ready" || r.status === "connected" ? 0 : r.status === "not_built" ? 1 : 2);
    return [...rows].sort((a, b) => rank(a) - rank(b) || b.requestCount - a.requestCount || a.name.localeCompare(b.name));
  }, [rows]);

  return (
    <>
      <OsPageHeader
        title="Integrations"
        views={
          <>
            <ViewTab label="All" active={tab === "all"} onClick={() => setParams({ status: null })} />
            <ViewTab label="Ready" active={tab === "ready"} onClick={() => setParams({ status: "ready" })} />
            <ViewTab label="Requested" active={tab === "requested"} onClick={() => setParams({ status: "requested" })} />
          </>
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: activeFilters },
          primary: { label: "Request a connector", icon: Plus, onClick: () => setRequestOpen(true) },
        }}
      />
      <div className="os-chrome flex min-h-0 flex-1 gap-4 px-6 pb-8 pt-2">
        <FilterPanel
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          objects="connectors"
          activeCount={activeFilters}
          onClearAll={() => { setDraftQ(""); setParams({ q: null, category: null }); }}
          search={{ value: draftQ, onChange: setDraftQ, placeholder: "Search connectors" }}
        >
          <FilterGroup label="Category">
            {CONNECTOR_CATEGORIES.filter((c) => showUpcoming || c !== "Analytics").map((c) => (
              <FilterRow key={c} label={c} checked={category === c} onCheckedChange={(on) => setParams({ category: on ? c : null })} />
            ))}
          </FilterGroup>
        </FilterPanel>

        <div className="min-w-0 flex-1">
          {error ? (
            <OsEmptyView variant="error" title="Couldn't load Integrations" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
          ) : sorted === null ? (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex h-11 items-center gap-1 text-row text-ink-2">
              No results ·
              <button type="button" className="text-brand-deep hover:underline" onClick={() => { setDraftQ(""); setParams({ q: null, category: null, status: null }); }}>Clear filters</button>
            </div>
          ) : (
            <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {sorted.map((c) => (
                <ConnectorCard key={c.key} c={c} onRequested={(next) => patchRow(c.key, next)} />
              ))}
            </ul>
          )}
        </div>
      </div>
      <RequestConnectorDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        onSent={() => { toast("Thanks. We read every one of these."); void load(); }}
      />
    </>
  );
}

function ConnectorCard({ c, onRequested }: { c: Row; onRequested: (next: { requestCount: number; requestedByMe: boolean }) => void }) {
  const Icon = CATEGORY_ICON[c.category] ?? Plug;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-hover text-ink-2">
          <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">{c.name}</h3>
            <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-hover px-2 text-xs font-medium text-ink-2">{c.category}</span>
          </div>
          <p className="mt-1 text-sm text-ink-2">{c.blurb}</p>
        </div>
      </div>
      <div className="mt-auto flex min-h-8 items-center">
        {c.status === "connected" ? (
          <span className="inline-flex items-center gap-2 text-sm text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-presence" aria-hidden />Connected
            {c.canSetUp && c.setupHref ? <Link href={c.setupHref} className="ms-2 font-medium text-brand-deep hover:underline">Manage</Link> : null}
          </span>
        ) : c.status === "ready" ? (
          c.canSetUp && c.setupHref ? (
            <Link href={c.setupHref} className="inline-flex h-8 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover">Set up</Link>
          ) : (
            <span className="text-sm text-ink-2">Ask an admin to connect this</span>
          )
        ) : c.status === "upcoming" ? (
          <span className="inline-flex h-6 items-center rounded-md bg-hover px-2 text-xs font-medium text-ink-2" title="Not built yet">Coming soon</span>
        ) : (
          <RequestButton connectorKey={c.key} name={c.name} count={c.requestCount} requested={c.requestedByMe} onChange={onRequested} />
        )}
      </div>
    </li>
  );
}

function RequestConnectorDialog({ open, onOpenChange, onSent }: { open: boolean; onOpenChange: (v: boolean) => void; onSent: () => void }) {
  const { toast } = useOsToast();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!name.trim()) return;
    setBusy(true);
    const r = await apiFetch("/api/integrations/requests", { method: "POST", json: { key: name.trim(), note: note.trim() || undefined } });
    setBusy(false);
    if (!r.ok) { toast(r.error || "Couldn't send the request", { tone: "danger" }); return; }
    setName(""); setNote("");
    onOpenChange(false);
    onSent();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Request a connector</DialogTitle>
          <DialogDescription>Tell us which tool you want WorkwrK to talk to. Connectors are built in the order people ask for them.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="For example, HubSpot" className="h-9 rounded-md border border-line-strong bg-raised px-3 text-base font-normal text-ink placeholder:text-ink-3" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            What would you use it for?
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="rounded-md border border-line-strong bg-raised px-3 py-2 text-base font-normal text-ink" />
          </label>
        </div>
        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void send()} disabled={busy || !name.trim()} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-50">Send request</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

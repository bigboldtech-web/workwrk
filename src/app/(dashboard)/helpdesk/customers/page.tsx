"use client";

/* Helpdesk · Customers — directory of support customers.
 *
 *  GET   /api/helpdesk/customers          list w/ _count.tickets
 *  POST  /api/helpdesk/customers          upsert by email
 *
 * Layout:
 *   OsTitleBar with back + nav + New customer in actions.
 *   4-tile KPI strip: Total · With open tickets · Avg tickets · This month new.
 *   Toolbar: search + tone tabs (All / With tickets / Without) + sort dropdown.
 *   Card grid: avatar tile, name + company, email/phone, ticket count, member since.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Users, Plus, Search, ArrowLeft, Mail, Phone, Building2, ChevronDown,
  Inbox, Sparkles, UserCheck, MessageCircle,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiCustomer = {
  id: string;
  name?: string | null;
  email: string;
  companyName?: string | null;
  phone?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { tickets?: number };
};

const AV_GRADIENTS = [
  GRAD.bluePurple, GRAD.greenTeal, GRAD.pinkPurple, GRAD.indigoBlue,
  GRAD.orangePink, GRAD.purpleIndigo, GRAD.tealGreen, GRAD.yellowOrange,
];
function avGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_GRADIENTS[h % AV_GRADIENTS.length];
}
function avInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
function displayName(c: ApiCustomer): string {
  return c.name || c.email.split("@")[0] || "Anonymous";
}
function domain(email: string): string {
  return email.split("@")[1] ?? "";
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function fmtMember(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

type Filter = "all" | "with-tickets" | "without";
type SortKey = "recent" | "name" | "tickets" | "oldest";

export default function CustomersPage() {
  const [customers, setCustomers] = useState<ApiCustomer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/helpdesk/customers");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCustomers(data.customers ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("helpdesk");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function addCustomer() {
    const email = (typeof window !== "undefined" ? window.prompt("Customer email?") : "")?.trim();
    if (!email) return;
    try {
      const res = await fetch("/api/helpdesk/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Customer added");
      void load();
    } catch { toast("Couldn't add customer"); }
  }

  // ─── Filter + sort ────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = customers ?? [];
    if (filter === "with-tickets") list = list.filter((c) => (c._count?.tickets ?? 0) > 0);
    if (filter === "without") list = list.filter((c) => (c._count?.tickets ?? 0) === 0);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.companyName ?? "").toLowerCase().includes(q));
    }
    const sorted = list.slice();
    if (sortKey === "name") sorted.sort((a, b) => displayName(a).localeCompare(displayName(b)));
    else if (sortKey === "tickets") sorted.sort((a, b) => (b._count?.tickets ?? 0) - (a._count?.tickets ?? 0));
    else if (sortKey === "oldest") sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    else sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sorted;
  }, [customers, filter, query, sortKey]);

  // ─── KPIs ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = customers ?? [];
    const withTickets = list.filter((c) => (c._count?.tickets ?? 0) > 0);
    const totalTickets = list.reduce((acc, c) => acc + (c._count?.tickets ?? 0), 0);
    const avg = list.length === 0 ? 0 : totalTickets / list.length;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const newThisMonth = list.filter((c) => new Date(c.createdAt).getTime() >= monthStart).length;
    return { total: list.length, withTickets: withTickets.length, withoutTickets: list.length - withTickets.length, totalTickets, avg, newThisMonth };
  }, [customers]);

  return (
    <>
      <OsTitleBar
        title="Customers"
        Icon={Users}
        iconGradient={GRAD.greenTeal}
        description={customers === null
          ? "Loading customers…"
          : `${stats.total} customer${stats.total === 1 ? "" : "s"} · ${stats.totalTickets} ticket${stats.totalTickets === 1 ? "" : "s"} total`}
        people={[PEOPLE.pr, PEOPLE.mk, PEOPLE.sc]}
        morePeople={4}
        actions={
          <div className="hdc__head-actions">
            <button type="button" className="hdc__back" onClick={() => history.back()}>
              <ArrowLeft /> Inbox
            </button>
            <Link href="/helpdesk/tickets" className="hdc__nav-link">Tickets</Link>
            <Link href="/helpdesk/macros" className="hdc__nav-link">Macros</Link>
            <button type="button" className="hdc__btn-primary" onClick={addCustomer}>
              <Plus /> New customer
            </button>
          </div>
        }
      />

      <div className="hdc">
        {/* KPIs */}
        <div className="hdc__kpis">
          <KpiTile accent="var(--os-c-green)"  Icon={Users}        label="Total customers" value={`${stats.total}`}                 sub="in directory" />
          <KpiTile accent="var(--os-c-orange)" Icon={Inbox}        label="With tickets"    value={`${stats.withTickets}`}           sub={`${stats.withoutTickets} ticket-free`} />
          <KpiTile accent="var(--os-c-blue)"   Icon={MessageCircle} label="Avg tickets"    value={stats.avg.toFixed(1)}             sub="per customer" />
          <KpiTile accent="var(--os-c-purple)" Icon={Sparkles}     label="New this month"  value={`${stats.newThisMonth}`}          sub="recently added" />
        </div>

        {/* Toolbar */}
        <div className="hdc__toolbar">
          <div className="hdc__search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, company…"
              aria-label="Search customers"
            />
          </div>
          <div className="hdc__tabs">
            <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>
              All <span>{stats.total}</span>
            </button>
            <button type="button" className={filter === "with-tickets" ? "is-active" : ""} onClick={() => setFilter("with-tickets")}>
              With tickets <span>{stats.withTickets}</span>
            </button>
            <button type="button" className={filter === "without" ? "is-active" : ""} onClick={() => setFilter("without")}>
              No tickets <span>{stats.withoutTickets}</span>
            </button>
          </div>
          <div className="hdc__sort">
            <span>Sort</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="hdc__sort-select">
              <option value="recent">Recently active</option>
              <option value="name">A–Z</option>
              <option value="tickets">Most tickets</option>
              <option value="oldest">Oldest first</option>
            </select>
            <ChevronDown />
          </div>
        </div>

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={Users} iconGradient={GRAD.redPink} title="Couldn't load customers" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : customers === null ? (
          <div className="hdc__loading">Loading customers…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Users}
            iconGradient={GRAD.greenTeal}
            title="No customers yet"
            subtitle="Customers are auto-created when tickets arrive (email, portal, chat). Add one manually here, or wait for the first inbound."
            chips={["From email", "From portal", "From chat"]}
            cta="New customer"
          />
        ) : filtered.length === 0 ? (
          <div className="hdc__empty">
            <Search />
            <div>No customers match these filters.</div>
            <button type="button" className="hdc__empty-reset" onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</button>
          </div>
        ) : (
          <div className="hdc__grid">
            {filtered.map((c) => <CustomerCard key={c.id} customer={c} />)}
          </div>
        )}
      </div>
    </>
  );
}

function CustomerCard({ customer: c }: { customer: ApiCustomer }) {
  const name = displayName(c);
  const av = avGradient(c.id);
  const init = avInitials(name);
  const ticketCount = c._count?.tickets ?? 0;
  const dom = c.companyName || domain(c.email);
  const href = `/helpdesk/tickets?customer=${encodeURIComponent(c.email)}`;
  return (
    <Link href={href} className="hdc__card">
      <div className="hdc__card-head">
        <div className="hdc__card-av" style={{ background: av }} aria-hidden="true">{init}</div>
        {ticketCount > 0 ? (
          <span className="hdc__card-ticket-badge" title={`${ticketCount} ticket${ticketCount === 1 ? "" : "s"}`}>
            <Inbox /> {ticketCount}
          </span>
        ) : (
          <span className="hdc__card-clean-badge" title="No tickets">
            <UserCheck />
          </span>
        )}
      </div>

      <div className="hdc__card-body">
        <div className="hdc__card-name">{name}</div>
        {dom && (
          <div className="hdc__card-company">
            <Building2 /> {dom}
          </div>
        )}
        <div className="hdc__card-line"><Mail /> <span>{c.email}</span></div>
        {c.phone && <div className="hdc__card-line"><Phone /> <span>{c.phone}</span></div>}
      </div>

      <div className="hdc__card-foot">
        <span className="hdc__card-since">Joined {fmtMember(c.createdAt)}</span>
        <span className="hdc__card-recent">Active {fmtRelative(c.updatedAt)}</span>
      </div>
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Users; label: string; value: string; sub: string }) {
  return (
    <div className="hdc__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="hdc__kpi-accent" aria-hidden="true" />
      <div className="hdc__kpi-row">
        <div className="hdc__kpi-icon"><Icon /></div>
        <div className="hdc__kpi-label">{label}</div>
      </div>
      <div className="hdc__kpi-value">{value}</div>
      <div className="hdc__kpi-sub">{sub}</div>
    </div>
  );
}

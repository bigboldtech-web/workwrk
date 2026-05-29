"use client";

/* CRM · Accounts — card grid with logo tiles.
 *
 *  GET  /api/crm/accounts          list this org's accounts
 *  POST /api/crm/accounts          { name, type? }
 *
 * Layout:
 *   OsTitleBar with type filter chips + New account CTA in actions slot.
 *   KPI strip: Total · Customers · Prospects · Partners.
 *   Card grid grouped by type, with bespoke logo tiles, type badges, hover overlay.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2, Plus, Briefcase, UserCheck, Handshake, Search, ExternalLink,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type AccountType = "PROSPECT" | "CUSTOMER" | "PARTNER" | "CHURNED" | "COMPETITOR";

type ApiAccount = {
  id: string;
  name: string;
  domain?: string | null;
  industry?: string | null;
  size?: string | null;
  website?: string | null;
  phone?: string | null;
  description?: string | null;
  type: AccountType;
  ownerId?: string | null;
  _count?: { opportunities?: number };
  createdAt: string;
  updatedAt: string;
};

const TYPE_LABELS: Record<AccountType, string> = {
  PROSPECT: "Prospect", CUSTOMER: "Customer", PARTNER: "Partner",
  CHURNED: "Churned", COMPETITOR: "Competitor",
};
const TYPE_COLORS: Record<AccountType, string> = {
  PROSPECT: C.indigo, CUSTOMER: C.green, PARTNER: C.purple,
  CHURNED: C.gray, COMPETITOR: C.red,
};
const TYPE_GRADIENTS: Record<AccountType, string> = {
  PROSPECT: `linear-gradient(135deg, ${C.indigo}, ${C.blue})`,
  CUSTOMER: `linear-gradient(135deg, ${C.green}, ${C.teal})`,
  PARTNER:  `linear-gradient(135deg, ${C.purple}, ${C.pink})`,
  CHURNED:  `linear-gradient(135deg, ${C.gray}, ${C.brown})`,
  COMPETITOR: `linear-gradient(135deg, ${C.red}, ${C.orange})`,
};

const GROUP_ORDER: AccountType[] = ["CUSTOMER", "PROSPECT", "PARTNER", "COMPETITOR", "CHURNED"];

const LOGO_PALETTE = [
  GRAD.bluePurple, GRAD.greenTeal, GRAD.pinkPurple, GRAD.indigoBlue,
  GRAD.orangePink, GRAD.purpleIndigo, GRAD.tealGreen, GRAD.yellowOrange,
];
function logoGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return LOGO_PALETTE[h % LOGO_PALETTE.length];
}
function logoInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function cleanDomain(d?: string | null): string | null {
  if (!d) return null;
  return d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

type Filter = "all" | AccountType;

export default function CrmAccountsPage() {
  const [rows, setRows] = useState<ApiAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/accounts");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.accounts ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("crm/accounts");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function addAccount(type: AccountType = "PROSPECT") {
    try {
      const res = await fetch("/api/crm/accounts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled account", type }),
      });
      if (!res.ok) {
        if (res.status === 409) toast("Name already exists");
        throw new Error(`POST ${res.status}`);
      }
      toast("Account added");
      void load();
    } catch {
      // already toasted on 409
    }
  }

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((a) => {
      if (filter !== "all" && a.type !== filter) return false;
      if (q) {
        const hay = `${a.name} ${a.domain ?? ""} ${a.industry ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, query]);

  const groups = useMemo(() => {
    const buckets = new Map<AccountType, ApiAccount[]>();
    for (const t of GROUP_ORDER) buckets.set(t, []);
    for (const a of filtered) {
      const b = buckets.get(a.type);
      if (b) b.push(a);
    }
    return GROUP_ORDER
      .map((t) => ({ type: t, label: TYPE_LABELS[t], color: TYPE_COLORS[t], accounts: buckets.get(t) ?? [] }))
      .filter((g) => g.accounts.length > 0);
  }, [filtered]);

  const counts = useMemo(() => {
    const total = rows?.length ?? 0;
    const byType: Record<AccountType, number> = {
      PROSPECT: 0, CUSTOMER: 0, PARTNER: 0, CHURNED: 0, COMPETITOR: 0,
    };
    for (const a of rows ?? []) byType[a.type]++;
    return { total, byType };
  }, [rows]);

  const totalDeals = useMemo(() => (rows ?? []).reduce((acc, a) => acc + (a._count?.opportunities ?? 0), 0), [rows]);

  return (
    <>
      <OsTitleBar
        title="Accounts"
        Icon={Building2}
        iconGradient={GRAD.greenTeal}
        description={rows === null
          ? "Loading accounts…"
          : `${counts.total} account${counts.total === 1 ? "" : "s"} · ${counts.byType.CUSTOMER} customer${counts.byType.CUSTOMER === 1 ? "" : "s"}`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
        actions={
          <div className="acct__head-actions">
            <Link href="/crm" className="acct__nav-link">Pipeline</Link>
            <button type="button" className="acct__btn-primary" onClick={() => addAccount("PROSPECT")}>
              <Plus /> New account
            </button>
          </div>
        }
      />

      <div className="acct">
        {/* KPI strip */}
        <div className="acct__kpis">
          <KpiTile accent="var(--os-c-indigo)" Icon={Building2} label="Total accounts" value={`${counts.total}`} sub={`${totalDeals} open deal${totalDeals === 1 ? "" : "s"}`} />
          <KpiTile accent="var(--os-c-green)"  Icon={UserCheck} label="Customers"     value={`${counts.byType.CUSTOMER}`} sub={pctSub(counts.byType.CUSTOMER, counts.total)} />
          <KpiTile accent="var(--os-c-blue)"   Icon={Briefcase} label="Prospects"     value={`${counts.byType.PROSPECT}`} sub={pctSub(counts.byType.PROSPECT, counts.total)} />
          <KpiTile accent="var(--os-c-purple)" Icon={Handshake} label="Partners"      value={`${counts.byType.PARTNER}`}  sub={pctSub(counts.byType.PARTNER, counts.total)} />
        </div>

        {/* Filter bar */}
        <div className="acct__filters">
          <div className="acct__search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search accounts, domains, industries…"
              aria-label="Search accounts"
            />
          </div>
          <div className="acct__chips">
            <FilterChip label="All" count={counts.total}                   active={filter === "all"}        onClick={() => setFilter("all")} />
            <FilterChip label="Customers" count={counts.byType.CUSTOMER}   color={C.green}  active={filter === "CUSTOMER"} onClick={() => setFilter("CUSTOMER")} />
            <FilterChip label="Prospects" count={counts.byType.PROSPECT}   color={C.indigo} active={filter === "PROSPECT"} onClick={() => setFilter("PROSPECT")} />
            <FilterChip label="Partners"  count={counts.byType.PARTNER}    color={C.purple} active={filter === "PARTNER"}  onClick={() => setFilter("PARTNER")} />
            <FilterChip label="Competitors" count={counts.byType.COMPETITOR} color={C.red}  active={filter === "COMPETITOR"} onClick={() => setFilter("COMPETITOR")} />
            <FilterChip label="Churned" count={counts.byType.CHURNED}      color={C.gray}   active={filter === "CHURNED"}  onClick={() => setFilter("CHURNED")} />
          </div>
        </div>

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={Building2} iconGradient={GRAD.redPink} title="Couldn't load accounts" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : rows === null ? (
          <div className="acct__loading">Loading accounts…</div>
        ) : (rows.length === 0) ? (
          <OsEmptyView
            Icon={Building2}
            iconGradient={GRAD.greenTeal}
            title="No accounts yet"
            subtitle="Track the companies you sell to. Tag them as prospects, customers, partners — and link every opportunity back."
            chips={["Prospect", "Customer", "Partner", "Industry"]}
            cta="New account"
          />
        ) : groups.length === 0 ? (
          <div className="acct__empty">
            <Search />
            <div>No accounts match your filters.</div>
            <button type="button" className="acct__empty-reset" onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</button>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.type} className="acct__group" style={{ ["--g-c" as unknown as string]: g.color }}>
              <header className="acct__group-head">
                <span className="acct__group-dot" />
                <h2 className="acct__group-title">{g.label}s</h2>
                <span className="acct__group-count">{g.accounts.length}</span>
                <button type="button" className="acct__group-add" onClick={() => addAccount(g.type)}>
                  <Plus /> Add {g.label.toLowerCase()}
                </button>
              </header>
              <div className="acct__grid">
                {g.accounts.map((a) => (
                  <AccountCard key={a.id} acct={a} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function pctSub(part: number, total: number): string {
  if (total === 0) return "—";
  const pct = Math.round((part / total) * 100);
  return `${pct}% of accounts`;
}

function AccountCard({ acct }: { acct: ApiAccount }) {
  const domain = cleanDomain(acct.domain ?? acct.website);
  const dealCount = acct._count?.opportunities ?? 0;
  return (
    <Link href={`/crm/accounts/${acct.id}`} className="acct__card">
      <div className="acct__card-head">
        <div className="acct__logo" style={{ background: logoGradient(acct.name) }} aria-hidden="true">
          {logoInitials(acct.name)}
        </div>
        <span className="acct__type" style={{ background: TYPE_GRADIENTS[acct.type] }}>
          {TYPE_LABELS[acct.type]}
        </span>
      </div>

      <div className="acct__card-body">
        <div className="acct__card-name">{acct.name}</div>
        {(acct.industry || acct.size) && (
          <div className="acct__card-meta">
            {acct.industry && <span>{acct.industry}</span>}
            {acct.industry && acct.size && <span className="acct__card-sep">·</span>}
            {acct.size && <span>{acct.size}</span>}
          </div>
        )}
        {domain && (
          <div className="acct__card-domain">
            <ExternalLink /> {domain}
          </div>
        )}
      </div>

      <div className="acct__card-foot">
        <span className="acct__card-deals">
          <strong>{dealCount}</strong> open deal{dealCount === 1 ? "" : "s"}
        </span>
        <span className="acct__card-open">Open →</span>
      </div>
    </Link>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Building2; label: string; value: string; sub: string }) {
  return (
    <div className="acct__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="acct__kpi-accent" aria-hidden="true" />
      <div className="acct__kpi-row">
        <div className="acct__kpi-icon"><Icon /></div>
        <div className="acct__kpi-label">{label}</div>
      </div>
      <div className="acct__kpi-value">{value}</div>
      <div className="acct__kpi-sub">{sub}</div>
    </div>
  );
}

function FilterChip({ label, count, color, active, onClick }: { label: string; count: number; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`acct__chip${active ? " is-active" : ""}`}
      style={color ? { ["--chip-c" as unknown as string]: color } : undefined}
      onClick={onClick}
    >
      {color && <span className="acct__chip-dot" />}
      {label}
      <span className="acct__chip-count">{count}</span>
    </button>
  );
}

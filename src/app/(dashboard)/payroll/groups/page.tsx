"use client";

/* Payroll · Pay groups — config catalog.
 *
 *  GET  /api/pay-groups
 *  POST /api/pay-groups   { name, frequency, country, currency, anchorDate, payOffsetDays }
 *
 * Layout:
 *   OsTitleBar with back + nav + New group CTA.
 *   4-tile KPI strip: Total · Active · Payslips · Runs.
 *   Toolbar: search + show inactive toggle.
 *   Card grid showing each pay group with frequency tag, currency, anchor info, run counts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus, Search, ArrowLeft, Layers, Globe, Calendar as CalendarIcon,
  Receipt, FileText, Users, Power, PowerOff,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Frequency = "WEEKLY" | "BIWEEKLY" | "SEMIMONTHLY" | "MONTHLY";

type ApiPayGroup = {
  id: string;
  name: string;
  country: string;
  currency: string;
  frequency: Frequency;
  anchorDate: string;
  payOffsetDays: number;
  active: boolean;
  _count?: { payRuns?: number; payslips?: number };
};

const FREQ_LABELS: Record<Frequency, string> = {
  WEEKLY: "Weekly", BIWEEKLY: "Biweekly", SEMIMONTHLY: "Semimonthly", MONTHLY: "Monthly",
};
const FREQ_COLORS: Record<Frequency, string> = {
  WEEKLY: C.orange, BIWEEKLY: C.blue, SEMIMONTHLY: C.purple, MONTHLY: C.green,
};

const COVER_GRADIENTS = [
  GRAD.bluePurple, GRAD.greenTeal, GRAD.pinkPurple, GRAD.indigoBlue,
  GRAD.orangePink, GRAD.purpleIndigo, GRAD.tealGreen, GRAD.yellowOrange,
];
function coverGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COVER_GRADIENTS[h % COVER_GRADIENTS.length];
}

function fmtAnchor(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Flag emoji from 2-letter country code
function flag(country: string): string {
  if (!country || country.length !== 2) return "🏳️";
  const A = 0x1f1e6;
  const a = "A".charCodeAt(0);
  return String.fromCodePoint(...country.toUpperCase().split("").map((c) => A + c.charCodeAt(0) - a));
}

export default function PayGroupsPage() {
  const [groups, setGroups] = useState<ApiPayGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pay-groups");
      if (res.status === 403) { setLoadError("Org-admin access required."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGroups(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("payroll");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const name = (typeof window !== "undefined" ? window.prompt("Pay group name?") : "")?.trim();
    if (!name) return;
    const today = new Date();
    const anchorDate = today.toISOString().slice(0, 10);
    try {
      const res = await fetch("/api/pay-groups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          frequency: "MONTHLY",
          country: "IN",
          currency: "INR",
          anchorDate,
          payOffsetDays: 3,
        }),
      });
      if (!res.ok) {
        if (res.status === 409) toast("A pay group with that name already exists");
        else if (res.status === 403) toast("Org-admin only");
        else toast("Couldn't create");
        return;
      }
      toast("Pay group created");
      void load();
    } catch { toast("Couldn't create"); }
  }

  // ─── Filter ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = groups ?? [];
    if (!showInactive) list = list.filter((g) => g.active);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((g) =>
        g.name.toLowerCase().includes(q) ||
        g.currency.toLowerCase().includes(q) ||
        g.country.toLowerCase().includes(q));
    }
    return list;
  }, [groups, search, showInactive]);

  // ─── KPIs ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = groups ?? [];
    const activeCount = list.filter((g) => g.active).length;
    const totalRuns = list.reduce((acc, g) => acc + (g._count?.payRuns ?? 0), 0);
    const totalSlips = list.reduce((acc, g) => acc + (g._count?.payslips ?? 0), 0);
    return { total: list.length, active: activeCount, inactive: list.length - activeCount, totalRuns, totalSlips };
  }, [groups]);

  return (
    <>
      <OsTitleBar
        title="Pay groups"
        Icon={Layers}
        iconGradient={GRAD.greenTeal}
        description={groups === null
          ? "Loading pay groups…"
          : `${stats.total} group${stats.total === 1 ? "" : "s"} · ${stats.active} active · ${stats.totalRuns} run${stats.totalRuns === 1 ? "" : "s"}`}
        actions={
          <div className="pyrg__head-actions">
            <button type="button" className="pyrg__back" onClick={() => history.back()}>
              <ArrowLeft /> Payroll
            </button>
            <Link href="/payroll/runs" className="pyrg__nav-link"><FileText /> All runs</Link>
            <button type="button" className="pyrg__btn-primary" onClick={quickAdd}>
              <Plus /> New group
            </button>
          </div>
        }
      />

      <div className="pyrg">
        {/* KPIs */}
        <div className="pyrg__kpis">
          <KpiTile accent="var(--os-c-green)"  Icon={Layers}    label="Pay groups"  value={`${stats.total}`}      sub={`${stats.active} active`} />
          <KpiTile accent="var(--os-c-blue)"   Icon={Power}     label="Active"      value={`${stats.active}`}     sub={stats.inactive > 0 ? `${stats.inactive} inactive` : "all groups live"} />
          <KpiTile accent="var(--os-c-purple)" Icon={FileText}  label="Pay runs"    value={`${stats.totalRuns}`}  sub="across all groups" />
          <KpiTile accent="var(--os-c-orange)" Icon={Receipt}   label="Payslips"    value={`${stats.totalSlips}`} sub="generated total" />
        </div>

        {/* Toolbar */}
        <div className="pyrg__toolbar">
          <div className="pyrg__search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search group name, currency, country…"
              aria-label="Search pay groups"
            />
          </div>
          <label className="pyrg__inactive-toggle">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            <span>Show inactive</span>
          </label>
        </div>

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={Layers} iconGradient={GRAD.redPink} title="Couldn't load pay groups" subtitle={loadError} cta="Retry" />
        ) : groups === null ? (
          <div className="pyrg__loading">Loading pay groups…</div>
        ) : stats.total === 0 ? (
          <OsEmptyView
            Icon={Layers}
            iconGradient={GRAD.greenTeal}
            title="No pay groups yet"
            subtitle="A pay group bundles people with a shared frequency, currency, and pay cadence. Create one to start running payroll."
            chips={["Monthly", "Biweekly", "Weekly", "Semimonthly"]}
            cta="New pay group"
          />
        ) : filtered.length === 0 ? (
          <div className="pyrg__empty">
            <Search />
            <div>No groups match your search.</div>
            <button type="button" className="pyrg__empty-reset" onClick={() => { setSearch(""); setShowInactive(false); }}>Clear filters</button>
          </div>
        ) : (
          <div className="pyrg__grid">
            {filtered.map((g) => <GroupCard key={g.id} group={g} />)}
          </div>
        )}
      </div>
    </>
  );
}

function GroupCard({ group: g }: { group: ApiPayGroup }) {
  const cover = coverGradient(g.id);
  const freqColor = FREQ_COLORS[g.frequency];
  return (
    <article className={`pyrg__card${g.active ? "" : " is-inactive"}`}>
      <div className="pyrg__card-cover" style={{ background: cover }} aria-hidden="true">
        <span className="pyrg__card-flag">{flag(g.country)}</span>
        <span className="pyrg__card-currency">{g.currency}</span>
        {!g.active && <span className="pyrg__card-state-pill">Inactive</span>}
      </div>

      <div className="pyrg__card-body">
        <div className="pyrg__card-head">
          <h3 className="pyrg__card-name">{g.name}</h3>
          <span className="pyrg__card-freq" style={{ ["--freq-c" as unknown as string]: freqColor }}>
            {FREQ_LABELS[g.frequency]}
          </span>
        </div>

        <div className="pyrg__card-lines">
          <div className="pyrg__card-line">
            <Globe />
            <span>{g.country}</span>
            <span className="pyrg__card-sep">·</span>
            <span>{g.currency}</span>
          </div>
          <div className="pyrg__card-line">
            <CalendarIcon />
            <span>Anchor {fmtAnchor(g.anchorDate)}</span>
          </div>
          <div className="pyrg__card-line">
            <Receipt />
            <span>Pay {g.payOffsetDays}d after period</span>
          </div>
        </div>
      </div>

      <div className="pyrg__card-foot">
        <span className="pyrg__card-stat">
          <FileText /> <strong>{g._count?.payRuns ?? 0}</strong> run{(g._count?.payRuns ?? 0) === 1 ? "" : "s"}
        </span>
        <span className="pyrg__card-stat">
          <Users /> <strong>{g._count?.payslips ?? 0}</strong> slip{(g._count?.payslips ?? 0) === 1 ? "" : "s"}
        </span>
        <span className={`pyrg__card-active${g.active ? "" : " is-off"}`} title={g.active ? "Active" : "Inactive"}>
          {g.active ? <Power /> : <PowerOff />}
        </span>
      </div>
    </article>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Layers; label: string; value: string; sub: string }) {
  return (
    <div className="pyrg__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="pyrg__kpi-accent" aria-hidden="true" />
      <div className="pyrg__kpi-row">
        <div className="pyrg__kpi-icon"><Icon /></div>
        <div className="pyrg__kpi-label">{label}</div>
      </div>
      <div className="pyrg__kpi-value">{value}</div>
      <div className="pyrg__kpi-sub">{sub}</div>
    </div>
  );
}

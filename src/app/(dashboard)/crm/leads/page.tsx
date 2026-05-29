"use client";

/* CRM · Leads — routing list with score badges.
 *
 *  GET   /api/crm/leads             list this org's leads
 *  POST  /api/crm/leads             { firstName, lastName?, ... }
 *  PATCH /api/crm/leads             { id, status?, ownerId?, ... }
 *
 *  Score is derived client-side from contact completeness (email + phone +
 *  company + title) + lead age, so reps can triage at a glance.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  UserPlus, Plus, Flame, Search, Phone, Mail, ArrowRight, Sparkles,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsPickerPopover, type PickerOption } from "@/components/layout/os/picker-popover";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "UNQUALIFIED" | "CONVERTED" | "DISQUALIFIED";

type ApiLead = {
  id: string;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  title?: string | null;
  status: LeadStatus;
  source?: string | null;
  ownerId?: string | null;
  convertedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New", CONTACTED: "Contacted", QUALIFIED: "Qualified",
  UNQUALIFIED: "Unqualified", CONVERTED: "Converted", DISQUALIFIED: "Disqualified",
};
const STATUS_COLORS: Record<LeadStatus, string> = {
  NEW: C.indigo, CONTACTED: C.orange, QUALIFIED: C.purple,
  UNQUALIFIED: C.gray, CONVERTED: C.green, DISQUALIFIED: C.red,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as LeadStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

type Filter = "all" | LeadStatus;
type SortKey = "score" | "recent" | "name";

// ─── Scoring ──────────────────────────────────────────────────
// Higher = hotter. Combines contact completeness + freshness.
function scoreLead(l: ApiLead): number {
  let s = 0;
  if (l.email && l.email.includes("@")) s += 25;
  if (l.phone) s += 20;
  if (l.company) s += 20;
  if (l.title) s += 10;
  if (l.source) s += 5;
  // Freshness boost: leads in last 3 days are hotter
  const ageDays = (Date.now() - new Date(l.createdAt).getTime()) / 86_400_000;
  if (ageDays < 1) s += 15;
  else if (ageDays < 3) s += 10;
  else if (ageDays < 7) s += 5;
  // Qualified leads are intrinsically hotter
  if (l.status === "QUALIFIED") s += 10;
  return Math.min(100, s);
}
function scoreTone(score: number): "hot" | "warm" | "cold" {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_PALETTE[h % AV_PALETTE.length];
}
function initials(f?: string | null, l?: string | null): string {
  const fa = (f ?? "")[0] ?? "";
  const la = (l ?? "")[0] ?? "";
  return ((fa + la) || "?").toUpperCase();
}

function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function CrmLeadsPage() {
  const [rows, setRows] = useState<ApiLead[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [picker, setPicker] = useState<{ rect: DOMRect; leadId: string } | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/leads");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.leads ?? data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("crm/leads");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/crm/leads", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("You don't have permission to edit this lead");
        return false;
      }
      void load();
      return true;
    } catch { return false; }
  }

  async function addLead() {
    try {
      const res = await fetch("/api/crm/leads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: "New lead" }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      toast("Lead added");
      void load();
    } catch {
      toast("Couldn't add lead");
    }
  }

  // ─── Score + filter + sort ────────────────────────────────
  const scored = useMemo(() => {
    return (rows ?? []).map((l) => ({ lead: l, score: scoreLead(l) }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = scored.filter(({ lead: l }) => {
      if (filter !== "all" && l.status !== filter) return false;
      if (q) {
        const hay = `${l.firstName} ${l.lastName ?? ""} ${l.email ?? ""} ${l.company ?? ""} ${l.title ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (sortKey === "score") list = list.slice().sort((a, b) => b.score - a.score);
    else if (sortKey === "recent") list = list.slice().sort((a, b) => new Date(b.lead.createdAt).getTime() - new Date(a.lead.createdAt).getTime());
    else if (sortKey === "name") list = list.slice().sort((a, b) => `${a.lead.firstName} ${a.lead.lastName ?? ""}`.localeCompare(`${b.lead.firstName} ${b.lead.lastName ?? ""}`));
    return list;
  }, [scored, filter, query, sortKey]);

  const counts = useMemo(() => {
    const byStatus: Record<LeadStatus, number> = {
      NEW: 0, CONTACTED: 0, QUALIFIED: 0, UNQUALIFIED: 0, CONVERTED: 0, DISQUALIFIED: 0,
    };
    let hot = 0, warm = 0;
    for (const { lead: l, score } of scored) {
      byStatus[l.status]++;
      const tone = scoreTone(score);
      if (tone === "hot") hot++;
      else if (tone === "warm") warm++;
    }
    return { total: scored.length, byStatus, hot, warm };
  }, [scored]);

  return (
    <>
      <OsTitleBar
        title="Leads"
        Icon={UserPlus}
        iconGradient={GRAD.greenTeal}
        description={rows === null
          ? "Loading leads…"
          : `${counts.total} lead${counts.total === 1 ? "" : "s"} · ${counts.hot} hot · ${counts.byStatus.NEW} new`}
        people={[PEOPLE.bb, PEOPLE.mk]}
        morePeople={3}
        actions={
          <div className="lds__head-actions">
            <Link href="/crm" className="lds__nav-link">Pipeline</Link>
            <Link href="/crm/accounts" className="lds__nav-link">Accounts</Link>
            <button type="button" className="lds__btn-primary" onClick={addLead}>
              <Plus /> New lead
            </button>
          </div>
        }
      />

      <div className="lds">
        {/* KPI strip */}
        <div className="lds__kpis">
          <KpiTile accent="var(--os-c-red)"     Icon={Flame}     label="Hot leads"   value={`${counts.hot}`}              sub="score ≥ 70" />
          <KpiTile accent="var(--os-c-orange)"  Icon={Sparkles}  label="Warm"        value={`${counts.warm}`}             sub="score 40–69" />
          <KpiTile accent="var(--os-c-indigo)"  Icon={UserPlus}  label="New"         value={`${counts.byStatus.NEW}`}     sub="awaiting first touch" />
          <KpiTile accent="var(--os-c-green)"   Icon={ArrowRight} label="Converted"   value={`${counts.byStatus.CONVERTED}`} sub={counts.total > 0 ? `${Math.round((counts.byStatus.CONVERTED / counts.total) * 100)}% conversion` : "—"} />
        </div>

        {/* Routing toolbar */}
        <div className="lds__toolbar">
          <div className="lds__search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email, company, title…"
              aria-label="Search leads"
            />
          </div>

          <div className="lds__chips">
            <FilterChip label="All"        count={counts.total}                 active={filter === "all"}        onClick={() => setFilter("all")} />
            <FilterChip label="New"        count={counts.byStatus.NEW}        color={C.indigo} active={filter === "NEW"}        onClick={() => setFilter("NEW")} />
            <FilterChip label="Contacted"  count={counts.byStatus.CONTACTED}  color={C.orange} active={filter === "CONTACTED"}  onClick={() => setFilter("CONTACTED")} />
            <FilterChip label="Qualified"  count={counts.byStatus.QUALIFIED}  color={C.purple} active={filter === "QUALIFIED"}  onClick={() => setFilter("QUALIFIED")} />
            <FilterChip label="Converted"  count={counts.byStatus.CONVERTED}  color={C.green}  active={filter === "CONVERTED"}  onClick={() => setFilter("CONVERTED")} />
          </div>

          <div className="lds__sort">
            <span className="lds__sort-label">Sort</span>
            <div className="lds__sort-tabs">
              <button type="button" className={sortKey === "score" ? "is-active" : ""}  onClick={() => setSortKey("score")}>Score</button>
              <button type="button" className={sortKey === "recent" ? "is-active" : ""} onClick={() => setSortKey("recent")}>Recent</button>
              <button type="button" className={sortKey === "name" ? "is-active" : ""}   onClick={() => setSortKey("name")}>A–Z</button>
            </div>
          </div>
        </div>

        {/* Body */}
        {loadError ? (
          <OsEmptyView Icon={UserPlus} iconGradient={GRAD.redPink} title="Couldn't load leads" subtitle={`API error: ${loadError}.`} cta="Retry" />
        ) : rows === null ? (
          <div className="lds__loading">Loading leads…</div>
        ) : counts.total === 0 ? (
          <OsEmptyView
            Icon={UserPlus}
            iconGradient={GRAD.greenTeal}
            title="No leads yet"
            subtitle="Capture inbound interest, then move leads through New → Contacted → Qualified → Converted."
            chips={["New", "Contacted", "Qualified", "Converted"]}
            cta="New lead"
          />
        ) : filtered.length === 0 ? (
          <div className="lds__empty">
            <Search />
            <div>No leads match your filters.</div>
            <button type="button" className="lds__empty-reset" onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</button>
          </div>
        ) : (
          <div className="lds__list">
            {filtered.map(({ lead: l, score }) => {
              const tone = scoreTone(score);
              const name = `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim() || "Unknown";
              const avBg = avatarFor(l.id);
              const statusColor = STATUS_COLORS[l.status];
              return (
                <article key={l.id} className={`lds__row lds__row--${tone}`}>
                  <div className={`lds__score lds__score--${tone}`} title={`Lead score: ${score}`}>
                    <div className="lds__score-num">{score}</div>
                    <div className="lds__score-label">{tone}</div>
                  </div>

                  <div className="lds__av" style={{ background: avBg }}>
                    {initials(l.firstName, l.lastName)}
                  </div>

                  <div className="lds__who">
                    <div className="lds__name">{name}</div>
                    <div className="lds__sub">
                      {l.title && <span>{l.title}</span>}
                      {l.title && l.company && <span className="lds__sep">·</span>}
                      {l.company && <span className="lds__company">{l.company}</span>}
                    </div>
                  </div>

                  <div className="lds__contact">
                    {l.email && <span className="lds__contact-item" title={l.email}><Mail /> {l.email}</span>}
                    {l.phone && <span className="lds__contact-item" title={l.phone}><Phone /> {l.phone}</span>}
                  </div>

                  {l.source && (
                    <span className="lds__source">{l.source}</span>
                  )}

                  <button
                    type="button"
                    className="lds__status-pill"
                    style={{ background: statusColor, color: "white" }}
                    onClick={(e) => setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), leadId: l.id })}
                  >
                    {STATUS_LABELS[l.status]}
                  </button>

                  <span className="lds__age">{fmtAge(l.createdAt)}</span>

                  <div className="lds__actions">
                    {l.email && (
                      <a href={`mailto:${l.email}`} className="lds__act" title="Email" onClick={(e) => e.stopPropagation()}>
                        <Mail />
                      </a>
                    )}
                    {l.phone && (
                      <a href={`tel:${l.phone}`} className="lds__act" title="Call" onClick={(e) => e.stopPropagation()}>
                        <Phone />
                      </a>
                    )}
                    {l.status !== "CONVERTED" && (
                      <button
                        type="button"
                        className="lds__act lds__act--convert"
                        title="Convert"
                        onClick={() => patch(l.id, { status: "CONVERTED" })}
                      >
                        <ArrowRight />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {picker ? (
        <OsPickerPopover
          anchorRect={picker.rect}
          title="Set status"
          options={STATUS_OPTIONS}
          activeValue={rows?.find((r) => r.id === picker.leadId)?.status ?? undefined}
          onSelect={async (val) => {
            const ok = await patch(picker.leadId, { status: val });
            if (ok) toast(`Status set to ${STATUS_LABELS[val as LeadStatus]}`);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Flame; label: string; value: string; sub: string }) {
  return (
    <div className="lds__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="lds__kpi-accent" aria-hidden="true" />
      <div className="lds__kpi-row">
        <div className="lds__kpi-icon"><Icon /></div>
        <div className="lds__kpi-label">{label}</div>
      </div>
      <div className="lds__kpi-value">{value}</div>
      <div className="lds__kpi-sub">{sub}</div>
    </div>
  );
}

function FilterChip({ label, count, color, active, onClick }: { label: string; count: number; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`lds__chip${active ? " is-active" : ""}`}
      style={color ? { ["--chip-c" as unknown as string]: color } : undefined}
      onClick={onClick}
    >
      {color && <span className="lds__chip-dot" />}
      {label}
      <span className="lds__chip-count">{count}</span>
    </button>
  );
}

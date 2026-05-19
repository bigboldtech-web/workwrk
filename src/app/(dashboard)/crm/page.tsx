"use client";

// WorkwrK CRM — Phase E2 showcase product.
//
// Three tabs: Pipeline (kanban by stage), Leads (table), Accounts (table).
// Pipeline auto-seeds 6 default stages on first visit (handled by
// /api/crm/pipeline-stages GET). Deals can be moved between stages
// via a dropdown on each card. Won/Lost transitions auto-stamp
// closedAt + isWon.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TrendingUp,
  Users as UsersIcon,
  Building2,
  Plus,
  X,
  DollarSign,
  Calendar,
  ChevronDown,
  MoreHorizontal,
} from "lucide-react";

type Stage = {
  id: string;
  name: string;
  position: number;
  probability: number;
  color: string | null;
  isWon: boolean;
  isLost: boolean;
};

type Opportunity = {
  id: string;
  name: string;
  amount: string | null;
  currency: string;
  expectedCloseDate: string | null;
  closedAt: string | null;
  isWon: boolean | null;
  pipelineStageId: string | null;
  ownerId: string | null;
  account: { id: string; name: string } | null;
  pipelineStage: { id: string; name: string; color: string | null; isWon: boolean; isLost: boolean } | null;
};

type Lead = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  source: string | null;
  status: string;
  score: number;
  createdAt: string;
};

type Account = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  type: string;
  _count: { opportunities: number };
  createdAt: string;
};

type Tab = "pipeline" | "leads" | "accounts";

function formatMoney(amount: string | null, currency: string) {
  if (!amount) return "—";
  const n = parseFloat(amount);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

function dateLabel(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function CrmPage() {
  const [tab, setTab] = useState<Tab>("pipeline");
  const [stages, setStages] = useState<Stage[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewOpp, setShowNewOpp] = useState(false);
  const [showNewLead, setShowNewLead] = useState(false);
  const [showNewAccount, setShowNewAccount] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o, l, a] = await Promise.all([
        fetch("/api/crm/pipeline-stages").then((r) => r.ok ? r.json() : { stages: [] }),
        fetch("/api/crm/opportunities").then((r) => r.ok ? r.json() : { opportunities: [] }),
        fetch("/api/crm/leads").then((r) => r.ok ? r.json() : { leads: [] }),
        fetch("/api/crm/accounts").then((r) => r.ok ? r.json() : { accounts: [] }),
      ]);
      setStages(s.stages || []);
      setOpps(o.opportunities || []);
      setLeads(l.leads || []);
      setAccounts(a.accounts || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const oppsByStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const stage of stages) map.set(stage.id, []);
    for (const o of opps) {
      if (!o.pipelineStageId) continue;
      const arr = map.get(o.pipelineStageId) ?? [];
      arr.push(o);
      map.set(o.pipelineStageId, arr);
    }
    return map;
  }, [stages, opps]);

  const totalPipelineValue = useMemo(() => {
    return opps
      .filter((o) => !o.closedAt)
      .reduce((sum, o) => sum + (o.amount ? parseFloat(o.amount) : 0), 0);
  }, [opps]);

  const weightedForecast = useMemo(() => {
    return opps
      .filter((o) => !o.closedAt)
      .reduce((sum, o) => {
        if (!o.amount) return sum;
        const stage = stages.find((s) => s.id === o.pipelineStageId);
        const prob = (stage?.probability ?? 50) / 100;
        return sum + parseFloat(o.amount) * prob;
      }, 0);
  }, [opps, stages]);

  async function moveOpp(oppId: string, newStageId: string) {
    // Optimistic update
    setOpps((prev) =>
      prev.map((o) =>
        o.id === oppId
          ? { ...o, pipelineStageId: newStageId, pipelineStage: stages.find((s) => s.id === newStageId) ? { ...stages.find((s) => s.id === newStageId)! } : o.pipelineStage }
          : o,
      ),
    );
    await fetch("/api/crm/opportunities", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: oppId, pipelineStageId: newStageId }),
    });
  }

  return (
    <div className="p-6 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-medium mb-3">
            <TrendingUp size={12} />
            WorkwrK CRM
          </div>
          <h1 className="text-2xl font-semibold mb-1">Sales pipeline</h1>
          <p className="text-sm text-muted">
            Leads → Accounts → Opportunities · drag a card to move between stages
          </p>
        </div>
        <button
          type="button"
          onClick={() => (tab === "pipeline" ? setShowNewOpp(true) : tab === "leads" ? setShowNewLead(true) : setShowNewAccount(true))}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
        >
          <Plus size={14} />
          New {tab === "pipeline" ? "deal" : tab === "leads" ? "lead" : "account"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {(
          [
            { id: "pipeline", label: "Pipeline", Icon: TrendingUp, count: opps.length },
            { id: "leads", label: "Leads", Icon: UsersIcon, count: leads.length },
            { id: "accounts", label: "Accounts", Icon: Building2, count: accounts.length },
          ] as { id: Tab; label: string; Icon: typeof TrendingUp; count: number }[]
        ).map(({ id, label, Icon, count }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              "inline-flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors " +
              (tab === id
                ? "border-emerald-600 text-emerald-700 dark:text-emerald-400"
                : "border-transparent text-muted hover:text-foreground")
            }
          >
            <Icon size={14} />
            {label}
            <span className={tab === id ? "ml-1 text-xs px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40" : "ml-1 text-xs text-muted-2"}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Pipeline tab */}
      {tab === "pipeline" && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <KpiCard label="Open deals" value={opps.filter((o) => !o.closedAt).length.toString()} />
            <KpiCard label="Pipeline value" value={formatMoney(totalPipelineValue.toString(), "USD")} />
            <KpiCard label="Weighted forecast" value={formatMoney(weightedForecast.toString(), "USD")} tone="emerald" />
            <KpiCard label="Won this quarter" value={opps.filter((o) => o.isWon === true).length.toString()} />
          </div>

          {loading ? (
            <div className="text-sm text-muted py-20 text-center">Loading pipeline…</div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 480 }}>
              {stages.map((stage) => {
                const stageOpps = oppsByStage.get(stage.id) ?? [];
                const total = stageOpps.reduce((s, o) => s + (o.amount ? parseFloat(o.amount) : 0), 0);
                return (
                  <div key={stage.id} className="flex-shrink-0 w-[280px] rounded-xl bg-surface-2 p-3">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ background: stage.color ?? "#94a3b8" }}
                          aria-hidden
                        />
                        <span className="text-sm font-semibold">{stage.name}</span>
                        <span className="text-xs text-muted-2">{stageOpps.length}</span>
                      </div>
                      <div className="text-xs text-muted-2">{formatMoney(total.toString(), "USD")}</div>
                    </div>
                    <div className="space-y-2">
                      {stageOpps.length === 0 ? (
                        <div className="text-xs text-muted-2 italic py-4 text-center border border-dashed border-border rounded-lg">
                          No deals yet
                        </div>
                      ) : (
                        stageOpps.map((opp) => (
                          <DealCard
                            key={opp.id}
                            opp={opp}
                            stages={stages}
                            onMove={(newStageId) => moveOpp(opp.id, newStageId)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Leads tab */}
      {tab === "leads" && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          {loading ? (
            <div className="text-sm text-muted py-20 text-center">Loading leads…</div>
          ) : leads.length === 0 ? (
            <div className="text-center py-20">
              <UsersIcon size={40} className="mx-auto mb-3 text-muted-2" />
              <p className="text-sm text-muted mb-4">No leads yet. Capture inbound interest, work outbound lists.</p>
              <button
                type="button"
                onClick={() => setShowNewLead(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
              >
                <Plus size={14} /> Add your first lead
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-2">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium">Company</th>
                  <th className="text-left px-4 py-2.5 font-medium">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-t border-border hover:bg-surface-2">
                    <td className="px-4 py-2.5 font-medium">{l.firstName} {l.lastName ?? ""}</td>
                    <td className="px-4 py-2.5 text-muted">{l.company ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted text-xs">{l.email ?? "—"}</td>
                    <td className="px-4 py-2.5"><LeadStatusBadge status={l.status} /></td>
                    <td className="px-4 py-2.5 text-xs text-muted-2">{l.source ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Accounts tab */}
      {tab === "accounts" && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          {loading ? (
            <div className="text-sm text-muted py-20 text-center">Loading accounts…</div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-20">
              <Building2 size={40} className="mx-auto mb-3 text-muted-2" />
              <p className="text-sm text-muted mb-4">No accounts yet. Track companies you sell to or partner with.</p>
              <button
                type="button"
                onClick={() => setShowNewAccount(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
              >
                <Plus size={14} /> Add your first account
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted-2">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium">Industry</th>
                  <th className="text-left px-4 py-2.5 font-medium">Size</th>
                  <th className="text-left px-4 py-2.5 font-medium">Deals</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-t border-border hover:bg-surface-2">
                    <td className="px-4 py-2.5 font-medium">{a.name}</td>
                    <td className="px-4 py-2.5"><AccountTypeBadge type={a.type} /></td>
                    <td className="px-4 py-2.5 text-muted">{a.industry ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted">{a.size ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted">{a._count.opportunities}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modals */}
      {showNewOpp && (
        <NewOpportunityModal
          accounts={accounts}
          stages={stages}
          onClose={() => setShowNewOpp(false)}
          onCreated={() => { setShowNewOpp(false); refresh(); }}
        />
      )}
      {showNewLead && (
        <NewLeadModal
          onClose={() => setShowNewLead(false)}
          onCreated={() => { setShowNewLead(false); refresh(); }}
        />
      )}
      {showNewAccount && (
        <NewAccountModal
          onClose={() => setShowNewAccount(false)}
          onCreated={() => { setShowNewAccount(false); refresh(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: "emerald" }) {
  return (
    <div className={`rounded-xl border border-border p-3 ${tone === "emerald" ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900" : "bg-surface"}`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-2 mb-1">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function DealCard({
  opp,
  stages,
  onMove,
}: {
  opp: Opportunity;
  stages: Stage[];
  onMove: (newStageId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="rounded-lg bg-surface border border-border p-3 hover:border-emerald-300 transition-colors relative">
      <div className="flex items-start justify-between mb-1.5">
        <div className="font-medium text-sm leading-tight pr-6">{opp.name}</div>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="absolute top-2 right-2 p-1 rounded hover:bg-surface-2 text-muted-2"
          aria-label="Deal options"
        >
          <MoreHorizontal size={12} />
        </button>
        {menuOpen && (
          <div className="absolute top-7 right-2 z-10 w-44 rounded-lg bg-surface border border-border shadow-lg py-1">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-2">Move to</div>
            {stages.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setMenuOpen(false); onMove(s.id); }}
                disabled={s.id === opp.pipelineStageId}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-2 disabled:opacity-40 inline-flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full" style={{ background: s.color ?? "#94a3b8" }} aria-hidden />
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {opp.account && (
        <div className="text-xs text-muted-2 mb-2">{opp.account.name}</div>
      )}
      <div className="flex items-center gap-3 text-xs">
        {opp.amount && (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
            <DollarSign size={11} />
            {formatMoney(opp.amount, opp.currency)}
          </span>
        )}
        {opp.expectedCloseDate && (
          <span className="inline-flex items-center gap-1 text-muted-2">
            <Calendar size={11} />
            {dateLabel(opp.expectedCloseDate)}
          </span>
        )}
      </div>
    </div>
  );
}

function LeadStatusBadge({ status }: { status: string }) {
  const tones: Record<string, string> = {
    NEW: "bg-blue-100 text-blue-700",
    CONTACTED: "bg-amber-100 text-amber-700",
    QUALIFIED: "bg-emerald-100 text-emerald-700",
    UNQUALIFIED: "bg-zinc-100 text-zinc-600",
    CONVERTED: "bg-violet-100 text-violet-700",
    DISQUALIFIED: "bg-rose-100 text-rose-700",
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${tones[status] ?? "bg-zinc-100 text-zinc-600"}`}>
      {status}
    </span>
  );
}

function AccountTypeBadge({ type }: { type: string }) {
  const tones: Record<string, string> = {
    PROSPECT: "bg-blue-100 text-blue-700",
    CUSTOMER: "bg-emerald-100 text-emerald-700",
    PARTNER: "bg-violet-100 text-violet-700",
    CHURNED: "bg-rose-100 text-rose-700",
    COMPETITOR: "bg-amber-100 text-amber-700",
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${tones[type] ?? "bg-zinc-100 text-zinc-600"}`}>
      {type}
    </span>
  );
}

function NewOpportunityModal({
  accounts,
  stages,
  onClose,
  onCreated,
}: {
  accounts: Account[];
  stages: Stage[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState<string>("");
  const [stageId, setStageId] = useState<string>(stages.find((s) => !s.isWon && !s.isLost)?.id ?? "");
  const [amount, setAmount] = useState<string>("");
  const [closeDate, setCloseDate] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/crm/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          accountId: accountId || undefined,
          pipelineStageId: stageId || undefined,
          amount: amount ? parseFloat(amount) : undefined,
          expectedCloseDate: closeDate || undefined,
        }),
      });
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="New deal" onClose={onClose}>
      <FormRow label="Deal name">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          placeholder="Acme Corp · annual contract"
        />
      </FormRow>
      <FormRow label="Account">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
        >
          <option value="">— None —</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </FormRow>
      <FormRow label="Stage">
        <select
          value={stageId}
          onChange={(e) => setStageId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
        >
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Amount (USD)">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
            placeholder="50000"
          />
        </FormRow>
        <FormRow label="Expected close">
          <input
            type="date"
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
          />
        </FormRow>
      </div>
      <ModalActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!name.trim()} />
    </ModalShell>
  );
}

function NewLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("website");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!firstName.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: firstName.trim(), lastName, email, company, title, source }),
      });
      onCreated();
    } finally { setSaving(false); }
  }

  return (
    <ModalShell title="New lead" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="First name">
          <input autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </FormRow>
        <FormRow label="Last name">
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </FormRow>
      </div>
      <FormRow label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Company">
          <input value={company} onChange={(e) => setCompany(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </FormRow>
        <FormRow label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </FormRow>
      </div>
      <FormRow label="Source">
        <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm">
          <option value="website">Website</option>
          <option value="referral">Referral</option>
          <option value="outbound">Outbound</option>
          <option value="linkedin">LinkedIn</option>
          <option value="event">Event</option>
          <option value="import">Import</option>
        </select>
      </FormRow>
      <ModalActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!firstName.trim()} />
    </ModalShell>
  );
}

function NewAccountModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [type, setType] = useState("PROSPECT");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/crm/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), domain, industry, size, type }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to create account");
        return;
      }
      onCreated();
    } finally { setSaving(false); }
  }

  return (
    <ModalShell title="New account" onClose={onClose}>
      <FormRow label="Company name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
      </FormRow>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Domain">
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </FormRow>
        <FormRow label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm">
            <option value="PROSPECT">Prospect</option>
            <option value="CUSTOMER">Customer</option>
            <option value="PARTNER">Partner</option>
            <option value="CHURNED">Churned</option>
            <option value="COMPETITOR">Competitor</option>
          </select>
        </FormRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Industry">
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm" />
        </FormRow>
        <FormRow label="Size">
          <select value={size} onChange={(e) => setSize(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm">
            <option value="">—</option>
            <option value="1-10">1-10</option>
            <option value="11-50">11-50</option>
            <option value="51-200">51-200</option>
            <option value="201-1000">201-1000</option>
            <option value="1000+">1000+</option>
          </select>
        </FormRow>
      </div>
      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
      <ModalActions onClose={onClose} onSubmit={submit} saving={saving} disabled={!name.trim()} />
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-2 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ModalActions({ onClose, onSubmit, saving, disabled }: { onClose: () => void; onSubmit: () => void; saving: boolean; disabled: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface-2">
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={saving || disabled}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
      >
        {saving ? "Creating…" : "Create"}
      </button>
    </div>
  );
}

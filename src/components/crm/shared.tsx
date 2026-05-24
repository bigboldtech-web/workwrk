"use client";

// Shared CRM bits — extracted from the original `/crm/page.tsx` so the
// per-board routes (`/crm/pipeline`, `/crm/leads`, `/crm/accounts`)
// can each own their data fetch and render without duplicating modal
// UI, badges, and money/date formatting helpers.

import { useState } from "react";
import {
  X, Plus, DollarSign, Calendar, MoreHorizontal,
} from "lucide-react";

export type Stage = {
  id: string;
  name: string;
  position: number;
  probability: number;
  color: string | null;
  isWon: boolean;
  isLost: boolean;
};

export type Opportunity = {
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

export type Lead = {
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

export type Account = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  type: string;
  _count: { opportunities: number };
  createdAt: string;
};

export function formatMoney(amount: string | number | null, currency: string = "USD") {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

export function dateLabel(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function KpiCard({ label, value, tone }: { label: string; value: string; tone?: "emerald" }) {
  return (
    <div className={`rounded-xl border border-border p-3 ${tone === "emerald" ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900" : "bg-surface"}`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-2 mb-1">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

export function DealCard({
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

export function AccountTypeBadge({ type }: { type: string }) {
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

export function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

export function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-2 mb-1">{label}</label>
      {children}
    </div>
  );
}

export function ModalActions({ onClose, onSubmit, saving, disabled }: { onClose: () => void; onSubmit: () => void; saving: boolean; disabled: boolean }) {
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

export function NewOpportunityModal({
  accounts,
  stages,
  workspaceId,
  onClose,
  onCreated,
}: {
  accounts: Account[];
  stages: Stage[];
  /** When the CRM is scoped to a workspace, new deals land inside
   *  that workspace so they're only visible there. */
  workspaceId?: string | null;
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
          workspaceId: workspaceId ?? undefined,
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

export function NewLeadModal({ workspaceId, onClose, onCreated }: { workspaceId?: string | null; onClose: () => void; onCreated: () => void }) {
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
        body: JSON.stringify({
          firstName: firstName.trim(), lastName, email, company, title, source,
          workspaceId: workspaceId ?? undefined,
        }),
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

export function NewAccountModal({ workspaceId, onClose, onCreated }: { workspaceId?: string | null; onClose: () => void; onCreated: () => void }) {
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
        body: JSON.stringify({
          name: name.trim(), domain, industry, size, type,
          workspaceId: workspaceId ?? undefined,
        }),
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

export const LEAD_FIELDS = [
  { key: "firstName", label: "First name", fieldType: "TEXT" as const },
  { key: "lastName", label: "Last name", fieldType: "TEXT" as const },
  { key: "company", label: "Company", fieldType: "TEXT" as const },
  { key: "title", label: "Title", fieldType: "TEXT" as const },
  { key: "email", label: "Email", fieldType: "EMAIL" as const },
  {
    key: "status", label: "Status", fieldType: "SELECT" as const,
    options: { choices: [
      { value: "NEW", label: "New", color: "#60a5fa" },
      { value: "CONTACTED", label: "Contacted", color: "#f59e0b" },
      { value: "QUALIFIED", label: "Qualified", color: "#10b981" },
      { value: "UNQUALIFIED", label: "Unqualified", color: "#71717a" },
      { value: "CONVERTED", label: "Converted", color: "#a78bfa" },
      { value: "DISQUALIFIED", label: "Disqualified", color: "#ef4444" },
    ] },
  },
  {
    key: "source", label: "Source", fieldType: "SELECT" as const,
    options: { choices: [
      { value: "website", label: "Website" },
      { value: "referral", label: "Referral" },
      { value: "outbound", label: "Outbound" },
      { value: "linkedin", label: "LinkedIn" },
      { value: "event", label: "Event" },
      { value: "import", label: "Import" },
    ] },
  },
];

export const PrimaryButtonIcon = Plus;

"use client";

// WorkwrK Legal — Phase E6 showcase product.
// Contracts (CLM) + Privacy DSARs + IP/Trademarks. General Counsel
// surface. Distinct from /policies (internal company rules).

import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  Shield,
  Award,
  Plus,
  X,
  Zap,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { BoardView, type BoardField } from "@/components/board-view/board-view";
import { ItemDetailDrawer } from "@/components/board-view/item-detail-drawer";

const CONTRACT_FIELDS: BoardField[] = [
  { key: "title", label: "Title", fieldType: "TEXT" },
  { key: "counterparty", label: "Counterparty", fieldType: "TEXT" },
  {
    key: "status", label: "Status", fieldType: "SELECT",
    options: { choices: [
      { value: "DRAFT", label: "Draft", color: "#a1a1aa" },
      { value: "IN_REVIEW", label: "In review", color: "#f59e0b" },
      { value: "IN_NEGOTIATION", label: "In negotiation", color: "#f59e0b" },
      { value: "AWAITING_SIGNATURE", label: "Awaiting signature", color: "#a78bfa" },
      { value: "SIGNED", label: "Signed", color: "#60a5fa" },
      { value: "ACTIVE", label: "Active", color: "#10b981" },
      { value: "EXPIRED", label: "Expired", color: "#ef4444" },
      { value: "RENEWED", label: "Renewed", color: "#14b8a6" },
      { value: "TERMINATED", label: "Terminated", color: "#71717a" },
      { value: "CANCELLED", label: "Cancelled", color: "#71717a" },
    ] },
  },
  { key: "type", label: "Type", fieldType: "TEXT" },
  { key: "counterpartyType", label: "Party type", fieldType: "TEXT" },
  { key: "value", label: "Value", fieldType: "NUMBER" },
  { key: "expiresAt", label: "Expires", fieldType: "DATE" },
];

type Contract = {
  id: string;
  title: string;
  counterparty: string;
  counterpartyType: string | null;
  type: string | null;
  status: string;
  value: string | null;
  currency: string;
  signedAt: string | null;
  effectiveDate: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  ownerId: string | null;
};

type PrivacyRequest = {
  id: string;
  type: string;
  status: string;
  subjectEmail: string;
  subjectName: string | null;
  jurisdiction: string | null;
  verifiedAt: string | null;
  receivedAt: string;
  dueAt: string | null;
  completedAt: string | null;
};

type Trademark = {
  id: string;
  mark: string;
  type: string;
  status: string;
  jurisdictions: string[];
  classes: number[];
  registrationNumber: string | null;
  expiresAt: string | null;
  renewalDueAt: string | null;
};

type Tab = "contracts" | "privacy" | "ip";

const CONTRACT_TONES: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600",
  IN_REVIEW: "bg-amber-100 text-amber-700",
  IN_NEGOTIATION: "bg-amber-100 text-amber-700",
  AWAITING_SIGNATURE: "bg-violet-100 text-violet-700",
  SIGNED: "bg-blue-100 text-blue-700",
  ACTIVE: "bg-emerald-100 text-emerald-700",
  EXPIRED: "bg-rose-100 text-rose-700",
  RENEWED: "bg-teal-100 text-teal-700",
  TERMINATED: "bg-zinc-100 text-zinc-500",
  CANCELLED: "bg-zinc-100 text-zinc-500",
};

const PRIVACY_TONES: Record<string, string> = {
  RECEIVED: "bg-blue-100 text-blue-700",
  VERIFYING: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-violet-100 text-violet-700",
  PENDING_REVIEW: "bg-amber-100 text-amber-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  DENIED: "bg-rose-100 text-rose-700",
  CANCELLED: "bg-zinc-100 text-zinc-500",
};

const TRADEMARK_TONES: Record<string, string> = {
  PROPOSED: "bg-zinc-100 text-zinc-600",
  CLEARANCE_SEARCH: "bg-amber-100 text-amber-700",
  APPLIED: "bg-blue-100 text-blue-700",
  PENDING: "bg-amber-100 text-amber-700",
  PUBLISHED: "bg-violet-100 text-violet-700",
  REGISTERED: "bg-emerald-100 text-emerald-700",
  RENEWAL_DUE: "bg-rose-100 text-rose-700",
  EXPIRED: "bg-rose-100 text-rose-700",
  ABANDONED: "bg-zinc-100 text-zinc-500",
  CANCELLED: "bg-zinc-100 text-zinc-500",
  OPPOSED: "bg-rose-100 text-rose-700",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtMoney(amount: string | null, currency: string) {
  if (!amount) return "—";
  const n = parseFloat(amount);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

function daysUntil(iso: string | null) {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export default function LegalPage() {
  const [tab, setTab] = useState<Tab>("contracts");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [trademarks, setTrademarks] = useState<Trademark[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState<Tab | null>(null);
  const [openContract, setOpenContract] = useState<Contract | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p, t] = await Promise.all([
        fetch("/api/legal/contracts").then((r) => (r.ok ? r.json() : { contracts: [] })),
        fetch("/api/legal/privacy-requests").then((r) => (r.ok ? r.json() : { requests: [] })),
        fetch("/api/legal/trademarks").then((r) => (r.ok ? r.json() : { trademarks: [] })),
      ]);
      setContracts(c.contracts || []);
      setRequests(p.requests || []);
      setTrademarks(t.trademarks || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // KPIs
  const activeContracts = contracts.filter((c) => c.status === "ACTIVE" || c.status === "SIGNED").length;
  const expiringSoon = contracts.filter((c) => {
    const d = daysUntil(c.expiresAt);
    return d !== null && d <= 60 && d >= 0 && (c.status === "ACTIVE" || c.status === "SIGNED");
  }).length;
  const dsarsDue = requests.filter((r) => {
    const d = daysUntil(r.dueAt);
    return d !== null && d <= 7 && !["COMPLETED", "DENIED", "CANCELLED"].includes(r.status);
  }).length;
  const renewalsDue = trademarks.filter((t) => {
    const d = daysUntil(t.renewalDueAt);
    return d !== null && d <= 90 && d >= 0;
  }).length;

  return (
    <div className="p-6 max-w-[1800px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-xs font-medium mb-3">
            <FileText size={12} />
            WorkwrK Legal
          </div>
          <h1 className="text-2xl font-semibold mb-1">Legal &amp; Compliance</h1>
          <p className="text-sm text-muted">Contracts · Privacy requests (GDPR/CCPA) · IP portfolio</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(tab)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
        >
          <Plus size={14} />
          New {tab === "contracts" ? "contract" : tab === "privacy" ? "DSAR" : "mark"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Kpi label="Active contracts" value={activeContracts.toString()} />
        <Kpi label="Expiring < 60 days" value={expiringSoon.toString()} tone={expiringSoon > 0 ? "amber" : undefined} />
        <Kpi label="DSARs due < 7 days" value={dsarsDue.toString()} tone={dsarsDue > 0 ? "rose" : undefined} />
        <Kpi label="IP renewals due" value={renewalsDue.toString()} tone={renewalsDue > 0 ? "amber" : undefined} />
      </div>

      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {([
          { id: "contracts", label: "Contracts", Icon: FileText, count: contracts.length },
          { id: "privacy", label: "Privacy (DSARs)", Icon: Shield, count: requests.length },
          { id: "ip", label: "IP Portfolio", Icon: Award, count: trademarks.length },
        ] as { id: Tab; label: string; Icon: typeof FileText; count: number }[]).map(({ id, label, Icon, count }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={"inline-flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors " + (tab === id ? "border-indigo-600 text-indigo-700 dark:text-indigo-400" : "border-transparent text-muted hover:text-foreground")}
          >
            <Icon size={14} />
            {label}
            <span className={tab === id ? "ml-1 text-xs px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40" : "ml-1 text-xs text-muted-2"}>{count}</span>
          </button>
        ))}
      </div>

      {tab === "contracts" && (
        loading ? <div className="rounded-xl border border-border bg-surface"><Loading /></div>
        : contracts.length === 0 ? <div className="rounded-xl border border-border bg-surface"><Empty Icon={FileText} title="No contracts tracked" hint="Track every MSA, NDA, SOW, DPA — get alerted before renewals expire." onAction={() => setShowNew("contracts")} actionLabel="Add first contract" /></div>
        : (
          <BoardView
            boardKey="legal:contracts"
            items={contracts}
            fields={CONTRACT_FIELDS}
            getId={(c) => c.id}
            getTitle={(c) => c.title}
            getValue={(c, key) => {
              const raw = (c as unknown as Record<string, unknown>)[key];
              if (key === "value") return raw != null ? Number(raw) : null;
              return raw;
            }}
            editableFields={["status"]}
            selectable
            onRowClick={(c) => setOpenContract(c)}
            onChangeField={async (id, key, value) => {
              await fetch("/api/legal/contracts", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, [key]: value }),
              });
              await refresh();
              setOpenContract((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Contract : prev);
            }}
            onBulkChange={async (ids, key, value) => {
              await Promise.all(ids.map((id) => fetch("/api/legal/contracts", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, [key]: value }),
              })));
              await refresh();
            }}
          />
        )
      )}

      {tab === "privacy" && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          {loading ? <Loading /> : requests.length === 0 ? <Empty Icon={Shield} title="No DSARs filed" hint="GDPR / CCPA data subject requests get filed here. SLA timers auto-compute per jurisdiction." onAction={() => setShowNew("privacy")} actionLabel="Log a DSAR" /> : (
            <div className="divide-y divide-border">{requests.map((r) => {
              const d = daysUntil(r.dueAt);
              const overdue = d !== null && d < 0;
              const urgent = d !== null && d <= 7 && d >= 0 && !["COMPLETED", "DENIED", "CANCELLED"].includes(r.status);
              return (
                <div key={r.id} className="px-4 py-3 hover:bg-surface-2 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-indigo-100 text-indigo-700">{r.type.replace(/_/g, " ")}</span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${PRIVACY_TONES[r.status]}`}>{r.status.replace(/_/g, " ")}</span>
                      {r.jurisdiction && <span className="text-[10px] text-muted-2 uppercase tracking-wider">{r.jurisdiction}</span>}
                    </div>
                    <div className="font-medium text-sm">{r.subjectName ?? r.subjectEmail}</div>
                    {r.subjectName && <div className="text-xs text-muted-2">{r.subjectEmail}</div>}
                  </div>
                  <div className="flex-shrink-0 text-xs text-right">
                    {r.completedAt ? (
                      <span className="text-emerald-600">Done {fmtDate(r.completedAt)}</span>
                    ) : (
                      <>
                        <div className={overdue ? "text-rose-700 font-medium" : urgent ? "text-amber-700 font-medium" : "text-muted"}>
                          {overdue ? <AlertTriangle size={11} className="inline mr-1" /> : urgent ? <Clock size={11} className="inline mr-1" /> : null}
                          Due {fmtDate(r.dueAt)}
                        </div>
                        {d !== null && (
                          <div className={overdue ? "text-rose-700" : urgent ? "text-amber-700" : "text-muted-2"}>
                            {overdue ? `${-d}d overdue` : `${d}d left`}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}</div>
          )}
        </div>
      )}

      {tab === "ip" && (
        <div>
          {loading ? <Loading /> : trademarks.length === 0 ? <div className="rounded-xl border border-border bg-surface"><Empty Icon={Award} title="No IP records" hint="Track trademarks, patents, copyrights with renewal alerts + outside-counsel attribution." onAction={() => setShowNew("ip")} actionLabel="Add first mark" /></div> : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{trademarks.map((t) => {
              const d = daysUntil(t.renewalDueAt);
              const renewalSoon = d !== null && d <= 90 && d >= 0;
              return (
                <article key={t.id} className="rounded-xl border border-border bg-surface p-4 hover:border-indigo-300">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-2">{t.type.replace(/_/g, " ")}</span>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider ${TRADEMARK_TONES[t.status]} ml-auto`}>{t.status.replace(/_/g, " ")}</span>
                  </div>
                  <h3 className="font-semibold text-base mb-1">{t.mark}</h3>
                  {t.registrationNumber && <p className="text-[11px] text-muted-2 mb-1 font-mono">Reg# {t.registrationNumber}</p>}
                  {t.jurisdictions && t.jurisdictions.length > 0 && <p className="text-xs text-muted mb-2">{t.jurisdictions.join(" · ")}</p>}
                  {t.renewalDueAt && (
                    <div className={`text-[11px] mt-2 ${renewalSoon ? "text-amber-700 font-medium" : "text-muted-2"}`}>
                      {renewalSoon && <Clock size={11} className="inline mr-1" />}
                      Renewal: {fmtDate(t.renewalDueAt)} {d !== null && d >= 0 && `(${d}d)`}
                    </div>
                  )}
                </article>
              );
            })}</div>
          )}
        </div>
      )}

      {showNew === "contracts" && <ContractModal onClose={() => setShowNew(null)} onCreated={() => { setShowNew(null); refresh(); }} />}
      {showNew === "privacy" && <PrivacyModal onClose={() => setShowNew(null)} onCreated={() => { setShowNew(null); refresh(); }} />}
      {showNew === "ip" && <TrademarkModal onClose={() => setShowNew(null)} onCreated={() => { setShowNew(null); refresh(); }} />}

      <ItemDetailDrawer
        open={!!openContract}
        onClose={() => setOpenContract(null)}
        item={openContract}
        title={openContract?.title ?? ""}
        entityType="CONTRACT"
        fields={CONTRACT_FIELDS}
        editableFields={["status"]}
        getValue={(c, k) => {
          const raw = (c as unknown as Record<string, unknown>)[k];
          if (k === "value") return raw != null ? Number(raw) : null;
          return raw;
        }}
        onChangeField={async (id, key, value) => {
          await fetch("/api/legal/contracts", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, [key]: value }),
          }).catch(() => {});
          await refresh();
          setOpenContract((prev) => prev && prev.id === id ? { ...prev, [key]: value } as Contract : prev);
        }}
      />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "amber" | "rose" }) {
  const bg = tone === "rose" ? "bg-rose-50 dark:bg-rose-950/30" : tone === "amber" ? "bg-amber-50 dark:bg-amber-950/30" : "bg-surface";
  return <div className={`rounded-xl border border-border p-3 ${bg}`}><div className="text-[11px] uppercase tracking-wider text-muted-2 mb-1">{label}</div><div className="text-lg font-semibold">{value}</div></div>;
}

function Loading() { return <div className="text-sm text-muted py-20 text-center">Loading…</div>; }

function Empty({ Icon, title, hint, onAction, actionLabel }: { Icon: typeof FileText; title: string; hint: string; onAction: () => void; actionLabel: string }) {
  return (
    <div className="text-center py-20">
      <Icon size={40} className="mx-auto mb-3 text-muted-2" />
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm text-muted mb-4 max-w-sm mx-auto">{hint}</p>
      <button type="button" onClick={onAction} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"><Plus size={14} /> {actionLabel}</button>
    </div>
  );
}

function ContractModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState(""); const [counterparty, setCounterparty] = useState(""); const [type, setType] = useState(""); const [counterpartyType, setCounterpartyType] = useState("Vendor");
  const [value, setValue] = useState(""); const [effectiveDate, setEffectiveDate] = useState(""); const [expiresAt, setExpiresAt] = useState(""); const [autoRenew, setAutoRenew] = useState(false);
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!title.trim() || !counterparty.trim()) return; setSaving(true);
    try {
      await fetch("/api/legal/contracts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, counterparty, type, counterpartyType, value: value ? parseFloat(value) : undefined, effectiveDate: effectiveDate || undefined, expiresAt: expiresAt || undefined, autoRenew }) });
      onCreated();
    } finally { setSaving(false); }
  }
  return <Modal title="New contract" onClose={onClose}><Row label="Title"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="i" /></Row><div className="grid grid-cols-2 gap-3"><Row label="Counterparty"><input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} className="i" /></Row><Row label="Counterparty type"><select value={counterpartyType} onChange={(e) => setCounterpartyType(e.target.value)} className="i"><option>Customer</option><option>Vendor</option><option>Partner</option><option>Investor</option><option>Employee</option></select></Row></div><div className="grid grid-cols-2 gap-3"><Row label="Contract type"><input value={type} onChange={(e) => setType(e.target.value)} placeholder="MSA, NDA, SOW, DPA..." className="i" /></Row><Row label="Value (USD)"><input type="number" value={value} onChange={(e) => setValue(e.target.value)} className="i" /></Row></div><div className="grid grid-cols-2 gap-3"><Row label="Effective"><input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="i" /></Row><Row label="Expires"><input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="i" /></Row></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} /> Auto-renew</label><Actions onClose={onClose} onSubmit={submit} saving={saving} disabled={!title.trim() || !counterparty.trim()} /></Modal>;
}

function PrivacyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState("ACCESS"); const [subjectEmail, setSubjectEmail] = useState(""); const [subjectName, setSubjectName] = useState(""); const [jurisdiction, setJurisdiction] = useState("GDPR"); const [notes, setNotes] = useState(""); const [saving, setSaving] = useState(false);
  async function submit() {
    if (!subjectEmail.trim()) return; setSaving(true);
    try {
      await fetch("/api/legal/privacy-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, subjectEmail, subjectName, jurisdiction, notes }) });
      onCreated();
    } finally { setSaving(false); }
  }
  return <Modal title="Log DSAR" onClose={onClose}><div className="grid grid-cols-2 gap-3"><Row label="Request type"><select value={type} onChange={(e) => setType(e.target.value)} className="i"><option value="ACCESS">Access</option><option value="DELETION">Deletion / Erasure</option><option value="RECTIFICATION">Rectification</option><option value="PORTABILITY">Portability</option><option value="OBJECTION">Objection</option><option value="CONSENT_WITHDRAWAL">Consent withdrawal</option><option value="RESTRICTION">Restriction</option><option value="AUTOMATED_DECISION">Automated decision</option></select></Row><Row label="Jurisdiction"><select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} className="i"><option>GDPR</option><option>CCPA</option><option>LGPD</option><option>PIPEDA</option><option>Other</option></select></Row></div><Row label="Subject email"><input autoFocus type="email" value={subjectEmail} onChange={(e) => setSubjectEmail(e.target.value)} className="i" /></Row><Row label="Subject name (optional)"><input value={subjectName} onChange={(e) => setSubjectName(e.target.value)} className="i" /></Row><Row label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="i" /></Row><Actions onClose={onClose} onSubmit={submit} saving={saving} disabled={!subjectEmail.trim()} submitLabel="Log request" /></Modal>;
}

function TrademarkModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [mark, setMark] = useState(""); const [type, setType] = useState("WORD_MARK"); const [jurisdictions, setJurisdictions] = useState(""); const [registrationNumber, setRegistrationNumber] = useState(""); const [registeredAt, setRegisteredAt] = useState(""); const [renewalDueAt, setRenewalDueAt] = useState(""); const [externalCounselFirm, setExternalCounselFirm] = useState(""); const [saving, setSaving] = useState(false);
  async function submit() {
    if (!mark.trim()) return; setSaving(true);
    try {
      await fetch("/api/legal/trademarks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mark, type, jurisdictions: jurisdictions.split(",").map((s) => s.trim()).filter(Boolean), registrationNumber, registeredAt: registeredAt || undefined, renewalDueAt: renewalDueAt || undefined, externalCounselFirm }) });
      onCreated();
    } finally { setSaving(false); }
  }
  return <Modal title="New IP record" onClose={onClose}><Row label="Mark / asset"><input autoFocus value={mark} onChange={(e) => setMark(e.target.value)} placeholder="WORKWRK" className="i" /></Row><div className="grid grid-cols-2 gap-3"><Row label="Type"><select value={type} onChange={(e) => setType(e.target.value)} className="i"><option value="WORD_MARK">Word mark</option><option value="DESIGN_MARK">Design mark</option><option value="COMBINED_MARK">Combined mark</option><option value="PATENT">Patent</option><option value="COPYRIGHT">Copyright</option><option value="TRADE_SECRET">Trade secret</option><option value="DOMAIN_NAME">Domain name</option></select></Row><Row label="Jurisdictions"><input value={jurisdictions} onChange={(e) => setJurisdictions(e.target.value)} placeholder="US, EU, UK" className="i" /></Row></div><Row label="Registration #"><input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} className="i font-mono text-xs" /></Row><div className="grid grid-cols-2 gap-3"><Row label="Registered"><input type="date" value={registeredAt} onChange={(e) => setRegisteredAt(e.target.value)} className="i" /></Row><Row label="Renewal due"><input type="date" value={renewalDueAt} onChange={(e) => setRenewalDueAt(e.target.value)} className="i" /></Row></div><Row label="External counsel firm"><input value={externalCounselFirm} onChange={(e) => setExternalCounselFirm(e.target.value)} className="i" /></Row><Actions onClose={onClose} onSubmit={submit} saving={saving} disabled={!mark.trim()} /></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2"><h2 className="text-lg font-semibold">{title}</h2><button type="button" onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted"><X size={16} /></button></div>
        <style>{".i{width:100%;padding:.5rem .75rem;border-radius:.5rem;border:1px solid var(--color-border, rgba(0,0,0,.1));background:var(--color-surface, #fff);font-size:.875rem;}"}</style>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-muted-2 mb-1">{label}</label>{children}</div>;
}

function Actions({ onClose, onSubmit, saving, disabled, submitLabel = "Create" }: { onClose: () => void; onSubmit: () => void; saving: boolean; disabled: boolean; submitLabel?: string }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface-2">Cancel</button>
      <button type="button" onClick={onSubmit} disabled={saving || disabled} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5">{saving ? "Saving…" : (<><Zap size={12} /> {submitLabel}</>)}</button>
    </div>
  );
}

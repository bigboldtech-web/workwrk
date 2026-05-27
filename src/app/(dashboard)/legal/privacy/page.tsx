"use client";

/* Legal · Privacy — flexible DSAR queue (GDPR / CCPA / any jurisdiction).
 *
 * Type field is enum-backed (Access / Deletion / Rectification /
 * Portability / Restriction / Objection) — that's regulator-defined, so
 * we keep it. Jurisdiction is free-form (GDPR / CCPA / LGPD / your-org's
 * abbreviation). Cards group by status with SLA chip + days-to-due.
 *
 * GET  /api/legal/privacy-requests
 * POST /api/legal/privacy-requests  { type, subjectEmail, jurisdiction? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Shield, Plus, Search, AlertTriangle, Calendar, Mail, ShieldCheck } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Status = "RECEIVED" | "VERIFYING" | "IN_PROGRESS" | "FULFILLED" | "REJECTED" | "ESCALATED";
type Type = "ACCESS" | "DELETION" | "RECTIFICATION" | "PORTABILITY" | "RESTRICTION" | "OBJECTION" | "OPT_OUT";

type ApiReq = {
  id: string; type: Type; status: Status;
  subjectEmail: string; subjectName?: string | null;
  jurisdiction?: string | null;
  verifiedAt?: string | null; receivedAt: string;
  dueAt?: string | null; completedAt?: string | null;
  notes?: string | null;
};

const STATUS_HUE: Record<Status, string> = {
  RECEIVED: "var(--os-c-indigo)", VERIFYING: "var(--os-c-orange)",
  IN_PROGRESS: "var(--os-c-purple)", FULFILLED: "var(--os-c-green)",
  REJECTED: "var(--os-c-red)", ESCALATED: "var(--os-c-red)",
};
const STATUS_LABEL: Record<Status, string> = {
  RECEIVED: "Received", VERIFYING: "Verifying", IN_PROGRESS: "In progress",
  FULFILLED: "Fulfilled", REJECTED: "Rejected", ESCALATED: "Escalated",
};
const TYPE_LABEL: Record<Type, string> = {
  ACCESS: "Access", DELETION: "Deletion", RECTIFICATION: "Rectification",
  PORTABILITY: "Portability", RESTRICTION: "Restriction", OBJECTION: "Objection", OPT_OUT: "Opt-out",
};
const TYPE_HUE: Record<Type, string> = {
  ACCESS: "var(--os-c-blue)", DELETION: "var(--os-c-red)",
  RECTIFICATION: "var(--os-c-orange)", PORTABILITY: "var(--os-c-purple)",
  RESTRICTION: "var(--os-c-indigo)", OBJECTION: "var(--os-c-pink)", OPT_OUT: "var(--os-c-teal)",
};

const MS_DAY = 86_400_000;
function daysToDue(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / MS_DAY);
}

export default function PrivacyLibrary() {
  const [items, setItems] = useState<ApiReq[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeJurisdiction, setActiveJurisdiction] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/legal/privacy-requests");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.privacyRequests ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("legal");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function quickAdd() {
    const email = window.prompt("Subject email?")?.trim();
    if (!email || !email.includes("@")) { toast("Valid email required"); return; }
    const type = (window.prompt("Type (ACCESS / DELETION / RECTIFICATION / PORTABILITY / RESTRICTION / OBJECTION / OPT_OUT)?")?.trim().toUpperCase() ?? "ACCESS") as Type;
    if (!TYPE_LABEL[type]) { toast("Pick a valid type"); return; }
    const jurisdiction = window.prompt("Jurisdiction (GDPR / CCPA / LGPD / …)?")?.trim() || undefined;
    try {
      const res = await fetch("/api/legal/privacy-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, subjectEmail: email, jurisdiction }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't log request"); }
  }

  const jurisdictions = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items ?? []) {
      if (i.jurisdiction) m.set(i.jurisdiction, (m.get(i.jurisdiction) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [items]);

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (activeJurisdiction) list = list.filter((i) => i.jurisdiction === activeJurisdiction);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        i.subjectEmail.toLowerCase().includes(q) ||
        (i.subjectName ?? "").toLowerCase().includes(q) ||
        (i.jurisdiction ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, activeJurisdiction, search]);

  const open = filtered.filter((i) => i.status !== "FULFILLED" && i.status !== "REJECTED");
  const closed = filtered.filter((i) => i.status === "FULFILLED" || i.status === "REJECTED");

  const overdueOpen = open.filter((i) => {
    const d = daysToDue(i.dueAt);
    return d != null && d < 0;
  });
  const dueSoon = open.filter((i) => {
    const d = daysToDue(i.dueAt);
    return d != null && d >= 0 && d <= 7;
  });

  return (
    <div className="lib">
      <header className="lib__head">
        <div className="lib__head-l">
          <div className="lib__icon" style={{ background: "linear-gradient(135deg, var(--os-c-red), var(--os-c-orange))" }}><Shield /></div>
          <div>
            <h1 className="lib__title">Privacy requests</h1>
            <div className="lib__sub">
              {items === null ? "Loading…" : `${open.length} open · ${dueSoon.length} due this week${overdueOpen.length > 0 ? ` · ${overdueOpen.length} overdue` : ""}`}
            </div>
          </div>
        </div>
        <div className="lib__actions">
          <div className="lib__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email, jurisdiction…" />
          </div>
          <button type="button" className="lib__new" onClick={quickAdd}><Plus /> Log request</button>
        </div>
      </header>

      {jurisdictions.length > 0 && (
        <nav className="lib__types">
          <button type="button" className={!activeJurisdiction ? "is-active" : ""} onClick={() => setActiveJurisdiction(null)}>All <em>{items?.length ?? 0}</em></button>
          {jurisdictions.map(([j, n]) => (
            <button key={j} type="button" className={activeJurisdiction === j ? "is-active" : ""} onClick={() => setActiveJurisdiction(j)}>
              {j} <em>{n}</em>
            </button>
          ))}
        </nav>
      )}

      {loadError ? (
        <div className="lib__error">{loadError}</div>
      ) : items === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {overdueOpen.length > 0 && (
            <div className="lib__banner">
              <AlertTriangle />
              <span><strong>{overdueOpen.length} request{overdueOpen.length === 1 ? "" : "s"} past SLA.</strong> Statutory clocks already started.</span>
            </div>
          )}

          {open.length > 0 && (
            <section className="lib__section">
              <header><h2>Open</h2><span>{open.length}</span></header>
              <div className="lib__list">
                {open.map((r) => <PrivacyRow key={r.id} r={r} />)}
              </div>
            </section>
          )}

          {closed.length > 0 && (
            <details className="lib__archive">
              <summary>Resolved · {closed.length}</summary>
              <div className="lib__list" style={{ marginTop: 8 }}>
                {closed.slice(0, 20).map((r) => <PrivacyRow key={r.id} r={r} dim />)}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function PrivacyRow({ r, dim }: { r: ApiReq; dim?: boolean }) {
  const due = daysToDue(r.dueAt);
  const late = due != null && due < 0;
  const soon = due != null && due >= 0 && due <= 7;
  return (
    <article className={`privacy-row ${dim ? "is-dim" : ""}`}>
      <span className="privacy-row__type" style={{ background: TYPE_HUE[r.type] }}>{TYPE_LABEL[r.type]}</span>
      <div className="privacy-row__main">
        <div className="privacy-row__subj">
          <Mail />
          <strong>{r.subjectName ?? r.subjectEmail}</strong>
          {r.subjectName && <span>· {r.subjectEmail}</span>}
        </div>
        <div className="privacy-row__meta">
          {r.jurisdiction && <span><Shield /> {r.jurisdiction}</span>}
          {r.verifiedAt ? <span style={{ color: "var(--os-c-green)" }}><ShieldCheck /> Verified</span> : <span style={{ color: "var(--os-c-orange)" }}>Unverified</span>}
          <span>Received {new Date(r.receivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        </div>
      </div>
      {r.dueAt && (
        <span className={`privacy-row__due ${late ? "is-late" : soon ? "is-soon" : ""}`}>
          {late ? <AlertTriangle /> : <Calendar />}
          {late ? `${-due!}d overdue` : `Due in ${due}d`}
        </span>
      )}
      <span className="privacy-row__status" style={{ background: STATUS_HUE[r.status] }}>{STATUS_LABEL[r.status]}</span>
    </article>
  );
}

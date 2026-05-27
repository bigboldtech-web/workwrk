"use client";

/* Recruiting · Pipeline — hiring funnel kanban.
 *
 * 5 active stages (Rejected + Withdrawn collapse into archive sections):
 *   Applied -> Screening -> Interview -> Offer -> Hired
 *
 * Each candidate card has avatar initials, name, job they applied to,
 * source chip, days-in-stage chip (turns red after 7d). Drag to advance.
 *
 * GET   /api/recruiting/applications
 * PATCH /api/recruiting/applications/[id]   { stage }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { UserCheck, Mail, Briefcase } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Stage = "APPLIED" | "SCREENING" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED" | "WITHDRAWN";

type ApiApp = {
  id: string;
  stage: Stage;
  source?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
  job?: { id: string; title: string } | null;
  candidate?: { id: string; firstName: string; lastName: string; email?: string | null } | null;
  recruiter?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const STAGES: { id: Stage; label: string; hue: string }[] = [
  { id: "APPLIED",   label: "Applied",    hue: "var(--os-c-indigo)" },
  { id: "SCREENING", label: "Screening",  hue: "var(--os-c-blue)" },
  { id: "INTERVIEW", label: "Interview",  hue: "var(--os-c-purple)" },
  { id: "OFFER",     label: "Offer",      hue: "var(--os-c-orange)" },
  { id: "HIRED",     label: "Hired",      hue: "var(--os-c-green)" },
];

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

const MS_DAY = 86_400_000;
function daysInStage(a: ApiApp): number { return Math.floor((Date.now() - new Date(a.updatedAt).getTime()) / MS_DAY); }

export default function RecruitingPipelinePage() {
  const [apps, setApps] = useState<ApiApp[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/recruiting/applications?limit=500");
      if (res.status === 403) { setLoadError("Manager access required."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setApps(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("recruiting");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const grouped = useMemo(() => {
    const m = new Map<Stage, ApiApp[]>();
    for (const s of STAGES) m.set(s.id, []);
    m.set("REJECTED", []); m.set("WITHDRAWN", []);
    for (const a of apps ?? []) m.get(a.stage)?.push(a);
    for (const [, arr] of m) arr.sort((a, b) => daysInStage(b) - daysInStage(a));
    return m;
  }, [apps]);

  async function moveTo(id: string, stage: Stage) {
    setApps((prev) => prev?.map((a) => a.id === id ? { ...a, stage, updatedAt: new Date().toISOString() } : a) ?? prev);
    try {
      const res = await fetch(`/api/recruiting/applications/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch { toast("Couldn't move candidate"); void load(); }
  }

  const total = apps?.length ?? 0;
  const active = (apps ?? []).filter((a) => a.stage !== "REJECTED" && a.stage !== "WITHDRAWN").length;
  const hired = (apps ?? []).filter((a) => a.stage === "HIRED").length;
  const rejected = grouped.get("REJECTED") ?? [];
  const withdrawn = grouped.get("WITHDRAWN") ?? [];

  return (
    <div className="recpipe">
      <header className="recpipe__head">
        <div className="recpipe__head-l">
          <div className="recpipe__icon"><UserCheck /></div>
          <div>
            <h1 className="recpipe__title">Hiring pipeline</h1>
            <div className="recpipe__sub">
              {apps === null ? "Loading…" : `${active} active · ${hired} hired · ${total} total this period`}
            </div>
          </div>
        </div>
        <Link href="/recruiting/candidates" className="recpipe__link">All candidates →</Link>
      </header>

      {loadError ? (
        <div className="recpipe__error">{loadError}</div>
      ) : apps === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <div className="recpipe__board">
            {STAGES.map((s) => {
              const items = grouped.get(s.id) ?? [];
              return (
                <section
                  key={s.id}
                  className="recpipe__col"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (drag) void moveTo(drag, s.id); setDrag(null); }}
                >
                  <header className="recpipe__col-head" style={{ borderTop: `3px solid ${s.hue}` }}>
                    <span>{s.label}</span>
                    <span className="recpipe__col-count">{items.length}</span>
                  </header>
                  <div className="recpipe__col-body">
                    {items.length === 0 ? (
                      <div className="recpipe__col-empty">No candidates here yet.</div>
                    ) : items.map((a) => {
                      const days = daysInStage(a);
                      const stale = days >= 7;
                      const name = `${a.candidate?.firstName ?? ""} ${a.candidate?.lastName ?? ""}`.trim();
                      return (
                        <article
                          key={a.id}
                          className={`reccard ${stale ? "is-stale" : ""}`}
                          draggable
                          onDragStart={() => setDrag(a.id)}
                          onDragEnd={() => setDrag(null)}
                        >
                          <header className="reccard__head">
                            <span className="reccard__av" style={{ background: avColor(a.candidate?.id ?? a.id) }}>
                              {initials(a.candidate?.firstName, a.candidate?.lastName)}
                            </span>
                            <div className="reccard__main">
                              <div className="reccard__name">{name || "Unknown"}</div>
                              {a.job?.title && <div className="reccard__job"><Briefcase /> {a.job.title}</div>}
                            </div>
                          </header>
                          <footer className="reccard__foot">
                            {a.source && <span className="reccard__src">{a.source}</span>}
                            <span className={`reccard__age ${stale ? "is-stale" : ""}`}>{days}d in stage</span>
                            {a.candidate?.email && (
                              <a href={`mailto:${a.candidate.email}`} className="reccard__mail" title={a.candidate.email} onClick={(e) => e.stopPropagation()}>
                                <Mail />
                              </a>
                            )}
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>

          {(rejected.length + withdrawn.length) > 0 && (
            <section className="recpipe__archive">
              {rejected.length > 0 && (
                <details>
                  <summary>Rejected · {rejected.length}</summary>
                  <ul>
                    {rejected.slice(0, 10).map((a) => (
                      <li key={a.id}>
                        {`${a.candidate?.firstName ?? ""} ${a.candidate?.lastName ?? ""}`.trim() || "—"}
                        {a.job?.title && <em> · {a.job.title}</em>}
                        {a.rejectionReason && <span> · {a.rejectionReason}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {withdrawn.length > 0 && (
                <details>
                  <summary>Withdrawn · {withdrawn.length}</summary>
                  <ul>
                    {withdrawn.slice(0, 10).map((a) => (
                      <li key={a.id}>
                        {`${a.candidate?.firstName ?? ""} ${a.candidate?.lastName ?? ""}`.trim() || "—"}
                        {a.job?.title && <em> · {a.job.title}</em>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

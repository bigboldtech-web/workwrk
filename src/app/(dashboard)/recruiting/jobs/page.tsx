"use client";

/* Recruiting · Jobs — open positions card grid grouped by status.
 *
 * Each job card: title, department, location, employment type, salary
 * range, openings count, applicant count, hiring manager.
 *
 * GET  /api/recruiting/jobs
 * POST /api/recruiting/jobs   { title, status?, employmentType?, ... }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, MapPin, Users as UsersIcon, Plus, Globe2 } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type JobStatus = "DRAFT" | "OPEN" | "ON_HOLD" | "CLOSED" | "FILLED";
type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN" | "TEMPORARY";

type ApiJob = {
  id: string;
  title: string;
  status: JobStatus;
  employmentType: EmploymentType;
  location?: string | null;
  openings?: number | null;
  publishedAt?: string | null;
  closedAt?: string | null;
  salaryMin?: number | string | null;
  salaryMax?: number | string | null;
  salaryCurrency?: string | null;
  department?: { id: string; name: string } | null;
  hiringManager?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  _count?: { applications?: number };
};

const STATUS_LABEL: Record<JobStatus, string> = {
  OPEN: "Open", DRAFT: "Draft", ON_HOLD: "On hold", CLOSED: "Closed", FILLED: "Filled",
};
const STATUS_HUE: Record<JobStatus, string> = {
  OPEN: "var(--os-c-green)", DRAFT: "var(--os-c-indigo)",
  ON_HOLD: "var(--os-c-orange)", CLOSED: "var(--os-c-darkgray)", FILLED: "var(--os-c-purple)",
};
const STATUS_ORDER: JobStatus[] = ["OPEN", "DRAFT", "ON_HOLD", "FILLED", "CLOSED"];

const EMP_LABEL: Record<EmploymentType, string> = {
  FULL_TIME: "Full-time", PART_TIME: "Part-time", CONTRACT: "Contract", INTERN: "Internship", TEMPORARY: "Temporary",
};

function num(v?: number | string | null): number { if (v == null) return 0; return typeof v === "string" ? parseFloat(v) : v; }
function money(n: number, ccy = "USD"): string {
  if (n >= 1_000_000) return `${ccy} ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${ccy} ${(n / 1_000).toFixed(0)}K`;
  return `${ccy} ${n.toFixed(0)}`;
}
function rangeStr(min: number, max: number, ccy: string): string {
  if (!min && !max) return "—";
  if (min && max) return `${money(min, ccy)} – ${money(max, ccy)}`;
  if (min) return `${money(min, ccy)}+`;
  return `up to ${money(max, ccy)}`;
}

export default function RecruitingJobsPage() {
  const [jobs, setJobs] = useState<ApiJob[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/recruiting/jobs?limit=200");
      if (res.status === 403) { setLoadError("Manager access required."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setJobs(data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("recruiting");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const grouped = useMemo(() => {
    const m = new Map<JobStatus, ApiJob[]>();
    for (const s of STATUS_ORDER) m.set(s, []);
    for (const j of jobs ?? []) m.get(j.status)?.push(j);
    return m;
  }, [jobs]);

  const total = jobs?.length ?? 0;
  const open = grouped.get("OPEN")?.length ?? 0;
  const totalApps = (jobs ?? []).reduce((acc, j) => acc + (j._count?.applications ?? 0), 0);

  async function quickCreate() {
    const title = window.prompt("Job title?")?.trim();
    if (!title) return;
    try {
      const res = await fetch("/api/recruiting/jobs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, status: "DRAFT", employmentType: "FULL_TIME", openings: 1 }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      void load();
    } catch { toast("Couldn't create job"); }
  }

  return (
    <div className="recjobs">
      <header className="recjobs__head">
        <div className="recjobs__head-l">
          <div className="recjobs__icon"><Briefcase /></div>
          <div>
            <h1 className="recjobs__title">Open positions</h1>
            <div className="recjobs__sub">
              {jobs === null ? "Loading…" : `${open} open · ${total} total · ${totalApps} applicant${totalApps === 1 ? "" : "s"} across them`}
            </div>
          </div>
        </div>
        <div className="recjobs__actions">
          <Link href="/recruiting/pipeline" className="recjobs__link">Pipeline →</Link>
          <button type="button" className="recjobs__new" onClick={quickCreate}><Plus /> New job</button>
        </div>
      </header>

      {loadError ? (
        <div className="recjobs__error">{loadError}</div>
      ) : jobs === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : total === 0 ? (
        <div className="recjobs__empty">
          <Briefcase />
          <div>
            <h3>No jobs posted yet</h3>
            <p>Post a role with a department, location, and salary band. Candidates flow into the pipeline from any source.</p>
          </div>
        </div>
      ) : (
        <div className="recjobs__sections">
          {STATUS_ORDER.map((status) => {
            const items = grouped.get(status) ?? [];
            if (items.length === 0) return null;
            return (
              <section key={status} className="recjobs__section">
                <header className="recjobs__section-head" style={{ borderLeft: `4px solid ${STATUS_HUE[status]}` }}>
                  <h2>{STATUS_LABEL[status]}</h2>
                  <span>{items.length} role{items.length === 1 ? "" : "s"}</span>
                </header>
                <div className="recjobs__grid">
                  {items.map((j) => {
                    const apps = j._count?.applications ?? 0;
                    const min = num(j.salaryMin); const max = num(j.salaryMax);
                    return (
                      <article key={j.id} className="recjob-card" style={{ ["--card-hue" as string]: STATUS_HUE[status] }}>
                        <header className="recjob-card__head">
                          <h3>{j.title}</h3>
                          <span className="recjob-card__opens">{j.openings ?? 1} opening{(j.openings ?? 1) === 1 ? "" : "s"}</span>
                        </header>
                        <div className="recjob-card__meta">
                          {j.department && <span className="recjob-card__dept">{j.department.name}</span>}
                          {j.location && <span className="recjob-card__loc"><MapPin /> {j.location}</span>}
                          <span className="recjob-card__type"><Globe2 /> {EMP_LABEL[j.employmentType]}</span>
                        </div>
                        <div className="recjob-card__salary">
                          {rangeStr(min, max, j.salaryCurrency ?? "USD")}
                        </div>
                        <footer className="recjob-card__foot">
                          {j.hiringManager && (
                            <span className="recjob-card__hm">
                              <small>Hiring manager</small>
                              <strong>{[j.hiringManager.firstName, j.hiringManager.lastName].filter(Boolean).join(" ")}</strong>
                            </span>
                          )}
                          <Link href={`/recruiting/pipeline?jobId=${j.id}`} className="recjob-card__apps">
                            <UsersIcon /> {apps}
                          </Link>
                        </footer>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

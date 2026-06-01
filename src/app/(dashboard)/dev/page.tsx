"use client";

/* Engineering hub — overview with KPI strip + workspace tiles. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Code2, Zap, Rocket, Map as MapIcon, GitBranch, ChevronRight, Layers, Hash,
  Activity, AlertTriangle, CheckCircle2, Target,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiTask = { id: string; status: "PLANNED" | "IN_PROGRESS" | "COMPLETED"; date: string };
type ApiIncident = { id: string; status: string; severity: string };

export default function DevHubPage() {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [incs, setIncs] = useState<ApiIncident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const MS = 86_400_000;
      const from = new Date(Date.now() - 14 * MS).toISOString().slice(0, 10);
      const to = new Date(Date.now() + 60 * MS).toISOString().slice(0, 10);
      const [t, i] = await Promise.all([
        fetch(`/api/tasks?startDate=${from}&endDate=${to}`).catch(() => null),
        fetch(`/api/itsm/incidents`).catch(() => null),
      ]);
      if (t?.ok) {
        const d = await t.json();
        setTasks(Array.isArray(d) ? d : (d.data ?? []));
      } else setTasks([]);
      if (i?.ok) {
        const d = await i.json();
        setIncs(d.incidents ?? d.data ?? []);
      } else setIncs([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("dev");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const inProgress = (tasks ?? []).filter((t) => t.status === "IN_PROGRESS").length;
    const planned = (tasks ?? []).filter((t) => t.status === "PLANNED").length;
    const done = (tasks ?? []).filter((t) => t.status === "COMPLETED").length;
    const liveIncs = (incs ?? []).filter((i) => i.status !== "RESOLVED").length;
    const sev1 = (incs ?? []).filter((i) => i.status !== "RESOLVED" && i.severity === "SEV1").length;
    return { inProgress, planned, done, liveIncs, sev1 };
  }, [tasks, incs]);

  const loading = tasks === null || incs === null;

  return (
    <>
      <OsTitleBar
        title="Engineering"
        Icon={Code2}
        iconGradient={GRAD.bluePurple}
        description={loading ? "Loading engineering pulse…" : `${stats.inProgress} in progress · ${stats.planned} planned · ${stats.liveIncs} live incident${stats.liveIncs === 1 ? "" : "s"}${stats.sev1 > 0 ? ` · ${stats.sev1} SEV1` : ""}`}
        actions={
          <div className="dev__head-actions">
            <Link href="/dev/sprints" className="dev__nav-link"><Zap /> Sprints</Link>
            <Link href="/dev/releases" className="dev__nav-link"><Rocket /> Releases</Link>
            <Link href="/dev/roadmap" className="dev__nav-link"><MapIcon /> Roadmap</Link>
          </div>
        }
      />

      <div className="dev">
        {error && <div className="dev__error">{error}</div>}

        <div className="dev__kpis">
          <KpiTile accent="var(--os-c-orange)" Icon={Activity}     label="In progress" value={`${stats.inProgress}`} sub="active sprint" />
          <KpiTile accent="var(--os-c-indigo)" Icon={Layers}       label="Planned"     value={`${stats.planned}`}    sub="backlog primed" />
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Shipped"     value={`${stats.done}`}       sub="last 14d" />
          <KpiTile accent={stats.sev1 > 0 ? "var(--os-c-red)" : stats.liveIncs > 0 ? "var(--os-c-orange)" : "var(--os-c-green)"} Icon={stats.sev1 > 0 ? AlertTriangle : stats.liveIncs > 0 ? Activity : CheckCircle2} label="Incidents" value={`${stats.liveIncs}`} sub={stats.sev1 > 0 ? `${stats.sev1} SEV1 active` : stats.liveIncs > 0 ? "live now" : "all clear"} />
        </div>

        <section className="dev__section">
          <header className="dev__section-head">
            <h2><Hash /> Sprint & board</h2>
            <span className="dev__section-line" />
          </header>
          <div className="dev__grid">
            <HubTile href="/tasks/sprint" Icon={Zap} hue="var(--os-c-orange)" title="Current sprint" stat={`${stats.inProgress}`} sub="tasks in flight" />
            <HubTile href="/tasks/board" Icon={Layers} hue="var(--os-c-blue)" title="Sprint board" stat="Kanban" sub="drag to advance" />
            <HubTile href="/tasks/backlog" Icon={Target} hue="var(--os-c-indigo)" title="Backlog" stat={`${stats.planned}`} sub="prioritised queue" />
            <HubTile href="/tasks/gantt" Icon={MapIcon} hue="var(--os-c-pink)" title="Gantt" stat="60d" sub="rolling timeline" />
          </div>
        </section>

        <section className="dev__section">
          <header className="dev__section-head">
            <h2><Hash /> Delivery & ops</h2>
            <span className="dev__section-line" />
          </header>
          <div className="dev__grid">
            <HubTile href="/dev/sprints" Icon={Zap} hue="var(--os-c-purple)" title="Sprint review" stat="Velocity" sub="carryover · health" />
            <HubTile href="/dev/releases" Icon={Rocket} hue="var(--os-c-green)" title="Releases" stat="Ship log" sub="versions + changelog" />
            <HubTile href="/dev/roadmap" Icon={MapIcon} hue="var(--os-c-indigo)" title="Roadmap" stat="Quarters" sub="outcomes by quarter" />
            <HubTile href="/itsm/incidents" Icon={GitBranch} hue={stats.sev1 > 0 ? "var(--os-c-red)" : "var(--os-c-orange)"} title="Incidents" stat={`${stats.liveIncs}`} sub={stats.liveIncs === 0 ? "all clear" : "active right now"} />
          </div>
        </section>
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Code2; label: string; value: string; sub: string }) {
  return (
    <div className="dev__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="dev__kpi-accent" aria-hidden="true" />
      <div className="dev__kpi-row">
        <div className="dev__kpi-icon"><Icon /></div>
        <div className="dev__kpi-label">{label}</div>
      </div>
      <div className="dev__kpi-value">{value}</div>
      <div className="dev__kpi-sub">{sub}</div>
    </div>
  );
}

function HubTile({ href, Icon, hue, title, stat, sub }: { href: string; Icon: typeof Code2; hue: string; title: string; stat: string; sub: string }) {
  return (
    <Link href={href} className="dev__tile" style={{ ["--tile-hue" as unknown as string]: hue }}>
      <span className="dev__tile-icon"><Icon /></span>
      <div className="dev__tile-body">
        <div className="dev__tile-title">{title}</div>
        <div className="dev__tile-stat">{stat}</div>
        <div className="dev__tile-sub">{sub}</div>
      </div>
      <ChevronRight className="dev__tile-chev" />
    </Link>
  );
}

"use client";

/* Engineering hub — overview of dev surfaces. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Code2, Zap, Rocket, Map as MapIcon, GitBranch, ChevronRight, Layers } from "lucide-react";
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
    const liveIncs = (incs ?? []).filter((i) => i.status !== "RESOLVED").length;
    const sev1 = (incs ?? []).filter((i) => i.status !== "RESOLVED" && i.severity === "SEV1").length;
    return { inProgress, planned, liveIncs, sev1 };
  }, [tasks, incs]);

  const loading = tasks === null || incs === null;

  return (
    <div className="hub">
      <header className="hub__head">
        <div className="hub__icon" style={{ background: "linear-gradient(135deg, var(--os-c-blue), var(--os-c-purple))" }}><Code2 /></div>
        <div>
          <h1>Engineering</h1>
          <p>{loading ? "Loading engineering…" : `${stats.inProgress} in progress · ${stats.planned} planned · ${stats.liveIncs} live incident${stats.liveIncs === 1 ? "" : "s"}${stats.sev1 > 0 ? ` · ${stats.sev1} SEV1` : ""}`}</p>
        </div>
      </header>

      {error && <div className="hub__error">{error}</div>}

      <div className="hub__grid">
        <HubTile href="/tasks/sprint" icon={<Zap />} hue="var(--os-c-orange)" title="Current sprint" stat={`${stats.inProgress}`} sub="tasks in flight" />
        <HubTile href="/tasks/board" icon={<Layers />} hue="var(--os-c-blue)" title="Sprint board" stat="Kanban" sub="drag to advance status" />
        <HubTile href="/dev/sprints" icon={<Zap />} hue="var(--os-c-purple)" title="All sprints" stat="—" sub="velocity · health · carryover" />
        <HubTile href="/dev/releases" icon={<Rocket />} hue="var(--os-c-green)" title="Releases" stat="—" sub="shipped this quarter" />
        <HubTile href="/dev/roadmap" icon={<MapIcon />} hue="var(--os-c-indigo)" title="Roadmap" stat="—" sub="quarterly outcomes" />
        <HubTile href="/itsm/incidents" icon={<GitBranch />} hue={stats.sev1 > 0 ? "var(--os-c-red)" : "var(--os-c-orange)"} title="Incidents" stat={`${stats.liveIncs}`} sub={stats.liveIncs === 0 ? "all clear" : "active right now"} />
        <HubTile href="/tasks/backlog" icon={<Layers />} hue="var(--os-c-indigo)" title="Backlog" stat={`${stats.planned}`} sub="prioritised tasks waiting" />
        <HubTile href="/tasks/gantt" icon={<MapIcon />} hue="var(--os-c-pink)" title="Gantt" stat="—" sub="60-day rolling timeline" />
      </div>
    </div>
  );
}

function HubTile({ href, icon, hue, title, stat, sub }: { href: string; icon: React.ReactNode; hue: string; title: string; stat: string; sub: string }) {
  return (
    <Link href={href} className="hub-tile" style={{ ["--tile-hue" as string]: hue }}>
      <span className="hub-tile__icon">{icon}</span>
      <div className="hub-tile__body">
        <div className="hub-tile__title">{title}</div>
        <div className="hub-tile__stat">{stat}</div>
        <div className="hub-tile__sub">{sub}</div>
      </div>
      <span className="hub-tile__chev"><ChevronRight /></span>
    </Link>
  );
}

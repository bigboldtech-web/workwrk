"use client";

/* Planning hub — overview of plans + variance. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ScrollText, ChartLine, Users as UsersIcon, ChevronRight, Layers } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiPlan = { id: string; status: string; fiscalYear?: { label: string } };

export default function PlanningHubPage() {
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/budget-plans");
      if (!r.ok) { setPlans([]); return; }
      const d = await r.json();
      setPlans(d.data ?? (Array.isArray(d) ? d : []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("planning");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const stats = useMemo(() => {
    const active = (plans ?? []).filter((p) => p.status === "ACTIVE" || p.status === "PUBLISHED").length;
    const fy = new Set((plans ?? []).map((p) => p.fiscalYear?.label).filter(Boolean));
    return { total: plans?.length ?? 0, active, fyCount: fy.size };
  }, [plans]);

  return (
    <div className="hub">
      <header className="hub__head">
        <div className="hub__icon" style={{ background: "linear-gradient(135deg, var(--os-c-indigo), var(--os-c-purple))" }}><Layers /></div>
        <div>
          <h1>Planning</h1>
          <p>{plans === null ? "Loading plans…" : `${stats.active} active plan${stats.active === 1 ? "" : "s"} · ${stats.fyCount} fiscal year${stats.fyCount === 1 ? "" : "s"} · variance computed live`}</p>
        </div>
      </header>

      {error && <div className="hub__error">{error}</div>}

      <div className="hub__grid">
        <Tile href="/planning/plans" icon={<ScrollText />} hue="var(--os-c-indigo)"
          title="Budget plans" stat={`${stats.active}`} sub={`active · ${stats.total} total`} />
        <Tile href="/planning/variance" icon={<ChartLine />} hue="var(--os-c-orange)"
          title="Plan variance" stat="—" sub="plan vs actual per account" />
        <Tile href="/workforce-planning" icon={<UsersIcon />} hue="var(--os-c-pink)"
          title="Workforce plan" stat="—" sub="headcount + salary budget" />
        <Tile href="/financials/calendar" icon={<Layers />} hue="var(--os-c-teal)"
          title="Accounting periods" stat="—" sub="fiscal calendar · close" />
      </div>
    </div>
  );
}

function Tile({ href, icon, hue, title, stat, sub }: { href: string; icon: React.ReactNode; hue: string; title: string; stat: string; sub: string }) {
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

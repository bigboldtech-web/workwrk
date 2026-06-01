"use client";

/* Analytics — cross-module insights hub.
 *
 * Pulls counts from key modules in parallel to surface the org's
 * operational pulse: tasks, headcount, expenses, POs, SOPs, time-off.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChartPie, TrendingUp, Users, Receipt, ShoppingCart, BookCopy, Plane, Briefcase,
  ChevronRight, Activity, Coins, Target,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type Counts = {
  tasks: number;
  tasksOpen: number;
  people: number;
  expenses: number;
  expensesPending: number;
  pos: number;
  posOpen: number;
  sops: number;
  timeoff: number;
  timeoffPending: number;
};

function safeLen(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  const d = data as { data?: unknown; items?: unknown };
  if (Array.isArray(d?.data)) return d.data.length;
  const items = (d?.data as { items?: unknown[] })?.items;
  if (Array.isArray(items)) return items.length;
  if (Array.isArray(d?.items)) return d.items.length;
  return 0;
}

function safeList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const d = data as { data?: unknown; items?: unknown };
  if (Array.isArray(d?.data)) return d.data as unknown[];
  const items = (d?.data as { items?: unknown[] })?.items;
  if (Array.isArray(items)) return items;
  if (Array.isArray(d?.items)) return d.items as unknown[];
  return [];
}

export default function AnalyticsPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const [tasksR, peopleR, expR, poR, sopR, toR] = await Promise.all([
        fetch("/api/tasks?limit=200").catch(() => null),
        fetch("/api/users?limit=200").catch(() => null),
        fetch("/api/expenses?scope=all&limit=200").catch(() => null),
        fetch("/api/purchase-orders?limit=200").catch(() => null),
        fetch("/api/sops?limit=200").catch(() => null),
        fetch("/api/time-off?limit=200").catch(() => null),
      ]);
      const j = async (r: Response | null) => r && r.ok ? await r.json() : null;
      const [tasksD, peopleD, expD, poD, sopD, toD] = await Promise.all([
        j(tasksR), j(peopleR), j(expR), j(poR), j(sopR), j(toR),
      ]);
      const tasks = safeList(tasksD) as { status?: string }[];
      const expenses = safeList(expD) as { status?: string }[];
      const pos = safeList(poD) as { status?: string }[];
      const timeoff = safeList(toD) as { status?: string }[];
      setCounts({
        tasks: tasks.length,
        tasksOpen: tasks.filter((t) => t.status !== "DONE" && t.status !== "done" && t.status !== "CANCELLED").length,
        people: safeLen(peopleD),
        expenses: expenses.length,
        expensesPending: expenses.filter((e) => e.status === "SUBMITTED").length,
        pos: pos.length,
        posOpen: pos.filter((p) => p.status !== "CLOSED" && p.status !== "REJECTED" && p.status !== "RECEIVED").length,
        sops: safeLen(sopD),
        timeoff: timeoff.length,
        timeoffPending: timeoff.filter((t) => t.status === "PENDING").length,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("analytics");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const loading = counts === null;

  const sections = useMemo(() => [
    {
      title: "Operations",
      Icon: Activity,
      tiles: [
        { href: "/tasks", Icon: Target, hue: "var(--os-c-indigo)", title: "Tasks", value: loading ? "…" : `${counts!.tasksOpen}`, sub: loading ? "" : `${counts!.tasks} total · ${counts!.tasksOpen} open` },
        { href: "/procurement/pos", Icon: ShoppingCart, hue: "var(--os-c-brown)", title: "Purchase orders", value: loading ? "…" : `${counts!.posOpen}`, sub: loading ? "" : `${counts!.pos} total · ${counts!.posOpen} open` },
        { href: "/expenses", Icon: Receipt, hue: "var(--os-c-orange)", title: "Expenses", value: loading ? "…" : `${counts!.expensesPending}`, sub: loading ? "" : `${counts!.expenses} total · ${counts!.expensesPending} pending` },
        { href: "/time-off", Icon: Plane, hue: "var(--os-c-blue)", title: "Time off", value: loading ? "…" : `${counts!.timeoffPending}`, sub: loading ? "" : `${counts!.timeoff} total · ${counts!.timeoffPending} pending` },
      ],
    },
    {
      title: "People & knowledge",
      Icon: Users,
      tiles: [
        { href: "/people", Icon: Users, hue: "var(--os-c-pink)", title: "Headcount", value: loading ? "…" : `${counts!.people}`, sub: "active users" },
        { href: "/sops", Icon: BookCopy, hue: "var(--os-c-teal)", title: "SOPs", value: loading ? "…" : `${counts!.sops}`, sub: "published library" },
        { href: "/sops/compliance", Icon: Activity, hue: "var(--os-c-red)", title: "Compliance", value: "Live", sub: "rates by dept" },
        { href: "/workforce-planning", Icon: TrendingUp, hue: "var(--os-c-purple)", title: "Workforce", value: "Plan", sub: "headcount + salary" },
      ],
    },
    {
      title: "Finance",
      Icon: Coins,
      tiles: [
        { href: "/financials", Icon: Coins, hue: "var(--os-c-green)", title: "Finance hub", value: "Books", sub: "GL · entries · periods" },
        { href: "/financials/reports", Icon: ChartPie, hue: "var(--os-c-pink)", title: "Reports", value: "—", sub: "P&L · BS · variance" },
        { href: "/financials/statements", Icon: Briefcase, hue: "var(--os-c-blue)", title: "Statements", value: "P&L · BS · CF", sub: "for any period" },
        { href: "/planning/variance", Icon: TrendingUp, hue: "var(--os-c-red)", title: "Variance", value: "Plan vs actual", sub: "monthly delta" },
      ],
    },
  ], [counts, loading]);

  return (
    <>
      <OsTitleBar
        title="Analytics"
        Icon={ChartPie}
        iconGradient={GRAD.pinkPurple}
        description={loading ? "Computing your pulse…" : `${counts!.tasksOpen} open tasks · ${counts!.expensesPending} expenses pending · ${counts!.timeoffPending} PTO requests`}
        actions={
          <div className="ana__head-actions">
            <Link href="/financials/reports" className="ana__nav-link"><ChartPie /> Reports</Link>
            <Link href="/planning/variance" className="ana__nav-link"><TrendingUp /> Variance</Link>
            <Link href="/sops/compliance" className="ana__nav-link"><Activity /> Compliance</Link>
          </div>
        }
      />

      <div className="ana">
        {error && (
          <div className="ana__error">{error}</div>
        )}

        {sections.map((s) => (
          <section key={s.title} className="ana__section">
            <header className="ana__section-head">
              <h2><s.Icon /> {s.title}</h2>
              <span className="ana__section-line" />
            </header>
            <div className="ana__grid">
              {s.tiles.map((t) => (
                <Link key={t.href} href={t.href} className="ana__tile" style={{ ["--tile-hue" as unknown as string]: t.hue }}>
                  <span className="ana__tile-icon"><t.Icon /></span>
                  <div className="ana__tile-body">
                    <div className="ana__tile-title">{t.title}</div>
                    <div className="ana__tile-value">{t.value}</div>
                    <div className="ana__tile-sub">{t.sub}</div>
                  </div>
                  <ChevronRight className="ana__tile-chev" />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}


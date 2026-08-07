// Shared Teams design-system tiles — one StatTile, one section Card, one avatar,
// one progress bar, one percent-color ramp. Every Teams page renders these
// instead of its own bespoke StatCard / KpiTile / Metric / bg-*-500/15 chip, so
// the section reads as one system. No "use client": pure + server-compatible, so
// server pages (the Overview landing) and client pages can both use them.

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function pctColor(pct: number): string {
  if (pct >= 90) return "#16a34a";
  if (pct >= 70) return "#0073EA";
  if (pct >= 50) return "#f59e0b";
  return "#dc2626";
}

export function TeamStatTile({ icon: Icon, label, value, sub, accent = "#0073EA", href }: {
  icon: LucideIcon; label: string; value: string | number; sub?: string; accent?: string; href?: string;
}) {
  const inner = (
    <div className="h-full rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-300 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${accent}1a` }}>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-zinc-900 tabular-nums">{value}</div>
      {sub ? <div className="text-[12px] text-zinc-400 mt-0.5">{sub}</div> : null}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

export function TeamCard({ title, subtitle, action, children, className }: {
  title?: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-zinc-200 bg-white p-4", className)}>
      {title || action ? (
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
            {subtitle ? <p className="text-[11.5px] text-zinc-400 mt-0.5">{subtitle}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function TeamAvatar({ name, avatar, size = 28 }: { name: string; avatar?: string | null; size?: number }) {
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatar} alt={name} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <span className="rounded-full bg-zinc-200 text-zinc-600 inline-flex items-center justify-center font-medium shrink-0" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initials}
    </span>
  );
}

export function TeamProgressBar({ pct, className }: { pct: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="h-1.5 flex-1 rounded-full bg-zinc-100 overflow-hidden min-w-[60px]">
        <span className="block h-full rounded-full" style={{ width: `${clamped}%`, background: pctColor(clamped) }} />
      </span>
      <span className="text-[11px] tabular-nums shrink-0" style={{ color: pctColor(clamped) }}>{clamped}%</span>
    </span>
  );
}

// A Teams page title-row: breadcrumb + icon-tile + title + right actions.
export function TeamHeader({ crumb, icon: Icon, accent = "#0073EA", title, count, actions }: {
  crumb?: string; icon: LucideIcon; accent?: string; title: string; count?: string; actions?: React.ReactNode;
}) {
  return (
    <div className="px-6 pt-4 pb-3">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
        <Link href="/team" className="hover:text-zinc-900">Teams</Link>
        {crumb ? (<><span className="text-zinc-300">/</span><span>{crumb}</span></>) : null}
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg shrink-0" style={{ background: `${accent}1a` }}>
          <Icon className="h-5 w-5" style={{ color: accent }} />
        </span>
        <h1 className="text-base font-semibold text-zinc-900 truncate">{title}</h1>
        {count ? <span className="text-xs text-zinc-400">{count}</span> : null}
        <div className="flex-1" />
        {actions}
      </div>
    </div>
  );
}

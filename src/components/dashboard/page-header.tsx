"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/ui/breadcrumbs";

type Tone = "violet" | "blue" | "amber" | "pink" | "emerald" | "lime";

const toneHex: Record<Tone, string> = {
  violet: "#7c3aed",
  blue: "#4a9eff",
  amber: "#ff9933",
  pink: "#ff3d8a",
  emerald: "#22c55e",
  // Legacy: existing pages still pass `kickerTone="lime"`. The CSS now
  // renders this as the violet bento mark so untouched callers inherit
  // the new accent without a code change.
  lime: "#7c3aed",
};

type HeaderAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  tone?: Tone;
  variant?: "primary" | "ghost";
  icon?: ReactNode;
};

export function PageHeader({
  kicker,
  kickerTone = "violet",
  breadcrumbs,
  title,
  subtitle,
  actions,
  stats,
}: {
  kicker?: string;
  kickerTone?: Tone;
  breadcrumbs?: BreadcrumbItem[];
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: HeaderAction[];
  /** Tiny inline stats rendered in the header (e.g. "142 people · 6 depts") */
  stats?: { label: string; value: ReactNode }[];
}) {
  return (
    <header className="dash-page-header">
      <div className="dash-page-header-text">
        {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
        {kicker && (
          <span className="dash-page-kicker">
            <span
              className={`dash-page-kicker-dot dash-page-kicker-dot--${kickerTone}`}
              style={{ background: toneHex[kickerTone] }}
            />
            {kicker}
          </span>
        )}
        <h1 className="dash-page-title">{title}</h1>
        {subtitle && <p className="dash-page-sub">{subtitle}</p>}
        {stats && stats.length > 0 && (
          <div className="dash-page-inline-stats">
            {stats.map((s, i) => (
              <span key={i} className="dash-page-inline-stat">
                <span className="dash-page-inline-stat-val">{s.value}</span>
                <span className="dash-page-inline-stat-label">{s.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      {actions && actions.length > 0 && (
        <div className="dash-page-actions">
          {actions.map((a, i) => {
            const className = `dash-action dash-action-${a.variant ?? "primary"}`;
            const content = (
              <>
                {a.icon && <span className="dash-action-icon">{a.icon}</span>}
                <span>{a.label}</span>
              </>
            );
            if (a.href) {
              return (
                <Link key={i} href={a.href} className={className}>
                  {content}
                </Link>
              );
            }
            return (
              <button key={i} type="button" onClick={a.onClick} className={className}>
                {content}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}

/* ==== Stat tile grid — consistent across dashboard pages ==== */

export function StatTileGrid({ children }: { children: ReactNode }) {
  return <div className="dash-stat-grid">{children}</div>;
}

export function StatTile({
  label,
  value,
  delta,
  tone = "violet",
  icon,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
}) {
  return (
    <div className="dash-stat-tile" style={{ ["--tone" as string]: toneHex[tone] } as React.CSSProperties}>
      <div className="dash-stat-tile-head">
        {icon && <span className="dash-stat-tile-icon">{icon}</span>}
        <span className="dash-stat-tile-label">{label}</span>
      </div>
      <div className="dash-stat-tile-value">{value}</div>
      {delta && <div className="dash-stat-tile-delta">{delta}</div>}
    </div>
  );
}

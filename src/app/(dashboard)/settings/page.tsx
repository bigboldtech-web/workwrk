"use client";

/* Settings hub — category card grid.
 *
 *  GET /api/settings   org profile + enabled modules + scoring weights +
 *                      security policy + usage counts.
 *
 * Replaces the previous "generic table" view with a card grid grouped
 * by area (Organization, Product, Scoring, Policies, Usage). Each
 * card surfaces 2-4 key values + an "Open" CTA that deep-links to the
 * sub-page that actually edits those fields.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  SlidersHorizontal, Building2, Boxes, Award, Shield, BarChart3,
  Tag, FileCheck, Key, Calendar as CalendarIcon, Users, BookOpen,
  Sparkles, ChevronRight, type LucideIcon,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiSettings = {
  organization?: { id: string; name: string; slug?: string | null; plan?: string | null; status?: string | null; domain?: string | null };
  settings?: {
    enabledModules?: string[];
    businessType?: string; industry?: string; teamSize?: string;
    timezone?: string; currency?: string; fiscalYearStart?: number;
    reviewFrequency?: string;
    scoreWeights?: Record<string, number>;
    scoringBands?: Array<{ label: string; min: number; max: number; color: string }>;
    notifications?: Record<string, unknown>;
    security?: { minPasswordLength?: number; requireUppercase?: boolean; requireNumbers?: boolean; sessionTimeout?: number; twoFactorEnabled?: boolean };
  };
  usage?: { users?: number; sops?: number; aiQueries?: number };
};

interface SettingsCard {
  href: string;
  title: string;
  description: string;
  Icon: LucideIcon;
  color: string;
  fields: Array<{ label: string; value: string }>;
}

export default function SettingsPage() {
  const [data, setData] = useState<ApiSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("settings");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const moduleCount = data?.settings?.enabledModules?.length ?? 0;
  const org = data?.organization;
  const set = data?.settings ?? {};
  const sec = set.security ?? {};
  const usage = data?.usage ?? {};

  const sections: Array<{ title: string; cards: SettingsCard[] }> = data ? [
    {
      title: "Organization",
      cards: [
        {
          href: "/settings/identity",
          title: "Identity & profile",
          description: "Name, slug, primary domain, contact info.",
          Icon: Building2, color: C.blue,
          fields: [
            { label: "Name", value: org?.name ?? "—" },
            { label: "Slug", value: org?.slug ?? "—" },
            { label: "Domain", value: org?.domain ?? "—" },
          ],
        },
        {
          href: "/settings",
          title: "Locale & finance",
          description: "Timezone, currency, fiscal year start.",
          Icon: CalendarIcon, color: C.teal,
          fields: [
            { label: "Timezone", value: set.timezone ?? "—" },
            { label: "Currency", value: set.currency ?? "—" },
            { label: "Fiscal start", value: set.fiscalYearStart ? `Month ${set.fiscalYearStart}` : "—" },
          ],
        },
        {
          href: "/settings",
          title: "Plan & billing",
          description: "Current subscription and billing details.",
          Icon: Award, color: C.purple,
          fields: [
            { label: "Plan", value: org?.plan ?? "Starter" },
            { label: "Status", value: org?.status ?? "Active" },
            { label: "Industry", value: set.industry ?? "—" },
          ],
        },
      ],
    },
    {
      title: "Product & integrations",
      cards: [
        {
          href: "/settings",
          title: "Enabled modules",
          description: "Turn WorkwrK apps on or off for your team.",
          Icon: Boxes, color: C.indigo,
          fields: [
            { label: "Active", value: `${moduleCount} modules` },
            { label: "Team size", value: set.teamSize ?? "—" },
          ],
        },
        {
          href: "/settings/tags",
          title: "Tags & labels",
          description: "Shared taxonomy across boards, tasks, and SOPs.",
          Icon: Tag, color: C.pink,
          fields: [{ label: "Manage", value: "Open" }],
        },
        {
          href: "/settings/api",
          title: "API keys",
          description: "Service tokens for webhooks and automations.",
          Icon: Key, color: C.green,
          fields: [{ label: "Manage", value: "Open" }],
        },
        {
          href: "/settings/calendar",
          title: "Calendar feeds",
          description: "Subscribe external calendars; publish org feeds.",
          Icon: CalendarIcon, color: C.orange,
          fields: [{ label: "Manage", value: "Open" }],
        },
      ],
    },
    {
      title: "Scoring & reviews",
      cards: [
        {
          href: "/settings/scoring",
          title: "Review cadence",
          description: "Weekly, monthly, quarterly & annual review rhythms.",
          Icon: Sparkles, color: C.pink,
          fields: [{ label: "Frequency", value: set.reviewFrequency ?? "Quarterly" }],
        },
        {
          href: "/settings/scoring",
          title: "Score weights",
          description: "Weight each metric for composite performance scoring.",
          Icon: BarChart3, color: C.purple,
          fields: set.scoreWeights
            ? Object.entries(set.scoreWeights).slice(0, 3).map(([k, v]) => ({ label: k, value: `${v}%` }))
            : [{ label: "Weights", value: "Default" }],
        },
        {
          href: "/settings/scoring",
          title: "Performance bands",
          description: "Ranges that map composite scores to labels (e.g. 'Strong').",
          Icon: Award, color: C.indigo,
          fields: [{ label: "Bands", value: `${set.scoringBands?.length ?? 0} configured` }],
        },
      ],
    },
    {
      title: "Security & compliance",
      cards: [
        {
          href: "/account/security",
          title: "Password policy",
          description: "Minimum length and character requirements.",
          Icon: Shield, color: C.red,
          fields: [
            { label: "Min length", value: `${sec.minPasswordLength ?? 8} chars` },
            { label: "Uppercase", value: sec.requireUppercase ? "Required" : "Optional" },
            { label: "Numbers", value: sec.requireNumbers ? "Required" : "Optional" },
          ],
        },
        {
          href: "/account/security",
          title: "Session & 2FA",
          description: "Idle timeout and two-factor enforcement.",
          Icon: Key, color: C.orange,
          fields: [
            { label: "Timeout", value: `${sec.sessionTimeout ?? 30} min` },
            { label: "2FA", value: sec.twoFactorEnabled ? "Required" : "Optional" },
          ],
        },
        {
          href: "/settings/audit",
          title: "Audit log",
          description: "Every privileged action across the workspace.",
          Icon: FileCheck, color: C.brown,
          fields: [{ label: "Open", value: "Audit log" }],
        },
      ],
    },
    {
      title: "Usage",
      cards: [
        {
          href: "/people",
          title: "People",
          description: "Active members and seats consumed.",
          Icon: Users, color: C.blue,
          fields: [{ label: "Active users", value: `${usage.users ?? 0}` }],
        },
        {
          href: "/sops",
          title: "Knowledge",
          description: "SOPs and docs across the workspace.",
          Icon: BookOpen, color: C.green,
          fields: [{ label: "Total SOPs", value: `${usage.sops ?? 0}` }],
        },
        {
          href: "/analytics",
          title: "AI usage",
          description: "Sidekick + agent queries this billing period.",
          Icon: Sparkles, color: C.purple,
          fields: [{ label: "AI queries", value: `${usage.aiQueries ?? 0}` }],
        },
      ],
    },
  ] : [];

  return (
    <>
      <OsTitleBar
        title="Settings"
        Icon={SlidersHorizontal}
        iconGradient={GRAD.bluePurple}
        description={data === null ? "Loading…" : `${org?.name ?? "Workspace"} · ${moduleCount} modules on · plan ${org?.plan ?? "—"}`}
        people={[PEOPLE.bb]}
        morePeople={0}
      />

      {loadError ? (
        <OsEmptyView Icon={SlidersHorizontal} iconGradient={GRAD.redPink} title="Couldn't load settings" subtitle={`API error: ${loadError}.`} cta="Retry" />
      ) : data === null ? (
        <div className="settings__loading">Loading settings…</div>
      ) : (
        <div className="settings">
          {sections.map((section) => (
            <section key={section.title} className="settings__section">
              <header className="settings__section-head">
                <h2>{section.title}</h2>
                <span className="settings__section-count">{section.cards.length}</span>
              </header>
              <div className="settings__grid">
                {section.cards.map((card) => (
                  <Link key={card.title + card.href} href={card.href} className="setcard">
                    <div className="setcard__head">
                      <span className="setcard__icon" style={{ background: `color-mix(in srgb, ${card.color} 14%, transparent)`, color: card.color }}>
                        <card.Icon />
                      </span>
                      <ChevronRight className="setcard__arrow" />
                    </div>
                    <h3 className="setcard__title">{card.title}</h3>
                    <p className="setcard__desc">{card.description}</p>
                    <div className="setcard__fields">
                      {card.fields.map((f) => (
                        <div key={f.label} className="setcard__field">
                          <span className="setcard__field-label">{f.label}</span>
                          <span className="setcard__field-value">{f.value}</span>
                        </div>
                      ))}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

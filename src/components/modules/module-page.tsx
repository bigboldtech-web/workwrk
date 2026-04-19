"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { Label, Reveal, SectionHeader } from "@/components/bento";
import {
  IconAccess,
  IconAi,
  IconAnalytics,
  IconIntegrations,
  IconKpi,
  IconKra,
  IconKudos,
  IconOkr,
  IconPeople,
  IconReviews,
  IconSop,
  IconTask,
} from "@/components/bento/module-icons";
import "./module-page.css";

/* ──────────────────────────────────────────────────────────────────────────
   Module page primitives — reusable across all 12 module deep-dive pages.
   Composition-first: each module page imports these pieces and arranges them
   in whatever order tells the best story for that module.

   Icons are passed as STRING KEYS (not component refs) so each page.tsx can
   remain a Server Component with metadata exports. Functions can't be
   serialized across the server→client boundary.
   ─────────────────────────────────────────────────────────────────────────── */

type Tone = "lime" | "pink" | "blue" | "amber";

const toneVar: Record<Tone, string> = {
  lime: "var(--b-lime)",
  pink: "var(--b-pink)",
  blue: "var(--b-blue)",
  amber: "var(--b-amber)",
};

export type ModuleIconKey =
  | "people"
  | "kpi"
  | "kra"
  | "sop"
  | "reviews"
  | "okr"
  | "tasks"
  | "kudos"
  | "ai"
  | "analytics"
  | "integrations"
  | "access";

const iconRegistry: Record<ModuleIconKey, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  people: IconPeople,
  kpi: IconKpi,
  kra: IconKra,
  sop: IconSop,
  reviews: IconReviews,
  okr: IconOkr,
  tasks: IconTask,
  kudos: IconKudos,
  ai: IconAi,
  analytics: IconAnalytics,
  integrations: IconIntegrations,
  access: IconAccess,
};

function ModuleIconByKey({
  iconKey,
  width = 16,
  height = 16,
}: {
  iconKey: ModuleIconKey;
  width?: number;
  height?: number;
}) {
  const Icon = iconRegistry[iconKey];
  return <Icon width={width} height={height} />;
}

/* ==== HERO ========================================================== */

type ModuleHeroProps = {
  eyebrow: string;
  moduleNumber: string;
  iconKey: ModuleIconKey;
  title: ReactNode;
  body: ReactNode;
  tone?: Tone;
  badges?: string[];
  visual?: ReactNode;
  primaryCta?: { href: string; label: string };
  secondaryCta?: { href: string; label: string };
};

export function ModuleHero({
  eyebrow,
  moduleNumber,
  iconKey,
  title,
  body,
  tone = "lime",
  badges = [],
  visual,
  primaryCta = { href: "/signup", label: "Start free trial →" },
  secondaryCta = { href: "/demo", label: "Book a live walkthrough" },
}: ModuleHeroProps) {
  return (
    <section className="bento-section" style={{ paddingTop: 64, paddingBottom: 48 }}>
      <div className="bento-container">
        <Reveal>
          <div className="mh-head">
            <span className="mh-eyebrow">
              <span className="mh-chip" style={{ color: toneVar[tone] }}>
                <ModuleIconByKey iconKey={iconKey} width={14} height={14} />
                {moduleNumber}
              </span>
              {eyebrow}
            </span>
          </div>
        </Reveal>
        <div className="mh-grid">
          <Reveal>
            <div className="mh-main">
              <h1 className="mh-title">{title}</h1>
              <p className="mh-body">{body}</p>
              {badges.length > 0 && (
                <div className="mh-badges">
                  {badges.map((b) => (
                    <span key={b} className="mh-badge">
                      {b}
                    </span>
                  ))}
                </div>
              )}
              <div className="mh-ctas">
                <Link href={primaryCta.href} className="bento-btn bento-btn-lime bento-btn-lg">
                  {primaryCta.label}
                </Link>
                <Link href={secondaryCta.href} className="bento-btn bento-btn-ghost bento-btn-lg">
                  {secondaryCta.label}
                </Link>
              </div>
            </div>
          </Reveal>
          {visual && (
            <Reveal>
              <div className="mh-visual">{visual}</div>
            </Reveal>
          )}
        </div>
      </div>
    </section>
  );
}

/* ==== SUB-FEATURE DEEP-DIVE ======================================== */

type DeepDiveProps = {
  eyebrow: string;
  title: ReactNode;
  body: ReactNode;
  visual?: ReactNode;
  visualSide?: "left" | "right";
  bullets?: string[];
  tone?: Tone;
  background?: "dark" | "carded";
  id?: string;
};

export function ModuleDeepDive({
  eyebrow,
  title,
  body,
  visual,
  visualSide = "right",
  bullets,
  tone = "lime",
  background = "dark",
  id,
}: DeepDiveProps) {
  return (
    <section
      id={id}
      className={`mdd mdd-${background}`}
      style={{ ["--c" as string]: toneVar[tone] } as React.CSSProperties}
    >
      <div className="bento-container">
        <Reveal>
          <div className={`mdd-grid mdd-${visualSide}`}>
            <div className="mdd-copy">
              <span className="bento-label" style={{ color: toneVar[tone] }}>
                {eyebrow}
              </span>
              <h3 className="mdd-title">{title}</h3>
              <div className="mdd-body">{body}</div>
              {bullets && bullets.length > 0 && (
                <ul className="mdd-bullets">
                  {bullets.map((b) => (
                    <li key={b}>
                      <span className="tick" style={{ color: toneVar[tone] }}>✓</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {visual && <div className="mdd-visual">{visual}</div>}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ==== REPLACES ===================================================== */

type ReplacesRow = { old: ReactNode; nu: ReactNode };

export function ModuleReplaces({
  title,
  rows,
}: {
  title: ReactNode;
  rows: ReplacesRow[];
}) {
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal>
          <SectionHeader
            label="What it replaces"
            title={title}
            subtitle="One module, on one spine, replaces the stack on the left. No sync jobs, no Zapier glue, no spreadsheet someone forgets to update."
            aside={{
              label: "Tools replaced",
              stat: rows.length.toString(),
              text: "Each replaced with a first-class module — not a lightweight imitation of it.",
            }}
          />
        </Reveal>
        <Reveal>
          <div className="mr-head">
            <div className="mr-col-label mr-old">The old way</div>
            <div />
            <div className="mr-col-label mr-new">On WorkwrK</div>
          </div>
        </Reveal>
        <div className="mr-rows">
          {rows.map((r, i) => (
            <Reveal key={i}>
              <div className="mr-row">
                <div className="mr-cell mr-old">
                  <span className="mr-bullet" />
                  {r.old}
                </div>
                <div className="mr-arrow" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="13 5 19 12 13 19" />
                  </svg>
                </div>
                <div className="mr-cell mr-new">
                  <span className="mr-bullet mr-bullet-new" />
                  {r.nu}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ==== CONNECTS ===================================================== */

type ConnectEntry = {
  name: string;
  flow: string;
  href: string;
  iconKey: ModuleIconKey;
};

export function ModuleConnects({
  title,
  subtitle,
  sourceName,
  entries,
}: {
  title: ReactNode;
  subtitle: string;
  sourceName: string;
  entries: ConnectEntry[];
}) {
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal>
          <SectionHeader
            label="Connected to the spine"
            title={title}
            subtitle={subtitle}
            aside={{
              label: "Modules it talks to",
              stat: entries.length.toString(),
              text: "Every write is a live signal into the rest of the system — not a nightly export.",
            }}
          />
        </Reveal>
        <Reveal stagger className="mc-grid">
          {entries.map((e) => (
            <Link key={e.name} href={e.href} className="mc-card">
              <div className="mc-head">
                <span className="mc-icon">
                  <ModuleIconByKey iconKey={e.iconKey} width={18} height={18} />
                </span>
                <span className="mc-from">{sourceName}</span>
                <span className="mc-arr" aria-hidden>→</span>
                <span className="mc-to">{e.name}</span>
              </div>
              <div className="mc-flow">{e.flow}</div>
            </Link>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ==== STATS ======================================================== */

type Stat = { stat: ReactNode; label: string; tone?: Tone };

export function ModuleStats({
  kicker,
  title,
  stats,
}: {
  kicker: string;
  title: ReactNode;
  stats: Stat[];
}) {
  return (
    <section className="bento-section" style={{ paddingTop: 48, paddingBottom: 48 }}>
      <div className="bento-container">
        <Reveal>
          <div className="ms-head">
            <Label>{kicker}</Label>
            <h2 className="ms-title">{title}</h2>
          </div>
        </Reveal>
        <Reveal stagger className="ms-grid">
          {stats.map((s, i) => (
            <div key={i} className="ms-card">
              <div className="ms-val" style={{ color: toneVar[s.tone ?? "lime"] }}>
                {s.stat}
              </div>
              <div className="ms-label">{s.label}</div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ==== FAQ ========================================================== */

export function ModuleFaq({
  title,
  items,
}: {
  title: ReactNode;
  items: { q: string; a: ReactNode }[];
}) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="bento-section">
      <div className="bento-container">
        <Reveal>
          <SectionHeader
            label="Frequently asked"
            title={title}
            subtitle="The specifics — honestly. No marketing hedging."
            aside={{
              label: "Plain answers",
              stat: items.length.toString(),
              text: "Still unsure? Email hi@workwrk.com — real humans answer within a working day.",
            }}
          />
        </Reveal>
        <div className="mf-list">
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={it.q}>
                <div className={`mf-item ${isOpen ? "is-open" : ""}`}>
                  <button
                    className="mf-q"
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                  >
                    <span>{it.q}</span>
                    <span className="mf-plus" aria-hidden>
                      <span className="mf-plus-h" />
                      <span className="mf-plus-v" />
                    </span>
                  </button>
                  <div className="mf-a" hidden={!isOpen}>
                    <div className="mf-a-inner">{it.a}</div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ==== CLOSING CTA ================================================== */

export function ModuleCta({
  title,
  subtitle,
  primary = { href: "/signup", label: "Start free trial →" },
  secondary = { href: "/demo", label: "Book a live walkthrough" },
  tone = "lime",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string };
  tone?: Tone;
}) {
  return (
    <section className="bento-section-cta">
      <div className="bento-container">
        <Reveal>
          <div className={`mcta mcta-${tone}`}>
            <h2 className="mcta-title">{title}</h2>
            {subtitle && <p className="mcta-sub">{subtitle}</p>}
            <div className="mcta-ctas">
              <Link href={primary.href} className="bento-btn bento-btn-lg mcta-primary">
                {primary.label}
              </Link>
              <Link href={secondary.href} className="bento-btn bento-btn-lg mcta-ghost">
                {secondary.label}
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ==== ANCHOR JUMP NAV ============================================== */

export function ModuleAnchorNav({
  items,
}: {
  items: { id: string; label: string; tone?: Tone }[];
}) {
  return (
    <nav className="man" aria-label="Module sub-sections">
      <div className="bento-container">
        <div className="man-row">
          <span className="man-label">Jump to</span>
          <div className="man-links">
            {items.map((it) => (
              <a
                key={it.id}
                href={`#${it.id}`}
                className="man-link"
                style={{ color: toneVar[it.tone ?? "lime"] }}
              >
                {it.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}

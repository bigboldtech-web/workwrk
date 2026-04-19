"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Reveal } from "@/components/bento";
import { useCurrency } from "@/components/layout/currency-provider";

type Mode = "per-user" | "flat";

type Tier = {
  key: string;
  name: string;
  priceUsd: number | null;
  priceLabel?: string;
  period: string;
  meta: string;
  description: string;
  cta: string;
  href: string;
  features: string[];
  recommended?: boolean;
};

const perUserTiers: Tier[] = [
  {
    key: "pu-starter",
    name: "Starter",
    priceUsd: 0,
    period: "forever",
    meta: "up to 10 users · always free",
    description: "Everything a small team needs to get structured. Free forever.",
    cta: "Start free",
    href: "/signup",
    features: [
      "People · KRAs · KPIs · Tasks",
      "Up to 10 SOPs",
      "Monthly pulse reviews",
      "Kudos + recognition feed",
      "Community support",
    ],
  },
  {
    key: "pu-growth",
    name: "Growth",
    priceUsd: 4,
    period: "per user / month",
    meta: "pay only for active users",
    description: "All 12 modules. AI-drafted KRAs, Scribe, full scoring.",
    cta: "Start 14-day trial",
    href: "/signup",
    recommended: true,
    features: [
      "All 12 modules · unlimited records",
      "AI Engine · Scribe SOP extraction",
      "360° reviews · composite scoring",
      "40+ native integrations · webhooks",
      "Priority support · Slack channel",
    ],
  },
  {
    key: "pu-enterprise",
    name: "Enterprise",
    priceUsd: null,
    priceLabel: "Let's talk",
    period: "custom",
    meta: "for 200+ seats",
    description: "SSO / SAML, dedicated region, audit exports, 99.9% SLA.",
    cta: "Contact sales",
    href: "/contact",
    features: [
      "SSO · SAML · SCIM",
      "Field-level audit exports",
      "Dedicated data residency",
      "99.9% uptime SLA",
      "Named customer success",
    ],
  },
];

const flatTiers: Tier[] = [
  {
    key: "fl-starter",
    name: "Starter",
    priceUsd: 0,
    period: "forever",
    meta: "up to 10 users · always free",
    description: "The basics — people, KRAs, KPIs, and tasks. On us, forever.",
    cta: "Start free",
    href: "/signup",
    features: [
      "People · KRAs · KPIs · Tasks",
      "Up to 10 SOPs",
      "Monthly pulse reviews",
      "Community support",
    ],
  },
  {
    key: "fl-team",
    name: "Team",
    priceUsd: 50,
    period: "/ month",
    meta: "up to 25 users · flat monthly",
    description: "The whole spine for a tight team — no per-seat math.",
    cta: "Start 14-day trial",
    href: "/signup",
    features: [
      "All 12 modules · unlimited records",
      "Up to 25 users · flat pricing",
      "AI Engine · 500 queries / month",
      "10+ native integrations",
      "Email + Slack support",
    ],
  },
  {
    key: "fl-growth",
    name: "Growth",
    priceUsd: 150,
    period: "/ month",
    meta: "up to 100 users · flat monthly",
    description: "AI unlocked. Scale+ integrations. Fairer math for scaling teams.",
    cta: "Start 14-day trial",
    href: "/signup",
    recommended: true,
    features: [
      "Everything in Team",
      "Up to 100 users · flat pricing",
      "AI Engine · 5,000 queries / month",
      "40+ integrations · webhooks",
      "Priority support",
    ],
  },
  {
    key: "fl-scale",
    name: "Scale",
    priceUsd: 300,
    period: "/ month",
    meta: "up to 500 users · flat monthly",
    description: "Multi-location clarity. Unlimited AI. Full analytics warehouse.",
    cta: "Start 14-day trial",
    href: "/signup",
    features: [
      "Everything in Growth",
      "Up to 500 users · flat pricing",
      "AI Engine · unlimited queries",
      "Snowflake / BigQuery warehouse sync",
      "Dedicated CSM · quarterly review",
    ],
  },
];

function formatUsdRaw(n: number, format: (n: number) => string): string {
  if (n === 0) return "Free";
  return format(n);
}

export function PricingPlans({
  heading,
  subtitle,
  defaultMode = "per-user",
}: {
  heading?: ReactNode;
  subtitle?: ReactNode;
  defaultMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const { formatFromUSD, currency } = useCurrency();

  const tiers = mode === "per-user" ? perUserTiers : flatTiers;

  return (
    <div className="pp-wrap">
      {(heading || subtitle) && (
        <div className="pp-head">
          {heading && <Reveal><h2 className="pp-heading">{heading}</h2></Reveal>}
          {subtitle && <Reveal><p className="pp-sub">{subtitle}</p></Reveal>}
        </div>
      )}

      <Reveal>
        <div className="pp-toggle" role="tablist" aria-label="Pricing model">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "per-user"}
            className={`pp-toggle-btn${mode === "per-user" ? " is-active" : ""}`}
            onClick={() => setMode("per-user")}
          >
            Per user
            <span className="pp-toggle-sub">pay only for active seats</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "flat"}
            className={`pp-toggle-btn${mode === "flat" ? " is-active" : ""}`}
            onClick={() => setMode("flat")}
          >
            Flat monthly
            <span className="pp-toggle-sub">fixed price per tier</span>
          </button>
        </div>
      </Reveal>

      <div className={`pp-grid pp-grid-${tiers.length}`}>
        {tiers.map((t) => (
          <Reveal key={t.key}>
            <article className={`pp-card${t.recommended ? " pp-card-rec" : ""}`}>
              {t.recommended && <span className="pp-badge">Recommended</span>}
              <div className="pp-name">{t.name}</div>
              <div className="pp-price">
                {t.priceUsd !== null ? (
                  <>
                    <span className="pp-price-val">
                      {formatUsdRaw(t.priceUsd, formatFromUSD)}
                    </span>
                    <span className="pp-price-period">
                      {t.priceUsd === 0 ? ` · ${t.period}` : ` ${t.period}`}
                    </span>
                  </>
                ) : (
                  <span className="pp-price-val pp-price-custom">{t.priceLabel}</span>
                )}
              </div>
              <div className="pp-meta">{t.meta}</div>
              <p className="pp-desc">{t.description}</p>
              <ul className="pp-features">
                {t.features.map((f) => (
                  <li key={f}>
                    <span className="pp-check" aria-hidden>✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={t.href}
                className={`bento-btn pp-cta${t.recommended ? " pp-cta-rec" : " bento-btn-ghost"}`}
              >
                {t.cta} <span className="arr">→</span>
              </Link>
            </article>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <div className="pp-foot">
          All prices shown in <strong>{currency}</strong>, converted from USD at
          indicative rates — final pricing confirmed at checkout. GST / VAT where
          applicable. Switch currency via the globe menu in the nav.
        </div>
      </Reveal>

      <style jsx>{`
        .pp-wrap { display: flex; flex-direction: column; }
        .pp-head { text-align: center; margin-bottom: 28px; }
        .pp-heading {
          font-size: clamp(36px, 5vw, 64px);
          font-weight: 600; letter-spacing: -0.04em;
          line-height: 1; margin: 0 0 14px;
        }
        .pp-heading :global(.hi) { color: var(--b-lime); }
        .pp-sub {
          font-size: 17px;
          color: var(--b-t2);
          line-height: 1.55;
          max-width: 60ch;
          margin: 0 auto;
        }

        .pp-toggle {
          align-self: center;
          display: inline-flex;
          padding: 6px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 100px;
          gap: 4px;
          margin-bottom: 40px;
        }
        .pp-toggle-btn {
          padding: 10px 22px;
          border: 0;
          background: transparent;
          color: var(--b-t2);
          font-family: inherit;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          border-radius: 100px;
          display: inline-flex; flex-direction: column; align-items: center;
          line-height: 1.2;
          gap: 3px;
          transition: all 0.25s;
        }
        .pp-toggle-btn:hover { color: var(--b-fg); }
        .pp-toggle-btn.is-active {
          background: var(--b-lime);
          color: var(--b-bg);
          box-shadow: 0 6px 16px -6px rgba(212, 255, 46, 0.5);
        }
        .pp-toggle-sub {
          font-family: var(--font-geist-mono), monospace;
          font-size: 9.5px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          opacity: 0.7;
        }
        .pp-toggle-btn.is-active .pp-toggle-sub { opacity: 0.7; }

        .pp-grid {
          display: grid;
          gap: 14px;
          align-items: stretch;
        }
        .pp-grid-3 { grid-template-columns: repeat(3, 1fr); }
        .pp-grid-4 { grid-template-columns: repeat(4, 1fr); }
        .pp-card {
          position: relative;
          padding: 32px 28px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          display: flex; flex-direction: column;
          gap: 14px;
          transition: transform 0.3s, border-color 0.3s, box-shadow 0.3s;
          height: 100%;
        }
        .pp-card:hover {
          transform: translateY(-3px);
          border-color: var(--b-line-2);
        }
        .pp-card-rec {
          background: var(--b-lime);
          color: var(--b-bg);
          border-color: transparent;
        }
        .pp-card-rec:hover {
          box-shadow: var(--b-shadow-lime);
        }
        .pp-badge {
          position: absolute;
          top: -14px;
          right: 24px;
          padding: 6px 14px;
          border-radius: 100px;
          background: var(--b-bg);
          color: var(--b-lime);
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          font-weight: 600;
        }
        .pp-name {
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          color: var(--b-t2);
        }
        .pp-card-rec .pp-name { color: rgba(0, 0, 0, 0.55); }
        .pp-price {
          display: flex;
          align-items: baseline;
          gap: 4px;
          flex-wrap: wrap;
          margin-top: 4px;
        }
        .pp-price-val {
          font-family: var(--font-geist), sans-serif;
          font-size: 52px;
          font-weight: 700;
          line-height: 1;
          letter-spacing: -0.045em;
          font-variant-numeric: tabular-nums;
        }
        .pp-price-custom { font-size: 30px; }
        .pp-price-period {
          font-size: 13px;
          color: var(--b-t2);
          font-weight: 500;
        }
        .pp-card-rec .pp-price-period { color: rgba(0, 0, 0, 0.7); }
        .pp-meta {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--b-t3);
        }
        .pp-card-rec .pp-meta { color: rgba(0, 0, 0, 0.6); }
        .pp-desc {
          font-size: 14.5px;
          color: var(--b-t2);
          line-height: 1.55;
          margin: 0;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--b-line);
        }
        .pp-card-rec .pp-desc {
          color: rgba(0, 0, 0, 0.8);
          border-bottom-color: rgba(0, 0, 0, 0.15);
        }
        .pp-features {
          list-style: none;
          margin: 0; padding: 0;
          display: flex; flex-direction: column;
          gap: 8px;
          flex: 1;
        }
        .pp-features li {
          font-size: 13.5px;
          display: grid;
          grid-template-columns: 16px 1fr;
          gap: 10px;
          align-items: start;
          color: var(--b-off);
          line-height: 1.45;
        }
        .pp-card-rec .pp-features li { color: var(--b-bg); }
        .pp-check { color: var(--b-lime); font-weight: 700; }
        .pp-card-rec .pp-check { color: var(--b-bg); font-weight: 700; }
        .pp-cta {
          margin-top: auto;
          justify-content: center;
          width: 100%;
        }
        .pp-cta-rec {
          background: var(--b-bg);
          color: var(--b-lime);
          border: 1px solid var(--b-bg);
        }
        .pp-cta-rec:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.4);
        }
        .pp-foot {
          margin-top: 40px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          color: var(--b-t3);
          text-align: center;
          letter-spacing: 0.04em;
          line-height: 1.55;
        }
        .pp-foot strong {
          color: var(--b-lime);
          font-weight: 700;
          letter-spacing: 0.08em;
        }
        @media (max-width: 1100px) {
          .pp-grid-4 { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 900px) {
          .pp-grid-3 { grid-template-columns: 1fr; }
          .pp-grid-4 { grid-template-columns: 1fr; }
          .pp-toggle-btn { padding: 8px 16px; }
        }
      `}</style>
    </div>
  );
}

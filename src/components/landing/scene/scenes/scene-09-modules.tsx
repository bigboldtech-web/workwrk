"use client";

import Link from "next/link";
import { Reveal } from "@/components/bento/reveal";
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
import { Scene } from "../scene";

type Mod = {
  num: string;
  name: string;
  meta: string;
  href: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const modules: Mod[] = [
  { num: "01", name: "People", meta: "Org graph · RBAC", href: "/features/people", Icon: IconPeople },
  { num: "02", name: "KPIs", meta: "Live per-role metrics", href: "/features/kpis", Icon: IconKpi },
  { num: "03", name: "KRAs", meta: "AI-drafted in 10 min", href: "/features/kras", Icon: IconKra },
  { num: "04", name: "SOPs", meta: "Written · Recorded · Flows", href: "/features/sops", Icon: IconSop },
  { num: "05", name: "Reviews", meta: "48-hour cycles", href: "/features/reviews", Icon: IconReviews },
  { num: "06", name: "OKRs", meta: "Cascaded by quarter", href: "/features/okrs", Icon: IconOkr },
  { num: "07", name: "Tasks", meta: "Auto-escalating", href: "/features/tasks", Icon: IconTask },
  { num: "08", name: "Kudos", meta: "Peer recognition", href: "/features/kudos", Icon: IconKudos },
  { num: "09", name: "AI Engine", meta: "Reasons over your org", href: "/features/ai-engine", Icon: IconAi },
  { num: "10", name: "Analytics", meta: "Exports · SQL-friendly", href: "/features/analytics", Icon: IconAnalytics },
  { num: "11", name: "Integrations", meta: "40+ native connectors", href: "/features/integrations", Icon: IconIntegrations },
  { num: "12", name: "Access", meta: "RBAC · GDPR-ready", href: "/features/access", Icon: IconAccess },
];

export function SceneModules() {
  return (
    <Scene id="modules">
      <Reveal>
        <div className="scene-kicker">The full system · 12 modules, one spine</div>
      </Reveal>
      <Reveal>
        <h2 className="scene-headline">
          Everything your business runs on.
          <br />
          <span className="hi">Finally connected.</span>
        </h2>
      </Reveal>

      <Reveal stagger className="mod-grid">
        {modules.map((m) => (
          <Link key={m.num} href={m.href} className="mod-card" aria-label={`${m.name} — ${m.meta}`}>
            <div className="mod-card-head">
              <span className="mod-icon-wrap">
                <m.Icon width={20} height={20} />
              </span>
              <span className="mod-num">{m.num}</span>
            </div>
            <div className="mod-card-body">
              <div className="mod-name">{m.name}</div>
              <div className="mod-meta">{m.meta}</div>
            </div>
          </Link>
        ))}
      </Reveal>

      <style jsx>{`
        :global(.mod-grid) {
          margin-top: 64px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          grid-auto-rows: 220px;
          gap: 16px;
        }
        :global(.mod-card) {
          padding: 28px 26px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-md);
          transition: transform 0.3s, border-color 0.3s;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          height: 100%;
          box-sizing: border-box;
          text-decoration: none;
          color: inherit;
        }
        :global(.mod-card):hover {
          transform: translateY(-3px);
          border-color: var(--b-line-2);
        }
        .mod-card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .mod-icon-wrap {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: var(--b-card-3);
          border: 1px solid var(--b-line);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--b-lime);
        }
        .mod-num {
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          letter-spacing: 0.08em;
          color: var(--b-t3);
          font-weight: 500;
        }
        .mod-card-body {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .mod-name {
          font-size: 22px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: var(--b-fg);
          line-height: 1.2;
        }
        .mod-meta {
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--b-t2);
          line-height: 1.3;
        }
        @media (max-width: 1000px) {
          :global(.mod-grid) {
            grid-template-columns: repeat(3, 1fr);
          }
        }
        @media (max-width: 720px) {
          :global(.mod-grid) {
            grid-template-columns: repeat(2, 1fr);
            grid-auto-rows: 200px;
          }
        }
        @media (max-width: 440px) {
          :global(.mod-grid) {
            grid-template-columns: 1fr;
            grid-auto-rows: auto;
          }
          .mod-card { min-height: 180px; }
        }
      `}</style>
    </Scene>
  );
}

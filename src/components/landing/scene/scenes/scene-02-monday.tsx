"use client";

import type { SVGProps } from "react";
import { Reveal } from "@/components/bento/reveal";
import { Scene } from "../scene";

const iconBase: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  width: 22,
  height: 22,
};

function IconInvisible(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...p}>
      <path d="M3 12s3.5-6 9-6c2 0 3.7.8 5 1.8" />
      <path d="M21 12s-3.5 6-9 6c-2 0-3.7-.8-5-1.8" />
      <path d="M10.5 10.5a2 2 0 0 0 2.8 2.8" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

function IconHeads(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...p}>
      <circle cx="6" cy="8" r="2.4" />
      <circle cx="12" cy="6" r="2.4" />
      <circle cx="18" cy="8" r="2.4" />
      <path d="M3 20c.5-2.5 2-4 3-4M21 20c-.5-2.5-2-4-3-4M9 20c.5-3 2-4.5 3-4.5s2.5 1.5 3 4.5" />
    </svg>
  );
}

function IconTools(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...p}>
      <rect x="3" y="3" width="6" height="6" rx="1.2" />
      <rect x="15" y="3" width="6" height="6" rx="1.2" />
      <rect x="3" y="15" width="6" height="6" rx="1.2" />
      <rect x="15" y="15" width="6" height="6" rx="1.2" />
      <path d="M11 6h2M11 18h2M6 11v2M18 11v2" />
    </svg>
  );
}

function IconBrokenChain(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...p}>
      <path d="M10 13a4 4 0 0 1 0-5.7l1.4-1.4a4 4 0 0 1 5.7 5.7L16 12.7" />
      <path d="M14 11a4 4 0 0 1 0 5.7l-1.4 1.4a4 4 0 0 1-5.7-5.7L8 11.3" />
      <path d="m3 3 2 2M3 8h2M8 3v2" />
    </svg>
  );
}

function IconBottleneck(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...p}>
      <path d="M5 4h14l-5.5 7 5.5 9H5l5.5-9z" />
      <path d="M10.5 11h3" />
    </svg>
  );
}

function IconNoMedal(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...p}>
      <circle cx="12" cy="14" r="5" />
      <path d="M8 9 5 3h4l3 5M16 9l3-6h-4l-3 5" />
      <path d="m9.5 11.5 5 5M14.5 11.5l-5 5" />
    </svg>
  );
}

type Pain = {
  Icon: (p: SVGProps<SVGSVGElement>) => React.ReactElement;
  title: string;
  body: string;
};

const pains: Pain[] = [
  {
    Icon: IconInvisible,
    title: "Invisible performance",
    body: "No idea who's carrying the team until someone resigns. Promotions become arguments.",
  },
  {
    Icon: IconHeads,
    title: "Process lives in three heads",
    body: "Tribal knowledge never written down. When one person leaves, the playbook leaves with them.",
  },
  {
    Icon: IconTools,
    title: "Fifteen tools. Zero clarity.",
    body: "Slack, Drive, Excel, Notion, Monday, HRMS, WhatsApp. Nothing talks. Nothing aligns.",
  },
  {
    Icon: IconBrokenChain,
    title: "No accountability chain",
    body: "Tasks in DMs. Decisions in email. Commitments in meetings. When it breaks, nobody owns it.",
  },
  {
    Icon: IconBottleneck,
    title: "The founder is the bottleneck",
    body: "Every decision routes through one person. Nobody else sees the full picture of the business.",
  },
  {
    Icon: IconNoMedal,
    title: "Recognition doesn't exist",
    body: "Great work goes unnoticed. No culture of appreciation. Top performers feel invisible — and have options.",
  },
];

export function SceneMonday() {
  return (
    <Scene id="why">
      <Reveal>
        <div className="scene-kicker">A Monday you didn&apos;t see coming</div>
      </Reveal>
      <Reveal>
        <h2 className="scene-headline">
          9:47 AM. Your top performer <span className="pk">just resigned.</span>
          <br />
          You had no signal.
        </h2>
      </Reveal>
      <Reveal>
        <p className="scene-sub">
          Your business is stitched together with WhatsApp, Google Drive, spreadsheets, and
          hope. Signals are buried. Performance is invisible. Process lives in three
          people&apos;s heads. Then one of them quits on a Monday morning.
        </p>
      </Reveal>

      <div className="monday-grid">
        {pains.map((p) => (
          <Reveal key={p.title}>
            <div className="monday-card">
              <span className="monday-icon-wrap" aria-hidden>
                <p.Icon />
              </span>
              <h3 className="monday-card-title">{p.title}</h3>
              <p className="monday-card-body">{p.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <style jsx>{`
        .monday-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          margin-top: 64px;
        }
        .monday-card {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 36px 32px;
          border-radius: var(--b-r-lg);
          background: var(--b-card);
          border: 1px solid var(--b-line);
          transition: transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1),
            border-color 0.3s;
          min-height: 240px;
        }
        .monday-card:hover {
          transform: translateY(-3px);
          border-color: var(--b-line-2);
        }
        .monday-icon-wrap {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          background: var(--b-card-3);
          border: 1px solid var(--b-line);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--b-lime);
          transition: transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1),
            background 0.3s, border-color 0.3s;
        }
        .monday-card:hover .monday-icon-wrap {
          background: var(--b-lime);
          border-color: var(--b-lime);
          color: var(--b-bg);
          transform: translateY(-2px);
        }
        .monday-card-title {
          font-size: 22px;
          font-weight: 600;
          margin: 4px 0 0;
          letter-spacing: -0.02em;
          line-height: 1.15;
          color: var(--b-fg);
        }
        .monday-card-body {
          font-size: 15px;
          color: var(--b-t2);
          line-height: 1.55;
          margin: 0;
        }
        @media (max-width: 1000px) {
          .monday-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 640px) {
          .monday-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Scene>
  );
}

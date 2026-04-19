"use client";

import { Reveal } from "@/components/bento/reveal";
import { Scene } from "../scene";

const pillars = [
  {
    title: "GDPR & CCPA",
    body: "Per-region consent tracking, data export & deletion, Do-Not-Sell, policy versioning.",
  },
  {
    title: "SSO & SAML",
    body: "Google Workspace, Microsoft 365, Okta. SCIM provisioning on Scale+.",
  },
  {
    title: "Field-level RBAC",
    body: "Every read and write is audited with IP and user agent. Eight access tiers out of the box.",
  },
  {
    title: "Data residency",
    body: "Hosted on compliant, region-aware infrastructure. EU, India, US regions.",
  },
];

export function SceneCompliance() {
  return (
    <Scene id="compliance">
      <Reveal>
        <div className="scene-kicker">Compliance, quietly</div>
      </Reveal>
      <Reveal>
        <h2 className="scene-headline">
          Built like your <span className="hi">auditor is watching.</span>
        </h2>
      </Reveal>
      <Reveal>
        <p className="scene-sub">
          No afterthought. Consent, audit log, RBAC and data export are first-class. We don&apos;t
          sell security as a tier — we ship it in the floor of the product.
        </p>
      </Reveal>

      <div className="comp-grid">
        {pillars.map((p, i) => (
          <Reveal key={p.title}>
            <div className="comp-card">
              <span className="comp-num">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="comp-title">{p.title}</h3>
              <p className="comp-body">{p.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <style jsx>{`
        .comp-grid {
          margin-top: 64px;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }
        .comp-card {
          padding: 36px 32px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          transition: transform 0.3s, border-color 0.3s;
          min-height: 200px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .comp-card:hover {
          transform: translateY(-3px);
          border-color: var(--b-line-2);
        }
        .comp-num {
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          color: var(--b-lime);
          letter-spacing: 0.08em;
        }
        .comp-title {
          font-size: 26px;
          font-weight: 600;
          letter-spacing: -0.02em;
          margin: 0;
          line-height: 1.15;
        }
        .comp-body {
          font-size: 17px;
          color: var(--b-t2);
          line-height: 1.55;
          margin: 0;
        }
        @media (max-width: 720px) {
          .comp-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Scene>
  );
}

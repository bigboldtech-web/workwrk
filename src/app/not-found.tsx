import type { Metadata } from "next";
import Link from "next/link";
import { BentoRoot } from "@/components/bento/bento-root";

export const metadata: Metadata = {
  title: "Not found — WorkwrK",
  description: "This page doesn't exist. Head home or jump back into the product.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <BentoRoot>
      <div className="nf-shell">
        <div className="nf-bg" aria-hidden>
          <span className="nf-glow nf-glow-lime" />
          <span className="nf-glow nf-glow-blue" />
        </div>

        <main className="nf-main">
          <Link href="/" className="nf-brand" aria-label="WorkwrK home">
            <span className="nf-dot" />
            workwrk
          </Link>

          <div className="nf-badge">
            <span className="nf-badge-dot" />
            HTTP 404
          </div>

          <h1 className="nf-title">
            This page isn&apos;t <span className="nf-hi">on the spine.</span>
          </h1>

          <p className="nf-sub">
            The link you followed might be wrong, the page might have moved, or
            we&apos;re still drafting it. Here&apos;s where you can actually go:
          </p>

          <div className="nf-grid">
            <Link href="/" className="nf-card">
              <span className="nf-card-label">Homepage</span>
              <span className="nf-card-title">See the system →</span>
              <span className="nf-card-sub">The full product walkthrough</span>
            </Link>
            <Link href="/features" className="nf-card">
              <span className="nf-card-label">Features</span>
              <span className="nf-card-title">12 modules →</span>
              <span className="nf-card-sub">People, KRAs, SOPs, AI, everything</span>
            </Link>
            <Link href="/pricing" className="nf-card">
              <span className="nf-card-label">Pricing</span>
              <span className="nf-card-title">Plans + pricing →</span>
              <span className="nf-card-sub">Per-user or flat monthly</span>
            </Link>
            <Link href="/demo" className="nf-card">
              <span className="nf-card-label">Demo</span>
              <span className="nf-card-title">Book a call →</span>
              <span className="nf-card-sub">30-minute live walkthrough</span>
            </Link>
          </div>

          <div className="nf-ctas">
            <Link href="/" className="bento-btn bento-btn-lime bento-btn-lg">
              Take me home →
            </Link>
            <Link href="/contact" className="bento-btn bento-btn-ghost bento-btn-lg">
              Report a broken link
            </Link>
          </div>
        </main>

        <style>{`
          .nf-shell {
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 48px 24px;
            background: #0a0a0a;
            position: relative;
            overflow: hidden;
          }
          .nf-bg {
            position: absolute; inset: 0;
            pointer-events: none;
            z-index: 0;
          }
          .nf-glow {
            position: absolute;
            border-radius: 50%;
            filter: blur(120px);
          }
          .nf-glow-lime {
            top: -20%; left: -10%;
            width: 520px; height: 520px;
            background: radial-gradient(circle, rgba(212,255,46,0.2), transparent 70%);
          }
          .nf-glow-blue {
            bottom: -25%; right: -15%;
            width: 620px; height: 620px;
            background: radial-gradient(circle, rgba(74,158,255,0.14), transparent 70%);
          }
          .nf-main {
            position: relative;
            z-index: 1;
            width: 100%;
            max-width: 840px;
            text-align: center;
          }
          .nf-brand {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            font-size: 22px;
            font-weight: 700;
            letter-spacing: -0.04em;
            color: #fafafa;
            text-decoration: none;
            margin-bottom: 40px;
          }
          .nf-dot {
            width: 14px; height: 14px;
            border-radius: 4px;
            background: #d4ff2e;
            box-shadow: 0 0 14px #d4ff2e;
            animation: bentoBrandPulse 3s ease-in-out infinite;
          }
          .nf-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 14px;
            background: rgba(255, 61, 138, 0.08);
            border: 1px solid rgba(255, 61, 138, 0.3);
            color: #ff3d8a;
            border-radius: 100px;
            font-family: var(--font-geist-mono), monospace;
            font-size: 11px;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            margin-bottom: 24px;
          }
          .nf-badge-dot {
            width: 6px; height: 6px;
            border-radius: 50%;
            background: #ff3d8a;
            box-shadow: 0 0 6px #ff3d8a;
          }
          .nf-title {
            font-size: clamp(44px, 7vw, 84px);
            font-weight: 600;
            letter-spacing: -0.045em;
            line-height: 0.98;
            margin: 0 0 20px;
            color: #fafafa;
            max-width: 14ch;
            margin-left: auto;
            margin-right: auto;
          }
          .nf-hi { color: #d4ff2e; }
          .nf-sub {
            font-size: 17px;
            color: #a0a0a0;
            line-height: 1.55;
            margin: 0 auto 40px;
            max-width: 52ch;
          }
          .nf-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
            margin-bottom: 40px;
            text-align: left;
          }
          .nf-card {
            padding: 22px 24px;
            background: #141414;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 16px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            text-decoration: none;
            transition: all 0.25s cubic-bezier(0.2,0.9,0.3,1);
          }
          .nf-card:hover {
            transform: translateY(-3px);
            border-color: rgba(212, 255, 46, 0.3);
            background: #1a1a1a;
          }
          .nf-card-label {
            font-family: var(--font-geist-mono), monospace;
            font-size: 10.5px;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: #707070;
          }
          .nf-card:hover .nf-card-label { color: #d4ff2e; }
          .nf-card-title {
            font-size: 17px;
            font-weight: 600;
            letter-spacing: -0.02em;
            color: #fafafa;
          }
          .nf-card-sub {
            font-size: 13px;
            color: #a0a0a0;
            line-height: 1.4;
          }
          .nf-ctas {
            display: inline-flex;
            gap: 10px;
            flex-wrap: wrap;
            justify-content: center;
          }

          @media (max-width: 640px) {
            .nf-grid { grid-template-columns: 1fr; }
            .nf-title { font-size: 40px; }
          }
        `}</style>
      </div>
    </BentoRoot>
  );
}

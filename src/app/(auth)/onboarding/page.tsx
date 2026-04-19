"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Sparkles,
  Users,
  Target,
  BookOpen,
  Star,
  Heart,
} from "lucide-react";

type Focus = "ic" | "manager" | "founder";

const focusOptions: { key: Focus; label: string; body: string; modules: string[] }[] = [
  {
    key: "ic",
    label: "I'm doing the work",
    body: "You'll live in Tasks, KPIs, and SOPs. We'll surface your goals, what's due this week, and kudos you've received.",
    modules: ["Tasks", "My KRAs", "SOPs", "Kudos"],
  },
  {
    key: "manager",
    label: "I lead a team",
    body: "You'll spend most time in People, Reviews, and the AI Engine. We'll pre-open the dashboards for your directs.",
    modules: ["People", "Reviews", "Analytics", "AI Engine"],
  },
  {
    key: "founder",
    label: "I run the company",
    body: "You'll see company OKRs, composite scoring, and signals the AI surfaces (attrition risk, drift, wins).",
    modules: ["OKRs", "Analytics", "AI Engine", "KRAs"],
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [step, setStep] = useState(0);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [firstName, setFirstName] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const name = (session?.user as { firstName?: string; name?: string } | undefined)?.firstName
      ?? session?.user?.name?.split(" ")[0]
      ?? "";
    setFirstName(name);
  }, [session]);

  const totalSteps = 3;
  const progress = Math.round(((step + 1) / totalSteps) * 100);

  async function handleFinish() {
    setSaving(true);
    try {
      // Non-fatal — if the endpoint doesn't exist the onboarding still
      // completes (user lands in dashboard).
      await fetch("/api/onboarding-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus, title, completed: true }),
      }).catch(() => {});
      router.push("/dashboard");
    } catch {
      router.push("/dashboard");
    }
  }

  return (
    <div className="auth-card ob-card">
      <Link href="/" className="auth-brand" aria-label="WorkwrK home">
        <span className="auth-brand-dot" />
        workwrk
      </Link>

      <div className="ob-step-head">
        <span className="ob-step-label">
          <Sparkles size={12} />
          Getting started · step {step + 1} of {totalSteps}
        </span>
        <span className="ob-progress-bar">
          <span className="ob-progress-fill" style={{ width: `${progress}%` }} />
        </span>
      </div>

      {step === 0 && (
        <>
          <h1 className="auth-title">
            Welcome in, <span className="hi">{firstName || "friend"}.</span>
          </h1>
          <p className="auth-sub">
            WorkwrK is the spine for everything your team does — people, KRAs,
            KPIs, SOPs, reviews, and an AI that reads all of it. We&apos;ll spend
            about 90 seconds tailoring it to you.
          </p>

          <div className="ob-preview">
            <div className="ob-preview-tile ob-tile-lime">
              <Users size={16} />
              <span>People</span>
            </div>
            <div className="ob-preview-tile ob-tile-pink">
              <Target size={16} />
              <span>KRAs</span>
            </div>
            <div className="ob-preview-tile ob-tile-blue">
              <BookOpen size={16} />
              <span>SOPs</span>
            </div>
            <div className="ob-preview-tile ob-tile-amber">
              <Star size={16} />
              <span>Reviews</span>
            </div>
            <div className="ob-preview-tile ob-tile-mint">
              <Heart size={16} />
              <span>Kudos</span>
            </div>
            <div className="ob-preview-tile ob-tile-lime">
              <Sparkles size={16} />
              <span>AI Engine</span>
            </div>
          </div>

          <div className="ob-nav">
            <Link href="/dashboard" className="ob-skip">
              Skip
            </Link>
            <button
              type="button"
              className="bento-btn bento-btn-lime auth-submit ob-next"
              onClick={() => setStep(1)}
            >
              Let&apos;s go <ArrowRight size={14} />
            </button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <h1 className="auth-title">
            What&apos;s your <span className="hi">shape?</span>
          </h1>
          <p className="auth-sub">
            Pick the one that fits you best. We&apos;ll prioritise the modules you&apos;ll
            actually use first — you can change this later.
          </p>

          <div className="ob-focus-list">
            {focusOptions.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setFocus(o.key)}
                className={`ob-focus ${focus === o.key ? "is-active" : ""}`}
              >
                <div className="ob-focus-head">
                  <span className="ob-focus-title">{o.label}</span>
                  {focus === o.key && (
                    <span className="ob-focus-check">
                      <Check size={12} />
                    </span>
                  )}
                </div>
                <p className="ob-focus-body">{o.body}</p>
                <div className="ob-focus-mods">
                  {o.modules.map((m) => (
                    <span key={m} className="ob-focus-mod">
                      {m}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>

          <div className="ob-nav">
            <button
              type="button"
              className="ob-back"
              onClick={() => setStep(0)}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              className="bento-btn bento-btn-lime auth-submit ob-next"
              onClick={() => setStep(2)}
              disabled={!focus}
            >
              Next <ArrowRight size={14} />
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="auth-title">
            One last <span className="hi">detail.</span>
          </h1>
          <p className="auth-sub">
            What&apos;s your role or title? This helps teammates find you and
            helps WorkwrK recommend the right KPI templates.
          </p>

          <div className="auth-form" style={{ marginTop: 8 }}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="ob-title">Your title</label>
              <input
                id="ob-title"
                type="text"
                className="auth-input"
                placeholder="Head of Sales · Senior SDR · Operations lead"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div className="ob-summary">
            <span className="ob-summary-label">Focus</span>
            <span className="ob-summary-val">
              {focus ? focusOptions.find((f) => f.key === focus)?.label : "Not set"}
            </span>
          </div>

          <div className="ob-nav">
            <button
              type="button"
              className="ob-back"
              onClick={() => setStep(1)}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              className="bento-btn bento-btn-lime auth-submit ob-next"
              onClick={handleFinish}
              disabled={saving}
            >
              {saving ? (
                <>
                  <span className="auth-spinner" aria-hidden />
                  Finishing…
                </>
              ) : (
                <>
                  Take me in <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </>
      )}

      <style>{`
        .ob-card { max-width: 520px !important; }

        .ob-step-head {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 28px;
        }
        .ob-step-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #d4ff2e;
        }
        .ob-progress-bar {
          height: 3px;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 100px;
          overflow: hidden;
        }
        .ob-progress-fill {
          display: block;
          height: 100%;
          background: linear-gradient(90deg, #d4ff2e, #5eead4);
          box-shadow: 0 0 10px rgba(212, 255, 46, 0.5);
          transition: width 0.4s cubic-bezier(0.2, 0.9, 0.3, 1);
        }

        .ob-preview {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin: 4px 0 28px;
        }
        .ob-preview-tile {
          display: inline-flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 6px;
          padding: 12px 14px;
          border-radius: 12px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          border: 1px solid transparent;
        }
        .ob-tile-lime { background: rgba(212, 255, 46, 0.08); border-color: rgba(212, 255, 46, 0.25); color: #d4ff2e; }
        .ob-tile-pink { background: rgba(255, 61, 138, 0.08); border-color: rgba(255, 61, 138, 0.25); color: #ff3d8a; }
        .ob-tile-blue { background: rgba(74, 158, 255, 0.08); border-color: rgba(74, 158, 255, 0.25); color: #4a9eff; }
        .ob-tile-amber { background: rgba(255, 153, 51, 0.08); border-color: rgba(255, 153, 51, 0.25); color: #ff9933; }
        .ob-tile-mint { background: rgba(94, 234, 212, 0.08); border-color: rgba(94, 234, 212, 0.25); color: #5eead4; }

        .ob-focus-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin: 6px 0 28px;
        }
        .ob-focus {
          text-align: left;
          padding: 16px 18px;
          background: #1a1a1a;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          color: #ededed;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.2, 0.9, 0.3, 1);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ob-focus:hover {
          border-color: rgba(255, 255, 255, 0.14);
          transform: translateY(-1px);
        }
        .ob-focus.is-active {
          background: rgba(212, 255, 46, 0.04);
          border-color: #d4ff2e;
          box-shadow: 0 0 0 3px rgba(212, 255, 46, 0.12);
        }
        .ob-focus-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .ob-focus-title {
          font-size: 14.5px;
          font-weight: 600;
          color: #fafafa;
          letter-spacing: -0.01em;
        }
        .ob-focus-check {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #d4ff2e;
          color: #0a0a0a;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .ob-focus-body {
          font-size: 13px;
          color: #a0a0a0;
          line-height: 1.5;
          margin: 0;
        }
        .ob-focus-mods {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          padding-top: 2px;
        }
        .ob-focus-mod {
          font-family: var(--font-geist-mono), monospace;
          font-size: 9.5px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #707070;
          padding: 3px 8px;
          background: #141414;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 100px;
        }
        .ob-focus.is-active .ob-focus-mod {
          color: #d4ff2e;
          border-color: rgba(212, 255, 46, 0.25);
          background: rgba(212, 255, 46, 0.05);
        }

        .ob-summary {
          margin-top: 18px;
          padding: 14px 16px;
          background: rgba(212, 255, 46, 0.05);
          border: 1px solid rgba(212, 255, 46, 0.2);
          border-radius: 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .ob-summary-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #707070;
        }
        .ob-summary-val {
          font-size: 13px;
          font-weight: 500;
          color: #d4ff2e;
        }

        .ob-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 28px;
        }
        .ob-next {
          justify-content: center;
          flex: 1;
          max-width: 260px;
        }
        .ob-next:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none !important;
        }
        .ob-back,
        .ob-skip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 11px 16px;
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #a0a0a0;
          font-family: inherit;
          font-size: 13px;
          font-weight: 500;
          border-radius: 100px;
          cursor: pointer;
          text-decoration: none;
          transition: all 0.2s;
        }
        .ob-back:hover,
        .ob-skip:hover {
          color: #fafafa;
          border-color: rgba(255, 255, 255, 0.14);
          background: #1a1a1a;
        }

        @media (max-width: 480px) {
          .ob-preview { grid-template-columns: 1fr 1fr; }
        }
      `}</style>
    </div>
  );
}

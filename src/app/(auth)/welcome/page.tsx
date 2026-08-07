"use client";

import { useState } from "react";
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
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  // Derived directly from the session — no state/effect needed.
  const firstName =
    (session?.user as { firstName?: string; name?: string } | undefined)?.firstName
    ?? session?.user?.name?.split(" ")[0]
    ?? "";

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

      <div className="flex items-center justify-between gap-3 mb-6">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          <Sparkles size={12} />
          Getting started · step {step + 1} of {totalSteps}
        </span>
        <span className="flex-1 max-w-[160px] h-1 rounded-full bg-zinc-100 overflow-hidden">
          <span
            className="block h-full rounded-full bg-[#0073EA] transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
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

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 my-6">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-zinc-200 bg-white text-[13px] font-medium text-zinc-700">
              <Users size={16} />
              <span>People</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-zinc-200 bg-white text-[13px] font-medium text-zinc-700">
              <Target size={16} />
              <span>KRAs</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-zinc-200 bg-white text-[13px] font-medium text-zinc-700">
              <BookOpen size={16} />
              <span>SOPs</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-zinc-200 bg-white text-[13px] font-medium text-zinc-700">
              <Star size={16} />
              <span>Reviews</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-zinc-200 bg-white text-[13px] font-medium text-zinc-700">
              <Heart size={16} />
              <span>Kudos</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-zinc-200 bg-white text-[13px] font-medium text-zinc-700">
              <Sparkles size={16} />
              <span>AI Engine</span>
            </div>
          </div>

          <div className="mt-7 flex items-center justify-between gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-800"
            >
              Skip
            </Link>
            <button
              type="button"
              className="auth-submit ob-next"
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

          <div className="flex flex-col gap-2 my-6">
            {focusOptions.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setFocus(o.key)}
                className={`text-left p-4 rounded-xl border bg-white transition flex flex-col gap-2 ${
                  focus === o.key
                    ? "border-[#0073EA] ring-2 ring-[#0073EA]/15"
                    : "border-zinc-200 hover:border-zinc-300"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[14px] font-semibold text-zinc-900">{o.label}</span>
                  {focus === o.key && (
                    <span className="w-5 h-5 rounded-full bg-[#0073EA] text-white inline-flex items-center justify-center">
                      <Check size={12} />
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-zinc-500 leading-relaxed m-0">{o.body}</p>
                <div className="flex flex-wrap gap-1.5">
                  {o.modules.map((m) => (
                    <span
                      key={m}
                      className={`h-5 inline-flex items-center px-2 rounded-[5px] text-[10.5px] font-medium ${
                        focus === o.key
                          ? "bg-blue-50 text-[#0073EA]"
                          : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>

          <div className="mt-7 flex items-center justify-between gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-800"
              onClick={() => setStep(0)}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              className="auth-submit ob-next"
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

          <div className="mt-4 px-4 py-3 rounded-lg border border-zinc-200 bg-zinc-50 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-zinc-400">Focus</span>
            <span className="text-[13px] font-medium text-zinc-900">
              {focus ? focusOptions.find((f) => f.key === focus)?.label : "Not set"}
            </span>
          </div>

          <div className="mt-7 flex items-center justify-between gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-800"
              onClick={() => setStep(1)}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              className="auth-submit ob-next"
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

    </div>
  );
}

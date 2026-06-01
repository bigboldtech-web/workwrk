"use client";

/* Benefits · Open enrollment — wizard hub.
 *
 * Read-only summary of upcoming/active OE window + next-step CTAs.
 * Since there's no dedicated OE endpoint, we infer from benefit plan
 * effective dates and surface guidance.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Gift, ArrowLeft, Calendar as CalendarIcon, CheckCircle2, Clock,
  AlertCircle, ArrowRight, ChevronRight, Users, Heart, Wallet, FileText, BookOpen,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type ApiPlan = {
  id: string;
  name: string;
  type: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  active: boolean;
};

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

const STEPS = [
  { id: "review", icon: BookOpen, title: "Review your current benefits", desc: "Look at last year's elections before changing anything." },
  { id: "compare", icon: Heart, title: "Compare medical/dental/vision plans", desc: "Costs, deductibles, in-network coverage." },
  { id: "contribute", icon: Wallet, title: "Set 401(k) + HSA/FSA contributions", desc: "Don't leave employer match on the table." },
  { id: "dependents", icon: Users, title: "Add or remove dependents", desc: "Spouse, children, qualifying events." },
  { id: "confirm", icon: CheckCircle2, title: "Confirm + sign elections", desc: "Locks in until next OE or qualifying life event." },
];

export default function OpenEnrollmentPage() {
  const [plans, setPlans] = useState<ApiPlan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/benefit-plans");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPlans(data.data ?? (Array.isArray(data) ? data : []));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("benefits");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  // Infer OE window from earliest upcoming effectiveFrom
  const oeWindow = useMemo(() => {
    const list = (plans ?? []).filter((p) => p.active);
    if (list.length === 0) return null;
    const upcoming = list
      .filter((p) => daysUntil(p.effectiveFrom) > 0)
      .sort((a, b) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime());
    if (upcoming.length === 0) return null;
    const effective = upcoming[0].effectiveFrom;
    // OE window opens 30 days before plan effective, closes 7 days before
    const oeStart = new Date(new Date(effective).getTime() - 30 * 86_400_000);
    const oeEnd = new Date(new Date(effective).getTime() - 7 * 86_400_000);
    const now = Date.now();
    const status: "upcoming" | "open" | "closed" =
      now < oeStart.getTime() ? "upcoming"
      : now > oeEnd.getTime() ? "closed"
      : "open";
    return { effective, oeStart: oeStart.toISOString(), oeEnd: oeEnd.toISOString(), status, planCount: upcoming.length };
  }, [plans]);

  return (
    <>
      <OsTitleBar
        title="Open enrollment"
        Icon={Gift}
        iconGradient={GRAD.pinkPurple}
        description={oeWindow === null ? "No upcoming OE window" : `OE ${oeWindow.status}`}
        actions={
          <div className="oe__head-actions">
            <button type="button" className="oe__back" onClick={() => history.back()}>
              <ArrowLeft /> Benefits
            </button>
            <Link href="/benefits/plans" className="oe__nav-link">All plans</Link>
            <Link href="/my-benefits" className="oe__btn-primary">My benefits <ArrowRight /></Link>
          </div>
        }
      />

      <div className="oe">
        {loadError ? (
          <OsEmptyView Icon={Gift} iconGradient={GRAD.redPink} title="Couldn't load open enrollment" subtitle={loadError} cta="Retry" />
        ) : plans === null ? (
          <div className="oe__loading">Loading…</div>
        ) : !oeWindow ? (
          <OsEmptyView
            Icon={CalendarIcon}
            iconGradient={GRAD.pinkPurple}
            title="No open-enrollment window scheduled"
            subtitle="The OE wizard activates 30 days before any benefit plan's effective date. Add plans in the catalog to seed an OE window."
            cta="View all plans"
          />
        ) : (
          <>
            <section className={`oe__hero oe__hero--${oeWindow.status}`}>
              <span className="oe__hero-accent" aria-hidden="true" />
              <div className="oe__hero-meta">
                <span className="oe__hero-tag">
                  {oeWindow.status === "open" && <CheckCircle2 />}
                  {oeWindow.status === "upcoming" && <Clock />}
                  {oeWindow.status === "closed" && <AlertCircle />}
                  OE {oeWindow.status}
                </span>
                <span className="oe__hero-effective">
                  Plans effective {new Date(oeWindow.effective).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                </span>
              </div>
              <h1 className="oe__hero-title">
                {oeWindow.status === "open" && `OE window is open — finish your elections`}
                {oeWindow.status === "upcoming" && `OE window opens ${daysUntil(oeWindow.oeStart)} days`}
                {oeWindow.status === "closed" && `OE window closed — wait for next cycle`}
              </h1>
              <div className="oe__hero-dates">
                <span><CalendarIcon /> Opens {new Date(oeWindow.oeStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                <span><CalendarIcon /> Closes {new Date(oeWindow.oeEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                <span>{oeWindow.planCount} plan{oeWindow.planCount === 1 ? "" : "s"} included</span>
              </div>
              {oeWindow.status === "open" && (
                <Link href="/my-benefits" className="oe__hero-cta">
                  Start my elections <ArrowRight />
                </Link>
              )}
            </section>

            <section className="oe__steps">
              <header className="oe__section-head">
                <h2>Enrollment checklist</h2>
                <span>{STEPS.length} steps · 10–15 minutes</span>
              </header>
              <ol className="oe__step-list">
                {STEPS.map((s, i) => {
                  const Icon = s.icon;
                  return (
                    <li key={s.id} className="oe__step">
                      <span className="oe__step-num">{i + 1}</span>
                      <div className="oe__step-icon"><Icon /></div>
                      <div className="oe__step-main">
                        <div className="oe__step-title">{s.title}</div>
                        <div className="oe__step-desc">{s.desc}</div>
                      </div>
                      <ChevronRight className="oe__step-arrow" />
                    </li>
                  );
                })}
              </ol>
            </section>

            <section className="oe__resources">
              <header className="oe__section-head">
                <h2>Resources</h2>
              </header>
              <div className="oe__res-grid">
                <Link href="/benefits/plans" className="oe__res">
                  <FileText />
                  <div>
                    <div className="oe__res-title">All benefit plans</div>
                    <div className="oe__res-sub">Browse the full catalog</div>
                  </div>
                  <ArrowRight />
                </Link>
                <Link href="/my-benefits" className="oe__res">
                  <CheckCircle2 />
                  <div>
                    <div className="oe__res-title">My current elections</div>
                    <div className="oe__res-sub">See what you elected last year</div>
                  </div>
                  <ArrowRight />
                </Link>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

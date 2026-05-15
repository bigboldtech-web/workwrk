"use client";

// "My onboarding" — focused view for the assigned employee. Instead of
// the org-wide /onboarding board (manager-shaped), this surfaces only
// the user's own active journey(s) with the step checklist and buddy
// info up front. The same toggle endpoint backs both pages.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  GraduationCap, CheckCircle2, Circle, Clock, ExternalLink, Mail, Calendar, Sparkles,
} from "lucide-react";

type StepShape = string | { title?: string; description?: string };

interface OnboardingProgressEntry { stepIndex: number; completed: boolean; completedAt?: string | null }

interface BuddyLite {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  avatar?: string | null;
}

interface MyInstance {
  id: string;
  startDate: string;
  targetDate: string | null;
  completedAt: string | null;
  progress: OnboardingProgressEntry[];
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";
  buddy: BuddyLite | null;
  template: { name: string; steps: StepShape[]; durationDays: number };
}

function stepTitle(s: StepShape): string {
  if (typeof s === "string") return s;
  return s.title ?? "Untitled step";
}
function stepDescription(s: StepShape): string {
  if (typeof s === "string") return "";
  return s.description ?? "";
}

export default function MyOnboardingPage() {
  const [instances, setInstances] = useState<MyInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const { success: toastSuccess, error: toastError } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/onboarding?type=instances&mine=true", { cache: "no-store" });
      const data = await res.json();
      const list = Array.isArray(data) ? data : data?.data ?? [];
      setInstances(list as MyInstance[]);
    } catch {
      // Soft failure — empty state will render instead of an error wall.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleStep(instance: MyInstance, stepIndex: number, currentlyDone: boolean) {
    const key = `${instance.id}:${stepIndex}`;
    setTogglingKey(key);
    // Optimistic flip — the UI feels instant even on a slow network.
    setInstances((prev) =>
      prev.map((inst) => {
        if (inst.id !== instance.id) return inst;
        const progress = [...inst.progress];
        const existing = progress.findIndex((p) => p.stepIndex === stepIndex);
        if (existing >= 0) {
          progress[existing] = { ...progress[existing], completed: !currentlyDone };
        } else {
          progress.push({ stepIndex, completed: !currentlyDone });
        }
        return { ...inst, progress };
      }),
    );
    try {
      const res = await fetch(`/api/onboarding/${instance.id}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepIndex, completed: !currentlyDone }),
      });
      if (!res.ok) {
        toastError("Couldn't update step");
        // Revert on failure.
        load();
        return;
      }
      const data = await res.json();
      const fresh = data?.data ?? data;
      setInstances((prev) =>
        prev.map((inst) =>
          inst.id === instance.id ? { ...inst, progress: fresh.progress ?? inst.progress, status: fresh.status ?? inst.status, completedAt: fresh.completedAt ?? inst.completedAt } : inst,
        ),
      );
      if (!currentlyDone) toastSuccess("Step completed");
    } finally {
      setTogglingKey(null);
    }
  }

  // One stats summary aggregated across active journeys.
  const stats = (() => {
    if (instances.length === 0) return null;
    const totalSteps = instances.reduce((sum, i) => sum + (i.template.steps?.length ?? 0), 0);
    const doneSteps = instances.reduce(
      (sum, i) => sum + (i.progress.filter((p) => p.completed).length),
      0,
    );
    const completedJourneys = instances.filter((i) => i.status === "COMPLETED").length;
    return { totalSteps, doneSteps, completedJourneys };
  })();

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Onboarding", href: "/onboarding" },
          { label: "My onboarding" },
        ]}
        kicker="Onboarding · your journey"
        title="My onboarding"
        subtitle="Work through your checklist at your pace. Check off each step as you finish — managers and your buddy can see your progress in real time."
        stats={stats ? [
          { label: "Steps done", value: `${stats.doneSteps}/${stats.totalSteps}` },
          { label: "Journeys", value: instances.length },
          { label: "Completed", value: stats.completedJourneys },
        ] : undefined}
      />

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="space-y-3 animate-pulse">
                  <div className="h-4 w-48 bg-surface-2 rounded" />
                  <div className="h-2 w-full bg-surface-2 rounded" />
                  <div className="h-12 w-full bg-surface-2 rounded" />
                  <div className="h-12 w-full bg-surface-2 rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : instances.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No onboarding journeys yet"
          description="When a manager or HR assigns you an onboarding template, you'll see your step checklist right here. Until then, sit tight — or open an Inbox item from your manager."
        />
      ) : (
        <div className="space-y-3">
          {instances.map((inst) => {
            const steps = inst.template.steps ?? [];
            const completedCount = inst.progress.filter((p) => p.completed).length;
            const totalSteps = steps.length;
            const pct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;
            const targetDate = inst.targetDate ? new Date(inst.targetDate) : null;
            const daysRemaining = targetDate
              ? Math.ceil((targetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              : null;
            const isOverdue = daysRemaining !== null && daysRemaining < 0 && inst.status !== "COMPLETED";

            return (
              <Card key={inst.id} className={isOverdue ? "border-rose-500/30" : undefined}>
                <CardContent className="p-4 space-y-3">
                  {/* Journey header */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-sm font-semibold">{inst.template.name}</h2>
                        {inst.status === "COMPLETED" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                            <CheckCircle2 size={10} /> Completed
                          </span>
                        ) : isOverdue ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-full">
                            <Clock size={10} /> {Math.abs(daysRemaining!)}d overdue
                          </span>
                        ) : daysRemaining !== null ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                            <Calendar size={10} /> {daysRemaining}d remaining
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Progress value={pct} className="h-1.5 flex-1 max-w-[260px]" />
                        <span className="text-[10.5px] text-muted-2 font-mono tabular-nums">
                          {completedCount}/{totalSteps} · {pct}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Steps checklist */}
                  {steps.length === 0 ? (
                    <p className="text-xs text-muted-2 py-2">This journey has no steps yet — check back later.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-md border border-border bg-surface">
                      {steps.map((s, idx) => {
                        const entry = inst.progress.find((p) => p.stepIndex === idx);
                        const done = !!entry?.completed;
                        const key = `${inst.id}:${idx}`;
                        const busy = togglingKey === key;
                        const title = stepTitle(s);
                        const description = stepDescription(s);
                        return (
                          <li key={idx} className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => toggleStep(inst, idx, done)}
                              disabled={busy || inst.status === "COMPLETED"}
                              className="w-full text-left flex items-start gap-2.5 group"
                            >
                              <span
                                className={
                                  "mt-0.5 flex-shrink-0 transition-colors " +
                                  (done ? "text-emerald-600" : "text-muted group-hover:text-foreground")
                                }
                              >
                                {done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className={"text-[13px] font-medium block " + (done ? "line-through text-muted-2" : "text-foreground")}>
                                  {title}
                                </span>
                                {description && (
                                  <span className="text-[11.5px] text-muted block mt-0.5">{description}</span>
                                )}
                                {done && entry?.completedAt && (
                                  <span className="text-[10px] text-muted-2 block mt-0.5">
                                    Done {new Date(entry.completedAt).toLocaleDateString()}
                                  </span>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* Buddy block */}
                  {inst.buddy && (
                    <div className="rounded-md border border-border bg-surface-2 p-2.5 flex items-center gap-2.5">
                      <Sparkles size={12} className="text-[color:var(--accent-strong)] flex-shrink-0" />
                      <span className="text-[10.5px] uppercase tracking-wider text-muted-2 font-semibold">
                        Buddy
                      </span>
                      <Avatar className="h-6 w-6 ml-1">
                        <AvatarFallback className="text-[10px]">
                          {inst.buddy.firstName[0]}{inst.buddy.lastName[0]}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-[12px] font-medium">
                        {inst.buddy.firstName} {inst.buddy.lastName}
                      </span>
                      {inst.buddy.email && (
                        <a
                          href={`mailto:${inst.buddy.email}`}
                          className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted hover:text-[color:var(--accent-strong)]"
                        >
                          <Mail size={11} /> Email
                        </a>
                      )}
                      <Link
                        href={`/people/${inst.buddy.id}`}
                        className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-foreground"
                      >
                        Profile <ExternalLink size={10} />
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Footer link — manager / HR view, only visible if they happen to
          have one of those roles (we don't gate this hard since the
          target page does its own perm check). */}
      {!loading && instances.length > 0 && (
        <p className="text-[11px] text-muted-2 text-center pt-2">
          Managers & HR: see all journeys on{" "}
          <Link href="/onboarding" className="text-muted hover:text-foreground underline-offset-2 hover:underline">
            /onboarding
          </Link>
          .
        </p>
      )}
    </div>
  );
}

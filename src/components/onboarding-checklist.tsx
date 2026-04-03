"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  Rocket,
  X,
} from "lucide-react";

interface Step {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  href: string;
}

interface ChecklistData {
  steps: Step[];
  completedCount: number;
  totalCount: number;
  percentage: number;
  allDone: boolean;
}

export function OnboardingChecklist() {
  const [data, setData] = useState<ChecklistData | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user dismissed the checklist
    const wasDismissed = localStorage.getItem("twrk-checklist-dismissed");
    if (wasDismissed === "true") {
      setDismissed(true);
      setLoading(false);
      return;
    }

    fetch("/api/onboarding-progress")
      .then((res) => res.json())
      .then((json) => {
        const d = json.data || json;
        setData(d);
        // Auto-dismiss if all done
        if (d.allDone) {
          setDismissed(true);
          localStorage.setItem("twrk-checklist-dismissed", "true");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || dismissed || !data || data.allDone) return null;

  return (
    <Card className="border-purple-500/20 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-surface dark:to-purple-950">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10">
              <Rocket size={18} className="text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Get Started</CardTitle>
              <p className="text-xs text-muted mt-0.5">
                {data.completedCount} of {data.totalCount} completed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-purple-400">{data.percentage}%</span>
            <button
              onClick={() => setExpanded(!expanded)}
              className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground"
            >
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            <button
              onClick={() => {
                setDismissed(true);
                localStorage.setItem("twrk-checklist-dismissed", "true");
              }}
              className="rounded-md p-1 text-muted-2 hover:bg-surface-2 hover:text-muted"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <Progress value={data.percentage} className="mt-3 h-2" />
      </CardHeader>

      {expanded && (
        <CardContent className="pt-2 pb-4">
          <div className="space-y-1">
            {data.steps.map((step) => (
              <Link
                key={step.id}
                href={step.completed ? "#" : step.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                  step.completed
                    ? "opacity-60"
                    : "hover:bg-purple-500/5"
                }`}
              >
                {step.completed ? (
                  <CheckCircle2 size={18} className="text-green-400 shrink-0" />
                ) : (
                  <Circle size={18} className="text-border shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${step.completed ? "line-through text-muted-2" : "text-foreground"}`}>
                    {step.label}
                  </p>
                  <p className="text-xs text-muted-2">{step.description}</p>
                </div>
                {!step.completed && (
                  <span className="text-xs text-purple-400 shrink-0">Start</span>
                )}
              </Link>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

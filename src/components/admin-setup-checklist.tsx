"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, Sparkles, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTour } from "@/components/tour-provider";

interface SetupItem {
  key: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
}

const STORAGE_KEY = "workwrk-setup-checklist-dismissed";

export function AdminSetupChecklist() {
  const { startTour, isAdmin } = useTour();
  const [items, setItems] = useState<SetupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "true") setDismissed(true);
    } catch {}
  }, []);

  useEffect(() => {
    if (!isAdmin || dismissed) return;
    Promise.all([
      fetch("/api/settings").then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/users?limit=200").then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/kras").then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/sops").then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/departments").then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/policies").then((r) => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([settings, users, kras, sops, depts, policies]) => {
        const profile = (settings?.settings as any)?.companyProfile || {};
        const userList = Array.isArray(users) ? users : users?.data || [];
        const kraList = Array.isArray(kras) ? kras : kras?.data || [];
        const sopList = Array.isArray(sops) ? sops : sops?.data || [];
        const deptList = Array.isArray(depts) ? depts : depts?.data || [];
        const policyList = Array.isArray(policies) ? policies : policies?.data || [];

        const checks: SetupItem[] = [
          {
            key: "profile",
            label: "Set up your company profile",
            description: "Add mission, vision, values and a description so AI knows your business.",
            href: "/organization",
            done: !!(profile.about && profile.about.length > 30),
          },
          {
            key: "departments",
            label: "Create departments",
            description: "Organize people by department for better structure.",
            href: "/organization",
            done: deptList.length > 0,
          },
          {
            key: "team",
            label: "Invite your team",
            description: "Add the people who'll use WorkwrK.",
            href: "/settings",
            done: userList.length > 1,
          },
          {
            key: "kras",
            label: "Create KRAs and KPIs",
            description: "Define what each role is accountable for. Use AI to generate them in seconds.",
            href: "/kra-kpi",
            done: kraList.length > 0,
          },
          {
            key: "sops",
            label: "Document a process (SOP)",
            description: "Create your first SOP — a step-by-step playbook for how things get done.",
            href: "/sops",
            done: sopList.length > 0,
          },
          {
            key: "policies",
            label: "Publish a policy",
            description: "Add your first HR or compliance policy so employees can acknowledge it.",
            href: "/policies",
            done: policyList.length > 0,
          },
        ];

        setItems(checks);
      })
      .finally(() => setLoading(false));
  }, [isAdmin, dismissed]);

  if (!isAdmin || dismissed) return null;
  if (loading) return null;

  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  const allDone = completed === total;

  // Auto-hide once everything is done
  if (allDone) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch {}
    setDismissed(true);
  };

  return (
    <Card className="border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-purple-900/5">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 text-left flex-1 min-w-0">
            {collapsed ? <ChevronRight size={16} className="text-muted shrink-0" /> : <ChevronDown size={16} className="text-muted shrink-0" />}
            <Sparkles size={16} className="text-purple-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Finish setting up WorkwrK</p>
              <p className="text-xs text-muted">{completed} of {total} steps complete</p>
            </div>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => startTour("admin")} className="text-xs h-7">
              Replay tour
            </Button>
            <button onClick={dismiss} className="text-muted hover:text-foreground transition-colors p-1" aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 rounded-full bg-surface-2 overflow-hidden mb-3">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-purple-400 transition-all duration-500"
            style={{ width: `${(completed / total) * 100}%` }}
          />
        </div>

        {!collapsed && (
          <div className="space-y-1.5">
            {items.map((item) => (
              <Link key={item.key} href={item.href} className="block">
                <div className={`flex items-start gap-3 rounded-lg p-2.5 transition-colors ${item.done ? "opacity-60" : "hover:bg-surface-2"}`}>
                  {item.done ? (
                    <CheckCircle2 size={16} className="text-green-400 shrink-0 mt-0.5" />
                  ) : (
                    <Circle size={16} className="text-muted shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${item.done ? "text-muted line-through" : "text-foreground"}`}>{item.label}</p>
                    {!item.done && (
                      <p className="text-[11px] text-muted mt-0.5">{item.description}</p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

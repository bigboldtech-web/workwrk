"use client";

// DeptWorkspaceBanner — dashboard callout that points a department
// user at their team's natural workspace. A salesperson lands here
// and sees "Jump into your Sales workspace → CRM". Hidden for
// admins / managers (they typically need the cross-org view) and
// for users with no matched department.

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Briefcase } from "lucide-react";
import { deptHomeFor } from "@/lib/dept-home";
import { useRole } from "@/hooks/use-role";

interface MeResponse {
  user: {
    firstName: string | null;
    department: { id: string; name: string } | null;
    role: { id: string; title: string } | null;
  };
}

export function DeptWorkspaceBanner() {
  const { isAdmin, isManager } = useRole();
  const [home, setHome] = useState<ReturnType<typeof deptHomeFor> | null>(null);
  const [deptName, setDeptName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MeResponse | null) => {
        if (cancelled || !data?.user) return;
        const name = data.user.department?.name ?? null;
        setDeptName(name);
        setHome(deptHomeFor(name));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Hide entirely for admins/managers + when no department match.
  if (!loaded || isAdmin || isManager || !home) return null;

  return (
    <Link
      href={home.href}
      className="block rounded-xl border border-violet-200 dark:border-violet-900/40 bg-violet-50/50 dark:bg-violet-950/20 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors p-4 group"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">
          <Briefcase size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Jump into your {home.label}</p>
          <p className="text-xs text-muted-2 truncate">
            {deptName ? `Your ${deptName} workspace — ${home.blurb}` : home.blurb}
          </p>
        </div>
        <ArrowRight size={16} className="text-violet-600 dark:text-violet-300 group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
  );
}

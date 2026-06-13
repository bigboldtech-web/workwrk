"use client";

// Plan & billing — read-only snapshot of the org's plan + status and how
// current usage sits against the PLAN_LIMITS for the active plan. Admins
// (COMPANY_ADMIN / SUPER_ADMIN) get a "Manage billing" button that opens
// the Stripe customer portal via POST /api/billing/portal.
// Data: GET /api/settings → { organization { plan, status }, usage }.

import { useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { useToast } from "@/components/ui/toast";
import { PLAN_LIMITS } from "@/lib/plan-limits";

type Plan = "STARTER" | "GROWTH" | "SCALE" | "ENTERPRISE";
type Status = "ACTIVE" | "TRIAL" | "SUSPENDED" | "CANCELLED";

type SettingsResponse = {
  organization: { plan: Plan; status: Status };
  usage: { users: number; sops: number; aiQueries: number };
};

const PLAN_LABEL: Record<Plan, string> = {
  STARTER: "Starter",
  GROWTH: "Growth",
  SCALE: "Scale",
  ENTERPRISE: "Enterprise",
};

const STATUS_STYLE: Record<Status, string> = {
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  TRIAL: "border-blue-200 bg-blue-50 text-blue-700",
  SUSPENDED: "border-amber-200 bg-amber-50 text-amber-700",
  CANCELLED: "border-red-200 bg-red-50 text-red-700",
};

const STATUS_LABEL: Record<Status, string> = {
  ACTIVE: "Active",
  TRIAL: "Trial",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled",
};

// ENTERPRISE limits are sentinel 99999 ("unlimited") — render as a dash and
// a flat (empty) bar instead of an absurd fraction.
const UNLIMITED = 99999;

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit >= UNLIMITED;
  const pct = unlimited || limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const over = !unlimited && used >= limit;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12.5px] font-medium text-zinc-700">{label}</span>
        <span className="text-[12px] tabular-nums text-zinc-500">
          {used.toLocaleString()} / {unlimited ? "∞" : limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className={`h-full rounded-full ${over ? "bg-red-500" : "bg-zinc-900"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const { accessLevel } = useRole();
  const toast = useToast();
  const canManage = accessLevel === "COMPANY_ADMIN" || accessLevel === "SUPER_ADMIN";

  const [data, setData] = useState<SettingsResponse | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d as SettingsResponse))
      .catch(() => setData(null));
  }, []);

  const openPortal = async () => {
    setOpening(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        throw new Error(body?.error ?? "Could not open billing portal");
      }
      window.location.href = body.url as string;
    } catch (e) {
      toast.error("Billing", e instanceof Error ? e.message : "Could not open billing portal");
      setOpening(false);
    }
  };

  const plan = data?.organization.plan ?? "STARTER";
  const status = data?.organization.status ?? "ACTIVE";
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.STARTER;

  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <CreditCard className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">Plan &amp; billing</h1>
      </header>
      <p className="mb-5 max-w-2xl text-[13px] text-zinc-500">
        Review your current plan, usage against your limits, and manage payment details.
      </p>

      {data === null ? (
        <div className="flex items-center gap-2 text-[13px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading billing…
        </div>
      ) : (
        <div className="max-w-2xl space-y-4">
          {/* Current plan + status */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Current plan</div>
                <div className="mt-0.5 text-[18px] font-semibold tracking-[-0.01em] text-zinc-900">
                  {PLAN_LABEL[plan]}
                </div>
              </div>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLE[status]}`}
              >
                {STATUS_LABEL[status]}
              </span>
            </div>

            {/* Usage vs limits */}
            <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4">
              <UsageBar label="Users" used={data.usage.users} limit={limits.users} />
              <UsageBar label="SOPs" used={data.usage.sops} limit={limits.sops} />
              <UsageBar label="AI queries" used={data.usage.aiQueries} limit={limits.ai} />
            </div>
          </div>

          {/* Manage billing — admin only */}
          {canManage ? (
            <button
              onClick={openPortal}
              disabled={opening}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-[12px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
              Manage billing
            </button>
          ) : (
            <p className="text-[12.5px] text-zinc-400">
              You need Company Admin to manage billing.
            </p>
          )}
        </div>
      )}
      <div className="h-10" />
    </div>
  );
}

"use client";

// Workspace settings > Plan & billing (spec-settings-workspace
// `/settings/billing`, settings-architecture 5.14). Owner page (every Admin
// until the Owner and Admin split). Honest states, never a button that 503s:
//
//   Stripe portal configured   [Manage billing] is the page's one primary
//   not configured             "Billing is handled by our team" with a
//                              mailto line, and no blue button at all
//
// The plan comparison and Invoices tab render only when checkout and Stripe
// invoices exist; neither does in this release, so neither is drawn.
// Data: GET /api/settings/billing-summary; POST /api/billing/portal.

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";

type Summary = {
  plan: string;
  status: string;
  limits: { users: number; sops: number; ai: number };
  usage: { members: number; sops: number; aiThisMonth: number };
  billingLive: boolean;
};

const PLAN_LABEL: Record<string, string> = { STARTER: "Starter", GROWTH: "Growth", SCALE: "Scale", ENTERPRISE: "Enterprise" };
const STATUS: Record<string, { label: string; cls: string }> = {
  TRIAL: { label: "Trial", cls: "bg-[var(--os-warning-bg)] text-warning-text" },
  ACTIVE: { label: "Active", cls: "bg-[var(--os-success-bg)] text-success-text" },
  PAST_DUE: { label: "Past due", cls: "bg-[var(--os-danger-bg)] text-danger-text" },
  SUSPENDED: { label: "Suspended", cls: "bg-[var(--os-danger-bg)] text-danger-text" },
  CANCELLED: { label: "Cancelled", cls: "bg-[var(--os-danger-bg)] text-danger-text" },
};

function Meter({ label, used, limit, helper }: { label: string; used: number; limit: number; helper?: string }) {
  const unlimited = limit >= 99999;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const over = !unlimited && used > limit;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-base font-medium text-ink">{label}</span>
        <span className={`text-sm tabular-nums ${over ? "text-danger-text" : "text-ink-2"}`}>{unlimited ? `${used} · no limit` : `${used} of ${limit}`}</span>
      </div>
      {unlimited ? null : (
        <div className="h-1 w-full overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div className={`h-full rounded-full ${over ? "bg-[var(--os-danger-solid)]" : "bg-brand"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {helper ? <p className="mt-1 text-sm text-ink-2">{helper}</p> : null}
    </div>
  );
}

export default function BillingSettingsPage() {
  const { toast } = useOsToast();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const r = await apiFetch<Summary>("/api/settings/billing-summary", { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setData(r.data);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const portal = useCallback(async () => {
    setOpening(true);
    const r = await apiFetch<{ url: string }>("/api/billing/portal", { method: "POST", json: { returnUrl: `${window.location.origin}/settings/billing` } });
    setOpening(false);
    if (!r.ok || !r.data?.url) { toast(r.ok ? "Couldn't open billing. Try again." : r.error); return; }
    window.location.href = r.data.url;
  }, [toast]);

  const status = data ? STATUS[data.status] ?? { label: data.status, cls: "bg-hover text-ink-2" } : null;

  return (
    <SettingsPage
      pageKey="billing"
      primary={data?.billingLive ? { label: "Manage billing", onClick: () => { void portal(); }, busy: opening, icon: null } : undefined}
    >
      {error ? (
        <ErrorState what="billing" hint={error} onRetry={() => { void load(); }} />
      ) : !data ? (
        <SkeletonRows rows={5} className="max-w-[560px]" />
      ) : (
        <SettingsCardStack>
          <SettingsCard title="Plan" id="billing.plan">
            <div className="flex items-center gap-3">
              <span className="text-xl font-semibold text-ink">{PLAN_LABEL[data.plan] ?? data.plan}</span>
              {status ? <span className={`inline-flex h-[26px] items-center rounded-md px-2 text-xs font-medium ${status.cls}`}>{status.label}</span> : null}
            </div>
            {data.billingLive ? (
              <p className="text-sm text-ink-2">Change plan, payment method and invoices in the billing portal (Manage billing).</p>
            ) : (
              <p className="text-base text-ink">
                Billing is handled by our team. Email{" "}
                <a href="mailto:billing@workwrk.com" className="font-medium text-brand-deep hover:underline">billing@workwrk.com</a>.
              </p>
            )}
          </SettingsCard>
          <SettingsCard title="Usage" id="billing.usage">
            <Meter label="Members" used={data.usage.members} limit={data.limits.users} helper="Everyone who can sign in. Deactivated people do not count." />
            <Meter label="SOPs" used={data.usage.sops} limit={data.limits.sops} />
            <Meter label="AI queries this month" used={data.usage.aiThisMonth} limit={data.limits.ai} />
          </SettingsCard>
        </SettingsCardStack>
      )}
    </SettingsPage>
  );
}

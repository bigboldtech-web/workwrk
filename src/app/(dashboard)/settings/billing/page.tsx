"use client";

// Workspace settings > Plan & billing (spec-settings-workspace
// `/settings/billing`, settings-architecture 5.14). Owner page (every Admin
// until the Owner and Admin split). Honest states, never a button that fails:
//
//   Starter, checkout can open      [Upgrade to Growth] opens Stripe checkout,
//                                   and a customer's past invoices are a link
//   a Stripe customer, Stripe on    [Manage billing] is the page's one primary
//   anything else                   "Billing is handled by our team" with a
//                                   mailto line, and no blue button at all
//
// The meters are the numbers the product refuses at (seats: people plus open
// invitations; AI questions in total). The plan comparison and Invoices tab
// are not drawn in this release.
// Data: GET /api/settings/billing-summary; POST /api/billing/portal and
// /api/billing/checkout.

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
  usage: { members: number; pendingInvites: number; sops: number; aiUsed: number };
  /** People who hold a seat here through a membership (their account is another workspace's). */
  fromOtherWorkspaces?: Array<{ id: string; name: string; email: string; isOwner?: boolean }>;
  billingLive: boolean;
  portalAvailable: boolean;
  stripeSubscribed: boolean;
  paymentPending?: boolean;
  upgrade: { key: string; seats: number } | null;
};

const PLAN_LABEL: Record<string, string> = { STARTER: "Starter", GROWTH: "Growth", SCALE: "Scale", ENTERPRISE: "Enterprise" };
// A Starter workspace is free for good, so its TRIAL status reads "Free": a
// "Trial" chip promised an end that never comes.
const FREE = { label: "Free", cls: "bg-hover text-ink-2" };
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
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

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

  // Back from a paid checkout (?billing=success) before the payment's event
  // has landed: the page says the payment was received, reads the summary
  // again for a minute, and offers no second Upgrade meanwhile.
  const [paid, setPaid] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("billing") !== "success") return;
    const start = setTimeout(() => setPaid(true), 0);
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      void load();
      if (n >= 20) clearInterval(t);
    }, 3000);
    return () => { clearTimeout(start); clearInterval(t); };
  }, [load]);

  const portal = useCallback(async () => {
    setOpening(true);
    const r = await apiFetch<{ url: string }>("/api/billing/portal", { method: "POST", json: { returnUrl: `${window.location.origin}/settings/billing` } });
    setOpening(false);
    if (!r.ok || !r.data?.url) { toast(r.ok ? "Couldn't open billing. Try again." : r.error); return; }
    window.location.href = r.data.url;
  }, [toast]);

  const checkout = useCallback(async (upgrade: { key: string; seats: number }) => {
    setOpening(true);
    const back = `${window.location.origin}/settings/billing`;
    const r = await apiFetch<{ url: string | null }>("/api/billing/checkout", {
      method: "POST",
      json: { key: upgrade.key, seats: upgrade.seats, successUrl: `${back}?billing=success`, cancelUrl: `${back}?billing=canceled` },
    });
    setOpening(false);
    if (!r.ok || !r.data?.url) { toast(r.ok ? "Couldn't open checkout. Try again." : r.error); return; }
    window.location.href = r.data.url;
  }, [toast]);

  const redeem = useCallback(async () => {
    const value = code.trim();
    if (!value || redeeming) return;
    setRedeeming(true);
    setRedeemError(null);
    const r = await apiFetch<{ redeemed?: boolean; alreadyRedeemed?: boolean; plan?: string; seats?: number }>("/api/appsumo/redeem", { method: "POST", json: { code: value } });
    setRedeeming(false);
    if (!r.ok) { setRedeemError(r.error); return; }
    setCode("");
    const label = PLAN_LABEL[r.data.plan ?? ""] ?? r.data.plan ?? "";
    toast(r.data.alreadyRedeemed ? "This workspace already redeemed that code." : `Code redeemed: the ${label} plan${typeof r.data.seats === "number" && r.data.seats < 99999 ? `, ${r.data.seats} seats` : ""}.`);
    void load();
  }, [code, redeeming, toast, load]);

  const status = data
    ? data.status === "TRIAL" && data.plan === "STARTER"
      ? FREE
      : STATUS[data.status] ?? { label: data.status, cls: "bg-hover text-ink-2" }
    : null;
  const waitingForPayment = paid && !!data && data.plan === "STARTER" && !data.stripeSubscribed;
  const upgrade = waitingForPayment ? null : (data?.upgrade ?? null);
  // Upgrade first: a checkout opened and left (or a subscription that ended)
  // leaves a Stripe customer behind, and the portal cannot start a
  // subscription, so preferring it hid the only way to buy Growth.
  const primary = upgrade
    ? { label: "Upgrade to Growth", onClick: () => { void checkout(upgrade); }, busy: opening, icon: null }
    : data?.portalAvailable
      ? { label: "Manage billing", onClick: () => { void portal(); }, busy: opening, icon: null }
      : undefined;
  const seatsUsed = data ? data.usage.members + data.usage.pendingInvites : 0;
  const seatsHelper = data
    ? `${data.usage.members} ${data.usage.members === 1 ? "person" : "people"} who can sign in and ${data.usage.pendingInvites} open ${data.usage.pendingInvites === 1 ? "invitation" : "invitations"}. Deactivated people and expired invitations do not count.`
    : undefined;

  return (
    <SettingsPage pageKey="billing" primary={primary}>
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
            {waitingForPayment ? (
              <p role="status" className="text-sm text-ink-2">Payment received. The plan changes here as soon as the payment is confirmed; this page updates by itself.</p>
            ) : data.paymentPending ? (
              <p className="text-sm text-ink-2">This workspace&apos;s subscription has a payment that is pending or failed. Manage billing shows it and lets you pay or cancel.</p>
            ) : data.stripeSubscribed && data.portalAvailable ? (
              <p className="text-sm text-ink-2">
                Change the seats (never below the people and open invitations here) or the card, see invoices, or cancel, in the billing portal (Manage billing). To change the plan, email{" "}
                <a href="mailto:billing@workwrk.com" className="font-medium text-brand-deep hover:underline">billing@workwrk.com</a>.
              </p>
            ) : upgrade ? (
              <>
                <p className="text-sm text-ink-2">Growth adds Talk and Tables, up to 50 people, 20 SOPs and 500 AI questions. Upgrade to Growth opens checkout, where you choose the seats.</p>
                {data.portalAvailable ? (
                  <p className="text-sm text-ink-2">
                    Past invoices and the card on file are in the{" "}
                    <button type="button" onClick={() => { void portal(); }} disabled={opening} className="font-medium text-brand-deep hover:underline disabled:text-ink-3">billing portal</button>.
                  </p>
                ) : null}
              </>
            ) : data.portalAvailable ? (
              <p className="text-sm text-ink-2">Past invoices and the card on file are in the billing portal (Manage billing). To change the plan, email <a href="mailto:billing@workwrk.com" className="font-medium text-brand-deep hover:underline">billing@workwrk.com</a>.</p>
            ) : (
              <p className="text-base text-ink">
                Billing is handled by our team. Email{" "}
                <a href="mailto:billing@workwrk.com" className="font-medium text-brand-deep hover:underline">billing@workwrk.com</a>.
              </p>
            )}
          </SettingsCard>
          {data.stripeSubscribed ? null : (
            <SettingsCard title="AppSumo code" id="billing.appsumo">
              <form
                className="flex flex-wrap items-start gap-2"
                onSubmit={(e) => { e.preventDefault(); void redeem(); }}
              >
                <label htmlFor="appsumo-code" className="sr-only">AppSumo code</label>
                <input
                  id="appsumo-code"
                  value={code}
                  onChange={(e) => { setCode(e.target.value); setRedeemError(null); }}
                  placeholder="Paste your code"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={200}
                  aria-invalid={redeemError ? true : undefined}
                  aria-describedby={redeemError ? "appsumo-error" : "appsumo-help"}
                  className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
                />
                <button
                  type="submit"
                  disabled={!code.trim() || redeeming}
                  className="os-chrome inline-flex h-9 shrink-0 items-center rounded-md border border-line bg-raised px-4 text-base font-medium text-ink hover:bg-hover disabled:cursor-default disabled:text-ink-3"
                >
                  {redeeming ? "Redeeming" : "Redeem"}
                </button>
              </form>
              {redeemError ? (
                <p id="appsumo-error" className="text-sm text-danger-text">{redeemError}</p>
              ) : (
                <p id="appsumo-help" className="text-sm text-ink-2">A code raises this workspace to the plan and seats it grants, for good, and never lowers either.</p>
              )}
            </SettingsCard>
          )}
          <SettingsCard title="Usage" id="billing.usage">
            <Meter label="Seats" used={seatsUsed} limit={data.limits.users} helper={seatsHelper} />
            {data.fromOtherWorkspaces && data.fromOtherWorkspaces.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm text-ink-2">
                  In through another workspace: their account belongs to another workspace, so Members does not list
                  them, and each holds a seat here. Removing them from this page is not built yet: to free one of these
                  seats, email{" "}
                  <a href="mailto:billing@workwrk.com" className="font-medium text-brand-deep hover:underline">billing@workwrk.com</a>.
                </p>
                <ul className="flex flex-col gap-1">
                  {data.fromOtherWorkspaces.map((p) => (
                    <li key={p.id} className="flex min-h-8 items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink">
                        {p.name} <span className="text-ink-2">{p.email}</span>
                      </span>
                      {p.isOwner ? <span className="shrink-0 text-ink-2">Owner</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Meter label="SOPs" used={data.usage.sops} limit={data.limits.sops} />
            <Meter
              label="AI questions used, in total"
              used={data.usage.aiUsed}
              limit={data.limits.ai}
              helper="Ask AI messages, agent runs and the AI actions people start in docs, files, forms, tables, whiteboards, SOPs, KRAs, meetings and the app builder count. A request that fails before the AI answers is not counted; an answer that could not be used still is. Suggestions nobody asked for (field suggestions and goal assessments) never count, run up to a daily total, and stop once the total here is used. Fill with AI and Talk updates have their own daily limit."
            />
          </SettingsCard>
        </SettingsCardStack>
      )}
    </SettingsPage>
  );
}

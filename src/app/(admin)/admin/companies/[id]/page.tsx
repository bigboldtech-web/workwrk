"use client";

import { SkeletonRows } from "@/components/ui/skeleton";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Building2, Crown, Sparkles, Palette, Globe2, type LucideIcon } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { Switch } from "@/components/ui/switch";
import { useCompanyCrumb, useConsole } from "../../../console-context";
import { TypedConfirmDialog, type TypedConfirmRequest } from "../../../typed-confirm-dialog";

interface Company {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  plan: "STARTER" | "GROWTH" | "SCALE" | "ENTERPRISE";
  status: "ACTIVE" | "TRIAL" | "SUSPENDED" | "CANCELLED";
  createdAt: string;
  _count: { users: number; sops: number; kras: number; tasks: number; kpis: number };
  features: { byok: boolean; whiteLabel: boolean; customDomain: boolean };
}

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { noteCompanyOpened } = useConsole();
  const { success: toastSuccess, error: toastError } = useToast();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  // Suspended and Cancelled sign everyone out, so they wait for a typed
  // confirmation of the company name (spec-admin-backoffice 2.3 card 2).
  const [pendingStatus, setPendingStatus] = useState<"SUSPENDED" | "CANCELLED" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const r = await fetch(`/api/admin/companies/${id}`).catch(() => null);
    if (r?.ok) {
      const d = await r.json();
      setCompany(d.data || d);
    } else {
      // A failure says so; it never sits as a skeleton for ever.
      setLoadFailed(true);
    }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // The breadcrumb names the company, and Search's RECENT learns it was
  // opened (once per company, not on every reload after a save).
  useCompanyCrumb(company?.name);
  const notedId = useRef<string | null>(null);
  useEffect(() => {
    if (!company || notedId.current === company.id) return;
    notedId.current = company.id;
    noteCompanyOpened({ id: company.id, name: company.name, plan: company.plan, status: company.status });
  }, [company, noteCompanyOpened]);

  async function patch(body: Record<string, unknown>, label: string) {
    setSaving(label);
    try {
      const res = await fetch(`/api/admin/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const d = await res.json().catch(() => ({}));
        const signedOut = typeof d?.signedOut === "number" ? d.signedOut : 0;
        toastSuccess(
          `${label} updated`,
          signedOut > 0 ? `${signedOut} ${signedOut === 1 ? "person is" : "people are"} signed out within five minutes.` : undefined,
        );
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed");
      }
    } finally {
      setSaving(null);
    }
  }

  if (!company && loadFailed && !loading) {
    return (
      <div className="flex items-center gap-1 p-6 text-row text-ink-2">
        <span>Could not load this company.</span>
        <button type="button" onClick={() => void load()} className="font-medium text-brand-deep hover:underline">
          Retry
        </button>
      </div>
    );
  }

  if (loading || !company) {
    return (
      <div className="p-6">
        <SkeletonRows rows={4} />
      </div>
    );
  }

  const isEnterprise = company.plan === "ENTERPRISE";

  // Says only what the build does: the write bumps every anchored member's
  // tokenVersion, the session check revokes on the workspace status (moving
  // anyone with another healthy workspace into it), and a staff status
  // change never schedules or keeps a deletion.
  const statusConfirm: TypedConfirmRequest | null = pendingStatus
    ? {
        title: pendingStatus === "SUSPENDED" ? `Suspend ${company.name}?` : `Set ${company.name} to Cancelled?`,
        body:
          pendingStatus === "SUSPENDED"
            ? "Nobody there can sign in, and everyone signed in now is signed out within five minutes. Nothing is deleted, and you can set this back to Active at any time."
            : "Nobody there can sign in, and everyone signed in now is signed out within five minutes. Nothing is deleted: this console never deletes a company. Set it back to Active to restore it at any time.",
        note: "Anyone who also belongs to another WorkwrK workspace can sign back in to that one.",
        match: company.name,
        matchLabel: "the company name",
        confirmLabel: pendingStatus === "SUSPENDED" ? "Suspend" : "Set to Cancelled",
      }
    : null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5 animate-fade-in">
      <div>
        <BackButton fallbackHref="/admin/companies" label="Companies" />
        <div className="flex items-start justify-between gap-3 mt-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Building2 size={18} className="text-ink-2" />
              {company.name}
            </h1>
            <p className="text-sm text-ink-2 font-mono mt-0.5">{company.slug}{company.domain ? ` · ${company.domain}` : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{company.plan}</Badge>
            <Badge variant={company.status === "ACTIVE" ? "success" : company.status === "TRIAL" ? "warning" : "secondary"}>
              {company.status}
            </Badge>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-5 gap-3">
        <Stat label="Users" value={company._count.users} />
        <Stat label="SOPs" value={company._count.sops} />
        <Stat label="KRAs" value={company._count.kras} />
        <Stat label="KPIs" value={company._count.kpis} />
        <Stat label="Tasks" value={company._count.tasks} />
      </div>

      {/* Plan + status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Plan &amp; status</CardTitle>
          <CardDescription>Plan dictates which Enterprise features are eligible. Status controls whether the org can sign in.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm text-ink-2">Plan</label>
            <Select value={company.plan} onValueChange={(v) => patch({ plan: v }, "Plan")} disabled={saving !== null}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="STARTER">Starter</SelectItem>
                <SelectItem value="GROWTH">Growth</SelectItem>
                <SelectItem value="SCALE">Scale</SelectItem>
                <SelectItem value="ENTERPRISE">Enterprise</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-ink-2">Status</label>
            <Select
              value={company.status}
              onValueChange={(v) => {
                if (v === "SUSPENDED" || v === "CANCELLED") {
                  setPendingStatus(v);
                  return;
                }
                patch({ status: v }, "Status");
              }}
              disabled={saving !== null}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="TRIAL">Trial</SelectItem>
                <SelectItem value="SUSPENDED">Suspended</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Enterprise feature flags */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Crown size={14} className="text-ink-2" /> Enterprise add-ons
              </CardTitle>
              <CardDescription>
                Toggleable per customer. {isEnterprise ? "This company is on Enterprise, so each switch takes effect at once." : "This company is not on Enterprise, so a switch is stored but does nothing until it is."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <FeatureRow
            icon={Sparkles}
            title="Bring your own AI key"
            blurb="Lets the customer plug in their own Anthropic API key in their Settings → AI tab. Falls back to the WorkwrK shared key when off."
            enabled={company.features.byok}
            disabled={saving !== null || !isEnterprise}
            onChange={(v) => patch({ feature: "byok", enabled: v }, "BYOK")}
          />
          <FeatureRow
            icon={Palette}
            title="White label: their own brand in the app"
            blurb="Replaces the WorkwrK wordmark with the customer's logo + primary color across topbar, sidebar, and emails."
            enabled={company.features.whiteLabel}
            disabled={saving !== null || !isEnterprise}
            onChange={(v) => patch({ feature: "whiteLabel", enabled: v }, "White-label")}
          />
          <FeatureRow
            icon={Globe2}
            title="Custom domain"
            blurb="Routes the customer's own domain (e.g. sops.acme.com) into the app. They configure DNS; we handle middleware."
            enabled={company.features.customDomain}
            disabled={saving !== null || !isEnterprise}
            onChange={(v) => patch({ feature: "customDomain", enabled: v }, "Custom domain")}
          />
          {!isEnterprise && (
            <p className="text-xs text-ink-2 pt-2 border-t border-line">
              Lift their plan to Enterprise above for these flags to activate.
            </p>
          )}
        </CardContent>
      </Card>

      <TypedConfirmDialog
        request={statusConfirm}
        busy={saving === "Status"}
        onCancel={() => setPendingStatus(null)}
        onConfirm={async () => {
          const next = pendingStatus;
          if (!next) return;
          await patch({ status: next }, "Status");
          setPendingStatus(null);
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <p className="text-xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-ink-2">{label}</p>
      </CardContent>
    </Card>
  );
}

function FeatureRow({
  icon: Icon, title, blurb, enabled, disabled, onChange,
}: {
  icon: LucideIcon;
  title: string;
  blurb: string;
  enabled: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-hover p-3">
      <div className="flex items-start gap-3 min-w-0">
        <div className="h-8 w-8 rounded-lg bg-raised flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={14} className="text-ink-2" />
        </div>
        <div className="min-w-0">
          <div className="text-base font-medium">{title}</div>
          <p className="text-xs text-ink-2 leading-relaxed mt-0.5">{blurb}</p>
        </div>
      </div>
      <span className="mt-1 shrink-0">
        {/* The design system's one Switch (its track is inline-styled, so the
            .workwrk-os button reset cannot hide it). */}
        <Switch checked={enabled} disabled={disabled} onChange={onChange} aria-label={title} />
      </span>
    </div>
  );
}

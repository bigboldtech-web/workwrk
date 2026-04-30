"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ArrowLeft, Building2, Crown, Sparkles, Palette, Globe2, Loader2 } from "lucide-react";

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
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { success: toastSuccess, error: toastError } = useToast();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/admin/companies/${id}`);
    if (r.ok) {
      const d = await r.json();
      setCompany(d.data || d);
    }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>, label: string) {
    setSaving(label);
    try {
      const res = await fetch(`/api/admin/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toastSuccess(`${label} updated`);
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed");
      }
    } finally {
      setSaving(null);
    }
  }

  if (loading || !company) {
    return (
      <div className="flex items-center justify-center py-16 text-muted text-sm">
        <Loader2 size={16} className="animate-spin mr-2" /> Loading company…
      </div>
    );
  }

  const isEnterprise = company.plan === "ENTERPRISE";

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5 animate-fade-in">
      <div>
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => router.push("/admin/companies")}>
          <ArrowLeft size={14} /> Back to companies
        </Button>
        <div className="flex items-start justify-between gap-3 mt-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Building2 size={18} className="text-muted" />
              {company.name}
            </h1>
            <p className="text-xs text-muted font-mono mt-0.5">{company.slug}{company.domain ? ` · ${company.domain}` : ""}</p>
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
          <CardTitle className="text-base">Plan &amp; status</CardTitle>
          <CardDescription>Plan dictates which Enterprise features are eligible. Status controls whether the org can sign in.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted">Plan</label>
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
            <label className="text-xs text-muted">Status</label>
            <Select value={company.status} onValueChange={(v) => patch({ status: v }, "Status")} disabled={saving !== null}>
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
              <CardTitle className="text-base flex items-center gap-2">
                <Crown size={14} className="text-[#d4ff2e]" /> Enterprise add-ons
              </CardTitle>
              <CardDescription>
                Toggleable per customer. {isEnterprise ? "Org is on Enterprise — toggles take effect immediately." : "Org isn't on Enterprise yet, so toggles are stored but don't activate the feature."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <FeatureRow
            icon={Sparkles}
            title="BYOK — bring your own AI key"
            blurb="Lets the customer plug in their own Anthropic API key in their Settings → AI tab. Falls back to the WorkwrK shared key when off."
            enabled={company.features.byok}
            disabled={saving !== null || !isEnterprise}
            onChange={(v) => patch({ feature: "byok", enabled: v }, "BYOK")}
          />
          <FeatureRow
            icon={Palette}
            title="White-label — in-app rebrand"
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
            <p className="text-[11px] text-muted pt-2 border-t border-border">
              Lift their plan to Enterprise above for these flags to activate.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <p className="text-xl font-bold tabular-nums">{value}</p>
        <p className="text-[10px] text-muted">{label}</p>
      </CardContent>
    </Card>
  );
}

function FeatureRow({
  icon: Icon, title, blurb, enabled, disabled, onChange,
}: {
  icon: any;
  title: string;
  blurb: string;
  enabled: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-start gap-3 min-w-0">
        <div className="h-8 w-8 rounded-lg bg-surface flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={14} className="text-[#d4ff2e]" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <p className="text-[11px] text-muted leading-relaxed mt-0.5">{blurb}</p>
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={[
          "shrink-0 mt-1 inline-flex h-5 w-9 items-center rounded-full transition-colors",
          enabled ? "bg-[#d4ff2e]" : "bg-surface",
          disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
        aria-pressed={enabled}
        aria-label={`${enabled ? "Disable" : "Enable"} ${title}`}
      >
        <span
          className={[
            "inline-block h-4 w-4 transform rounded-full bg-background transition-transform",
            enabled ? "translate-x-4" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
    </div>
  );
}

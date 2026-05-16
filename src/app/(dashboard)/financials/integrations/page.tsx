"use client";

// Financials > Integrations — QuickBooks Online + Xero OAuth connect/
// disconnect surface. Tokens stored on Integration rows; this page
// is the visual control plane around them.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/dashboard/page-header";
import { useToast } from "@/components/ui/toast";
import { Plug, ShieldCheck, AlertTriangle, RefreshCw, Unplug } from "lucide-react";

interface IntegrationRow {
  id: string;
  type: string;
  name: string;
  status: "ACTIVE" | "INACTIVE" | "ERROR" | "SYNCING";
  lastSyncAt: string | null;
}

const PROVIDERS = [
  {
    type: "QUICKBOOKS",
    label: "QuickBooks Online",
    description: "Sync chart of accounts + push journal entries to QuickBooks.",
    connectHref: "/api/integrations/quickbooks/connect",
    disconnectHref: "/api/integrations/quickbooks/disconnect",
  },
  {
    type: "XERO",
    label: "Xero",
    description: "Sync chart of accounts + push journal entries to Xero (AU / NZ / UK / global).",
    connectHref: "/api/integrations/xero/connect",
    disconnectHref: "/api/integrations/xero/disconnect",
  },
] as const;

export default function FinancialsIntegrationsPage() {
  const params = useSearchParams();
  const { success: toastSuccess, error: toastError } = useToast();
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch("/api/integrations", { cache: "no-store" });
    if (!r.ok) { setLoading(false); return; }
    const d = await r.json();
    const list: IntegrationRow[] = d?.data || d || [];
    setRows(Array.isArray(list) ? list : []);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  // Surface OAuth callback results as toasts. The callback route
  // redirects here with ?provider=&connected=1 or ?error=…
  useEffect(() => {
    const provider = params.get("provider");
    if (!provider) return;
    if (params.get("connected") === "1") {
      toastSuccess(`${provider === "quickbooks" ? "QuickBooks" : "Xero"} connected`);
    } else if (params.get("error")) {
      toastError(`${provider}: ${params.get("error")}`);
    }
  }, [params]);

  function statusFor(type: string): IntegrationRow | undefined {
    return rows.find((r) => r.type === type);
  }

  async function disconnect(provider: typeof PROVIDERS[number]) {
    setBusy(provider.type);
    try {
      const r = await fetch(provider.disconnectHref, { method: "POST" });
      if (r.ok) {
        toastSuccess(`${provider.label} disconnected`);
        await refresh();
      } else {
        toastError(`Failed to disconnect ${provider.label}`);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Financials", href: "/financials" },
          { label: "Integrations" },
        ]}
        kicker="Financials · integrations"
        title="Accounting integrations"
        subtitle="Mirror your chart of accounts and push journal entries to QuickBooks or Xero."
      />

      {loading ? (
        <Card><CardContent className="p-6 text-sm text-muted">Loading…</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {PROVIDERS.map((p) => {
            const row = statusFor(p.type);
            const connected = row?.status === "ACTIVE";
            return (
              <Card key={p.type}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Plug size={16} className="text-[color:var(--accent-strong)]" />
                        <h3 className="text-sm font-semibold">{p.label}</h3>
                        {connected ? (
                          <Badge variant="outline" className="text-[10px] gap-1 text-emerald-600 border-emerald-300">
                            <ShieldCheck size={9} /> Connected
                          </Badge>
                        ) : row?.status === "ERROR" ? (
                          <Badge variant="outline" className="text-[10px] gap-1 text-red-600 border-red-300">
                            <AlertTriangle size={9} /> Error
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Not connected</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-1">{p.description}</p>
                      {row?.lastSyncAt && (
                        <p className="text-[10.5px] text-muted-2 mt-2 flex items-center gap-1">
                          <RefreshCw size={9} /> Last synced {new Date(row.lastSyncAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    {connected ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={busy === p.type}
                        onClick={() => disconnect(p)}
                      >
                        <Unplug size={12} /> Disconnect
                      </Button>
                    ) : (
                      <a href={p.connectHref} className="inline-flex">
                        <Button size="sm" className="gap-1.5">
                          <Plug size={12} /> Connect {p.label}
                        </Button>
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

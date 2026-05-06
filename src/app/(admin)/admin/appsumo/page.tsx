"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Upload, Loader2, KeyRound, CheckCircle2, XCircle } from "lucide-react";

interface CodeRow {
  id: string;
  code: string;
  tier: number;
  plan: string;
  seats: number;
  redeemedById: string | null;
  redeemedByOrg: string | null;
  redeemedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

const TIER_PRESETS: Array<{ tier: number; plan: string; seats: number; label: string }> = [
  { tier: 1, plan: "GROWTH",     seats: 5,  label: "Tier 1 — Growth, 5 seats" },
  { tier: 2, plan: "SCALE",      seats: 25, label: "Tier 2 — Scale, 25 seats" },
  { tier: 3, plan: "ENTERPRISE", seats: 999_999, label: "Tier 3 — Enterprise, unlimited" },
];

export default function AdminAppsumoPage() {
  const { success: toastSuccess, error: toastError } = useToast();
  const confirm = useConfirm();

  // Listing
  const [filter, setFilter] = useState<"all" | "unused" | "redeemed" | "refunded">("all");
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Bulk import
  const [importTier, setImportTier] = useState<string>("1");
  const [importCSV, setImportCSV] = useState<string>("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/admin/appsumo?filter=${filter}`);
    if (r.ok) {
      const d = await r.json();
      const data = d.data ?? d;
      setCodes(data.codes || []);
      setTotal(data.total || 0);
    }
    setLoading(false);
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function bulkImport() {
    const lines = importCSV
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    if (lines.length === 0) {
      toastError("Paste at least one code, one per line.");
      return;
    }
    const preset = TIER_PRESETS.find((p) => p.tier === Number(importTier));
    if (!preset) return;

    const codes = lines.map((line) => {
      // Allow `code` or `code,tier,plan,seats` rows.
      const parts = line.split(",").map((p) => p.trim());
      const code = parts[0];
      const tier = parts[1] ? Number(parts[1]) : preset.tier;
      const plan = parts[2] ? parts[2].toUpperCase() : preset.plan;
      const seats = parts[3] ? Number(parts[3]) : preset.seats;
      return { code, tier, plan, seats };
    });

    setImporting(true);
    try {
      const res = await fetch("/api/admin/appsumo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes }),
      });
      const d = await res.json();
      if (!res.ok) {
        toastError(d?.error || "Bulk import failed");
        return;
      }
      const data = d.data ?? d;
      toastSuccess(`Imported ${data.inserted} of ${data.attempted} codes`);
      setImportCSV("");
      await load();
    } finally {
      setImporting(false);
    }
  }

  async function refundCode(code: string) {
    if (!(await confirm({
      title: `Mark "${code}" as refunded?`,
      description: "The customer's org won't be downgraded automatically — you'll need to handle that separately. This is bookkeeping only.",
      confirmLabel: "Mark refunded",
      destructive: true,
    }))) return;
    const res = await fetch("/api/admin/appsumo", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, refunded: true }),
    });
    if (res.ok) {
      toastSuccess("Marked refunded");
      await load();
    } else {
      toastError("Couldn't update code");
    }
  }

  const stats = {
    total,
    unused: codes.filter((c) => !c.redeemedAt && !c.refundedAt).length,
    redeemed: codes.filter((c) => c.redeemedAt && !c.refundedAt).length,
    refunded: codes.filter((c) => c.refundedAt).length,
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5 animate-fade-in">
      <div>
        <p className="text-[11px] text-muted font-mono uppercase tracking-wider">Lifetime deals</p>
        <h1 className="text-xl font-semibold flex items-center gap-2 mt-1">
          <Sparkles size={18} className="text-[#d4ff2e]" /> AppSumo redemption codes
        </h1>
        <p className="text-xs text-muted mt-0.5">
          Bulk-import codes from the AppSumo merchant CSV, then watch them get redeemed.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Total" value={total} />
        <Stat label="On the page (unused)" value={stats.unused} />
        <Stat label="Redeemed" value={stats.redeemed} tone="green" />
        <Stat label="Refunded" value={stats.refunded} tone="amber" />
      </div>

      <Tabs defaultValue="import">
        <TabsList>
          <TabsTrigger value="import">Bulk import</TabsTrigger>
          <TabsTrigger value="list">Codes</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Import codes</CardTitle>
              <CardDescription>
                Paste codes from the AppSumo merchant CSV — one per line. The default tier
                applies unless a row overrides it (format: <code>code,tier,plan,seats</code>).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Default tier</Label>
                <Select value={importTier} onValueChange={setImportTier}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIER_PRESETS.map((p) => (
                      <SelectItem key={p.tier} value={String(p.tier)}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Codes</Label>
                <Textarea
                  rows={10}
                  value={importCSV}
                  onChange={(e) => setImportCSV(e.target.value)}
                  placeholder={`# One per line. Example:\nWK-2026-AAAA-BBBB\nWK-2026-CCCC-DDDD\n# Or override per-row:\nWK-2026-EEEE-FFFF,2,SCALE,25`}
                  className="font-mono text-xs"
                />
              </div>

              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted">
                  Duplicates are skipped silently — safe to re-run.
                </p>
                <Button onClick={bulkImport} disabled={importing || !importCSV.trim()} className="gap-1.5">
                  {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  Import
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="list" className="mt-4 space-y-4">
          <div className="flex items-center gap-2">
            {(["all", "unused", "redeemed", "refunded"] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Button>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-sm text-muted">
                  <Loader2 size={16} className="animate-spin mx-auto mb-2" /> Loading…
                </div>
              ) : codes.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted">No codes match this filter.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-[10px] font-mono uppercase tracking-wider text-muted bg-surface-2">
                    <tr>
                      <th className="text-left p-3">Code</th>
                      <th className="text-left p-3">Tier / Plan / Seats</th>
                      <th className="text-left p-3">Status</th>
                      <th className="text-left p-3">Redeemed</th>
                      <th className="text-right p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map((c) => (
                      <tr key={c.id} className="border-t border-border hover:bg-surface-2/50">
                        <td className="p-3 font-mono text-xs">
                          <KeyRound size={11} className="inline mr-1.5 text-muted" />
                          {c.code}
                        </td>
                        <td className="p-3">
                          T{c.tier} · {c.plan} · {c.seats === 999_999 ? "∞" : c.seats}
                        </td>
                        <td className="p-3">
                          {c.refundedAt ? (
                            <Badge variant="outline" className="text-amber-400 text-[10px]"><XCircle size={10} className="mr-1" /> Refunded</Badge>
                          ) : c.redeemedAt ? (
                            <Badge variant="success" className="text-[10px]"><CheckCircle2 size={10} className="mr-1" /> Redeemed</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">Unused</Badge>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted">
                          {c.redeemedAt ? new Date(c.redeemedAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="p-3 text-right">
                          {c.redeemedAt && !c.refundedAt && (
                            <Button variant="ghost" size="sm" onClick={() => refundCode(c.code)}>
                              Refund
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "green" | "amber" }) {
  const color = tone === "green" ? "text-green-400" : tone === "amber" ? "text-amber-400" : "";
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
        <p className="text-[10px] text-muted">{label}</p>
      </CardContent>
    </Card>
  );
}

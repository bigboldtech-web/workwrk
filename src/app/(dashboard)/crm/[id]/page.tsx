"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BarChart3, Calendar as CalendarIcon } from "lucide-react";
import { OsItemDetail } from "@/components/layout/os/item-detail";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { C, GRAD } from "@/components/layout/os/catalog";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type Stage = { id: string; name: string; color?: string | null; isWon?: boolean | null; isLost?: boolean | null };
type Deal = {
  id: string;
  name: string;
  amount?: number | string | null;
  currency?: string | null;
  expectedCloseDate?: string | null;
  description?: string | null;
  pipelineStageId?: string | null;
  pipelineStage?: Stage | null;
  account?: { id: string; name: string } | null;
  ownerId?: string | null;
};

function stageColor(s?: Stage | null): string {
  if (!s) return C.gray;
  if (s.isWon) return C.green;
  if (s.isLost) return C.red;
  return C.indigo;
}

export default function CrmDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [deal, setDeal] = useState<Deal | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([
        fetch("/api/crm/opportunities").then((r) => r.ok ? r.json() : null),
        fetch("/api/crm/pipeline-stages").then((r) => r.ok ? r.json() : null),
      ]);
      const list: Deal[] = d?.opportunities ?? d?.data ?? (Array.isArray(d) ? d : []);
      const found = list.find((x) => x.id === id);
      if (!found) { setNotFound(true); setDeal(null); }
      else { setDeal(found); setNotFound(false); }
      setStages(s?.stages ?? s?.data ?? (Array.isArray(s) ? s : []));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/crm/opportunities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) return false;
      void load();
      return true;
    } catch { return false; }
  }

  if (loading) {
    return (
      <>
        <OsTitleBar title="Loading deal…" Icon={BarChart3} iconGradient={GRAD.greenTeal} showActions={false} />
        <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading deal…</div>
      </>
    );
  }
  if (notFound || !deal) {
    return (
      <>
        <OsTitleBar title="Deal not found" Icon={BarChart3} iconGradient={GRAD.redPink} showActions={false} />
        <OsEmptyView Icon={BarChart3} iconGradient={GRAD.redPink} title="We couldn't find that deal" subtitle="It may have been deleted or you don't have access." cta="Back to CRM" />
      </>
    );
  }

  const stageOptions: PickerOption[] = stages.map((s) => ({ value: s.id, label: s.name, color: stageColor(s) }));
  const stage = deal.pipelineStage ?? null;
  const amount = typeof deal.amount === "string" ? parseFloat(deal.amount) : (deal.amount ?? null);

  return (
    <OsItemDetail
      backHref="/crm" backLabel="CRM Pipeline"
      Icon={BarChart3} iconGradient={GRAD.greenTeal}
      moduleId="crm" itemId={deal.id} title={deal.name}
      onRenameSave={(t) => patch({ name: t })}
      status={stage ? { label: stage.name, color: stageColor(stage) } : undefined}
      statusOptions={stageOptions}
      activeStatusValue={deal.pipelineStageId ?? undefined}
      onStatusPick={(v) => patch({ pipelineStageId: v })}
      description={deal.description}
      fields={[
        { label: "Account", value: <span>{deal.account?.name ?? "—"}</span> },
        { label: "Amount", value: <span style={{ fontWeight: 700 }}>{amount ? `${deal.currency ?? "₹"}${amount.toLocaleString()}` : "—"}</span> },
        { label: "Close date", value: deal.expectedCloseDate ? (<>
          <CalendarIcon style={{ width: 13, height: 13, color: "var(--os-ink-3)" }} />
          <span>{new Date(deal.expectedCloseDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
        </>) : <span style={{ color: "var(--os-ink-3)" }}>—</span> },
        { label: "Owner", value: <span style={{ color: deal.ownerId ? "var(--os-ink-2)" : "var(--os-ink-3)" }}>{deal.ownerId ?? "Unassigned"}</span> },
      ]}
    />
  );
}

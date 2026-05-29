"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Megaphone, Calendar as CalendarIcon, Target } from "lucide-react";
import { OsItemDetail } from "@/components/layout/os/item-detail";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { C, GRAD } from "@/components/layout/os/catalog";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type CampaignStatus = "PLANNING" | "APPROVED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";

type Campaign = {
  id: string;
  name: string;
  description?: string | null;
  status: CampaignStatus;
  channel?: string | null;
  budget?: number | string | null;
  spent?: number | string | null;
  currency?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  goalMetric?: string | null;
  goalTarget?: number | null;
  goalActual?: number | null;
};

const STATUS_LABELS: Record<CampaignStatus, string> = {
  PLANNING: "Planning", APPROVED: "Approved", ACTIVE: "Active",
  PAUSED: "Paused", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<CampaignStatus, string> = {
  PLANNING: C.indigo, APPROVED: C.yellow, ACTIVE: C.orange,
  PAUSED: C.brown, COMPLETED: C.green, CANCELLED: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as CampaignStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

function n(v?: number | string | null) { if (v === null || v === undefined) return undefined; return typeof v === "string" ? parseFloat(v) : v; }

export default function MarketingDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [c, setC] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/marketing/campaigns");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: Campaign[] = data.campaigns ?? data.data ?? (Array.isArray(data) ? data : []);
      const found = list.find((x) => x.id === id);
      if (!found) setNotFound(true); else setC(found);
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/marketing/campaigns", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) return false;
      void load();
      return true;
    } catch { return false; }
  }

  if (loading) return (<>
    <OsTitleBar title="Loading campaign…" Icon={Megaphone} iconGradient={GRAD.orangePink} showInvite={false} />
    <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
  </>);
  if (notFound || !c) return (<>
    <OsTitleBar title="Campaign not found" Icon={Megaphone} iconGradient={GRAD.redPink} showInvite={false} />
    <OsEmptyView Icon={Megaphone} iconGradient={GRAD.redPink} title="We couldn't find that campaign" subtitle="It may have been deleted." cta="Back to Marketing" />
  </>);

  const budget = n(c.budget);
  const spent = n(c.spent) ?? 0;
  const cur = c.currency ?? "₹";
  const spentPct = budget ? Math.min(100, Math.round((spent / budget) * 100)) : undefined;
  const goalPct = c.goalTarget ? Math.min(100, Math.round(((c.goalActual ?? 0) / c.goalTarget) * 100)) : undefined;

  return (
    <OsItemDetail
      backHref="/marketing" backLabel="Marketing"
      Icon={Megaphone} iconGradient={GRAD.orangePink}
      moduleId="marketing" itemId={c.id} title={c.name}
      onRenameSave={(v) => patch({ name: v })}
      status={{ label: STATUS_LABELS[c.status], color: STATUS_COLORS[c.status] }}
      statusOptions={STATUS_OPTIONS}
      activeStatusValue={c.status}
      onStatusPick={(v) => patch({ status: v })}
      description={c.description}
      fields={[
        { label: "Channel", value: <span style={{ fontWeight: 600 }}>{c.channel ?? "—"}</span> },
        { label: "Budget", value: <span style={{ fontWeight: 700 }}>{budget ? `${cur}${budget.toLocaleString()}` : "—"}</span> },
        {
          label: "Spent",
          value: budget ? (<>
            <span style={{ width: 120, height: 6, background: "var(--os-surface-2)", borderRadius: 999, overflow: "hidden" }}>
              <span style={{ display: "block", width: `${spentPct}%`, height: "100%", background: spentPct! > 80 ? C.orange : C.blue, borderRadius: 999 }} />
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--os-ink-2)", marginLeft: 6 }}>{cur}{spent.toLocaleString()} · {spentPct}%</span>
          </>) : <span style={{ fontWeight: 700 }}>{cur}{spent.toLocaleString()}</span>
        },
        { label: "Goal", value: c.goalMetric ? (<>
          <Target style={{ width: 13, height: 13, color: "var(--os-ink-3)" }} />
          <span style={{ fontWeight: 600 }}>{c.goalActual ?? 0} / {c.goalTarget ?? "?"} {c.goalMetric}{goalPct !== undefined ? ` · ${goalPct}%` : ""}</span>
        </>) : <span style={{ color: "var(--os-ink-3)" }}>—</span> },
        { label: "Starts", value: c.startDate ? (<>
          <CalendarIcon style={{ width: 13, height: 13, color: "var(--os-ink-3)" }} />
          <span>{new Date(c.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
        </>) : <span style={{ color: "var(--os-ink-3)" }}>—</span> },
        { label: "Ends", value: c.endDate ? (<>
          <CalendarIcon style={{ width: 13, height: 13, color: "var(--os-ink-3)" }} />
          <span>{new Date(c.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
        </>) : <span style={{ color: "var(--os-ink-3)" }}>—</span> },
      ]}
    />
  );
}

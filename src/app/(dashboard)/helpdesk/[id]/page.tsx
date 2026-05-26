"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Headphones, Calendar as CalendarIcon } from "lucide-react";
import { OsItemDetail } from "@/components/layout/os/item-detail";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { C, GRAD } from "@/components/layout/os/catalog";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type HdStatus = "NEW" | "OPEN" | "PENDING_CUSTOMER" | "PENDING_INTERNAL" | "RESOLVED" | "CLOSED" | "SPAM";

type SupportTicket = {
  id: string;
  subject: string;
  body?: string | null;
  status: HdStatus;
  priority: string;
  channel?: string | null;
  category?: string | null;
  slaTier?: string | null;
  csatScore?: number | null;
  firstResponseDueAt?: string | null;
  resolvedAt?: string | null;
  customer?: { id: string; name?: string | null; email?: string | null; companyName?: string | null } | null;
  assigneeId?: string | null;
};

const STATUS_LABELS: Record<HdStatus, string> = {
  NEW: "New", OPEN: "Open", PENDING_CUSTOMER: "Pending customer",
  PENDING_INTERNAL: "Pending internal", RESOLVED: "Resolved", CLOSED: "Closed", SPAM: "Spam",
};
const STATUS_COLORS: Record<HdStatus, string> = {
  NEW: C.indigo, OPEN: C.orange, PENDING_CUSTOMER: C.purple,
  PENDING_INTERNAL: C.brown, RESOLVED: C.sage, CLOSED: C.green, SPAM: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as HdStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

export default function HelpdeskDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [t, setT] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/helpdesk/tickets");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: SupportTicket[] = data.tickets ?? data.data ?? (Array.isArray(data) ? data : []);
      const found = list.find((x) => x.id === id);
      if (!found) setNotFound(true); else setT(found);
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/helpdesk/tickets", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) return false;
      void load();
      return true;
    } catch { return false; }
  }

  if (loading) return (<>
    <OsTitleBar title="Loading ticket…" Icon={Headphones} iconGradient={GRAD.orangePink} showActions={false} />
    <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
  </>);
  if (notFound || !t) return (<>
    <OsTitleBar title="Ticket not found" Icon={Headphones} iconGradient={GRAD.redPink} showActions={false} />
    <OsEmptyView Icon={Headphones} iconGradient={GRAD.redPink} title="We couldn't find that ticket" subtitle="It may have been deleted or marked spam." cta="Back to Helpdesk" />
  </>);

  const customerName = t.customer?.companyName || t.customer?.name || t.customer?.email || "—";

  return (
    <OsItemDetail
      backHref="/helpdesk" backLabel="Helpdesk"
      Icon={Headphones} iconGradient={GRAD.orangePink}
      moduleId="helpdesk" itemId={t.id} title={t.subject}
      onRenameSave={(v) => patch({ subject: v })}
      status={{ label: STATUS_LABELS[t.status], color: STATUS_COLORS[t.status] }}
      statusOptions={STATUS_OPTIONS}
      activeStatusValue={t.status}
      onStatusPick={(v) => patch({ status: v })}
      description={t.body}
      fields={[
        { label: "Customer", value: <span style={{ fontWeight: 600 }}>{customerName}</span> },
        { label: "Channel", value: <span>{t.channel ?? "—"}</span> },
        { label: "Priority", value: <span style={{ fontWeight: 600 }}>{t.priority}</span> },
        { label: "SLA tier", value: <span>{t.slaTier ?? "—"}</span> },
        { label: "CSAT", value: t.csatScore !== null && t.csatScore !== undefined ? <span style={{ fontWeight: 700 }}>{t.csatScore} / 5</span> : <span style={{ color: "var(--os-ink-3)" }}>—</span> },
        { label: "1st reply by", value: t.firstResponseDueAt ? (<>
          <CalendarIcon style={{ width: 13, height: 13, color: "var(--os-ink-3)" }} />
          <span>{new Date(t.firstResponseDueAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        </>) : <span style={{ color: "var(--os-ink-3)" }}>—</span> },
      ]}
    />
  );
}

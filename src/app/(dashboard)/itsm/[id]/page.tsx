"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Server, Calendar as CalendarIcon } from "lucide-react";
import { OsItemDetail } from "@/components/layout/os/item-detail";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { C, GRAD } from "@/components/layout/os/catalog";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type ItsmStatus = "OPEN" | "TRIAGED" | "IN_PROGRESS" | "WAITING_ON_USER" | "WAITING_ON_VENDOR" | "RESOLVED" | "CLOSED" | "CANCELLED";

type Ticket = {
  id: string;
  title: string;
  description?: string | null;
  status: ItsmStatus;
  priority: string;
  category?: string | null;
  slaTier?: string | null;
  dueAt?: string | null;
  assigneeId?: string | null;
};

const STATUS_LABELS: Record<ItsmStatus, string> = {
  OPEN: "Open", TRIAGED: "Triaged", IN_PROGRESS: "In progress",
  WAITING_ON_USER: "Waiting on user", WAITING_ON_VENDOR: "Waiting on vendor",
  RESOLVED: "Resolved", CLOSED: "Closed", CANCELLED: "Cancelled",
};
const STATUS_COLORS: Record<ItsmStatus, string> = {
  OPEN: C.indigo, TRIAGED: C.yellow, IN_PROGRESS: C.orange,
  WAITING_ON_USER: C.purple, WAITING_ON_VENDOR: C.brown,
  RESOLVED: C.sage, CLOSED: C.green, CANCELLED: C.gray,
};
const STATUS_OPTIONS: PickerOption[] = (Object.keys(STATUS_LABELS) as ItsmStatus[]).map((s) => ({
  value: s, label: STATUS_LABELS[s], color: STATUS_COLORS[s],
}));

export default function ItsmDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [t, setT] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/itsm/tickets");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: Ticket[] = data.tickets ?? data.data ?? (Array.isArray(data) ? data : []);
      const found = list.find((x) => x.id === id);
      if (!found) setNotFound(true); else setT(found);
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/itsm/tickets", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) return false;
      void load();
      return true;
    } catch { return false; }
  }

  if (loading) return (<>
    <OsTitleBar title="Loading ticket…" Icon={Server} iconGradient={GRAD.bluePurple} showActions={false} />
    <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading ticket…</div>
  </>);
  if (notFound || !t) return (<>
    <OsTitleBar title="Ticket not found" Icon={Server} iconGradient={GRAD.redPink} showActions={false} />
    <OsEmptyView Icon={Server} iconGradient={GRAD.redPink} title="We couldn't find that ticket" subtitle="It may have been deleted or you don't have access." cta="Back to ITSM" />
  </>);

  return (
    <OsItemDetail
      backHref="/itsm" backLabel="ITSM"
      Icon={Server} iconGradient={GRAD.bluePurple}
      moduleId="itsm" itemId={t.id} title={t.title}
      onRenameSave={(v) => patch({ title: v })}
      status={{ label: STATUS_LABELS[t.status], color: STATUS_COLORS[t.status] }}
      statusOptions={STATUS_OPTIONS}
      activeStatusValue={t.status}
      onStatusPick={(v) => patch({ status: v })}
      description={t.description}
      fields={[
        { label: "Category", value: <span>{t.category ?? "—"}</span> },
        { label: "Priority", value: <span style={{ fontWeight: 600 }}>{t.priority}</span> },
        { label: "SLA tier", value: <span>{t.slaTier ?? "—"}</span> },
        { label: "Assignee", value: <span style={{ color: t.assigneeId ? "var(--os-ink-2)" : "var(--os-ink-3)" }}>{t.assigneeId ?? "Unassigned"}</span> },
        { label: "Due", value: t.dueAt ? (<>
          <CalendarIcon style={{ width: 13, height: 13, color: "var(--os-ink-3)" }} />
          <span>{new Date(t.dueAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
        </>) : <span style={{ color: "var(--os-ink-3)" }}>—</span> },
      ]}
    />
  );
}

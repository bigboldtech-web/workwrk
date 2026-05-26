"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { UserPlus, Briefcase } from "lucide-react";
import { OsItemDetail } from "@/components/layout/os/item-detail";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { C, GRAD } from "@/components/layout/os/catalog";
import type { PickerOption } from "@/components/layout/os/picker-popover";

type Stage = "APPLIED" | "SCREENING" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED" | "WITHDRAWN";

type App = {
  id: string;
  stage: Stage;
  rejectionReason?: string | null;
  source?: string | null;
  notes?: string | null;
  createdAt: string;
  job?: { id: string; title: string } | null;
  candidate?: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  recruiter?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

const STAGE_LABELS: Record<Stage, string> = {
  APPLIED: "Applied", SCREENING: "Screening", INTERVIEW: "Interview",
  OFFER: "Offer", HIRED: "Hired", REJECTED: "Rejected", WITHDRAWN: "Withdrawn",
};
const STAGE_COLORS: Record<Stage, string> = {
  APPLIED: C.indigo, SCREENING: C.blue, INTERVIEW: C.orange,
  OFFER: C.purple, HIRED: C.green, REJECTED: C.red, WITHDRAWN: C.gray,
};
const STAGE_OPTIONS: PickerOption[] = (Object.keys(STAGE_LABELS) as Stage[]).map((s) => ({
  value: s, label: STAGE_LABELS[s], color: STAGE_COLORS[s],
}));

function candidateName(c?: App["candidate"]) {
  if (!c) return "Unknown";
  return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email || "Unknown";
}

export default function RecruitingDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [a, setA] = useState<App | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/recruiting/applications?scope=all");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: App[] = data.data ?? (Array.isArray(data) ? data : []);
      const found = list.find((x) => x.id === id);
      if (!found) setNotFound(true); else setA(found);
    } catch { setNotFound(true); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`/api/recruiting/applications/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) return false;
      void load();
      return true;
    } catch { return false; }
  }

  if (loading) return (<>
    <OsTitleBar title="Loading application…" Icon={UserPlus} iconGradient={GRAD.orangePink} showActions={false} />
    <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
  </>);
  if (notFound || !a) return (<>
    <OsTitleBar title="Application not found" Icon={UserPlus} iconGradient={GRAD.redPink} showActions={false} />
    <OsEmptyView Icon={UserPlus} iconGradient={GRAD.redPink} title="We couldn't find that application" subtitle="It may have been withdrawn or you don't have access." cta="Back to Recruiting" />
  </>);

  const recName = a.recruiter ? `${a.recruiter.firstName ?? ""} ${a.recruiter.lastName ?? ""}`.trim() : null;

  return (
    <OsItemDetail
      backHref="/recruiting" backLabel="Recruiting"
      Icon={UserPlus} iconGradient={GRAD.orangePink}
      moduleId="recruiting" itemId={a.id}
      title={candidateName(a.candidate)}
      status={{ label: STAGE_LABELS[a.stage], color: STAGE_COLORS[a.stage] }}
      statusOptions={STAGE_OPTIONS}
      activeStatusValue={a.stage}
      onStatusPick={(v) => patch({ stage: v })}
      description={a.notes}
      fields={[
        { label: "Job", value: (<>
          <Briefcase style={{ width: 13, height: 13, color: "var(--os-ink-3)" }} />
          <span>{a.job?.title ?? "—"}</span>
        </>) },
        { label: "Email", value: <span style={{ color: a.candidate?.email ? "var(--os-ink-2)" : "var(--os-ink-3)" }}>{a.candidate?.email ?? "—"}</span> },
        { label: "Source", value: <span>{a.source ?? "—"}</span> },
        { label: "Recruiter", value: <span style={{ color: recName ? "var(--os-ink-2)" : "var(--os-ink-3)" }}>{recName || "Unassigned"}</span> },
        { label: "Applied", value: <span>{new Date(a.createdAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span> },
        ...(a.rejectionReason ? [{ label: "Rejection reason", value: <span style={{ color: "var(--os-c-red)" }}>{a.rejectionReason}</span> }] : []),
      ]}
    />
  );
}

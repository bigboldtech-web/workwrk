"use client";

/* Per-policy audit ledger — the evidentiary record for one policy: who is
 * required, who acknowledged which version, when, from where, and what
 * statement they agreed to. Export CSV for legal/audit hand-off.
 *
 * Reads: GET /api/policies/[id]/ledger ; CSV: /api/policies/[id]/ledger/export
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ShieldCheck, ArrowLeft, Download, Loader2, CheckCircle2, AlertCircle, Clock, RefreshCw } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";

type Row = {
  userId: string; name: string; email: string | null; department: string; required: boolean;
  status: "acked" | "overdue" | "out-of-date" | "pending";
  versionAcked: number | null; acknowledgedAt: string | null; ipAddress: string | null;
  userAgent: string | null; attestation: string | null; contentHash: string | null;
  dueDate: string | null; daysOverdue: number;
};
type Ledger = {
  policy: { id: string; title: string; version: number; ackVersion: number; status: string; category: string | null };
  rows: Row[];
  summary: { total: number; acked: number; overdue: number; outOfDate: number; pending: number; rate: number };
};

const STATUS: Record<Row["status"], { label: string; color: string; Icon: typeof CheckCircle2 }> = {
  acked: { label: "Acknowledged", color: "var(--os-c-green)", Icon: CheckCircle2 },
  overdue: { label: "Overdue", color: "var(--os-c-red)", Icon: AlertCircle },
  "out-of-date": { label: "Re-ack required", color: "var(--os-c-orange)", Icon: RefreshCw },
  pending: { label: "Pending", color: "var(--os-c-orange)", Icon: Clock },
};

function fmt(iso: string | null) { return iso ? new Date(iso).toLocaleString() : "—"; }

export default function PolicyLedgerPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<Ledger | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/policies/${id}/ledger`);
      if (res.status === 403) { setErr("Manager access required."); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d.data ?? d);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "load failed"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <OsTitleBar
        title="Audit ledger"
        Icon={ShieldCheck}
        iconGradient={GRAD.indigoBlue}
        showStandardActions={false}
        description={data ? `${data.policy.title} · v${data.policy.version} · acks measured on v${data.policy.ackVersion}` : "Loading…"}
        actions={
          <div className="flex items-center gap-2">
            {data ? (
              <a href={`/api/policies/${id}/ledger/export`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[13px] font-medium text-white hover:bg-violet-500">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </a>
            ) : null}
            <Link href={`/policies/${id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to policy
            </Link>
          </div>
        }
      />

      <div className="px-6 py-6">
        {err ? (
          <OsEmptyView Icon={ShieldCheck} iconGradient={GRAD.indigoBlue} title="Couldn't load ledger" subtitle={err} cta="Retry" />
        ) : data === null ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Compliance" value={`${data.summary.rate}%`} sub={`${data.summary.acked}/${data.summary.total} acked`} color="var(--os-c-green)" />
              <Stat label="Overdue" value={`${data.summary.overdue}`} sub="past due, not acked" color={data.summary.overdue ? "var(--os-c-red)" : "var(--os-c-green)"} />
              <Stat label="Re-ack required" value={`${data.summary.outOfDate}`} sub="acked an old version" color={data.summary.outOfDate ? "var(--os-c-orange)" : "var(--os-c-green)"} />
              <Stat label="Pending" value={`${data.summary.pending}`} sub="never acked" color={data.summary.pending ? "var(--os-c-orange)" : "var(--os-c-green)"} />
            </div>

            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-zinc-100 text-[11px] uppercase tracking-wide text-zinc-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Person</th>
                    <th className="px-3 py-2 font-medium">Dept</th>
                    <th className="px-3 py-2 font-medium">Required</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Ver</th>
                    <th className="px-3 py-2 font-medium">Acknowledged at</th>
                    <th className="px-3 py-2 font-medium">IP</th>
                    <th className="px-3 py-2 font-medium">Attestation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {data.rows.map((r) => {
                    const s = STATUS[r.status];
                    return (
                      <tr key={r.userId} className="hover:bg-zinc-50/60">
                        <td className="px-3 py-2">
                          <div className="font-medium text-zinc-800">{r.name}</div>
                          {r.email ? <div className="text-[11px] text-zinc-400">{r.email}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-zinc-500">{r.department}</td>
                        <td className="px-3 py-2 text-zinc-500">{r.required ? "Assigned" : "Org-wide"}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: s.color }}>
                            <s.Icon className="h-3.5 w-3.5" /> {s.label}
                            {r.status === "overdue" && r.daysOverdue > 0 ? <em className="not-italic text-zinc-400">· {r.daysOverdue}d</em> : null}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-zinc-500">{r.versionAcked ? `v${r.versionAcked}` : "—"}</td>
                        <td className="px-3 py-2 text-zinc-500">{fmt(r.acknowledgedAt)}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-zinc-400">{r.ipAddress ?? "—"}</td>
                        <td className="max-w-[260px] px-3 py-2 text-[11px] text-zinc-400" title={r.attestation ?? ""}><span className="line-clamp-1">{r.attestation ?? "—"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-zinc-400">Each acknowledgement is pinned to the policy version, hashed (sha256 of the exact content shown), and stamped with time, IP, and the attestation statement the person agreed to.</p>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={{ color }}>{value}</div>
      <div className="text-[11px] text-zinc-400">{sub}</div>
    </div>
  );
}

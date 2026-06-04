"use client";

/* Topbar Surveys popover.
 * Shows the surveys this user is in audience for + has not yet responded to.
 * Click any → /surveys (full page) to actually take it.
 *
 * GET /api/pulse-surveys  (returns hasResponded, inAudience per survey)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, X, ExternalLink, CheckCircle2 } from "lucide-react";

interface ApiSurvey {
  id: string;
  title: string;
  status: string;
  closesAt?: string | null;
  audienceSize: number;
  responseRate: number;
  totalResponses: number;
  hasResponded: boolean;
  inAudience: boolean;
}

function deadlineLabel(iso?: string | null): string {
  if (!iso) return "No close date";
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  if (diff < 0) return "Closed";
  const days = Math.floor(diff / 86400_000);
  if (days < 1) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  if (days < 7) return `Closes in ${days} days`;
  return `Closes ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function OsSurveysPopover({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ApiSurvey[] | null>(null);

  const load = useCallback(() => {
    fetch("/api/pulse-surveys")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const list: ApiSurvey[] = data?.data ?? data ?? [];
        setRows(Array.isArray(list) ? list : []);
      })
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { pending, taken } = useMemo(() => {
    const pending: ApiSurvey[] = [];
    const taken: ApiSurvey[] = [];
    for (const r of rows ?? []) {
      if (!r.inAudience) continue;
      if (r.status !== "ACTIVE") continue;
      if (r.hasResponded) taken.push(r);
      else pending.push(r);
    }
    return { pending, taken };
  }, [rows]);

  return (
    <div
      role="dialog"
      aria-label="Surveys"
      className="bg-white rounded-xl border border-zinc-200 shadow-2xl overflow-hidden"
    >
      <header className="px-3.5 py-2.5 border-b border-zinc-100 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-zinc-900 inline-flex items-center gap-2">
          <FileSpreadsheet className="h-3.5 w-3.5 text-zinc-500" />
          Surveys
          {pending.length > 0 ? (
            <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
              {pending.length} pending
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-zinc-400 hover:text-zinc-700 p-1 -m-1 rounded hover:bg-zinc-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="max-h-[420px] overflow-y-auto">
        {rows === null ? (
          <div className="px-4 py-8 text-center text-[12px] text-zinc-400">Loading…</div>
        ) : pending.length === 0 && taken.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="text-[12.5px] text-zinc-700 font-medium">You&rsquo;re all caught up</div>
            <div className="mt-1 text-[11.5px] text-zinc-500 max-w-[260px] mx-auto">
              No active surveys for you right now. New pulses arrive here as soon as they&rsquo;re open.
            </div>
          </div>
        ) : (
          <>
            {pending.length > 0 ? (
              <SurveysSection title="Take now" rows={pending} accent="amber" />
            ) : null}
            {taken.length > 0 ? (
              <SurveysSection title="Already taken" rows={taken} accent="zinc" subtle />
            ) : null}
          </>
        )}
      </div>

      <footer className="px-3.5 py-2 border-t border-zinc-100">
        <Link
          href="/surveys"
          onClick={onClose}
          className="text-[12px] text-zinc-600 hover:text-zinc-900 inline-flex items-center gap-1"
        >
          See all surveys
          <ExternalLink className="h-3 w-3" />
        </Link>
      </footer>
    </div>
  );
}

function SurveysSection({
  title,
  rows,
  accent,
  subtle,
}: {
  title: string;
  rows: ApiSurvey[];
  accent: "amber" | "zinc";
  subtle?: boolean;
}) {
  return (
    <div className={subtle ? "border-t border-zinc-100" : ""}>
      <div className="px-3.5 pt-3 pb-1 text-[10px] uppercase tracking-wide text-zinc-400 font-semibold">
        {title}
      </div>
      <ul className="px-1.5 pb-2">
        {rows.map((s) => (
          <li key={s.id}>
            <Link
              href={`/surveys`}
              className="flex items-start gap-2.5 px-2 py-2 rounded-md hover:bg-zinc-50 group"
            >
              <span
                className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${
                  accent === "amber" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-500"
                }`}
              >
                {subtle ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-medium text-zinc-900 truncate">
                  {s.title}
                </span>
                <span className="block text-[11px] text-zinc-500 truncate">
                  {subtle ? "Submitted · thanks!" : deadlineLabel(s.closesAt)}
                  {!subtle && s.audienceSize > 0
                    ? ` · ${s.totalResponses}/${s.audienceSize} responded`
                    : ""}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

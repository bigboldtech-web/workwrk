"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { Target, Flame, Clock, TrendingUp, Send, Loader2 } from "lucide-react";
import { Sparkline } from "@/components/okrs/sparkline";

interface CheckIn {
  id: string;
  value: number;
  note: string | null;
  createdAt: string;
}

interface KeyResult {
  id: string;
  title: string;
  startValue: number;
  currentValue: number;
  targetValue: number;
  unit: string | null;
  progress: number;
  checkIns: CheckIn[];
  lastCheckInAt: string | null;
  daysSinceCheckIn: number | null;
  isStale: boolean;
}

interface OKR {
  id: string;
  title: string;
  description: string | null;
  level: "COMPANY" | "TEAM" | "INDIVIDUAL";
  quarter: string;
  status: "ON_TRACK" | "AT_RISK" | "BEHIND" | "COMPLETED" | "DRAFT";
  progress: number;
  isOwnedByMe: boolean;
  keyResults: KeyResult[];
  owner: { firstName: string; lastName: string } | null;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; ring: string; label: string }> = {
  ON_TRACK:  { bg: "bg-[rgba(212,255,46,0.12)]",  text: "text-[#d4ff2e]",  ring: "ring-[rgba(212,255,46,0.3)]",  label: "On track" },
  AT_RISK:   { bg: "bg-[rgba(245,158,11,0.12)]",  text: "text-amber-400",  ring: "ring-[rgba(245,158,11,0.3)]",  label: "At risk" },
  BEHIND:    { bg: "bg-[rgba(239,68,68,0.12)]",   text: "text-red-400",    ring: "ring-[rgba(239,68,68,0.3)]",   label: "Behind" },
  COMPLETED: { bg: "bg-[rgba(34,197,94,0.12)]",   text: "text-green-400",  ring: "ring-[rgba(34,197,94,0.3)]",   label: "Completed" },
  DRAFT:     { bg: "bg-surface-2",                text: "text-muted",      ring: "ring-border",                  label: "Draft" },
};

function progressColor(p: number) {
  if (p >= 100) return "bg-green-500";
  if (p >= 70) return "bg-[#d4ff2e]";
  if (p >= 40) return "bg-amber-500";
  return "bg-red-500";
}

interface Props {
  /** Called whenever the hero refreshes its data. Lets the parent
   *  page sync filters or related widgets. */
  onRefresh?: () => void;
}

/**
 * "My OKRs" hero — the top-of-page experience for `/okrs`.
 *
 * Each owned KR gets a card showing:
 *   - target vs current with a fat progress bar
 *   - sparkline of the last 8 check-ins
 *   - "X days since last check-in" nudge (amber if stale)
 *   - inline numeric input + tiny note + send → POSTs to /check-in
 *
 * Company and team OKRs are shown in a separate row below as
 * read-only context cards (so people see how their work fits in).
 */
export function MyOkrsHero({ onRefresh }: Props) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [data, setData] = useState<{ okrs: OKR[]; quarter: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Inline check-in state, keyed by KR id so we can edit several at once.
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/okrs/my-okrs");
      if (r.ok) {
        const d = await r.json();
        setData(d.data || d);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function checkIn(okrId: string, kr: KeyResult) {
    const raw = draftValues[kr.id];
    if (raw === undefined || raw === "") return;
    const value = Number(raw);
    if (Number.isNaN(value)) {
      toastError("Enter a number");
      return;
    }
    setSubmitting(kr.id);
    try {
      const res = await fetch(`/api/okrs/${okrId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyResultId: kr.id, value, note: draftNotes[kr.id] || null }),
      });
      if (res.ok) {
        toastSuccess("Check-in saved");
        setDraftValues((prev) => ({ ...prev, [kr.id]: "" }));
        setDraftNotes((prev) => ({ ...prev, [kr.id]: "" }));
        await load();
        onRefresh?.();
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to check in");
      }
    } finally {
      setSubmitting(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}><CardContent className="p-4 h-40 animate-pulse bg-surface-2" /></Card>
        ))}
      </div>
    );
  }

  const okrs = data?.okrs ?? [];
  const myOkrs = okrs.filter((o) => o.isOwnedByMe);
  const contextOkrs = okrs.filter((o) => !o.isOwnedByMe);

  // Aggregates for the header strip.
  const myKRs = myOkrs.flatMap((o) => o.keyResults);
  const overdueCount = myKRs.filter((kr) => kr.isStale).length;
  const avgProgress = myKRs.length === 0 ? 0 : Math.round(myKRs.reduce((s, kr) => s + (kr.progress || 0), 0) / myKRs.length);
  const onTrackCount = myOkrs.filter((o) => o.status === "ON_TRACK" || o.status === "COMPLETED").length;

  return (
    <div className="space-y-5">
      {/* Header strip — at-a-glance state of *my* goals this quarter. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile icon={Target} label="My OKRs" value={String(myOkrs.length)} hint={`${onTrackCount} on track`} />
        <SummaryTile icon={TrendingUp} label="Avg progress" value={`${avgProgress}%`} progress={avgProgress} />
        <SummaryTile
          icon={Clock}
          label="Need check-in"
          value={String(overdueCount)}
          hint={overdueCount === 0 ? "All up to date" : "More than 7 days old"}
          tone={overdueCount > 0 ? "amber" : "default"}
        />
        <SummaryTile icon={Flame} label="Quarter" value={data?.quarter ?? "—"} hint="Goals in this period" />
      </div>

      {/* My OKRs — owned by the current user, focus of the page. */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Target size={14} className="text-[#d4ff2e]" /> Your goals this quarter
          </h2>
          <span className="text-[11px] text-muted font-mono">{data?.quarter}</span>
        </div>
        {myOkrs.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted">
            You don&rsquo;t own any OKRs this quarter yet. Ask your manager, or create one from the
            full list below.
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {myOkrs.map((okr) => (
              <OkrOwnedCard
                key={okr.id}
                okr={okr}
                draftValues={draftValues}
                draftNotes={draftNotes}
                setDraftValues={setDraftValues}
                setDraftNotes={setDraftNotes}
                submittingKrId={submitting}
                onCheckIn={(kr) => checkIn(okr.id, kr)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Context OKRs — Company + Team. Read-only "this is what we're doing." */}
      {contextOkrs.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Target size={14} className="text-muted" /> Goals you contribute to
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {contextOkrs.map((okr) => (
              <OkrContextCard key={okr.id} okr={okr} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryTile({
  icon: Icon, label, value, hint, progress, tone = "default",
}: {
  icon: any; label: string; value: string; hint?: string; progress?: number; tone?: "default" | "amber";
}) {
  return (
    <Card>
      <CardContent className="p-3.5">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <Icon size={12} />
          {label}
        </div>
        <div className={`mt-1 text-2xl font-bold tabular-nums ${tone === "amber" ? "text-amber-400" : ""}`}>
          {value}
        </div>
        {progress !== undefined && (
          <Progress value={progress} className="h-1 mt-2" indicatorClassName={progressColor(progress)} />
        )}
        {hint && <div className="text-[10px] text-muted mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function OkrOwnedCard({
  okr, draftValues, draftNotes, setDraftValues, setDraftNotes, submittingKrId, onCheckIn,
}: {
  okr: OKR;
  draftValues: Record<string, string>;
  draftNotes: Record<string, string>;
  setDraftValues: (f: (prev: Record<string, string>) => Record<string, string>) => void;
  setDraftNotes: (f: (prev: Record<string, string>) => Record<string, string>) => void;
  submittingKrId: string | null;
  onCheckIn: (kr: KeyResult) => void;
}) {
  const status = STATUS_COLORS[okr.status] ?? STATUS_COLORS.DRAFT;
  return (
    <Card className={`ring-1 ${status.ring}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px] uppercase">{okr.level}</Badge>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${status.bg} ${status.text}`}>
                {status.label}
              </span>
            </div>
            <h3 className="mt-1.5 text-base font-semibold leading-tight">{okr.title}</h3>
            {okr.description && (
              <p className="text-[12px] text-muted mt-0.5 line-clamp-2">{okr.description}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold tabular-nums">{okr.progress}%</div>
            <Progress value={okr.progress} className="h-1 w-20" indicatorClassName={progressColor(okr.progress)} />
          </div>
        </div>

        {/* KRs */}
        <div className="mt-3 space-y-2">
          {okr.keyResults.map((kr) => {
            const sparkValues = kr.checkIns.map((c) => c.value);
            const submitting = submittingKrId === kr.id;
            return (
              <div key={kr.id} className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{kr.title}</div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted">
                      <span>
                        <span className="text-foreground tabular-nums font-mono">{kr.currentValue}</span>
                        {kr.unit ? ` ${kr.unit}` : ""}
                        <span className="text-muted-2"> / </span>
                        <span className="tabular-nums font-mono">{kr.targetValue}</span>
                        {kr.unit ? ` ${kr.unit}` : ""}
                      </span>
                      <span>·</span>
                      <span className="tabular-nums font-mono">{kr.progress}%</span>
                      <span>·</span>
                      <span className={kr.isStale ? "text-amber-400" : ""}>
                        {kr.daysSinceCheckIn === null
                          ? "Never checked in"
                          : kr.daysSinceCheckIn === 0
                          ? "Updated today"
                          : `${kr.daysSinceCheckIn}d ago`}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-muted">
                    <Sparkline values={sparkValues} />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder={`New value (was ${kr.currentValue})`}
                    value={draftValues[kr.id] ?? ""}
                    onChange={(e) => setDraftValues((prev) => ({ ...prev, [kr.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") onCheckIn(kr); }}
                    disabled={submitting}
                    className="h-8 w-32 font-mono"
                  />
                  <Input
                    placeholder="Quick note (optional)"
                    value={draftNotes[kr.id] ?? ""}
                    onChange={(e) => setDraftNotes((prev) => ({ ...prev, [kr.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") onCheckIn(kr); }}
                    disabled={submitting}
                    className="h-8 flex-1 text-[12.5px]"
                  />
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => onCheckIn(kr)}
                    disabled={submitting || !draftValues[kr.id]}
                  >
                    {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    Check in
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function OkrContextCard({ okr }: { okr: OKR }) {
  const status = STATUS_COLORS[okr.status] ?? STATUS_COLORS.DRAFT;
  return (
    <Card>
      <CardContent className="p-3.5">
        <div className="flex items-center gap-2 mb-1.5">
          <Badge variant="outline" className="text-[10px] uppercase">{okr.level}</Badge>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${status.bg} ${status.text}`}>
            {status.label}
          </span>
          {okr.owner && (
            <span className="text-[10px] text-muted ml-auto truncate">
              {okr.owner.firstName} {okr.owner.lastName}
            </span>
          )}
        </div>
        <div className="text-sm font-semibold leading-tight">{okr.title}</div>
        <div className="flex items-center gap-2 mt-2">
          <Progress value={okr.progress} className="h-1 flex-1" indicatorClassName={progressColor(okr.progress)} />
          <span className="text-xs font-mono tabular-nums">{okr.progress}%</span>
        </div>
      </CardContent>
    </Card>
  );
}

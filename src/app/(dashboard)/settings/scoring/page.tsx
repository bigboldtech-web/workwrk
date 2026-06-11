"use client";

/* Settings · Scoring & reviews — the editable config backbone.
 *
 *  GET   /api/settings                     → org settings (incl. cadences/weights/bands/anchors)
 *  PATCH /api/settings { section:"scoring", data }
 *
 * Four editable sections:
 *   1. Review cadences   — weekly / monthly / quarterly / annual rhythms
 *   2. Score weights     — composite-score metric weights (must sum to 100)
 *   3. Performance bands  — score → label ranges (drives 9-box + composite labels)
 *   4. Behavioral anchors — the 5-point Likert labels used in manager reviews
 *
 * Everything persists to Organization.settings JSON. Save is per-section
 * so a bad weight sum can't block the whole page.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft, Sparkles, BarChart3, Award, MessageSquareText,
  Check, AlertCircle, RotateCcw,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { C } from "@/components/layout/os/catalog";
import {
  CADENCE_LABELS, METRIC_LABELS,
  DEFAULT_CADENCES, DEFAULT_SCORE_WEIGHTS, DEFAULT_SCORING_BANDS, DEFAULT_BEHAVIORAL_ANCHORS,
  validateScoreWeights, validateScoringBands,
  type CadenceKey, type CadenceSetting, type ReviewCadenceConfig,
  type MetricKey, type ScoringBand,
} from "@/lib/review-cadence";

const CADENCE_KEYS: CadenceKey[] = ["weekly", "monthly", "quarterly", "annual"];
const METRIC_KEYS: MetricKey[] = ["kpi", "sopCompliance", "behavioral", "peer"];

const ANCHOR_HINT: Record<CadenceKey, string> = {
  weekly: "Anchor = ISO weekday the check-in is due (1 = Mon … 7 = Sun).",
  monthly: "Anchor = day-of-month the pulse opens (1–28).",
  quarterly: "Anchor = day-of-quarter the cycle opens (1 = first day).",
  annual: "Anchor = month-of-year the appraisal opens (1–12).",
};

type Banner = { kind: "ok" | "err"; text: string } | null;

export default function ScoringSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [cadences, setCadences] = useState<ReviewCadenceConfig>(DEFAULT_CADENCES);
  const [weights, setWeights] = useState<Record<MetricKey, number>>(DEFAULT_SCORE_WEIGHTS);
  const [bands, setBands] = useState<ScoringBand[]>(DEFAULT_SCORING_BANDS);
  const [anchors, setAnchors] = useState<string[]>(DEFAULT_BEHAVIORAL_ANCHORS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        const s = d.settings ?? {};
        if (s.reviewCadences) setCadences(s.reviewCadences);
        if (s.scoreWeights) {
          // Keep only known metric keys; fill missing with defaults.
          setWeights({ ...DEFAULT_SCORE_WEIGHTS, ...s.scoreWeights });
        }
        if (Array.isArray(s.scoringBands) && s.scoringBands.length) setBands(s.scoringBands);
        if (Array.isArray(s.behavioralAnchors) && s.behavioralAnchors.length === 5) setAnchors(s.behavioralAnchors);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div>
        <OsTitleBar title="Scoring & reviews" Icon={Sparkles} iconGradient="" showInvite={false} starred={false} />
        <div className="px-6 py-10 text-[13px] text-zinc-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="pb-16">
      <OsTitleBar
        title="Scoring & reviews"
        Icon={Sparkles}
        iconGradient=""
        description="Cadences, score weights, performance bands & behavioral anchors"
        showInvite={false}
        starred={false}
      />
      <div className="px-6">
        <Link href="/settings" className="inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-800 mb-4">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to settings
        </Link>

        <div className="max-w-3xl space-y-5">
          <CadencesSection cadences={cadences} setCadences={setCadences} />
          <WeightsSection weights={weights} setWeights={setWeights} />
          <BandsSection bands={bands} setBands={setBands} />
          <AnchorsSection anchors={anchors} setAnchors={setAnchors} />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── shared bits ───────────────────────── */

async function saveScoring(data: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ section: "scoring", data }),
    });
    if (res.ok) return { ok: true };
    const d = await res.json().catch(() => ({}));
    return { ok: false, error: d.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "save failed" };
  }
}

function SectionCard({
  Icon, color, title, subtitle, children, footer,
}: {
  Icon: typeof Sparkles;
  color: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white">
      <header className="flex items-start gap-3 p-4 border-b border-zinc-100">
        <span className="grid place-items-center w-8 h-8 rounded-lg shrink-0" style={{ background: `${color}1a`, color }}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-semibold text-zinc-900">{title}</h2>
          <p className="text-[12px] text-zinc-500">{subtitle}</p>
        </div>
      </header>
      <div className="p-4">{children}</div>
      {footer ? <div className="px-4 pb-4">{footer}</div> : null}
    </section>
  );
}

function SaveRow({
  banner, dirty, onSave, onReset, saving,
}: { banner: Banner; dirty: boolean; onSave: () => void; onReset: () => void; saving: boolean }) {
  return (
    <div className="flex items-center gap-3 mt-4 pt-3 border-t border-zinc-100">
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-zinc-900 text-white text-[12px] font-medium disabled:opacity-40 hover:bg-zinc-800"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
      <button
        type="button"
        onClick={onReset}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] text-zinc-500 hover:bg-zinc-100"
      >
        <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
      </button>
      {banner ? (
        <span className={`inline-flex items-center gap-1 text-[12px] ${banner.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>
          {banner.kind === "ok" ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {banner.text}
        </span>
      ) : null}
    </div>
  );
}

/* ───────────────────────── 1. Cadences ───────────────────────── */

function CadencesSection({
  cadences, setCadences,
}: { cadences: ReviewCadenceConfig; setCadences: (c: ReviewCadenceConfig) => void }) {
  const [banner, setBanner] = useState<Banner>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const patch = (key: CadenceKey, p: Partial<CadenceSetting>) => {
    setCadences({ ...cadences, [key]: { ...cadences[key], ...p } });
    setDirty(true);
    setBanner(null);
  };

  const onSave = async () => {
    setSaving(true);
    const r = await saveScoring({ reviewCadences: cadences });
    setSaving(false);
    setBanner(r.ok ? { kind: "ok", text: "Saved" } : { kind: "err", text: r.error ?? "Save failed" });
    if (r.ok) setDirty(false);
  };

  return (
    <SectionCard
      Icon={Sparkles} color={C.pink}
      title="Review cadences"
      subtitle="Turn each review rhythm on or off and set when it anchors."
      footer={<SaveRow banner={banner} dirty={dirty} saving={saving} onSave={onSave} onReset={() => { setCadences(DEFAULT_CADENCES); setDirty(true); }} />}
    >
      <div className="space-y-2.5">
        {CADENCE_KEYS.map((key) => {
          const c = cadences[key];
          return (
            <div key={key} className={`rounded-lg border p-3 ${c.enabled ? "border-zinc-200" : "border-zinc-100 bg-zinc-50/60"}`}>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={c.enabled}
                  onClick={() => patch(key, { enabled: !c.enabled })}
                  style={{
                    backgroundColor: c.enabled ? "var(--os-brand)" : "#e4e4e7",
                    border: c.enabled ? "1px solid var(--os-brand)" : "1px solid #d4d4d8",
                  }}
                  className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors" >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform ${c.enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                </button>
                <span className="text-[13px] font-medium text-zinc-800 flex-1">{CADENCE_LABELS[key]}</span>
              </div>
              {c.enabled ? (
                <div className="mt-2.5 grid grid-cols-3 gap-3 pl-12">
                  <label className="text-[11.5px] text-zinc-500">
                    Anchor
                    <input
                      type="number" min={1} value={c.anchor}
                      onChange={(e) => patch(key, { anchor: Number(e.target.value) })}
                      className="mt-0.5 w-full h-7 px-2 rounded border border-zinc-200 text-[12px] text-zinc-800"
                    />
                  </label>
                  <label className="text-[11.5px] text-zinc-500">
                    Reminder lead (days)
                    <input
                      type="number" min={0} value={c.reminderLeadDays}
                      onChange={(e) => patch(key, { reminderLeadDays: Number(e.target.value) })}
                      className="mt-0.5 w-full h-7 px-2 rounded border border-zinc-200 text-[12px] text-zinc-800"
                    />
                  </label>
                  <label className="flex items-end gap-1.5 text-[11.5px] text-zinc-600 pb-1">
                    <input
                      type="checkbox" checked={c.autoOpen}
                      onChange={(e) => patch(key, { autoOpen: e.target.checked })}
                    />
                    Auto-open
                  </label>
                  <p className="col-span-3 text-[11px] text-zinc-400 -mt-1">{ANCHOR_HINT[key]}</p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

/* ───────────────────────── 2. Score weights ───────────────────────── */

function WeightsSection({
  weights, setWeights,
}: { weights: Record<MetricKey, number>; setWeights: (w: Record<MetricKey, number>) => void }) {
  const [banner, setBanner] = useState<Banner>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const sum = useMemo(() => METRIC_KEYS.reduce((a, k) => a + (weights[k] ?? 0), 0), [weights]);
  const valid = validateScoreWeights(weights).ok;

  const set = (k: MetricKey, v: number) => {
    setWeights({ ...weights, [k]: v });
    setDirty(true);
    setBanner(null);
  };

  const onSave = async () => {
    const v = validateScoreWeights(weights);
    if (!v.ok) { setBanner({ kind: "err", text: v.error ?? "Invalid" }); return; }
    setSaving(true);
    const r = await saveScoring({ scoreWeights: weights });
    setSaving(false);
    setBanner(r.ok ? { kind: "ok", text: "Saved" } : { kind: "err", text: r.error ?? "Save failed" });
    if (r.ok) setDirty(false);
  };

  return (
    <SectionCard
      Icon={BarChart3} color={C.purple}
      title="Score weights"
      subtitle="How each metric weighs into the composite performance score."
      footer={<SaveRow banner={banner} dirty={dirty} saving={saving} onSave={onSave} onReset={() => { setWeights(DEFAULT_SCORE_WEIGHTS); setDirty(true); }} />}
    >
      <div className="space-y-2.5">
        {METRIC_KEYS.map((k) => (
          <div key={k} className="flex items-center gap-3">
            <span className="text-[12.5px] text-zinc-700 w-40 shrink-0">{METRIC_LABELS[k]}</span>
            <input
              type="range" min={0} max={100} value={weights[k] ?? 0}
              onChange={(e) => set(k, Number(e.target.value))}
              className="flex-1 accent-zinc-800"
            />
            <input
              type="number" min={0} max={100} value={weights[k] ?? 0}
              onChange={(e) => set(k, Number(e.target.value))}
              className="w-16 h-7 px-2 rounded border border-zinc-200 text-[12px] text-zinc-800 text-right"
            />
            <span className="text-[12px] text-zinc-400 w-3">%</span>
          </div>
        ))}
      </div>
      <div className={`mt-3 text-[12px] font-medium ${valid ? "text-emerald-600" : "text-red-600"}`}>
        Total: {sum}% {valid ? "✓" : "— must equal 100%"}
      </div>
    </SectionCard>
  );
}

/* ───────────────────────── 3. Performance bands ───────────────────────── */

function BandsSection({
  bands, setBands,
}: { bands: ScoringBand[]; setBands: (b: ScoringBand[]) => void }) {
  const [banner, setBanner] = useState<Banner>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const valid = validateScoringBands(bands).ok;

  const set = (i: number, p: Partial<ScoringBand>) => {
    setBands(bands.map((b, idx) => (idx === i ? { ...b, ...p } : b)));
    setDirty(true);
    setBanner(null);
  };

  const onSave = async () => {
    const v = validateScoringBands(bands);
    if (!v.ok) { setBanner({ kind: "err", text: v.error ?? "Invalid" }); return; }
    setSaving(true);
    const r = await saveScoring({ scoringBands: bands });
    setSaving(false);
    setBanner(r.ok ? { kind: "ok", text: "Saved" } : { kind: "err", text: r.error ?? "Save failed" });
    if (r.ok) setDirty(false);
  };

  return (
    <SectionCard
      Icon={Award} color={C.indigo}
      title="Performance bands"
      subtitle="Score ranges that map a composite score to a label."
      footer={<SaveRow banner={banner} dirty={dirty} saving={saving} onSave={onSave} onReset={() => { setBands(DEFAULT_SCORING_BANDS); setDirty(true); }} />}
    >
      <div className="space-y-2">
        {bands.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="color"
              value={b.color?.startsWith("#") ? b.color : "#a1a1aa"}
              onChange={(e) => set(i, { color: e.target.value })}
              className="w-7 h-7 rounded border border-zinc-200 p-0.5 shrink-0 cursor-pointer"
              aria-label="Band color"
            />
            <input
              value={b.label}
              onChange={(e) => set(i, { label: e.target.value })}
              className="flex-1 h-7 px-2 rounded border border-zinc-200 text-[12px] text-zinc-800"
              placeholder="Label"
            />
            <input
              type="number" min={0} max={100} value={b.min}
              onChange={(e) => set(i, { min: Number(e.target.value) })}
              className="w-16 h-7 px-2 rounded border border-zinc-200 text-[12px] text-zinc-800 text-right"
            />
            <span className="text-[11px] text-zinc-400">–</span>
            <input
              type="number" min={0} max={100} value={b.max}
              onChange={(e) => set(i, { max: Number(e.target.value) })}
              className="w-16 h-7 px-2 rounded border border-zinc-200 text-[12px] text-zinc-800 text-right"
            />
          </div>
        ))}
      </div>
      {!valid ? (
        <p className="mt-2 text-[12px] text-red-600">Ranges must stay within 0–100 and not overlap.</p>
      ) : null}
    </SectionCard>
  );
}

/* ───────────────────────── 4. Behavioral anchors ───────────────────────── */

function AnchorsSection({
  anchors, setAnchors,
}: { anchors: string[]; setAnchors: (a: string[]) => void }) {
  const [banner, setBanner] = useState<Banner>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const set = (i: number, v: string) => {
    setAnchors(anchors.map((a, idx) => (idx === i ? v : a)));
    setDirty(true);
    setBanner(null);
  };

  const onSave = async () => {
    if (anchors.some((a) => !a.trim())) { setBanner({ kind: "err", text: "All 5 anchors need a label" }); return; }
    setSaving(true);
    const r = await saveScoring({ behavioralAnchors: anchors });
    setSaving(false);
    setBanner(r.ok ? { kind: "ok", text: "Saved" } : { kind: "err", text: r.error ?? "Save failed" });
    if (r.ok) setDirty(false);
  };

  return (
    <SectionCard
      Icon={MessageSquareText} color={C.teal}
      title="Behavioral anchors"
      subtitle="The 5-point scale labels managers see when rating behaviors."
      footer={<SaveRow banner={banner} dirty={dirty} saving={saving} onSave={onSave} onReset={() => { setAnchors(DEFAULT_BEHAVIORAL_ANCHORS); setDirty(true); }} />}
    >
      <div className="space-y-2">
        {anchors.map((a, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="grid place-items-center w-6 h-6 rounded-full bg-zinc-100 text-[11px] font-semibold text-zinc-600 shrink-0">{i + 1}</span>
            <input
              value={a}
              onChange={(e) => set(i, e.target.value)}
              className="flex-1 h-8 px-2.5 rounded border border-zinc-200 text-[12.5px] text-zinc-800"
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

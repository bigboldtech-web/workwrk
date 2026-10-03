"use client";

// Workspace settings > Scoring & reviews (spec-settings-workspace
// `/settings/scoring`, settings-architecture 5.16). Four cards, each with its
// own dirty state and "Reset to defaults"; ONE sticky Save bar saves the
// dirty cards, one PATCH { section: "scoring" } per card, never two for one.
//
//   Review cadence       settings.reviewCadences: read by the review-cycle
//                        opener (/reviews launch) and the review-cycles cron
//   Score weights        settings.scoreWeights, the four keys the review
//                        cycle engine reads (orgScoring); the older five-key
//                        default migrates on read (org-policy scoreWeightsOf)
//   Performance bands    settings.scoringBands: add and remove rows; read by
//                        the band chip on reviews, calibration and the 9-box
//   Behavioural anchors  settings.behavioralAnchors: the five scale words
//                        the review form shows (orgScoring scaleWords)
//
// Bands carry no colour control: the band chip is the reserved neutral
// StatusChip variant (only the top band reads success), so a colour the
// renderer never paints is not offered. A stored colour is kept on save.
//
// Anyone below Admin who may open this page today (the manager tier, the
// People team) sees every value as text: no control they cannot save.

import { useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SaveBar } from "@/components/settings/save-bar";
import { ConfirmDialog, NativeSelect, NumberInput, TextInput, btn, useTypedNumbers, type TypedNumberField } from "@/components/settings/settings-form";
import { SettingsReadOnlyBanner } from "@/components/settings/settings-read-only";
import { Switch } from "@/components/ui/switch";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useSettingsSection, type SettingsGetBody } from "@/hooks/use-settings-section";
import {
  CADENCE_LABELS, METRIC_LABELS,
  DEFAULT_CADENCES, DEFAULT_SCORING_BANDS, DEFAULT_BEHAVIORAL_ANCHORS,
  type CadenceKey, type CadenceSetting, type ReviewCadenceConfig, type ScoringBand,
} from "@/lib/review-cadence";
import { DEFAULT_FOUR_WEIGHTS, MONTH_NAMES, SCORE_WEIGHT_KEYS, weightsTotal, type ScoreWeightKey } from "@/lib/settings/org-policy";
import { bandError } from "@/lib/settings/scoring-bands";

const CADENCE_KEYS: CadenceKey[] = ["weekly", "monthly", "quarterly", "annual"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Section = "cadences" | "weights" | "bands" | "anchors";
interface Loaded { values: ScoringValues; canEdit: boolean }
interface ScoringValues {
  cadences: ReviewCadenceConfig;
  weights: Record<ScoreWeightKey, number>;
  bands: ScoringBand[];
  anchors: string[];
}

function select(b: SettingsGetBody): Loaded {
  return { values: selectValues(b), canEdit: (b as { viewer?: { canEditScoring?: boolean } }).viewer?.canEditScoring === true };
}

function selectValues(b: SettingsGetBody): ScoringValues {
  const s = (b.settings ?? {}) as Record<string, unknown>;
  const w = (s.scoreWeights ?? {}) as Record<string, number>;
  return {
    cadences: (s.reviewCadences as ReviewCadenceConfig) ?? DEFAULT_CADENCES,
    weights: Object.fromEntries(SCORE_WEIGHT_KEYS.map((k) => [k, typeof w[k] === "number" ? w[k] : DEFAULT_FOUR_WEIGHTS[k]])) as Record<ScoreWeightKey, number>,
    bands: Array.isArray(s.scoringBands) && s.scoringBands.length ? (s.scoringBands as ScoringBand[]) : DEFAULT_SCORING_BANDS,
    anchors: Array.isArray(s.behavioralAnchors) && s.behavioralAnchors.length === 5 ? (s.behavioralAnchors as string[]) : DEFAULT_BEHAVIORAL_ANCHORS,
  };
}

const DEFAULTS: ScoringValues = { cadences: DEFAULT_CADENCES, weights: DEFAULT_FOUR_WEIGHTS, bands: DEFAULT_SCORING_BANDS, anchors: DEFAULT_BEHAVIORAL_ANCHORS };
const RESET_WORDS: Record<Section, string> = {
  cadences: "Weekly, monthly and quarterly on; annual off; the built-in anchors and reminders.",
  weights: "KPI 40, SOP compliance 20, Behavioural 30, Peer 10.",
  bands: "Exceptional 90 to 100, Strong 75 to 89, On track 60 to 74, Needs focus 40 to 59, At risk 0 to 39.",
  anchors: "The five built-in scale words.",
};
const TYPED_PREFIX: Record<Section, string> = { cadences: "cad.", weights: "w.", bands: "band.", anchors: "anchor." };
const STORE_KEY: Record<Section, string> = { cadences: "reviewCadences", weights: "scoreWeights", bands: "scoringBands", anchors: "behavioralAnchors" };

export default function ScoringSettingsPage() {
  const s = useSettingsSection("scoring", select);
  const { toast } = useOsToast();
  const [draft, setDraft] = useState<Partial<ScoringValues>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resetting, setResetting] = useState<Section | null>(null);
  // Every number field keeps what is typed (a cleared field stays clear, "15"
  // is never "1" then "15" clamped); the draft takes only in-range numbers,
  // and Save waits until each field holds one. Keys start with the section's
  // prefix (TYPED_PREFIX) so a reset or a removed band drops its typing.
  const nums = useTypedNumbers();

  const base = s.data?.values ?? null;
  const v: ScoringValues | null = base ? { ...base, ...draft } : null;
  const dirtyKeys = useMemo(
    () => (base ? (Object.keys(draft) as Section[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(base[k])) : []),
    [draft, base],
  );
  const total = v ? weightsTotal(v.weights) : 100;
  const bErr = v ? bandError(v.bands) : null;
  const set = <K extends Section>(k: K, val: ScoringValues[K]) => { setErr(null); setDraft((d) => ({ ...d, [k]: val })); };

  // Not memoized: the typed-number state it consults is rebuilt each render.
  const save = async () => {
    if (!nums.check()) { setErr("Fix the fields marked in red before saving."); return false; }
    if (!v) return true;
    if (dirtyKeys.includes("weights") && total !== 100) { setErr("Score weights must add up to 100"); return false; }
    if (dirtyKeys.includes("bands") && bErr) { setErr(bErr.message); return false; }
    if (dirtyKeys.includes("anchors") && v.anchors.some((a) => !a.trim())) { setErr("All five scale words need a label"); return false; }
    setSaving(true);
    for (const k of dirtyKeys) {
      const r = await s.save({ [STORE_KEY[k]]: v[k] });
      if (!r.ok) { setSaving(false); setErr(r.error ?? "Couldn't save"); return false; }
      setDraft((d) => { const n = { ...d }; delete n[k]; return n; });
    }
    setSaving(false);
    nums.reset();
    toast("Scoring saved");
    return true;
  };

  if (s.status === "error") return <SettingsPage pageKey="scoring"><ErrorState what="the scoring settings" hint={s.error ?? undefined} onRetry={s.retry} /></SettingsPage>;
  if (!v) return <SettingsPage pageKey="scoring"><SkeletonRows rows={8} className="max-w-[760px]" /></SettingsPage>;
  const ro = !s.data?.canEdit;

  const resetBtn = (sec: Section) => (ro ? null : <button type="button" className={btn.ghost} onClick={() => setResetting(sec)}>Reset to defaults</button>);

  return (
    <SettingsPage pageKey="scoring" subtitle="How reviews run and how scores are worked out.">
      <SettingsCardStack>
        {ro ? <SettingsReadOnlyBanner>You can look at these settings. Ask an Owner or Admin to change them.</SettingsReadOnlyBanner> : null}

        <SettingsCard title="Review cadence" id="scoring.cadence" wide="scoring.weights" actions={resetBtn("cadences")}>
          {CADENCE_KEYS.map((key) => {
            const c = v.cadences[key] ?? DEFAULT_CADENCES[key];
            const patch = (p: Partial<CadenceSetting>) => set("cadences", { ...v.cadences, [key]: { ...c, ...p } });
            const lead = nums.field(`cad.${key}.lead`, c.reminderLeadDays, { min: 0, max: 60 }, (n) => patch({ reminderLeadDays: n }));
            return (
              <div key={key} className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft pb-3 last:border-b-0 last:pb-0">
                <span className="w-40 text-base font-medium text-ink">{CADENCE_LABELS[key]}</span>
                {ro ? (
                  <span className="text-base text-ink-2">{c.enabled ? `On · ${anchorWord(key, c.anchor)} · remind ${c.reminderLeadDays} days before${c.autoOpen ? " · opens itself" : ""}` : "Off"}</span>
                ) : (
                  <>
                    {/* Off hides the cadence's day and reminder fields, so a value
                        typed into them and left invalid is forgotten with them: the
                        Save bar never asks to fix a field that is not on screen. */}
                    <Switch checked={c.enabled} onChange={(on) => { if (!on) nums.clear(`cad.${key}.`); patch({ enabled: on }); }} aria-label={`${CADENCE_LABELS[key]} on`} />
                    {c.enabled ? (
                      <>
                        <AnchorControl cadence={key} value={c.anchor} onChange={(a) => patch({ anchor: a })}
                          day={nums.field(`cad.${key}.anchor`, c.anchor, { min: 1, max: key === "monthly" ? 28 : 90 }, (a) => patch({ anchor: a }))} />
                        <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                          Remind
                          <NumberInput {...lead.input} width={64} ariaLabel={`${CADENCE_LABELS[key]} reminder days`} />
                          days before
                        </span>
                        {lead.error ? <span role="alert" className="text-sm text-danger-text">{lead.error}</span> : null}
                        <label className="inline-flex items-center gap-2 text-sm text-ink">
                          <input type="checkbox" className="h-4 w-4" checked={c.autoOpen} onChange={(e) => patch({ autoOpen: e.target.checked })} />
                          Open the cycle automatically
                        </label>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
          <p className="text-sm text-ink-2">
            Run a cycle now from <Link href="/reviews" className="font-medium text-brand-deep hover:underline">Review cycles</Link>.
          </p>
        </SettingsCard>

        <SettingsCard title="Score weights" description="How each part weighs into a person's review score. The monthly performance score on profiles also weighs the manager and self parts, which stay as they are." id="scoring.weights" wide="scoring.weights" actions={resetBtn("weights")}>
          {SCORE_WEIGHT_KEYS.map((k) => {
            const pct = nums.field(`w.${k}`, v.weights[k], { min: 0, max: 100 }, (n) => set("weights", { ...v.weights, [k]: n }));
            return (
            <div key={k} className="flex flex-wrap items-center gap-3">
              <span className="w-44 shrink-0 text-base text-ink">{METRIC_LABELS[k]}</span>
              {ro ? (
                <span className="text-base text-ink">{v.weights[k]}%</span>
              ) : (
                <>
                  <input type="range" min={0} max={100} value={v.weights[k]} aria-label={METRIC_LABELS[k]}
                    onChange={(e) => { nums.clear(`w.${k}`); set("weights", { ...v.weights, [k]: Number(e.target.value) }); }}
                    className="flex-1 accent-[var(--os-brand)]" />
                  <NumberInput {...pct.input} width={72} suffix="%" ariaLabel={`${METRIC_LABELS[k]} percent`} />
                  {pct.error ? <span role="alert" className="w-full text-end text-sm text-danger-text">{pct.error}</span> : null}
                </>
              )}
            </div>
            );
          })}
          <p className={`text-base font-medium ${total === 100 ? "text-ink" : "text-danger-text"}`} role={total === 100 ? undefined : "alert"}>
            Total {total}%{total === 100 ? "" : ". Must add up to 100"}
          </p>
        </SettingsCard>

        <SettingsCard title="Performance bands" description="Score ranges that name a composite score." id="scoring.bands" wide="scoring.bands" actions={resetBtn("bands")}>
          {v.bands.map((b, i) => {
            const from = nums.field(`band.${i}.min`, b.min, { min: 0, max: 100 }, (n) => set("bands", v.bands.map((x, j) => (j === i ? { ...x, min: n } : x))));
            const to = nums.field(`band.${i}.max`, b.max, { min: 0, max: 100 }, (n) => set("bands", v.bands.map((x, j) => (j === i ? { ...x, max: n } : x))));
            return (
            <div key={i}>
              <div className="flex items-center gap-2">
                {ro ? (
                  <span className="text-base text-ink">{b.label}: {b.min} to {b.max}</span>
                ) : (
                  <>
                    <TextInput value={b.label} aria-label="Band name" maxLength={40} invalid={bErr?.row === i}
                      onChange={(e) => set("bands", v.bands.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="max-w-[240px]" />
                    <NumberInput {...from.input} width={72} ariaLabel="From" invalid={from.input.invalid || bErr?.row === i} />
                    <span className="text-ink-2">to</span>
                    <NumberInput {...to.input} width={72} ariaLabel="To" invalid={to.input.invalid || bErr?.row === i} />
                    <button type="button" aria-label={`Remove ${b.label || "band"}`} disabled={v.bands.length <= 1}
                      // Rows below move up a place, so typing held by row
                      // index would land on the wrong band: dropped.
                      onClick={() => { nums.clear(TYPED_PREFIX.bands); set("bands", v.bands.filter((_, j) => j !== i)); }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40">
                      <X className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </>
                )}
              </div>
              {(from.error ?? to.error) && !ro ? <p role="alert" className="mt-1 text-sm text-danger-text">{from.error ?? to.error}</p>
                : bErr?.row === i && !ro ? <p role="alert" className="mt-1 text-sm text-danger-text">{bErr.message}</p> : null}
            </div>
            );
          })}
          {ro ? null : (
            <button type="button" className={`${btn.ghost} self-start`} disabled={v.bands.length >= 10}
              onClick={() => set("bands", [...v.bands, { label: "", min: 0, max: 0, color: "neutral" }])}>
              + Add band
            </button>
          )}
        </SettingsCard>

        <SettingsCard title="Behavioural anchors" description="The five words a reviewer picks from, lowest first." id="scoring.anchors" actions={resetBtn("anchors")}>
          {v.anchors.map((a, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hover text-xs font-semibold text-ink-2">{i + 1}</span>
              {ro ? <span className="text-base text-ink">{a}</span> : (
                <TextInput value={a} maxLength={200} aria-label={`Scale word ${i + 1}`} onChange={(e) => set("anchors", v.anchors.map((x, j) => (j === i ? e.target.value : x)))} />
              )}
            </div>
          ))}
        </SettingsCard>

        <p className="text-sm">
          <Link href="/talent" className="font-medium text-brand-deep hover:underline">Open the talent grid</Link>
        </p>
        {err ? <p role="alert" className="text-sm text-danger-text">{err}</p> : null}
      </SettingsCardStack>

      {ro ? null : <SaveBar dirty={dirtyKeys.length > 0 || nums.blocked} saving={saving} onDiscard={() => { setDraft({}); setErr(null); nums.reset(); }} onSave={save} />}

      <ConfirmDialog
        open={!!resetting}
        onOpenChange={(o) => { if (!o) setResetting(null); }}
        title="Reset to defaults?"
        confirmLabel="Reset"
        onConfirm={() => {
          if (!resetting) return;
          const k = resetting;
          nums.clear(TYPED_PREFIX[k]);
          setDraft((d) => ({ ...d, [k]: DEFAULTS[k] }));
          setResetting(null);
        }}
      >
        <p>{resetting ? RESET_WORDS[resetting] : ""}</p>
        <p className="text-ink-2">Nothing is saved until you press Save changes.</p>
      </ConfirmDialog>
    </SettingsPage>
  );
}

function anchorWord(cadence: CadenceKey, anchor: number): string {
  if (cadence === "weekly") return WEEKDAYS[(anchor - 1 + 7) % 7] ?? `day ${anchor}`;
  if (cadence === "annual") return MONTH_NAMES[(anchor - 1 + 12) % 12] ?? `month ${anchor}`;
  if (cadence === "monthly") return `day ${anchor} of the month`;
  return `day ${anchor} of the quarter`;
}

function AnchorControl({ cadence, value, onChange, day }: { cadence: CadenceKey; value: number; onChange: (n: number) => void; day: TypedNumberField }) {
  if (cadence === "weekly") {
    return <NativeSelect ariaLabel="Due on" value={String(value)} options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d }))} onChange={(x) => onChange(Number(x))} />;
  }
  if (cadence === "annual") {
    return <NativeSelect ariaLabel="Opens in" value={String(value)} options={MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }))} onChange={(x) => onChange(Number(x))} />;
  }
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-2">
      Opens on day
      <NumberInput {...day.input} width={64} ariaLabel="Opens on day" />
      {day.error ? <span role="alert" className="text-danger-text">{day.error}</span> : null}
    </span>
  );
}

# AI Performance Manager — Plan

> **Date:** 2026-06-17 · **Status:** Proposed · **Owner:** Ibrahim
> Extends the AI-OS vision ("the AI controls the people") and the Alignment System (KRA/KPI/OKR/SOP/Reviews). This is the feature that turns the alignment system from a *passive tracker of intent* into an *active management layer that measures delivery and ranks performance*.

---

## 1. North star

Every person in WorkwrK gets a **personal AI manager** — an always-on agent that watches their actual work against the KRAs, KPIs, and goals set for their role, and every month answers, with evidence:

- **Is the work being done?** What got delivered vs committed.
- **Are the goals met?** KPI actuals vs targets, OKR/KeyResult progress, KRA coverage.
- **How did this person do?** A composite, explainable score + a written verdict.
- **Who's the best performer? Who's slipping?** An org-wide, period-over-period leaderboard with the *why* attached.

The differentiator vs. every other PM/HR tool: the score is **computed deterministically and is fully auditable**, and the **AI layer adds the judgment a spreadsheet can't** — context, coaching, qualitative read, and a plain-English narrative — without being a black box that "decides who gets fired."

---

## 2. What already exists (build on this — do NOT rebuild)

**Agent runtime** — reuse it wholesale:
- `Agent` model has `autonomousEnabled`, `scheduleCron`, `autonomousPrompt`, `nextRunAt`, `systemPrompt`, `tools`, `modelOverride`.
- `/api/cron/run-due-agents` already fires due autonomous agents; `AgentRun` captures output + tokens + cost; `AgentMemory` is keyed/scoped JSON memory.
- Libs: `src/lib/agents/{autonomous,catalog,tools}.ts` (tools.ts is ~90KB of agent tools).

**Scoring inputs — already modeled:**
- `KRA` (+ `KRAAssignment.weightage`, `period`, `status`) → `KPI` (`targetValue`, `frequency`, `lowerIsBetter`, `type` QUANTITATIVE/QUALITATIVE) → `KPIRecord` (per `userId`+`period`: `targetValue`, `actualValue`, `score`, `status` PENDING/SUBMITTED/APPROVED/REJECTED, `evidence`, `managerNotes`).
- `OKR` + `KeyResult`, `Review` + `ReviewCycle`, `WeeklyReview`.
- **Delivery signals:** `Item` + `ItemActivity`, `Task` (`estimateHours`/`hoursSpent`/`completedAt`/`incompleteReason`), `TimerSession`, `ProcessRun`, `SOPCompliance` + `SOPAssignment`.

**Rollup helpers — already exist:** `src/lib/{team-alignment,team-rollup,kpi-record,kpi-utils,review-cadence,weekly-review}.ts`; pages `/team/alignment`, `/team/rollup`, `/team/kpi-reviews`, `/team/reviews`.

> The KPI manager-approval loop (KPIRecord SUBMITTED→APPROVED) already exists — the AI manager **proposes** actuals/scores into that same loop instead of inventing a parallel one.

---

## 3. Architecture — four layers, cleanly separated

The single most important design decision: **the AI does not compute the score.** A deterministic engine does. The AI reads the same data to *contextualize, coach, and handle the qualitative*. This keeps verdicts defensible and prevents "the AI fired me" liability.

```
┌─ Layer 1 · SIGNALS ─────────────────────────────────────────┐
│ Pure read. Collect everything about one person for a period: │
│ KPIRecords, KRA weightages, OKR/KR progress, completed vs    │
│ committed Items/Tasks, timer hours, SOP compliance, weekly   │
│ reviews. → lib/performance/signals.ts  (no AI, no opinions)  │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌─ Layer 2 · SCORING ENGINE (deterministic, auditable) ────────┐
│ Composite score from a transparent, configurable formula.    │
│ Every sub-score cites the rows it came from. No LLM here.     │
│ → lib/performance/score.ts                                   │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌─ Layer 3 · AI MANAGER (the agent) ───────────────────────────┐
│ An Agent archetype bound to a person. Reads signals+score,   │
│ writes: narrative verdict, qualitative KPI scores (where no   │
│ hard number exists), coaching actions, anomaly flags. Runs    │
│ monthly via the existing autonomous cron; weekly "nudge"      │
│ pass optional. → seeded via lib/agents/catalog.ts            │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌─ Layer 4 · ROLLUP / LEADERBOARD ─────────────────────────────┐
│ Snapshots aggregate into a per-team and org-wide ranking with │
│ trend (▲▼) vs last period and drill-through to the evidence.  │
│ → /team/performance + person scorecard + my own view         │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Data model additions

Keep it minimal — most data already exists; we add the *snapshot of a verdict* and the *binding of an agent to a person*.

```prisma
// One immutable record of "how person X did in period P".
model PerformanceSnapshot {
  id             String   @id @default(cuid())
  organizationId String
  userId         String                       // the person being evaluated
  period         String                       // "2026-06" (month) — matches KPIRecord.period convention
  // Deterministic outputs (Layer 2)
  compositeScore Float                         // 0–100
  band           PerfBand                      // STAR / STRONG / ON_TRACK / AT_RISK / UNDERPERFORMING
  breakdown      Json                          // { kpi: {score, weight, contributors:[{kpiRecordId,...}]}, kra:{}, okr:{}, delivery:{}, sop:{} }
  // AI outputs (Layer 3)
  narrative      String?  @db.Text             // plain-English verdict, written by the AI manager
  achievements   Json     @default("[]")       // [{title, evidenceRef}]
  risks          Json     @default("[]")       // [{title, severity, evidenceRef}]
  coaching       Json     @default("[]")       // [{action, dueHint}]
  // Provenance + governance
  generatedById  String?                       // Agent.id that produced the AI layer
  agentRunId     String?                       // AgentRun.id for audit
  status         PerfSnapshotStatus @default(DRAFT) // DRAFT → MANAGER_REVIEWED → PUBLISHED
  managerNote    String?  @db.Text
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([userId, period])
  @@index([organizationId, period])
  @@index([organizationId, band])
}

enum PerfBand { STAR STRONG ON_TRACK AT_RISK UNDERPERFORMING }
enum PerfSnapshotStatus { DRAFT MANAGER_REVIEWED PUBLISHED }
```

**Binding an agent to a person:** add nullable `managedUserId String?` (+ index) to `Agent`. An Agent with `managedUserId` set and `prebuiltSlug = "ai-manager"` IS that person's manager. This avoids a new join table and reuses the autonomous scheduler. (Alternative if we want one manager → many reports: a `ManagerAssignment` join — defer until needed.)

**Config:** scoring weights live in `OrganizationSettings` (or a small `PerformanceConfig` row) so an org can tune "delivery 40 / KPI 30 / KRA coverage 15 / SOP 10 / OKR 5" without a code change. Default ships opinionated.

---

## 5. The scoring formula (Layer 2) — transparent by design

Composite (0–100) = weighted sum of normalized sub-scores. Defaults (org-tunable):

| Dimension | Default weight | Source | Normalization |
|---|---|---|---|
| **KPI attainment** | 30% | `KPIRecord.actualValue` vs `targetValue` (respect `lowerIsBetter`) | clamp(actual/target) → 0–100, averaged across the person's KPIs weighted by parent `KRAAssignment.weightage` |
| **Goal/OKR progress** | 20% | `KeyResult` progress vs expected pace for the period | % to target, time-adjusted |
| **Delivery** | 30% | completed vs committed `Item`/`Task` in period; on-time %; `incompleteReason` rate | completion ratio + on-time factor |
| **SOP compliance** | 10% | `SOPCompliance` / `SOPAssignment` due in period | % acknowledged/run on time |
| **Cadence/engagement** | 10% | `WeeklyReview` submitted on time; activity recency | submission rate |

Rules that keep it honest:
- **Coverage gate:** if a person has no KRAs/KPIs set, the snapshot is `band = UNSCORED` (don't fabricate a number — surface "needs alignment setup," which reinforces the people-gated-entry pillar).
- **Every sub-score stores its contributors** (the `KPIRecord`/`Item` ids) in `breakdown` so the UI can drill from any number to the rows behind it.
- **Qualitative KPIs** (`KPIType.QUALITATIVE`) have no hard number → the AI proposes a 0–100 with a written justification, flagged as `aiAssessed: true` and routed through the manager-approval loop before it counts.

---

## 6. The AI Manager agent (Layer 3)

- **Archetype:** a prebuilt agent (`prebuiltSlug: "ai-manager"`) seeded per person at provisioning time (or on demand). `autonomousEnabled = true`, `scheduleCron = "monthly"` (plus an optional `"weekly"` nudge variant), `managedUserId` set.
- **System prompt:** "You are {person}'s AI manager. You are fair, evidence-driven, and constructive. You never invent numbers — the deterministic score is given to you. Your job: explain it, surface real achievements and real risks with citations, and propose concrete coaching." 
- **Tools (extend `src/lib/agents/tools.ts`):** `getPerformanceSignals(userId, period)`, `getScoreBreakdown(...)`, `proposeKpiActual(kpiRecordId, value, evidence)` (writes SUBMITTED into the existing approval loop — never auto-approves), `writePerformanceSnapshot(...)`, `flagAnomaly(...)`. All write-tools are guarded + audited via `AgentRun`.
- **Memory:** uses `AgentMemory` (scope=`user`, scopeId=userId) to remember prior months — enables real trend commentary ("third month in a row of slipping on-time delivery") instead of single-shot scoring.
- **Output** lands as a `PerformanceSnapshot` in `DRAFT`; the human manager reviews → `PUBLISHED`. Warn-not-block: nothing punitive is automatic.

---

## 7. Surfaces (Layer 4)

1. **Person scorecard** `/team/performance/[userId]` — composite + band, the 5-dimension breakdown with drill-through, AI narrative, achievements/risks/coaching, month-over-month trend.
2. **Org/team leaderboard** `/team/performance` — ranked cards/table by composite, band chips, ▲▼ vs last period, filter by team/role/period. Manager sees their reports; director sees the slice; admin sees org.
3. **My performance** `/me/performance` — the employee's own view: how they're tracking *this* month (live, pre-snapshot), what their AI manager is seeing, coaching actions as a checklist. Turns evaluation into a feedback loop, not a surprise.
4. **Review queue** — drafts awaiting manager publish, reusing the `/team/reviews` pattern.

---

## 8. Phased delivery (land value early, de-risk the AI last)

- **Phase 0 — Scoring engine, no AI.** `lib/performance/{signals,score}.ts` + `PerformanceSnapshot` model + migration. A cron computes deterministic monthly snapshots. Ship `/team/performance` leaderboard + person scorecard reading real numbers. **This alone is a shippable, valuable product** (objective monthly scorecards from data you already capture).
- **Phase 1 — Live "my performance" view.** Compute the same breakdown on-the-fly for the current (incomplete) period so people see where they stand before month-end. Pure reuse of Phase 0 engine.
- **Phase 2 — AI Manager narrative.** Seed the `ai-manager` agent archetype + tools; it writes `narrative`/`achievements`/`risks`/`coaching` onto the deterministic snapshot. Monthly autonomous run. Manager-review → publish loop.
- **Phase 3 — Qualitative + proposals.** AI proposes qualitative KPI scores + KPIRecord actuals into the existing approval loop; trend memory across months.
- **Phase 4 — Leaderboard intelligence.** Period-over-period movement, "most improved," team health rollup at `/team/rollup`, anomaly flags ("hours logged but nothing delivered").
- **Phase 5 — Closed loop.** Coaching actions become real assignable Items; next month's snapshot checks whether last month's coaching was acted on.

---

## 9. Guardrails (non-negotiable)

- **Explainable, never black-box.** Every number drills to the rows behind it; the AI narrates but does not originate the score.
- **Human-in-the-loop for anything consequential.** Snapshots publish only after manager review; AI never auto-approves KPI records or takes punitive action. Warn-not-block.
- **Fairness.** Coverage gate (no KRAs = UNSCORED, not 0); normalize for partial periods (new joiners, leave); never compare across incomparable roles without role-band context.
- **Data integrity.** Snapshots are immutable per `(userId, period)`; never mutate or delete underlying KPI/KRA/SOP data. Re-runs create new versions, not overwrites of history.
- **Privacy/access.** Reuse `resolveAccess` — a person sees their own; a manager sees direct reports; director sees the slice; admin sees org. Performance data is sensitive — gate hard.

---

## 10. Decisions (resolved 2026-06-17)

1. ✅ **Agent model: per-person.** Each employee gets their own AI manager via `Agent.managedUserId`. Per-person memory/trend.
2. ✅ **Leaderboard visibility: own band + callouts only.** Employees see their own score/band and "top performer" callouts on `/me/performance`; the full ranked list is manager/director/admin-only (gated via `resolveAccess`). Honor this when building both Layer-4 surfaces.
3. ✅ **Scoring weights: balanced 30/20/30/10/10** (KPI 30 · OKR 20 · Delivery 30 · SOP 10 · Cadence 10) — the §5 default. Org-tunable later.

Still open / defer:
- **Period granularity** — monthly snapshots + live current-month is the plan; quarterly rollups tied to `ReviewCycle` can come later (Phase 4+).
```

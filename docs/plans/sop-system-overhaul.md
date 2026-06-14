# SOP system overhaul — polished, type-aware, task-integrated

> Status: PLAN (2026-06-14). Goal: make SOPs (a) look great per type, (b) be
> creatable ONLY from the SOP system but usable/attachable anywhere, and (c)
> connect to tasks with follow + acknowledge + completion tracking.

## Vision (owner's words, distilled)
- SOPs look "pathetic" today — enhance every surface (list, detail, each type).
- Three types, each with the *right* shape:
  - **Written** → looks like our **Notes** (block editor).
  - **Checklist (Next-Step)** → a clean, runnable, tickable checklist.
  - **Recorded** → Scribe-style: screenshots + steps + annotations (we already capture screen).
- SOPs can be **created only from the SOP system**, but **attached/used anywhere** — especially on **tasks**.
- On a task you can attach a Next-Step / Written / Recorded SOP; the assignee sees it and must **follow** it. For Next-Step, they tick through steps; everything gets an **Acknowledge** confirmation.
- The system tracks **whether the SOP was actually followed** — interconnected with the task system (like custom fields/dropdowns on tasks, but "attach SOP + must-complete + ack").

## What already exists (don't rebuild)
- **Written**: `sops/new/text` uses the Notion-grade `BlockEditor` (`src/components/docs/block-editor.tsx`) — same engine as Notes. `SOP.content = {type:"blocks", blocks}`.
- **Checklist**: `sops/new/checklist` → `{type:"CHECKLIST", sections:[{title, steps:[{id,title,notes}]}]}`.
- **Recorded**: `sops/new/record` → MediaRecorder screen capture + per-step `{order,action,description,screenshot,elementText}`; `src/lib/scribe-enrich.ts` swaps S3 keys → presigned URLs on read.
- **Runner**: `ProcessRun` (completedSteps, stepData{completedAt,completedBy,notes,inputValues}, progress, shareToken) + public `/run/[token]` + `SOPAssignment` + `SOPCompliance` + `/sops/compliance` dashboard. Step completion + scoring + auto-compliance-record all work.
- **SOP↔task seam (≈80%)**: `LINKED_SOP` field type (`src/lib/field-catalog.ts`); `EntityLink` graph already lists `SOP` as a target type with `relationKind ∈ {LINKED, EMBEDDED, REQUIRED_READING, REFERENCES}`; `/api/entity-links` hydrates SOP links with title/category/href.
- **Ack**: `src/components/today/sop-ack-modal.tsx` (scoped to My Work today).

## Gaps to close
1. **UI polish** — detail-page tabs render broken (Radix `tabs.tsx` in `.workwrk-os`); list view is plain; the 3 types aren't visually distinct/finished.
2. **Task drawer doesn't render attached SOPs** — no EntityLink section in `BoardItemDrawer`, no "follow"/"acknowledge" affordance.
3. **No task-triggered run** — can't start a `ProcessRun` for a checklist SOP from a task and have its completion reflect back on the task.
4. **Ack not wired to tasks** — `SopAckModal` only fires from My Work.
5. **"Required SOP" semantics on a task** — no concept of "this SOP must be followed/acked before the task is done."

## Plan (phased)

### Phase S-1 — Polish each SOP surface
- **Fix the tabs**: `src/components/ui/tabs.tsx` — repair the active-pill styling / overflow inside `.workwrk-os` (the purple unstyled pills). Likely a color-inheritance + no-wrap/scroll fix.
- **Written**: render the block content read-only with the same typography as Notes; edit opens the block editor. (Mostly styling parity.)
- **Checklist**: detail view = a clean, sectioned, tickable checklist (it half-works — finish the visual + make "Start run" prominent).
- **Recorded**: detail view = Scribe-style vertical steps (screenshot + caption + optional annotation), not a raw video blob.
- **List page**: keep the stats header (Published/In Review/Drafts/Assignments) but tighten the card grid + type badges.

### Phase S-2 — Attach an SOP to a task (the interconnection)
- Use the **EntityLink graph** (not just the flat `LINKED_SOP` field) with `relationKind`:
  - `REFERENCES` = "here's a helpful SOP" (optional).
  - `REQUIRED_READING` = "must be followed + acknowledged before done."
- In `BoardItemDrawer` / item detail: a **"SOPs" section** listing linked SOPs (title, type badge, status), with **Attach SOP** (picker over `/api/sops`, SOP-system-created only) and per-link `relationKind`.
- Keep `LINKED_SOP` field type working for table/column use; the new section is the richer, trackable path.

### Phase S-3 — Follow + acknowledge + track (per type)
- **Written / Recorded** attached SOP → **"Acknowledge"** button (reuse `SopAckModal`), records who/when against the task (EntityLink.context or a small `SopFollow` record).
- **Checklist** attached SOP → **"Start / Continue"** spins up (or resumes) a `ProcessRun` tied to (task, user); the assignee ticks steps; progress + completion write back so the task shows "SOP: 3/5 steps" → "Followed ✓".
- A task with any `REQUIRED_READING` SOP shows a **gate chip** ("Required SOP not yet followed") until ack/run completes — surfaced on the task, not blocking unless we choose to.
- Everything feeds the existing **compliance** reporting (SOPCompliance), so "was it followed?" is answerable org-wide.

### Phase S-4 — Polish + reporting
- Per-task SOP-follow audit (who acked / who completed which run).
- Optional: a "Required SOPs" rollup on the assignee's My Work.

## Key decisions to confirm
1. **Attach mechanism**: EntityLink graph w/ `relationKind` (recommended — supports REQUIRED_READING + ack/run tracking) vs the simpler `LINKED_SOP` column. Recommend: **both** — column for casual reference, EntityLink section for must-follow.
2. **Completion semantics**: Checklist SOP on a task = must complete the `ProcessRun`; Written/Recorded = single **Acknowledge**. Confirm.
3. **Does a Required SOP BLOCK marking the task done**, or just warn? Recommend: **warn + visible gate chip**, not a hard block (less rage-inducing; can harden later).
4. **Build order**: S-1 (polish) first, or S-2/S-3 (the integration you care most about) first? Recommend S-1 quick (tabs fix + type views), then S-2+S-3 together.

## Sequencing note
Each phase is independently shippable. S-1 is mostly CSS/render. S-2+S-3 reuse EntityLink + ProcessRun + SopAckModal that already exist, so it's wiring + UI, not new engines.

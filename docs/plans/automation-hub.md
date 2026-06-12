# Automation Hub — design & build plan (DEFERRED)

> **Status:** Designed, not built. Deliberately deferred until the core
> modules emit rich domain events and at least one or two high-value
> actions (WhatsApp / email / assign-user) are real. Building the engine
> before then yields a cockpit wired to an almost-empty event surface.
>
> This doc preserves the full design so we can resume in one sitting.
> The data-layer work (schema + migration) was reverted to keep the tree
> clean — re-apply from the schema block below when we resume.

## What this is

A real **event-driven workflow automation engine** + a management Hub,
in the shape of Zapier/Make but native to WorkwrK:

> When something happens → check conditions → perform actions → log every
> run/step → meter usage for billing → surface health.

Hub sections: **Health · Usage · Workflows · Connections · Logs ·
Templates · Billing/Limits.**

## Scope decisions already made (2026-06-12)

1. **MVP slice, not the whole spec.** Engine + Health/Usage/Workflows/Logs/
   Connections pages + a form-based builder (drag canvas is V2). One
   trigger (`lead.created`) works end-to-end as proof.
2. **New `Automation*` tables**, NOT an extension of the existing
   `Workflow`/`WorkflowRun` models (those stay dedicated to approval
   chains + the first-gen Autopilot stub). Clean separation, no migration
   risk to approvals.
3. **Wire real events, seed the rest.** `lead.* / task.* / review.* /
   kpi.*` fire automations for real (they already emit via
   `dispatchEvent`). Cashkr triggers (pickup/payment/device/AI) are
   seeded into the registry as catalog-only ("not yet emitting") so the
   UI shows them and they light up automatically once those domains ship.

## Codebase facts the design depends on

- **Tenancy = `organizationId`** (cuid) on every model. Roles = the
  `AccessLevel` enum, gated via `src/lib/access.ts` (`resolveAccess`,
  `isOrgAdmin`, `isManagerOrAbove`). `read < edit < admin < none`.
- **Event bus already exists:** `src/services/webhookDispatcher.ts` →
  `dispatchEvent({ organizationId, event, payload })`. Fired today as
  `lead.created`, `task.created`, `kpi.recorded`, `review.completed`.
  **This is the single hook point** — `dispatchEvent` calls
  `runAutomationsForEvent(...)` (fire-and-forget, never throws) right
  after fanning out to webhooks.
- **Cron pattern:** `/api/cron/*` POST endpoints guarded by
  `x-cron-secret` header (see `email-queue`, `webhook-retry`). The retry
  queue mirrors `processWebhookRetries()`.
- **API route shape:** `export async function GET/POST(req, { params:
  Promise<{ id }> })`; auth via `getSessionOrFail()` + `getOrgId(session)`
  from `src/lib/api-helpers.ts`; responses via `jsonSuccess` / `jsonError`.
  `zod` is used for body validation (see `api/autopilot/workflows`).
- **Prisma client:** `import { prisma } from "@/lib/prisma"` (generated to
  `@/generated/prisma`). Provider postgres/Neon. Migrations are SQL files
  under `prisma/migrations/`; apply with `prisma migrate deploy`.
  **Watch out:** `prisma migrate diff --from-config-datasource` pulls in
  pre-existing DB drift (FK re-adds on `AnnouncementAcknowledgment` /
  `TaskComment`, index renames on `EntityLink`/`OrgSecret`/`SOPFolder`,
  `ScimToken` index). Author the migration **additive-only** by hand —
  the clean SQL is reproduced at the bottom of this doc.
- **Existing stubs to leave alone (or later redirect to /automation):**
  `(dashboard)/autopilot/page.tsx` (static sample data),
  `api/autopilot/workflows` (CRUD on the legacy `Workflow` model — no
  execution engine behind it), `(dashboard)/integrations/`.
- **Frontend:** apps registered in
  `src/components/layout/os/apps-catalog.tsx` (`AppEntry` type + `APPS`
  array; `linksSidebar([...])` helper for simple sidebars;
  `requiredAccess?: "manager" | "hr-admin" | "org-admin"`). `Workflow`
  lucide icon already imported there. recharts ^3.8.1 installed; donuts
  are hand-rolled SVG (see `landing/product-mosaic.tsx`). UI primitives
  in `@/components/ui/*` (card, button, tabs, switch, chip, dialog, input,
  badge, progress, data-table, dropdown-menu, skeleton, empty-state,
  toast via `useToast()`). Pages are server components; tabs are
  searchParams-driven; client islands for interactivity.

## "Lay the pipes as you go" convention (do this NOW, incrementally)

Every new module's write-paths should emit their lifecycle events through
`dispatchEvent()` with a stable `domain.event` key and a flat payload
(ids + the fields conditions will test). Cost: ~1 line per write. Payoff:
when we build the engine the event surface is already rich — no retrofit.
Candidate keys to standardize on: `lead.status_changed`,
`lead.owner_changed`, `quote.generated`, `quote.accepted`,
`pickup.scheduled`, `pickup.completed`, `payment.successful`,
`payment.failed`, `task.created`, `task.status_changed`.

## Engine architecture (`src/lib/automation/`)

```
dispatchEvent(event)            ← existing hook, add one call
  └─ runAutomationsForEvent()   ← entry point (fire-and-forget)
       ├─ matcher        find ACTIVE published AutomationWorkflows for
       │                 (org, triggerEvent)  — uses the hot index
       ├─ idempotency    key = sha(org + event + recordId + eventTs);
       │                 AutomationRun unique(workflowId, idempotencyKey)
       │                 dedupes duplicate trigger events
       ├─ anti-loop      max runs/record/hour + max chain depth +
       │                 ignore-self-triggered flag (depth carried in
       │                 the event payload as __automationDepth)
       ├─ condition eval evaluate definition.conditions vs payload
       │                 (AND/OR groups; operators: eq, neq, contains,
       │                 gt, lt, gte, lte, is_empty, is_not_empty,
       │                 before/after date, within_next_days, older_than)
       │                 no match → log run SKIPPED, no usage charged
       ├─ executor       run each action via the action registry; log an
       │                 AutomationRunStep per step; meter 1 AutomationUsage
       │                 row per executed action
       ├─ logger         AutomationRun + steps capture input/output/error/
       │                 duration; run status SUCCESS/PARTIAL/FAILED
       ├─ usage meter    enforce monthly limit (org plan) → block or warn;
       │                 upgrade prompt + admin notification on exceed
       └─ retry          failed safe actions (notify/webhook/email) retried
                         via /api/cron/automation-retry: immediate→5m→30m
                         →failed; idempotency keys prevent dup side-effects
```

Files:
- `registry-triggers.ts` — trigger catalog (key, name, category, schema,
  `isEmitting` flag). Seed real + Cashkr-stub triggers.
- `registry-actions.ts` — action catalog + per-action `execute(ctx,
  params)` impls. MVP: `assign_user`, `update_status`, `create_task`,
  `send_whatsapp`, `send_email`, `create_notification`. `safeToRetry` flag
  per action.
- `conditions.ts` — operator implementations + group evaluator.
- `engine.ts` — `runAutomationsForEvent`, matcher, anti-loop, orchestration.
- `usage.ts` — meter + monthly-limit check (limit from org plan/settings).
- `runner.ts` / `retry.ts` — `processAutomationRetries()` for the cron.
- `crypto.ts` — AES-256-GCM encrypt/decrypt for integration tokens
  (key from `AUTOMATION_ENC_KEY`).
- `idempotency.ts` — key builder.

## APIs (`/api/automation/*`, gated via resolveAccess)

`workflows` (GET/POST), `workflows/[id]` (GET/PUT/DELETE),
`workflows/[id]/publish|activate|deactivate` (POST),
`triggers` (GET) + `triggers/[event_key]/schema`,
`actions` (GET) + `actions/[action_key]/schema`,
`runs` (GET) + `runs/[id]` (GET) + `runs/[id]/retry` (POST),
`health` + `health/failures`,
`usage` + `usage/daily|top-workflows|top-users`,
`connections` (GET) + `connections/[provider]/connect|disconnect|status`.

Permission matrix: Owner/Admin full; Manager create/edit in assigned
module; Member view/run-manual; Viewer none. Checks: view hub, create/
edit/publish/delete workflow, connect integrations, view usage/billing,
retry run.

## Frontend pages (`(dashboard)/automation/*`)

Register `{ key: "automation", label: "Automation", Icon: Workflow,
defaultHref: "/automation/health", matchPaths: ["/automation"], Sidebar:
AutomationSidebar, requiredAccess: "manager" }` in `APPS`.

- `health/` — Critical/Major/Minor severity cards (success %, failed,
  total, hand-rolled SVG donut) + date/board/user filters + failure list
  + empty state.
- `usage/` — actions-used/limit progress bar + upgrade button + recharts
  daily-usage line graph + top workflows/users/boards.
- `workflows/` — list (name, status, trigger, last run, success rate,
  created by, row actions: edit/duplicate/activate/deactivate/delete/logs).
- `workflows/[id]/` — form-based builder (trigger picker popover,
  condition rows, action rows, active toggle, save draft / publish /
  delete, run history). Drag canvas = V2.
- `connections/` — provider cards (WhatsApp/Gmail/Calendar/Slack/Webhook)
  with connect/disconnect/reconnect + status + last synced.
- `logs/` — execution log table (run id, workflow, status, trigger,
  record, started, duration, error, retry) + run detail drawer with steps.
- `templates/` — starter gallery; clone → new DRAFT workflow.

## Edge cases & guarantees to honor

Token expired / send failed / inactive assignee / action fails halfway
(→ PARTIAL) / duplicate trigger (→ idempotency dedupe) / repeated self-
trigger (→ anti-loop) / monthly limit exceeded (→ block-or-warn) /
deleted record referenced / renamed field in condition (→ missing field =
condition false, logged). Idempotency key = `org + event_key + record_id
+ event_timestamp`. Retry only safe actions; payment/invoice/dup-task
guarded with idempotency keys.

## Resume checklist

1. Paste the schema block below back into `prisma/schema.prisma` (+ the 4
   Organization back-relations: `automationWorkflows`, `automationRuns`,
   `automationUsage`, `integrationConnections`). Note the enum is named
   **`IntegrationConnectionStatus`** — plain `IntegrationStatus` already
   exists.
2. `npx prisma validate && npx prisma format && npx prisma generate`.
3. Recreate `prisma/migrations/<ts>_automation_hub/migration.sql` —
   the clean, additive-only DDL is preserved verbatim at
   `docs/plans/automation-hub-schema.sql`. Copy it into a fresh migration
   folder (don't regenerate via diff — that pulls in unrelated DB drift).
4. `npx prisma migrate deploy`.
5. Build engine → APIs → cron → pages → seed, per the sections above.

### Schema block (re-add verbatim)

The exact column-level DDL (tables, enums, indexes, FKs) lives in
`docs/plans/automation-hub-schema.sql` — translate it back to Prisma
models, or just re-derive the models from that SQL. Models:
`AutomationWorkflow`, `AutomationWorkflowVersion`, `AutomationRun`,
`AutomationRunStep`, `AutomationUsage`, `IntegrationConnection`,
`AutomationTemplate`. Enums: `AutomationWorkflowStatus` (DRAFT/ACTIVE/
INACTIVE/ERROR/ARCHIVED), `AutomationSeverity` (CRITICAL/MAJOR/MINOR),
`AutomationRunStatus` (RUNNING/SUCCESS/FAILED/PARTIAL/SKIPPED),
`AutomationStepStatus` (RUNNING/SUCCESS/FAILED/SKIPPED), `AutomationStepType`
(TRIGGER/CONDITION/ACTION), `IntegrationProvider` (WHATSAPP/GMAIL/
GOOGLE_CALENDAR/SLACK/WEBHOOK/ZAPIER/CRM), `IntegrationConnectionStatus`
(CONNECTED/DISCONNECTED/EXPIRED/ERROR). Key constraints:
`AutomationRun @@unique([workflowId, idempotencyKey])`,
`IntegrationConnection @@unique([organizationId, provider])`,
`AutomationWorkflowVersion @@unique([workflowId, versionNumber])`,
hot matcher index `AutomationWorkflow @@index([organizationId,
triggerEvent, status])`.

# SOPs at the Center — plan (2026-08-18)

Founder intent: SOPs are the most important object in WorkwrK. Every type must
look and edit right, creation must be one obvious "+ New SOP" flow, the
click-capture extension must be reliable, and the loop that makes SOPs matter
(assign → read/run → acknowledge → compliance) must actually close. Separately:
Notepad is a PERSONAL sticky-note tool, not a mirror of org docs.

Recon: 5-agent workflow (wf_f5cf80be-22f), file:line evidence for every claim.

## Model (unchanged — no migration)

`SOP.sopType` enum: WRITTEN | CHECKLIST | RECORDED. The UI splits WRITTEN into
"Written" (block content) and "Step-by-step" (ordered steps[] content) keyed
off `content.type`. Four user-facing kinds, three DB types:

| Kind (UI)    | sopType   | content shape                          | editor                      |
|--------------|-----------|----------------------------------------|-----------------------------|
| Written      | WRITTEN   | `{type:'blocks', bnDoc, blocks, meta}` | BlockNoteCanvas (new/text)  |
| Step-by-step | WRITTEN   | `{type:'steps', steps:[]}` (legacy bare steps[] read too) | detail-page step list |
| Checklist    | CHECKLIST | `{type:'CHECKLIST', sections:[...]}`   | ChecklistBuilder            |
| Click-capture| RECORDED  | `{type:'recorded', steps:[...]}`       | extension → walkthrough     |

## Wave A — SOP UI truth (sops/[id], sops/new, apps-catalog, my-sops, process-runs)

1. Badge: `getSopKindLabel` maps content.type blocks/WRITTEN/richtext → "Written";
   "Step-by-step" only for steps-shaped content. (Bug: everything modern fell
   through to "Step-by-step".)
2. Written SOPs edit in the block editor: header Edit routes WRITTEN+blocks/
   body/richtext to /sops/new/text?id=. Kill the dead-end inline stub.
3. Data-loss fixes on the detail page: read `{type:'WRITTEN', body}`; top-bar
   Save must never clobber written content with `{steps: []}`; checklist saves
   keep `type:'CHECKLIST'`; step saves write `{type:'steps', steps}`.
4. Creation: /sops/new offers FOUR cards (Written / Step-by-step / Checklist /
   Click-capture). Sidebar: drop the mislabeled "New step-by-step SOP" row
   (it created a checklist); the app "+" (createActions) lists all four.
5. Close the loop UI: assignees get Acknowledge/Mark-complete on the SOP detail
   page + my-sops rows (wired to /api/me/sops/[id]/ack). "Used by tasks"
   backlinks section on SOP detail. KRA picker in the details rail (kraId was
   API-only; role seeding depends on it). /process-runs rows link to the run
   page, not just the SOP.

## Wave B — API hardening (api/sops/*, sop-assignments, backlinks, libs)

1. POST /api/sops validates sopType against the enum and defaults content to a
   shape MATCHING the type (never `{steps:[]}` for a checklist).
2. PATCH: server owns version numbers (bump on published-content save; ignore
   client-sent version). Snapshots already work.
3. /api/sops/record: requirePermission sops.create + plan limit + createdById;
   publish only with sops.publish, else DRAFT.
4. Agent create_sop writes type-matching content. role-defaults starter SOP
   content becomes blocks-shape (it rendered blank). Seed SOPs get real types.
5. GET /api/sop-assignments: non-managers see only their own.
6. SOPCompliance writer fixed (upsert where-id could never match) and the ack
   route also records compliance — the table four surfaces read stops being dead.
7. /api/backlinks returns BOARD_ITEM sources so SOP detail can show the tasks
   that require it.

## Wave C — Extension (extension/*, sops/new/record page)

1. Double-capture fix: capture on pointerdown (screenshot the page you actually
   clicked), suppress the MutationObserver "navigate" step within 2s of a click.
2. Never lose a step: persist the step BEFORE awaiting the screenshot; patch the
   image in after.
3. State propagation: content scripts follow `isRecording` via
   chrome.storage.onChanged (all tabs start/stop together); indicator clears.
4. Remove the broken re-injection in background.js (threw on every nav, silently).
5. captureVisibleTab: correct window (sender's windowId) + lastError handling.
6. Security: window-message handshake validates event.origin; only the app
   origin can start recording or set workwrkOrigin.
7. Serialize step appends through the background worker (no lost interleaved
   writes). Observer disconnect on stop; label-click dedupe; version string.
8. /sops/new/record gets a real "Start recording" button (postMessage
   handshake the extension already listens for).

## Wave D — Notepad separation (+ block editor)

Anchor: notes become `entityType:"NOTEPAD", entityId:<userId>` (columns exist —
zero migration).
1. Panel lists `/api/docs?entityType=NOTEPAD&entityId=me`; creates with the
   anchor. Voice-capture notes too.
2. doc-access: NOTEPAD anchor readable/writable ONLY by its owner (secures list,
   [id] GET/PATCH/DELETE, and blocks minting notes as someone else). Unknown
   anchors no longer fall through to allow.
3. Bare GET /api/docs excludes NOTEPAD rows — personal notes never appear on
   /docs; org docs never appear in Notepad.
4. Editor upgrade: BlockNoteCanvas (dynamic import, ssr:false — panel is mounted
   on every page) with the TipTap-paragraphs → blocks converter for old notes.
   The 700ms-debounce + keepalive flush data-integrity pattern is preserved.
5. Backfill: one-off script re-anchors existing personal notes (TipTap shape +
   createdById) on local + prod after deploy.

## Deferred (recorded here so they're not lost)
- In-app checklist run execution (today only the public /run/[token] page can
  check steps; SopWalkthrough is local-state by design).
- OVERDUE status writes for assignments/runs (computed read-side today).
- Review self-assessment vs performanceScoreService reading different SOP
  sources — converge later.
- send-reminders cron row on aaPanel (manual, tracked with the other crons).

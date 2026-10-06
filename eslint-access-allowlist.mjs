// The G7 allow-list (spec docs/plans/ui-refresh/access-model-spec.md section 10
// step 0, graft G7).
//
// The rule in eslint.config.mjs forbids, outside src/lib/access/:
//
//   * reading `accessLevel` off anything,
//   * calling or importing isManager / isOrgAdmin / hasRole,
//   * touching the four member tables (SpaceMember, FolderMember, BoardMember,
//     SOPFolderAccess) or AccessGrant through prisma.
//
// Every file that does one of those TODAY is listed here, so the rule catches
// NEW violations from the day the engine lands without turning the existing
// call sites red. The list is the migration's own progress bar: step 6's exit
// criterion is that this array is empty (spec section 12), and every batch of
// call-site cleanup deletes its files from it.
//
// Generated from the tree at step 0 and then maintained by hand: shrink it,
// never grow it. A new file that needs one of these reads is a sign it should
// be calling can() / accessibleIds() / requireCan() instead.

// Phase 2 Stage A (2026-09-18) NET SHRINK of three. The four /api/items/[id]*
// routes each resolved their own gate and each read accessLevel to do it. They
// now all gate through src/lib/item-gate.ts, so three of them
// (updates, updates/[updateId], activity) leave this list entirely. What was
// added: item-gate.ts itself (the ONE place the item world reads the legacy
// signals, until access steps 0 and 1 make the wrappers delegate to can(), at
// which point this single entry goes too), /api/items/[id]/duplicate (one
// canContributeBoard check on the destination List) and /api/me/favorites
// (the aggregate, which gates per kind exactly as its seven per-kind siblings
// already on this list do) and src/lib/file-access.ts (the /api/files read rule,
// extracted so the comment-attachment path stops skipping it). Net: minus three,
// plus three, and three ROUTES became zero routes.
// Phase 2 Stage D (2026-09-19) adds five NEW routes, and says why. This stage's
// brief is explicit that the access pivot stays inert here: the three container
// detail routes and their APIs keep calling the existing helpers
// (`canEditSpace`, `getSpaceForReader`, `canEditBoard`), which read accessLevel,
// and nothing is flipped to `can()`. Four of the five are the routes the spec
// asks for and that did not exist at all (`folders/[id]/move`,
// `folders/[id]/duplicate`, `folders/[id]/contents`, `spaces/[id]/duplicate`),
// and the fifth (`boards/[id]/views/order`) replaces one PATCH per view with
// one request. Each one gates exactly like the sibling route already on this
// list, so they leave it in the same batch those siblings do, at access step 6.
// Phase 4 (Time and Talk, 2026-09-22) adds THREE, and all three are the same
// story.
// This phase's brief is explicit that the access pivot stays inert: "use the
// existing gate helpers and module checks". Each of these two new routes is a
// sibling of an allow-listed route and deliberately carries THE SAME gate as
// that sibling, so the count and the list it counts can never disagree:
//
//   api/meetings/route.ts          gained `isOrgAdmin(session)` when its GET
//     stopped being org-wide for everyone. Its sibling
//     api/meetings/[id]/route.ts is already on this list, and the two now
//     read one ladder (src/lib/meeting-access.ts, which is pure and reads
//     no session at all).
//   api/meetings/[id]/ics/route.ts  is the "Add to my calendar" download.
//     It carries the SAME MeetingFacts and the SAME canReadMeeting() gate as
//     its parent api/meetings/[id]/route.ts, because it is the same read of
//     the same object in another file format. A different gate here would
//     mean the .ics could say a meeting exists where the page answers 404.
//   api/meetings/[id]/action-items/route.ts  reads `accessLevel` through
//     legacyIsAdminLevel to build the SAME MeetingFacts its parent
//     api/meetings/[id]/route.ts builds, and hands them to the same three
//     helpers in src/lib/meeting-access.ts. Before Phase 4 stage B these
//     four verbs scoped to organizationId alone, so a Member who got 404
//     opening a one to one could still read, tick off, rename and delete its
//     action items by calling this route. A different gate here would be the
//     hole coming straight back.
//   api/timesheets/summary/route.ts  is one COUNT over exactly the query
//     api/timesheets/route.ts runs for scope=approve, which is on this list
//     and calls isManager four times. A different gate here would mean the
//     sidebar badge and the page disagreeing.
//   api/organization/work-schedule/route.ts  gates its PUT on
//     `isOrgAdmin(session)`, exactly like its four siblings already on this
//     list (organization/ai-profile, branding, byok, org/preferences). It is
//     an organization-wide setting with no object to point an ObjectRef at,
//     so it is one of the rows that leaves when those four do.
//
// Phase 4 stage D (Talk, 2026-09-22) adds TWO, and NET SHRINKS the Talk world.
//
//   src/lib/talk-gate.ts  is the replacement for `getSessionAndModule` in
//     nineteen Talk route files (spec-talk.md section 4 step 3, "one gate
//     helper"). It reads `accessLevel` in exactly ONE place, to map today's
//     ladder onto an org role through the engine's own `orgRoleOf()`, and
//     hands that role to src/lib/talk-access.ts, which is pure and reads no
//     session at all. Before it, five Talk routes each decided what a member
//     could do inline and differently, which is how "any member can rename
//     this channel" was true in the API and false in the menu. This file is
//     therefore a HOLE-CLOSER and a one-line swap for step 6: when the engine
//     turns on, `talkGate()` calls `requireCan("view", { type: "app", key:
//     "chat" })` and `loadConversationRole()` calls `can()` over the channel
//     ref, and every one of those nineteen routes is already through it.
//   api/calls/status/route.ts  answers "does this deployment have a media
//     server" and gates on `legacyIsAdminLevel`, exactly like its settings
//     siblings on this list. There is no object to point an ObjectRef at: it
//     describes the server's configuration, not a thing anybody owns.
//   api/people/pick/route.ts  is the access spec's own step-3 endpoint,
//     arriving early because Talk needed it: /api/users team-scopes anybody
//     below an org-wide level, so New message and Add people offered a
//     Member exactly one person, themselves. It reads `accessLevel` once, to
//     ask the engine's own `orgRoleOf()` whether the caller is a Guest, and
//     a Guest is narrowed to people they already share a conversation with.
//     That Guest branch IS `accessibleUsers` in miniature, and step 3
//     replaces the whole file with the engine's version.
//
// Both leave together, with their siblings, when the access engine's step 6
// turns these gates into can() / accessibleIds().
// Phase 6 Stage C (2026-09-27) NET SHRINK of two. /team and /team/workload
// became clients over three /api/team routes that read Lists through the
// engine's Viewer (src/lib/people/team-boards.server.ts), so the two pages
// and /api/team/members-work leave this list. One entry MOVED rather than
// grew: the Unassigned bucket's "Lists the team belongs to" read of
// BoardMember left team/workload/page.tsx for /api/team/workload unchanged,
// so that route carries the entry now.
// Phase 6 Stage F (2026-09-28) NET SHRINK of thirty-one. The People,
// Performance and Goals rebuilds (Stages A to E) moved their pages and routes
// onto the engine's Viewer and the shared gates (person-access, team-gate,
// review-cycle-access, culture-gate, gatePage), so these files no longer read
// accessLevel, call a tier predicate or touch a member table. Each one was
// linted with the G7 rule and no allow-list before it left: the directory,
// person page, org chart, cycle detail, survey pages, the four /team pages,
// /api/candor, /api/departments, /api/roles, /api/reviews and its launch,
// calibration, finalize, manager-review and peer-feedback routes, the cycle
// export, /api/pulse-surveys and [id], /api/talent-assessment,
// /api/team/weekly-reviews, /api/users/[id]/handover, /api/people/bulk-update
// and /api/kpi-records/[id]/manager-review. The unit files still listed below
// keep a real legacy read (an isManager or accessLevel check) that changes
// behaviour if removed; they leave with access step 6.
// Phase 8 Stage D (2026-09-30) NET SHRINK of nine. The rebuilt Settings pages
// (API, Billing, Identity, Locale, Structure), the settings shell,
// the org delete and restore routes and the SCIM Users collection now gate
// through src/lib/access/workspace-admin.ts and no longer read the legacy
// signals themselves.
// Phase 8 Stage F (2026-09-30) NET SHRINK of seventy-six, 331 to 255 (access
// step 6: Settings and Admin-adjacent, then Nav). Every file that left was
// linted with the G7 rule and no allow-list first (zero findings):
//   * the org write APIs now go through src/lib/access/settings-write.ts
//     settingsWriteGate (the page rule, the actor re-read): branding, BYOK,
//     AI profile, work schedule, SCIM tokens, tags, webhooks, API keys,
//     billing checkout and portal, audit export, people export, module
//     installs, org preferences, the permission grid PATCH, the logo and
//     PATCH /api/settings;
//   * the rail, the hub sidebars and the create menus read the display tiers
//     boot ships (src/lib/access/viewer-tiers.ts, viewer.tiers), never the
//     level: shell-context, apps-catalog, hub-sidebar, docs-sidebar;
//   * deleted with zero importers left: route-guard.ts (its callers use
//     src/lib/access/page-viewer.ts or the ledger's own personScope),
//     access-tiers.ts, /api/me/access; moved beside the engine:
//     src/lib/access.ts (now access/legacy-resolve.ts, which ends the shadow
//     of "@/lib/access"), hooks/use-role.ts and hooks/use-permission.ts (now
//     access/use-legacy-permissions.tsx, same answers);
//   * forty-seven files that had stopped reading the legacy signals in
//     earlier stages and were never taken off.
// What remains, and why, is in scripts/MIGRATIONS.md (Phase 8 stage F).
export const ACCESS_LEGACY_ALLOWLIST = [
  "src/app/api/calls/status/route.ts",
  "src/app/api/people/pick/route.ts",
  // Phase 0 step 2b: GET /api/boot folds the shell's four boot calls into one
  // and has to run the SAME legacy rail resolver the client runs today
  // (visibleRailApps over accessLevel tiers). It leaves this list with the
  // rail switch-over to can() at step 6, together with the client rail.
  "src/app/api/boot/route.ts",
  "src/app/(dashboard)/boards/\\[slug\\]/page.tsx",
  "src/app/(dashboard)/folders/\\[id\\]/page.tsx",
  "src/app/(dashboard)/okrs/\\[id\\]/page.tsx",
  "src/app/(dashboard)/people/roles/\\[id\\]/page.tsx",
  "src/app/(dashboard)/settings/members/page.tsx",
  // Phase 8 Stage A: /settings/permissions moved here; the transitional
  // page still draws the legacy grid through checkPermission.
  "src/app/(dashboard)/settings/access/page.tsx",
  "src/app/(dashboard)/spaces/\\[slug\\]/page.tsx",
  "src/app/(dashboard)/spaces/page.tsx",
  "src/app/(dashboard)/tlk/layout.tsx",
  "src/app/api/accounting-periods/\\[id\\]/route.ts",
  "src/app/api/accounting-periods/route.ts",
  // Phase 3 Stage D (2026-09-21): the contracts and policies routes the process
  // spec adds (resend, rename-folder, rename-category, the two CSV exports,
  // the assignment PATCH/DELETE and reminders) gate the way their siblings
  // beside them do (isManager, the person scope in lib/process-scope.ts, the
  // AGENT check on export), because this stage keeps the engine inert. They
  // leave with the rest of the family when the process routes flip to can().
  "src/app/api/agreements/\\[id\\]/parties/\\[partyId\\]/resend/route.ts",
  "src/app/api/policies/\\[id\\]/acknowledge/route.ts",
  "src/app/api/policies/compliance/export/route.ts",
  "src/app/api/sop-assignments/compliance/export/route.ts",
  "src/app/api/agreements/\\[id\\]/parties/route.ts",
  "src/app/api/agreements/\\[id\\]/route.ts",
  "src/app/api/agreements/\\[id\\]/save-as-template/route.ts",
  "src/app/api/agreements/\\[id\\]/send/route.ts",
  "src/app/api/agreements/route.ts",
  "src/app/api/ai/route.ts",
  "src/app/api/ai/signals/route.ts",
  "src/app/api/appsumo/redeem/route.ts",
  "src/app/api/assets/\\[id\\]/route.ts",
  "src/app/api/assets/route.ts",
  "src/app/api/audit/route.ts",
  "src/app/api/auth/accept-invite/route.ts",
  "src/app/api/auth/register/route.ts",
  "src/app/api/backlinks/route.ts",
  "src/app/api/boards/\\[id\\]/duplicate/route.ts",
  "src/app/api/boards/\\[id\\]/fields/\\[key\\]/route.ts",
  "src/app/api/boards/\\[id\\]/fields/available/route.ts",
  "src/app/api/boards/\\[id\\]/fields/route.ts",
  "src/app/api/boards/\\[id\\]/fields/suggest/route.ts",
  "src/app/api/boards/\\[id\\]/items/route.ts",
  "src/app/api/boards/\\[id\\]/members/route.ts",
  "src/app/api/boards/\\[id\\]/move/route.ts",
  "src/app/api/boards/\\[id\\]/route.ts",
  "src/app/api/boards/\\[id\\]/views/\\[viewId\\]/route.ts",
  "src/app/api/boards/\\[id\\]/views/order/route.ts",
  "src/app/api/boards/\\[id\\]/views/route.ts",
  "src/app/api/boards/route.ts",
  "src/app/api/budget-plans/\\[id\\]/route.ts",
  "src/app/api/budget-plans/route.ts",
  "src/app/api/bulk-decide/route.ts",
  "src/app/api/calendar/route.ts",
  "src/app/api/cron/review-cycles/route.ts",
  "src/app/api/cron/run-due-agents/route.ts",
  "src/app/api/dashboard/team-dashboard/route.ts",
  "src/app/api/docs/\\[id\\]/ask/route.ts",
  "src/app/api/docs/\\[id\\]/comments/route.ts",
  "src/app/api/docs/\\[id\\]/duplicate/route.ts",
  "src/app/api/docs/\\[id\\]/export/route.ts",
  "src/app/api/docs/\\[id\\]/extract-table/route.ts",
  "src/app/api/docs/\\[id\\]/mention/route.ts",
  "src/app/api/docs/\\[id\\]/restore/route.ts",
  "src/app/api/docs/\\[id\\]/route.ts",
  // Phase 3 stage B (docs-knowledge): four routes that gate through the same
  // legacy delegates their siblings use (canContributeBoard, getSpaceForReader,
  // canEditSpace). They leave this list with those delegates at access step 6.
  "src/app/api/docs/\\[id\\]/lock/route.ts",
  "src/app/api/files/\\[id\\]/url/route.ts",
  "src/app/api/lists/pick/route.ts",
  "src/app/api/notetaker/save/route.ts",
  "src/app/api/whiteboards/\\[id\\]/duplicate/route.ts",
  "src/app/api/whiteboards/\\[id\\]/thumbnail/route.ts",
  "src/app/api/docs/\\[id\\]/summarize/route.ts",
  "src/app/api/docs/\\[id\\]/versions/\\[versionId\\]/route.ts",
  "src/app/api/docs/\\[id\\]/versions/route.ts",
  "src/app/api/docs/by-entity/route.ts",
  "src/app/api/docs/route.ts",
  "src/app/api/employee-of-month/route.ts",
  "src/app/api/entity-links/\\[id\\]/route.ts",
  "src/app/api/entity-links/route.ts",
  "src/app/api/export/\\[type\\]/route.ts",
  "src/app/api/export/all/route.ts",
  "src/app/api/files/\\[id\\]/route.ts",
  "src/app/api/files/route.ts",
  "src/app/api/financial-reports/route.ts",
  "src/app/api/fiscal-years/route.ts",
  "src/app/api/folders/\\[id\\]/contents/route.ts",
  "src/app/api/folders/\\[id\\]/duplicate/route.ts",
  "src/app/api/folders/\\[id\\]/members/route.ts",
  "src/app/api/folders/\\[id\\]/move/route.ts",
  "src/app/api/folders/\\[id\\]/route.ts",
  "src/app/api/folders/reorder/route.ts",
  "src/app/api/folders/route.ts",
  "src/app/api/gl-accounts/route.ts",
  "src/app/api/ideas/\\[id\\]/route.ts",
  "src/app/api/integrations/\\[id\\]/route.ts",
  "src/app/api/integrations/\\[id\\]/test/route.ts",
  "src/app/api/integrations/quickbooks/connect/route.ts",
  "src/app/api/integrations/quickbooks/disconnect/route.ts",
  "src/app/api/integrations/route.ts",
  "src/app/api/integrations/xero/connect/route.ts",
  "src/app/api/integrations/xero/disconnect/route.ts",
  "src/app/api/invitations/route.ts",
  "src/app/api/invoices/\\[id\\]/route.ts",
  "src/app/api/invoices/route.ts",
  "src/app/api/item-activity/route.ts",
  "src/app/api/items/\\[id\\]/duplicate/route.ts",
  "src/app/api/journal-entries/\\[id\\]/route.ts",
  "src/app/api/journal-entries/route.ts",
  "src/app/api/kpi-records/batch/route.ts",
  "src/app/api/kpis/route.ts",
  "src/app/api/kra-assignments/\\[id\\]/route.ts",
  "src/app/api/kra-assignments/route.ts",
  "src/app/api/kra-categories/route.ts",
  "src/app/api/kras/orphans/route.ts",
  "src/app/api/kras/route.ts",
  "src/app/api/labels/route.ts",
  "src/app/api/notifications/route.ts",
  "src/app/api/me/export/route.ts",
  "src/app/api/me/favorites/route.ts",
  // Phase 2 Stage C, two entries, both for the SAME one reason: they hand an
  // accessLevel to `docAccessible` (already on this list), which is the gate
  // the Docs pages use, so that a Recent-docs row and an Inbox mention pane
  // can never show a doc /docs/[id] itself would refuse. The alternative was
  // passing null, which defaults to EMPLOYEE and would quietly hide an
  // admin's own documents from them. Both entries go when the wrappers
  // delegate to can().
  "src/app/api/me/home/route.ts",
  "src/app/api/me/favorites/boards/route.ts",
  "src/app/api/me/favorites/docs/route.ts",
  "src/app/api/me/favorites/files/route.ts",
  "src/app/api/me/favorites/folders/route.ts",
  "src/app/api/me/favorites/spaces/route.ts",
  "src/app/api/me/favorites/tables/route.ts",
  "src/app/api/me/favorites/whiteboards/route.ts",
  "src/app/api/me/mentions/route.ts",
  "src/app/api/meeting-templates/route.ts",
  "src/app/api/meetings/\\[id\\]/action-items/route.ts",
  "src/app/api/meetings/\\[id\\]/ics/route.ts",
  "src/app/api/meetings/\\[id\\]/route.ts",
  "src/app/api/meetings/route.ts",
  "src/app/api/my-team/route.ts",
  "src/app/api/okrs/route.ts",
  "src/app/api/ownership-areas/\\[id\\]/route.ts",
  "src/app/api/ownership-areas/route.ts",
  "src/app/api/people/backfill-role-defs/route.ts",
  "src/app/api/people/bulk-import/route.ts",
  "src/app/api/performance-scores/recalculate/route.ts",
  "src/app/api/plan-lines/route.ts",
  "src/app/api/plan-variance/route.ts",
  "src/app/api/policies/\\[id\\]/assignments/route.ts",
  "src/app/api/policies/\\[id\\]/ledger/export/route.ts",
  "src/app/api/policies/\\[id\\]/route.ts",
  "src/app/api/policies/\\[id\\]/versions/route.ts",
  "src/app/api/policies/route.ts",
  "src/app/api/process-runs/route.ts",
  // Phase 3 Stage C (2026-09-21) adds three NEW routes the process spec asks
  // for, each gating EXACTLY like the sibling already on this list: the
  // per-run route (drawer payload, cancel / reassign / due, delete) beside
  // api/process-runs/route.ts; the People tab payload beside
  // api/sop-assignments/route.ts (same own-row / report-tree / org-wide
  // scope); and the reminder beside api/sop-assignments/[id]/route.ts. The
  // brief keeps the access engine inert in this unit, so nothing is flipped
  // to can() here; all three leave this list in the batch their siblings do.
  "src/app/api/process-runs/\\[id\\]/route.ts",
  // Stage C findings pass: the run gate (assignee / report tree / org-wide)
  // that api/process-runs/route.ts and api/process-runs/[id]/route.ts each
  // wrote inline now lives ONCE in src/lib/process-run-access.ts, so the two
  // paths cannot disagree. Same tier reads as before, in one file instead of
  // two; it leaves this list with its two callers.
  "src/lib/process-run-access.ts",
  // Phase 3 Stage D: the person scope of the policy ledgers and compliance
  // dashboards, and the one manage_process rule, live ONCE in
  // src/lib/process-scope.ts (the same transcription as its sibling above).
  // They leave the list when the process routes flip to can().
  "src/lib/process-scope.ts",
  "src/app/api/sops/\\[id\\]/people/route.ts",
  "src/app/api/sop-assignments/\\[id\\]/remind/route.ts",
  "src/app/api/pulse-surveys/\\[id\\]/responses/export/route.ts",
  "src/app/api/pulse-surveys/\\[id\\]/responses/route.ts",
  "src/app/api/purchase-orders/\\[id\\]/route.ts",
  "src/app/api/purchase-orders/route.ts",
  "src/app/api/role-boundaries/\\[id\\]/route.ts",
  "src/app/api/role-boundaries/route.ts",
  "src/app/api/role-instances/\\[id\\]/route.ts",
  "src/app/api/role-instances/route.ts",
  "src/app/api/scopes/\\[id\\]/route.ts",
  "src/app/api/scopes/route.ts",
  "src/app/api/search/route.ts",
  "src/app/api/sop-assignments/\\[id\\]/route.ts",
  "src/app/api/sop-assignments/route.ts",
  "src/app/api/sop-categories/\\[id\\]/route.ts",
  "src/app/api/sop-categories/route.ts",
  "src/app/api/sop-folders/\\[id\\]/access/route.ts",
  "src/app/api/sop-folders/\\[id\\]/route.ts",
  "src/app/api/sop-folders/route.ts",
  "src/app/api/sop-tags/route.ts",
  // Phase 3 Stage A MOVED this file, it did not add it. It was
  // "src/app/(dashboard)/sops/\\[id\\]/share/route.ts" on this list until the
  // SOP public-link handler moved from the page segment to /api, which is
  // where API handlers live and, more to the point, the path the SOP page has
  // always called (the handler at the old path meant minting and revoking a
  // public link were both dead). The code inside is unchanged: the same
  // requirePermission + canWriteToFolder gate its sibling
  // api/sops/\\[id\\]/route.ts uses, so it leaves this list in the same batch
  // that one does, at access step 6. Net change to this array: zero.
  "src/app/api/sops/\\[id\\]/route.ts",
  "src/app/api/sops/\\[id\\]/share/route.ts",
  "src/app/api/sops/\\[id\\]/versions/route.ts",
  "src/app/api/sops/record/route.ts",
  "src/app/api/sops/route.ts",
  "src/app/api/spaces/\\[id\\]/bookmarks/route.ts",
  "src/app/api/spaces/\\[id\\]/duplicate/route.ts",
  "src/app/api/spaces/\\[id\\]/invitations/\\[inviteId\\]/resend/route.ts",
  "src/app/api/spaces/\\[id\\]/invitations/\\[inviteId\\]/route.ts",
  "src/app/api/spaces/\\[id\\]/invitations/route.ts",
  "src/app/api/spaces/\\[id\\]/members/route.ts",
  "src/app/api/spaces/\\[id\\]/move/route.ts",
  "src/app/api/spaces/\\[id\\]/route.ts",
  "src/app/api/spaces/reorder/route.ts",
  "src/app/api/spaces/route.ts",
  "src/app/api/tables/\\[id\\]/ask/route.ts",
  "src/app/api/tables/\\[id\\]/import/route.ts",
  "src/app/api/tables/\\[id\\]/rows/batch/route.ts",
  "src/app/api/tables/\\[id\\]/rows/route.ts",
  "src/app/api/tables/\\[id\\]/trash/route.ts",
  "src/app/api/tables/route.ts",
  "src/app/api/tag-assignments/route.ts",
  "src/app/api/team/workload/route.ts",
  "src/app/api/template-center/\\[id\\]/apply/route.ts",
  "src/app/api/template-center/save-as/route.ts",
  "src/app/api/templates/\\[slug\\]/apply/route.ts",
  "src/app/api/thresholds/\\[id\\]/route.ts",
  "src/app/api/thresholds/route.ts",
  "src/app/api/timesheets/\\[id\\]/route.ts",
  "src/app/api/timesheets/route.ts",
  "src/app/api/timesheets/summary/route.ts",
  "src/app/api/users/\\[id\\]/route.ts",
  "src/app/api/users/\\[id\\]/seed-alignment/route.ts",
  "src/app/api/users/route.ts",
  "src/app/api/v1/openapi.json/route.ts",
  "src/app/api/v1/people/route.ts",
  "src/app/api/vendors/\\[id\\]/route.ts",
  "src/app/api/vendors/route.ts",
  "src/app/api/weekly-reviews/\\[id\\]/manager-review/route.ts",
  "src/app/api/whiteboards/\\[id\\]/route.ts",
  "src/app/api/whiteboards/\\[id\\]/versions/\\[versionId\\]/restore/route.ts",
  "src/app/api/whiteboards/\\[id\\]/versions/route.ts",
  "src/app/api/whiteboards/route.ts",
  // Stage D follow-up (2026-09-19): GET /api/work/locate answers "which Space
  // and which folders is this object under", so the sidebar tree can open the
  // branch a deep link lands in. It gates with `folderReadable` / `canRead`,
  // the same helpers its sibling container routes on this list use, and leaves
  // in the same batch they do at access step 6.
  "src/app/api/workflow-runs/route.ts",
  "src/app/api/workflows/route.ts",
  "src/app/api/workspaces/\\[id\\]/members/route.ts",
  "src/app/api/workspaces/route.ts",
  "src/components/layout/os/invite-modal.tsx",
  "src/components/okrs/create-goal-modal.tsx",
  "src/lib/agents/autonomous.ts",
  "src/lib/agents/tools.ts",
  "src/lib/alignment-scope.ts",
  "src/lib/api-auth.ts",
  "src/lib/api-helpers.ts",
  // Phase 4 stage D: the one Talk gate (see the note above the array).
  "src/lib/talk-gate.ts",
  "src/lib/auth-helpers.ts",
  "src/lib/auth.ts",
  "src/lib/automation/registry-actions.ts",
  "src/lib/automation/usage.ts",
  "src/lib/board.ts",
  "src/lib/crm/auth.ts",
  "src/lib/doc-sharing.ts",
  "src/lib/email-templates/invitation.ts",
  "src/lib/entity-link-authz.ts",
  // The "who may read this file" rule, lifted verbatim out of
  // src/app/api/files/route.ts (still on this list, two entries above) so the
  // comment-attachment path can run the SAME check instead of skipping it. It
  // reads no signal /api/files did not already read; it leaves this list on the
  // same day the two /api/files entries do.
  "src/lib/file-access.ts",
  "src/lib/folder.ts",
  "src/lib/goal-audience.ts",
  "src/lib/hr-segment.ts",
  "src/lib/itsm/auth.ts",
  "src/lib/page-gates.ts",
  // Phase 6 Stage B: the Teams hub's people routes read the viewer's reach
  // through these three files and nowhere else (the two deleted people
  // clients above left this list the same day). They carry the legacy
  // org-wide and manager-tier reach so nobody loses a record they could open
  // yesterday, and leave this list at access step 6 with the rest.
  "src/lib/people/person-access.server.ts",
  "src/lib/people/directory-list.server.ts",
  "src/lib/people/department-access.server.ts",
  "src/lib/permissions.ts",
  "src/lib/item-gate.ts",
  // AI teammates step 3a (2026-10-06, docs/plans/ai-teammates.md 3.15): the
  // PATCH of /api/items/[id] and the PUT of /api/docs/[id] moved verbatim into
  // these two files, so a teammate's tools run the same write path a person's
  // request runs, and their legacy reads moved with them. The items route
  // reads nothing any more, so its entry MOVED here; the docs route's GET and
  // DELETE still read the level, so that entry stays and doc-save.ts is one
  // new row. Both leave with their routes at access step 6.
  "src/lib/items/item-patch.ts",
  "src/lib/docs/doc-save.ts",
  // AI teammates step 3b/3c (2026-10-06, docs/plans/ai-teammates.md 3.2): ONE
  // entry for the whole teammate tool layer, on the item-gate precedent. A
  // teammate acts as a person who is not at the keyboard, through the write
  // paths above and the existing gates (gateItem, docAccess, the List
  // helpers, the permission matrix, the Inbox's readability), and those take
  // the person's legacy level. acting.ts reads it once, when it resolves the
  // person, and hands it to them through its wrappers (itemCtxFor, nodeCtxOf,
  // canContributeAs, personMay and the rest), so teammate-tools.ts and
  // previews.ts never read the signal themselves. It leaves with the helpers
  // it wraps at access step 6.
  "src/lib/agents/acting.ts",
  // Phase 5 (Data): the ONE reader gate the three new /api/tables/[id]/*
  // routes (duplicate, export, presence) share, on the item-gate precedent,
  // so none of them reads the legacy signal itself.
  "src/lib/table-gate.ts",
  // Open in place (2026-09-24): an object opened from Work gets a Work
  // address, /spaces/[slug]/docs/[id] or /work/docs/[id], whose [id] layout
  // works out where it sits for this viewer. The brief is explicit that the
  // access pivot stays inert here ("use the existing gates"), so this ONE
  // loader reads the legacy level once per object and hands it to exactly the
  // helpers the object's own API gates with (docAccessible and the doc role,
  // readableTable, whiteboardSpaceVisible, folderAccessForSpace and
  // folderVisibleTo for the tree). No route or component reads it: the gate
  // component and the eight route files call this file. It leaves this list
  // on the day those helpers turn into can(), with the rest of step 6.
  "src/lib/work/placement-server.ts",
  // Phase 5b (the data layer: tasks in more than one List, connected columns,
  // dashboards, scheduled reports): ONE entry for the whole feature, on the
  // item-gate precedent. The brief keeps the engine inert and names the
  // existing helpers as the gate, and those read accessLevel, so every
  // Phase 5b route and module reaches them through this file's wrappers
  // (boardForViewer, canContributeFor, spaceForViewer, viewerIsOrgAdmin,
  // memberViewer and the rest) and none of them reads the signal itself.
  "src/lib/list-links-server.ts",
  "src/lib/rail-apps.test.ts",
  "src/lib/role-defaults.ts",
  "src/lib/sop-access.ts",
  "src/lib/space.ts",
  // Bird's eye (2026-09-24) had added src/lib/work/space-lists.ts and its
  // test here: a pure second predicate over the frozen legacy transcriptions
  // that readableListsInSpace decided through. The one access model merge
  // (2026-09-27) retired both: readableListsInSpace answers from the one
  // resolver's tree (node-access spaceTree), which knows the Private cut and
  // a Folder grant's own role, so the module had no caller left and a second
  // opinion on readability is exactly what this list exists to shrink.
  "src/lib/suites/auth.ts",
  "src/lib/workflow/engine.ts",
  "src/lib/workflows/runtime.ts",
  // Phase 8 stage F review (2026-09-30): SIX files that read the legacy
  // signals and were on no list, so `npx eslint` over src was not green and
  // the count above understated the real number of legacy readers. Listed
  // so the progress bar is true, each with what it still reads:
  //   announcement-server.ts, announcement-audience.ts  the audience and the
  //     publish rule of Announcements (accessLevel, hasPermission, the
  //     SpaceMember audience), the logic the announcements routes left the
  //     list through; it leaves when the audience resolves through can()
  //   move/destinations  the Space nesting picker hands the level to
  //     spaceNestDestinations (node-access's own input shape)
  //   my-work/personal  the Personal List projection's viewer shape
  //     (listBoardItems reads the level for the reserved-key rule)
  //   two tests that build sessions carrying a level on purpose
  "src/lib/announcement-server.ts",
  "src/lib/announcement-audience.ts",
  "src/app/api/move/destinations/route.ts",
  "src/app/(dashboard)/my-work/personal/page.tsx",
  "src/lib/auth-workspace-move.test.ts",
  "src/lib/reports/schedule-patch-private-view.test.ts",
];

// Legacy code that lives INSIDE src/lib/access/, which the rule never lints
// (the engine has to read these things). Not an ignore list: counted here so
// the step 6 exit test ("the allow-list is empty") also means these are gone.
// Stage F moved them in: src/lib/access.ts became legacy-resolve.ts, and
// src/hooks/use-role.ts plus use-permission.ts became
// use-legacy-permissions.tsx, whose useRole still derives isAdmin from the
// session level (C_LEVEL and HR included) for its client importers. The
// flip of that wrapper to orgRole (spec 10.1) waits for the same surfaces'
// server rules to delegate, or C-level would lose controls the server still
// grants them (scripts/MIGRATIONS.md, "what remains").
export const ACCESS_LEGACY_INSIDE_ENGINE = [
  "src/lib/access/legacy-resolve.ts",
  "src/lib/access/use-legacy-permissions.tsx",
];

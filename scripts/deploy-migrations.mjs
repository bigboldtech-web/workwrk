// Only run `prisma migrate deploy` when there's actual work to do.
//
// Prisma's `migrate deploy` takes a Postgres advisory lock with a
// hardcoded 10s timeout. Since migrations rarely change between
// deploys, we check what's pending ourselves (direct SQL diff of
// the migrations folder vs. the `_prisma_migrations` table) and
// only invoke Prisma when we actually have migrations to apply.
//
// When there ARE pending migrations, we call `prisma migrate
// deploy` with a retry loop. Between retries we also clear orphaned
// advisory-lock holders, a killed previous deploy can leave its
// session alive on the server, holding lock 72707369 forever, in
// which case naive retries all fail the same way.
//
// Run with: DEPLOY_MIGRATE=1 node scripts/deploy-migrations.mjs (the deploy
// does, through `npm run deploy:migrate`).
import { Client } from "pg";
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import "dotenv/config";

const PRISMA_LOCK_ID = 72707369;

// It changes whatever database .env names, so it runs only when asked to by
// name. It used to run inside `npm run build`: building a branch on a laptop
// whose .env reached production applied that branch's SQL to production.
if (process.env.DEPLOY_MIGRATE !== "1") {
  console.error(
    "deploy-migrations: not run. It changes the database that .env names, so it needs DEPLOY_MIGRATE=1 " +
      "(the deploy sets it: npm run deploy:migrate). `npm run build` no longer runs it.",
  );
  process.exit(1);
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  console.error("deploy-migrations: no DATABASE_URL / DIRECT_URL set");
  process.exit(1);
}

// ── Hand-written SQL (prisma/sql) ─────────────────────────────────────
//
// WHY THIS EXISTS. `prisma migrate deploy` reads prisma/migrations and
// nothing else, so for a long time the files in prisma/sql were applied
// by hand on the box before each deploy. Miss one and the new release
// meets a database without its tables: the deploy "succeeds" and the
// product 500s. Applying them here closes that window, because this
// script runs inside `npm run build`, before `next build` and therefore
// before pm2 reloads onto the new release. A failure below exits non
// zero, which stops the deploy before the new release is built, so
// production stays on the release it is serving.
//
// EXPLICIT MANIFEST, not a directory glob. A glob would auto-apply
// whatever happens to be in the folder, including files that are not
// idempotent or are deliberately withheld. Add a file here only after
// reading it.
//
// NOT IN THE MANIFEST, on purpose:
//   2026-07-21-operating-core.sql, 35 DDL statements with ZERO
//   IF NOT EXISTS guards, so it is additive but NOT idempotent, and it
//   belongs to the Operating Core work which is deliberately gated. Since
//   everything here runs on EVERY deploy, a non-idempotent file would fail
//   the second one. Leave it to a decision, not a glob.
const SQL_MANIFEST = [
  "2026-09-18-task-detail-phase2.sql",
  "2026-09-18-notification-cleared-at.sql",
  "2026-09-19-archived-by.sql",
  "2026-09-19-canvas-folder.sql",
  "2026-09-19-template-key.sql",
  // Phase 3 (knowledge unit). Both are ADD COLUMN IF NOT EXISTS only. The
  // contract routes select the new Agreement / AgreementParty columns on
  // every read, so a release that shipped without this line would 500 on
  // every contract list, open, send and sign until the file was applied by
  // hand; the doc-lock columns are read through a raw query that tolerates
  // their absence, but they belong here for the same reason.
  "2026-09-21-doc-lock.sql",
  "2026-09-21-contract-send-decline.sql",
  "2026-09-21-agreement-archived-by.sql",
  // Phase 4 (Time and Talk). Seven ADD COLUMN IF NOT EXISTS statements plus
  // one already-satisfied UPDATE. It belongs here because Prisma selects
  // every model field on a findMany with no select, so the moment the client
  // knows about Meeting.deletedAt or Conversation.findable, a database
  // without those columns 500s the meetings list and the Talk sidebar.
  "2026-09-22-time-and-talk.sql",
  // Phase 4, decided additions (b) and (c): the org working calendar table
  // and the two time-tracking-depth columns. It is late-safe only because
  // every TimeEntry query on the clock and timesheet paths names its
  // columns explicitly (a bare Prisma query emits every scalar, including
  // billable and tags, and would 500 the clock against a database without
  // them) and because readOrgWorkSchedule swallows a missing table and
  // answers the defaults. Read the header of the .sql file before touching
  // any TimeEntry query.
  "2026-09-22-work-schedule.sql",
  // Phase 4, spec-planner section 4 step 6: Meeting."itemId", the link to
  // the hidden per-organization Meetings List, so a meeting is gated through
  // the one Item ladder rather than through a new object type. Same reason
  // as the file two above: once the generated client knows about the column,
  // a database without it 500s the meetings list, because a findMany with no
  // select asks for every scalar. The Item rows themselves are a separate,
  // dry-run-by-default data script (scripts/backfill-meeting-items.mjs) and
  // are NOT part of the deploy.
  "2026-09-22-meeting-item.sql",
  // Phase 4, spec-planner section 2 `/planner` Data: the CalendarEvent
  // table, the home for a personal calendar entry and for the rows the
  // Google sync cron brings in. Deploy order is free (every reader is
  // wrapped and answers "no events" while the relation is absent), but it
  // belongs in the manifest anyway: until it is applied, "New event" on the
  // Calendar surfaces a failure instead of saving, and that is a visible
  // regression rather than a quiet one.
  "2026-09-22-calendar-event.sql",
  // Phase 4, the Calendar's "Show declined Google events" switch:
  // CalendarEvent."declined". Genuinely late-safe, and checked rather than
  // asserted: the calendar read tries the filtered query and falls back to
  // the unfiltered one, and the sync write retries without the field. It is
  // in the manifest so the switch stops being a control with no effect on
  // the same deploy that ships it.
  "2026-09-22-calendar-declined.sql",
  // Phase 5, the form builder: FormDefinition."settings" (JSONB NOT NULL
  // DEFAULT '{}'), the form's own settings bucket. One ADD COLUMN IF NOT
  // EXISTS and no backfill: an empty bucket reads as today's behaviour. It
  // must land before the code, because a findFirst with no select asks for
  // every scalar and would 500 the builder and the /forms list.
  "2026-09-23-form-settings.sql",
  // Phase 5b, the data layer: "ItemListLink" (tasks in more than one List)
  // and "ReportSchedule" (scheduled email reports). Two CREATE TABLE IF NOT
  // EXISTS, five indexes, three guarded foreign keys, nothing else. Deploy
  // order is free: no existing model gains a column, every link reader
  // falls back to today's home-only read while the table is absent, and the
  // report routes answer a named 503 (the cron a no-op) until it lands. It
  // is here so the release that ships the code is the release that can use it.
  "2026-09-24-phase5b-data.sql",
  // One access model (2026-09-24): the "AccessGrant" table, a person's grant
  // on one table, canvas or form. Late-safe and CHECKED rather than
  // asserted: no existing model gains a column, every reader
  // (src/lib/access/access-grant-store.ts) checks to_regclass and answers "no
  // grants" while the table is absent, and the grant writes answer a named
  // 503 grants_unavailable. It is here because this script runs inside
  // `npm run build`, before `next build` and before pm2 reloads, so
  // production never serves the grant routes without their table.
  "2026-09-24-access-grants.sql",
  // Phase 7, stage A: "IntegrationRequest" (Request this on /integrations)
  // and "AppSuggestion" (Suggest an app on Marketplace). Two CREATE TABLE IF
  // NOT EXISTS, three indexes, two guarded foreign keys, nothing else. Deploy
  // order is free: the catalogue reads zero counts and the request routes
  // answer a named 503 while the tables are absent.
  "2026-09-24-phase7-requests.sql",
  // Phase 6, people. ADD COLUMN IF NOT EXISTS on User, Threshold, KPIRecord,
  // ReviewCycle, Review, TalentAssessment and PulseSurvey (every one nullable
  // or defaulted) plus the new "CandorRespondent" table. The new scalar
  // columns are on the Prisma models, so a findMany with no select asks for
  // them: this file MUST be applied before the release starts, which is what
  // this manifest does. The backfills are separate dry-run scripts.
  "2026-09-26-phase6-people.sql",
  // Phase 7, stage C review: "AutomationCronTick" (one row per cron endpoint,
  // stamped on every tick, read by the trigger catalog so the two time
  // triggers show "Not live yet" until the automation-schedule cron row
  // really runs). One CREATE TABLE IF NOT EXISTS. Deploy order is free: the
  // writer and the reader both catch the missing relation.
  "2026-09-27-automation-cron-tick.sql",
  // Phase 9, the Staff console: "StaffAction" (one row per write a WorkwrK
  // staff member makes from the console, kept for ever) and
  // "PlatformAdmin"."consolePrefs" (nullable, read as an empty object). One
  // CREATE TABLE IF NOT EXISTS, four indexes, one guarded foreign key with
  // ON DELETE SET NULL, one ADD COLUMN IF NOT EXISTS. Deploy order is free:
  // nothing in the running release names either object.
  "2026-09-27-staff-console.sql",
  // Phase 8, the one schema file for the phase. Stage B adds two nullable
  // columns, "User"."termsAcceptedAt" and "User"."passwordChangedAt", with
  // ADD COLUMN IF NOT EXISTS. Applied here, before the reload, because the
  // new release writes both on signup, join and reset. Later Phase 8 stages
  // append guarded statements to the same file.
  "2026-09-30-phase8-settings-access.sql",
  // Batch 3 (Talk): "ConversationMessage"."clientId" (nullable) and a
  // partial unique index on (conversationId, authorId, clientId) where it is
  // set. ADD COLUMN IF NOT EXISTS and CREATE UNIQUE INDEX IF NOT EXISTS
  // only. Applied before the reload because the new release writes the
  // column on every send.
  "2026-10-03-message-client-id.sql",
  // Batch 5: "ItemPublicLink", one public view-only link per task (access
  // toggle 10), with its two settings ("expiresAt", "showPeople"). One new
  // table: CREATE TABLE / INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS and
  // catalogue-guarded foreign keys only, no existing column touched. Read
  // only by the task share routes and the public task page, which treat a
  // missing table as "no link" until it is applied.
  "2026-10-04-item-public-link.sql",
  // Batch 6: "BoardMember"."rung", the List ladder's Can comment and Can edit
  // assigned tasks (founder decision 3). One nullable column and its CHECK:
  // ADD COLUMN IF NOT EXISTS and a catalogue-guarded constraint, no existing
  // column or row touched. Readers that do not know it see Can view.
  "2026-10-04-board-member-rung.sql",
  // Batch 7: "ToolShare"."role", Can edit and Full access on a tool share
  // (the one share dialog for tools). One nullable column and its CHECK:
  // ADD COLUMN IF NOT EXISTS and a catalogue-guarded constraint, no existing
  // column or row touched. A row without a role is Can view, as every row
  // is today. Applied before the reload: the model names the column.
  "2026-10-04-tool-share-role.sql",
  // Batch 8: "AiUsageDay", the daily AI use guard rail (claimed by one
  // atomic upsert per use), and "TalkUpdate" / "TalkUpdateRun", scheduled AI
  // updates in Talk. New tables only: CREATE TABLE / INDEX IF NOT EXISTS and
  // catalogue-guarded foreign keys and CHECKs, no existing column or row
  // touched. Applied before the reload: a fill or an update answers "not
  // ready" and sends nothing until the tables exist.
  "2026-10-04-ai-fields-and-updates.sql",
  // Batch 9: "WorkspaceDeletion" (an Owner's deletion, kept after the
  // workspace is gone, with no name and no foreign key) and the staff-only
  // "Organization"."trialEndsAt". A new table and a new nullable column, plus
  // two one-time backfills guarded by marker comments, because this list runs
  // on every deploy. Applied before the reload: Prisma selects every
  // Organization column on a read with no select, so the column must exist
  // before the release that knows about it starts.
  "2026-10-05-workspace-deletion-and-trial-end.sql",
  "2026-10-05-membership-admin-scopes.sql",
  // Batch 12: the email queue's retry and lease column. The queue's claim
  // reads it on every send, so it must exist before the release serves.
  "2026-10-05-email-retry.sql",
  // Batch 13: Subscription."stripeEventAt" (Stripe events applied in order)
  // and the deleted workspace's Stripe ids on "WorkspaceDeletion". Before the
  // reload: Prisma selects every column on a read with no select.
  "2026-10-05-billing-events.sql",
  // Batch 13 round 3: "AiFreeDay" (the daily ceiling on free AI) and
  // "AIQuery"."freeTier". Before the reload: every free AI claim reads both.
  "2026-10-06-ai-free-day.sql",
  // AI teammates, Phase 1 (docs/plans/ai-teammates.md): nullable or defaulted
  // columns on "Agent", "AgentRun", "AgentMemory", "ChatSession" and
  // "ChatMessage", and the new "AgentAction", "AgentRoutine" and
  // "AgentPersonSetting" tables. ADD COLUMN, CREATE TABLE and CREATE INDEX IF
  // NOT EXISTS plus catalogue-guarded constraints (NOT VALID on the two chat
  // tables). Before the reload: Prisma selects every column on a read with no
  // select, and every Ask AI read touches ChatMessage.
  "2026-10-06-ai-teammates.sql",
  // Ask AI asks first: an Ask AI request in the approval queue has no
  // teammate, so "AgentAction"."agentId" may be NULL. One DROP NOT NULL: a
  // catalogue change, idempotent, no row read. Before the reload: the new
  // build writes such rows.
  "2026-10-07-ask-ai-approvals.sql",
  // AI teammates, Phase 2 (docs/plans/ai-teammates-phase2.md): the new
  // "ChatSessionTeammate" table (group chats), nullable columns on
  // "ChatSession", "Agent" and "AgentRun", a partial index on "AgentRun", and
  // two CHECKs widened to supersets ('TEAMMATE_GROUP', routines made
  // 'legacy'), each replaced only while it lacks the new value. Before the
  // reload: Prisma selects every column on a read with no select, and every
  // Ask AI read touches ChatSession.
  "2026-10-07-ai-teammates-phase2.sql",
  // AI teammates, Phase 2 step 7: the CHECK on "ChatMessage"."kind" widened
  // to a superset ('AUTOMATION', an automation's answer in its creator's
  // chat), replaced only while it lacks the value. Before the reload: the new
  // build writes such rows.
  "2026-10-07-ai-teammates-automation-kind.sql",
  // AI teammates, Phase 2 review round 5: two partial indexes over the runs
  // still open ("AgentRun" PENDING or RUNNING, "AutomationRun" RUNNING), for
  // the cron sweeps that close a run whose process stopped part way. Index
  // only, IF NOT EXISTS: safe before or after the reload.
  "2026-10-08-ai-teammates-stale-runs.sql",
  // AI teammates, Phase 2 review round 8: two partial indexes, "AutomationRun"
  // runs still holding retry state (the retry cron's scan) and "AgentRun"
  // kept questions by teammate and start (each claim's month count). Index
  // only, IF NOT EXISTS: safe before or after the reload.
  "2026-10-08-ai-teammates-round8.sql",
  // AI teammates, Phase 2 review round 10: a nullable "AgentRoutine"."teammatePrint"
  // column, the fingerprint of a routine's teammate as its person last chose
  // it. Before the reload: Prisma selects every column on a read with no
  // select, and the routine runner reads it.
  "2026-10-08-ai-teammates-routine-print.sql",
  // AI teammates, Phase 3 (docs/plans/ai-teammates-phase3.md): the new
  // "TeammateConnection", "TeammateOAuthState", "TeammateConnectorPolicy" and
  // "TeammateTokenRevocation" tables, two defaulted columns on
  // "AgentPersonSetting" (CHECK NOT VALID), catalogue-guarded foreign keys and
  // checks. Before the reload: Prisma selects every column on a read with no
  // select, and every teammate turn reads AgentPersonSetting.
  "2026-10-08-ai-teammates-phase3.sql",
  // AI teammates, Phase 3 review of step 2: a nullable "accountKey" on
  // "TeammateTokenRevocation" and on "TeammateConnection" (indexed), so a
  // queued revoke is never sent for a Google account connected again since,
  // and a backfill of the connections with no key, guarded on its own effect.
  // Before the reload: Prisma selects every column on a read with no select,
  // and the new build writes and reads both columns.
  "2026-10-08-ai-teammates-phase3-revoke-key.sql",
  // AI teammates, Phase 3 review round 1: "AgentAction"."readGoogle" BOOLEAN
  // NOT NULL DEFAULT false (a constant default, catalogue only, no row
  // rewritten), the mark of a card proposed after a Google read, and an index
  // on "TeammateTokenRevocation"."accountKey". Before the reload: Prisma
  // selects every column on a read with no select, and every card read and
  // every proposal writes the column.
  "2026-10-10-ai-teammates-phase3-round1.sql",
  // AI teammates, Phase 3 review round 2: output.readGoogle = false recorded
  // on runs that ended before round 1 with a final write on record, no
  // readGoogle at all, no Google tool named in their output, and a card not
  // yet told, so a turn told of their cards no longer reads them as unknown
  // and ignores the person's "Don't ask". Data only, guarded on its own
  // effect: safe before or after the reload.
  "2026-10-10-ai-teammates-phase3-round2.sql",
  // AI teammates, Phase 3 review round 5: an index on "AgentRun"
  // ("triggeredBy", "id"), so an account erasure's batches read one
  // person's runs in id order instead of the whole table. Index only,
  // catalogue-guarded so a later deploy takes no lock: safe before or after
  // the reload.
  "2026-10-10-ai-teammates-phase3-round5.sql",
  // AI teammates, Phase 3 review round 6: the new "AccountErasure" table
  // (one row a person: an account erasure's progress, so the sweep goes on
  // where it stopped instead of starting again), its catalogue-guarded
  // foreign key to "User", CHECK and partial index. New and empty, so it
  // locks nothing anyone waits on but "User" for a moment, once. Before the
  // reload: the new build's delete route writes it in its transaction.
  "2026-10-11-ai-teammates-phase3-round6.sql",
  // AI teammates, Phase 3 review round 7: a partial index on the erasure
  // consent records only, so the bridge that reads every past erasure each
  // tick reads that short list. Catalogue-guarded; its first build locks
  // "ConsentRecord" (small) for a moment, once.
  "2026-10-11-ai-teammates-phase3-round7.sql",
  // AI teammates, Phase 4 (docs/plans/ai-teammates-phase4.md), the two
  // columns first: "Agent"."browserSites" (CHECK NOT VALID) and
  // "AgentAction"."readWeb", both with constant defaults (catalogue only),
  // catalogue-guarded. Its own file (review of step 1) so its ACCESS
  // EXCLUSIVE locks on "Agent" and "AgentAction" are taken and released in
  // one short transaction, never held while the next file waits on
  // "Organization" and "User" for its foreign keys. Before the reload:
  // Prisma selects every column on a read with no select, and every turn and
  // every card read touches Agent and AgentAction.
  "2026-10-11-ai-teammates-phase4-columns.sql",
  // Then the new "TeammateBrowserPolicy", "TeammateBrowserSession",
  // "TeammateBrowserStep" and "TeammateBrowserShot" tables (a partial unique
  // index of one live browser per person), catalogue-guarded indexes,
  // foreign keys and checks, so a deploy after the first takes no lock. New
  // and empty, so nothing waits on them.
  "2026-10-11-ai-teammates-phase4.sql",
  // AI teammates, Phase 4 step 2: the CHECK on "AccountErasure"."part"
  // replaced under its own name with the erasure's new part "browser" (the
  // person's browser steps and pictures), guarded on its definition in
  // pg_constraint, so a later deploy takes no lock and round 6's file never
  // adds the old list back. Every row the old list allowed the new one does.
  // Before the reload: the new build's erasure pass saves that part.
  "2026-10-11-ai-teammates-phase4-erasure.sql",
  // AI teammates, Phase 4 review round 3: two partial indexes on
  // "ActivityLog", ("actingForId", "createdAt") WHERE "actingForId" IS NOT
  // NULL and ("targetId", "createdAt") WHERE "targetType" = 'user', so a
  // person's data export reads its rows that act for them and their Google
  // connection's rows by person, not by the type index across every
  // workspace. Catalogue-guarded, so a later deploy takes no lock; the
  // first build holds a SHARE lock on "ActivityLog" (small in production on
  // 2026-10-11) for a moment, once: every audited write waits for it. Safe
  // before or after the reload.
  "2026-10-11-ai-teammates-phase4-activity-indexes.sql",
  // Docs-found fixes batch 3: "WebhookSubscription"."secretSealed" JSONB,
  // nullable, the subscription's secret sealed with SECRETS_ENCRYPTION_KEY so
  // deliveries are signed with the secret the receiver was shown. Existing
  // rows keep null and keep signing with "secretHash" until rotated.
  // Catalogue-guarded, catalogue only, no backfill. Before the reload: the new
  // build selects the column on every subscription read.
  "2026-10-12-webhook-secret-sealed.sql",
  // Docs-found fixes batch 6: "CheckIn"."organizationId" TEXT, nullable, the
  // workspace a check-in was written in, with a foreign key that cascades
  // with the workspace and an index on ("organizationId", "createdAt"), so a
  // workspace reads only its own check-ins. Existing rows keep null, no
  // backfill. Catalogue-guarded; "CheckIn" is small. Before the reload: the
  // new build reads the column on every check-in read.
  "2026-10-12-check-in-workspace.sql",
  // Docs-found fixes batch 7: the older check-ins (organizationId null)
  // settled once. A row whose person holds a level in exactly one workspace
  // (anchored there, no membership in another) is written as that
  // workspace's; every other stays null and is read only by its person. ONE
  // TIME (a marker in the column's comment), so a later deploy never decides
  // a row again after a workspace's hard delete. One UPDATE of a small,
  // closed set; rows and workspaces chosen SKIP LOCKED, so it never waits on
  // a row. After the file above (it needs the column); safe before or after
  // the reload.
  "2026-10-12-check-in-backfill.sql",
  // Docs-found fixes batch 8: an account's erasure deletes the person's
  // check-ins. The CHECK on "AccountErasure"."part" gains 'checkins' (the
  // erasure pass's new first part), replaced under its own name and guarded
  // on its definition; and, once (the table's comment), the check-ins of
  // every account already in the erased state are deleted, rows chosen SKIP
  // LOCKED. Before the reload: the new build writes 'checkins', which the
  // old CHECK refuses.
  "2026-10-12-check-in-erasure.sql",
  // Docs-found fixes batch 8: the backfill above narrowed, once (its own
  // marker in the column's comment, which keeps the backfill's, so that
  // file never runs again): a row it gave to a workspace its person reached
  // through a membership (before 2026-10-12T10:00Z, a non-primary
  // membership there), and any row of a workspace its person holds no level
  // in, are set back to null, read by their person alone. Only ever
  // narrows; rows chosen SKIP LOCKED, the marker written only when none is
  // left. After the backfill; safe before or after the reload.
  "2026-10-12-check-in-backfill-narrow.sql",
  // AI teammates, Phase 5 (docs/plans/ai-teammates-phase5.md): the columns
  // first, in their own short transaction ("TeammateBrowserPolicy"."skillsEnabled",
  // the four "TeammateBrowserSession" skill columns and their CHECK NOT VALID,
  // "AgentRoutine"."skillId"), all nullable or with constant defaults
  // (catalogue only). Before the reload: Prisma selects every column on a
  // read with no select, and every browser call reads the session and the policy.
  "2026-10-17-ai-teammates-phase5-columns.sql",
  // Then the "TeammateSkill" table, its partial and expression indexes, its
  // keys (and the NOT VALID keys from the routine and the session to it) and
  // its value check, each catalogue-guarded. New and empty, so nothing waits
  // on it. On the deploy that builds them (once): "AgentRoutine_skillId_idx"
  // takes a SHARE lock on "AgentRoutine" in the first block and holds it to
  // the end of the file, through the second block's waits for the keys'
  // SHARE ROW EXCLUSIVE locks (up to the 5 s lock_timeout each, every try),
  // so a routine's write can wait that long (review of Phase 5 step 1; the
  // file's own header says "while it is built", which is too short).
  "2026-10-17-ai-teammates-phase5.sql",
  // Phase 5 step 1's review: "TeammateSkill_values_check" replaced under its
  // own name, its length tests read only for an array (a CASE), guarded on
  // its definition; then two partial indexes on "TeammateBrowserSession"
  // ("skillId", "recordingSkillId", WHERE NOT NULL) for the two ON DELETE SET
  // NULL keys, so deleting a skill no longer scans the session table twice.
  // Built plainly (the table is small while the computer is off), last in
  // the file, so the session table's SHARE lock is held only to its end; the
  // header says how to build them CONCURRENTLY by hand on a large table.
  // After the table file; safe before or after the reload.
  "2026-10-17-ai-teammates-phase5-step1-fixes.sql",
  // The WorkwrK browser host (docs/plans/browser-host.md Decision 16 and
  // section 2): "TeammateBrowserSession_values_check" replaced under its own
  // name with the provider 'workwrk' added, guarded on its definition naming
  // it, NOT VALID. ACCESS EXCLUSIVE on "TeammateBrowserSession" for the drop
  // and the add only, with no scan. Before the reload: the new build writes
  // 'workwrk' once it is configured.
  "2026-10-20-browser-host-provider.sql",
  // Then its VALIDATE, in its own transaction: SHARE UPDATE EXCLUSIVE for the
  // scan, so the session table's reads and writes go on. After the file
  // before it; safe before or after the reload.
  "2026-10-20-browser-host-provider-validate.sql",
  // The WorkwrK MCP server (docs/plans/mcp-server.md section 5): seven new
  // tables ("McpPolicy", "OAuthClient", "OAuthAuthorizationRequest",
  // "OAuthGrant", "OAuthAuthorizationCode", "OAuthToken", "McpUsageDay"),
  // their indexes (the partial unique "OAuthGrant_one_live" among them), keys
  // and value checks, every one catalogue-guarded. Every token, code and
  // secret is stored as its SHA-256 hex only. The keys take SHARE ROW
  // EXCLUSIVE on "Organization" and "User" for a moment, once. Existing rows
  // are unchanged; no backfill. Before the reload: the new build reads
  // "McpPolicy" and carries "OAuthGrant" on every sign out (falling back to
  // the plain bump while the table is absent). Nothing serves until
  // MCP_OFFERED is set.
  "2026-10-21-mcp-server.sql",
  // Ended sessions (src/lib/auth/ended-sessions.ts): one new table,
  // "EndedSession" (the session id of a token logged out in one browser,
  // primary key), and its "expiresAt" index, catalogue-guarded. No key to
  // "User", so no lock on it. Existing rows are unchanged; no backfill.
  // Before the reload: the new build lists a plain log out here instead of
  // bumping tokenVersion, and falls back to the bump while the table is
  // absent; a failed read of it never ends a session.
  "2026-10-22-ended-sessions.sql",
  // Recurring goals (docs/plans/recurring-goals.md section 3, File 1): two
  // new tables, "GoalPeriod" (one row per goal per period) and
  // "KeyResultPeriod" (one per target per period), with their keys, indexes
  // and value checks; nullable columns "OKR"."repeat" and "repeatUntil",
  // five on "KeyResult" (the source, who connected it, its refresh and pause,
  // what a period starts at) and "KRCheckIn"."periodId". Every column, index,
  // key and check is catalogue-guarded, so only the first apply locks: ACCESS
  // EXCLUSIVE on "OKR", "KeyResult" and "KRCheckIn" (small tables, NULL
  // columns, no rewrite). No key to "User". Existing rows are unchanged; no
  // backfill. BEFORE THE RELOAD: the new client selects every scalar of
  // those three on a findMany with no select. Nothing new becomes repeating
  // until RECURRING_GOALS is set.
  "2026-10-27-recurring-goals.sql",
  // Recurring goals, the KPI a period reads (docs/plans/recurring-goals.md
  // C6, B7; the step 2 review): two nullable bare-id columns on
  // "KeyResultPeriod", "kpiId" and "kpiUserId", fixed at opening so a
  // reassignment or an unlink during a period's KPI hold leaves it alone.
  // Catalogue-guarded, so only the first apply locks: ACCESS EXCLUSIVE on
  // "KeyResultPeriod" for a moment (new and small, NULL columns, no rewrite).
  // No key to "KPI" or "User". Existing rows are unchanged; no backfill.
  // BEFORE THE RELOAD: the new client selects both on a findUnique with no
  // select, and the opening writes them.
  "2026-10-27-recurring-goals-kpi-identity.sql",
];

/**
 * Apply each manifest file with `prisma db execute`.
 *
 * WHY PRISMA AND NOT A RAW pg CLIENT. The first version of this opened its own
 * `new Client({ connectionString: DIRECT_URL || DATABASE_URL })`, and the
 * deploy died three minutes in, before the build, with no log I could read.
 * That client is not the connection path the rest of the deploy has been
 * proving for months: `prisma migrate deploy` and `prisma generate` resolve
 * their datasource through prisma.config.ts, which may not be the same URL,
 * SSL mode or socket. Using the proven path removes a whole class of failure
 * rather than guessing at which part of it bit.
 *
 * EVERY FILE IN THE MANIFEST MUST BE IDEMPOTENT, because this runs on every
 * deploy and there is no ledger any more. The ledger existed to make a
 * non-idempotent file safe, but the manifest already refuses those (see the
 * note on operating-core above), so it was protecting against a case that is
 * not allowed to exist, at the cost of a second connection that broke the
 * deploy. Guard every statement with IF NOT EXISTS, and guard any backfill on
 * its own effect.
 *
 * A failure exits non zero, which aborts the build before pm2 reloads, so
 * production stays on the previous release rather than meeting a database
 * that is missing what the new code needs.
 */
//
// A LOCK TIMEOUT ON EVERY FILE. Every file runs on every deploy, and
// ALTER TABLE ... ADD COLUMN IF NOT EXISTS takes its table's ACCESS EXCLUSIVE
// lock before it finds the column already there. With no timeout, a long
// transaction on that table (the nightly backup, the hard delete at 03:30, a
// long export) made the ALTER wait, and every query of the app on that table
// (sign in on "User", every task read on "Item") queued behind it until the
// other one ended. Now a file waits at most LOCK_TIMEOUT for each lock, and is
// tried again a few times before the deploy stops.
const LOCK_TIMEOUT = "5s";
const LOCK_ATTEMPTS = 4;
const LOCK_RETRY_MS = 10_000;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function applyHandWrittenSql() {
  const scratch = mkdtempSync(join(tmpdir(), "deploy-sql-"));
  try {
    for (const name of SQL_MANIFEST) {
      const file = `prisma/sql/${name}`;
      if (!existsSync(file)) {
        console.error(`deploy-migrations: ${file} is in the manifest but missing on disk`);
        return false;
      }
      // The same file, with the timeout set first for its session.
      const timed = join(scratch, name);
      writeFileSync(timed, `SET lock_timeout = '${LOCK_TIMEOUT}';\n${readFileSync(file, "utf8")}`);
      let applied = false;
      for (let attempt = 1; attempt <= LOCK_ATTEMPTS && !applied; attempt++) {
        console.log(`deploy-migrations: applying sql ${name}${attempt > 1 ? ` (attempt ${attempt}/${LOCK_ATTEMPTS})` : ""}`);
        const r = spawnSync("npx", ["prisma", "db", "execute", "--file", timed], { encoding: "utf8" });
        if (r.stdout) process.stdout.write(r.stdout);
        if (r.stderr) process.stderr.write(r.stderr);
        if (r.status === 0) { applied = true; break; }
        const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
        // A deadlock (40P01) is tried again like a lock timeout (review of
        // Phase 4 step 1): Postgres ends one of the two transactions at
        // once, and a file whose locks crossed a long transaction's (the
        // hard delete, a backup) is whole again on the next try, every
        // file being idempotent.
        const lockWait = /lock timeout|55P03|deadlock detected|40P01/i.test(out);
        if (!lockWait || attempt === LOCK_ATTEMPTS) {
          console.error(
            `deploy-migrations: ${name} FAILED (exit ${r.status})${lockWait ? `: a table it alters stayed locked for ${LOCK_ATTEMPTS} tries` : ""}. Stopping before the build.`,
          );
          return false;
        }
        console.log(`deploy-migrations: ${name} waited ${LOCK_TIMEOUT} for a lock; trying again in ${LOCK_RETRY_MS / 1000}s`);
        sleepSync(LOCK_RETRY_MS);
      }
      console.log(`deploy-migrations: applied ${name}`);
    }
    return true;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function runPrismaDeploy() {
  const r = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
  return r.status === 0;
}

// Mirrors scripts/unstick-migrate-lock.mjs. Returns the number of
// holder sessions we terminated. Safe to call when the lock is free
// (returns 0). Best-effort: if the cleanup query itself errors we log
// and let the retry try anyway, we don't want a transient pg blip
// here to fail the whole build.
async function clearStuckLockHolders() {
  const client = new Client({ connectionString: url, statement_timeout: 15_000 });
  try {
    await client.connect();
    const holders = await client.query(
      `SELECT a.pid, a.state, a.application_name, a.query_start
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE l.locktype = 'advisory'
         AND l.objid = $1
         AND l.pid <> pg_backend_pid()`,
      [PRISMA_LOCK_ID],
    );
    if (holders.rows.length === 0) return 0;
    console.log(`deploy-migrations: clearing ${holders.rows.length} orphaned migration-lock holder(s):`);
    for (const row of holders.rows) {
      console.log(`  pid=${row.pid} state=${row.state} app=${row.application_name} since=${row.query_start}`);
    }
    const killed = await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE pid IN (SELECT l.pid FROM pg_locks l
                     WHERE l.locktype = 'advisory'
                       AND l.objid = $1
                       AND l.pid <> pg_backend_pid())`,
      [PRISMA_LOCK_ID],
    );
    return killed.rowCount ?? 0;
  } catch (err) {
    console.log(`deploy-migrations: clear-holders failed (${err.code || err.message}); continuing`);
    return 0;
  } finally {
    try { await client.end(); } catch {}
  }
}

async function runPrismaDeployWithRetry(attempts = 3, delayMs = 15_000) {
  for (let i = 1; i <= attempts; i++) {
    console.log(`deploy-migrations: running prisma migrate deploy (attempt ${i}/${attempts})`);
    if (runPrismaDeploy()) return true;
    if (i < attempts) {
      // Clear stuck holders before sleeping so a release has time to
      // propagate before we try again.
      await clearStuckLockHolders();
      console.log(`deploy-migrations: retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

// Hand-written SQL first: the new release's code depends on these objects,
// and the deploy builds it only after this script succeeds. Stop if any of
// them fails rather than reloading onto a release the database cannot serve.
if (!applyHandWrittenSql()) {
  console.error("deploy-migrations: stopping the deploy; production stays on the release it is serving");
  process.exit(1);
}

const onDisk = readdirSync("prisma/migrations", { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const client = new Client({ connectionString: url, statement_timeout: 15_000 });

let applied = null;
try {
  await client.connect();
  const r = await client.query(
    `SELECT migration_name FROM _prisma_migrations
     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  );
  applied = new Set(r.rows.map((row) => row.migration_name));
} catch (err) {
  // Table may not exist yet, or DB may be unreachable. Fall through
  // to prisma, which handles its own baselining / errors.
  console.log(`deploy-migrations: couldn't check migration state (${err.code || err.message}), delegating to prisma`);
} finally {
  try { await client.end(); } catch {}
}

if (applied === null) {
  const ok = await runPrismaDeployWithRetry();
  process.exit(ok ? 0 : 1);
}

const pending = onDisk.filter((m) => !applied.has(m));

if (pending.length === 0) {
  console.log(`deploy-migrations: all ${onDisk.length} migrations already applied, skipping prisma migrate deploy`);
  process.exit(0);
}

console.log(`deploy-migrations: ${pending.length} pending migration(s):`);
for (const m of pending) console.log(`  - ${m}`);

const ok = await runPrismaDeployWithRetry();
process.exit(ok ? 0 : 1);

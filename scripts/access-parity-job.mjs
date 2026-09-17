#!/usr/bin/env node
// The access parity job (access-model-spec.md section 10, step 2, graft G6).
//
//   node scripts/access-parity-job.mjs --limit 200            run and report
//   node scripts/access-parity-job.mjs --limit 50 --dry-run   print the sample plan only
//   node scripts/access-parity-job.mjs --org <id> --out report.json
//
// For a sample of real (viewer, object) pairs it fills parity.ts's
// LegacyInputs through the SAME loaders the step-1 delegates use
// (src/lib/access/legacy-facts.ts: one query set per helper, byte-identical
// to what space.ts, board.ts, folder.ts, access.ts and doc-access.ts read),
// computes today's answer (the branch-for-branch transcription) and the
// engine's answer for every helper that applies to the object, and prints
// the differences. Every difference must be in EXPECTED_MISMATCHES; an
// unexpected one exits 1. "Zero unexpected mismatches for a week" is the
// criterion for the step-4 read-path flip.
//
// READ-ONLY, three ways: the Postgres session is opened with
// default_transaction_read_only=on (any write is refused by the server), the
// Prisma client is extended to throw on any non-read operation, and the job
// only ever calls the loaders and the pure harness. Not scheduled here: the
// crontab row lives in scripts/CRON-SETUP.md for the founder to install.
//
// Sampling is deterministic (no randomness) so two runs over the same data
// report the same cases, and it is spread rather than oldest-first: orgs are
// the ones with the most users, objects are picked one per bucket first
// (visibility x has-members for spaces/folders/boards, per board for items,
// per anchor type for docs) and then in id order, and each object meets a
// rotating slice of the viewer ladder so a --limit reaches several objects
// per kind instead of one. --rotate shifts the object window by the day of
// the year so a nightly run walks the tenant over a week; --offset N sets
// the shift by hand. Pass --org to focus on one tenant.

import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import dotenv from "dotenv";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Arguments ─────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function flag(name) {
  return argv.includes(name);
}
function option(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}
if (flag("--help")) {
  console.log(
    [
      "usage: node scripts/access-parity-job.mjs [--limit N] [--dry-run] [--org <id>] [--out <file>] [--rotate | --offset N] [--viewers-per-object N] [--allow-remote]",
      "  --limit N               maximum (viewer, object) pairs to evaluate (default 200)",
      "  --dry-run               open the read-only session, print the sample plan, evaluate nothing",
      "  --org <id>              sample one organization only",
      "  --out <file>            also write the full report as JSON",
      "  --rotate                shift the object window by the day of the year (for the nightly row)",
      "  --offset N              shift the object window by N (default 0)",
      "  --viewers-per-object N  viewers paired with each object, rotating through the ladder (default 4)",
      "  --allow-remote          permit a DATABASE_URL host other than localhost",
    ].join("\n"),
  );
  process.exit(0);
}
const LIMIT = Math.max(1, Number(option("--limit", "200")) || 200);
const DRY_RUN = flag("--dry-run");
const ONLY_ORG = option("--org", null);
const OUT = option("--out", null);
const VIEWERS_PER_OBJECT = Math.max(1, Number(option("--viewers-per-object", "4")) || 4);
function dayOfYear(d = new Date()) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}
const OFFSET = flag("--rotate") ? dayOfYear() : Math.max(0, Number(option("--offset", "0")) || 0);

// ── Environment and the read-only connection ──────────────────────

dotenv.config({ path: join(ROOT, ".env.local") });
dotenv.config({ path: join(ROOT, ".env") });

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}
const parsed = new URL(rawUrl);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
if (!LOCAL_HOSTS.has(parsed.hostname) && !flag("--allow-remote")) {
  console.error(`DATABASE_URL host is ${parsed.hostname}; pass --allow-remote to run against a non-local database`);
  process.exit(2);
}
// Server-side read-only for every connection this process opens, including
// the one src/lib/prisma.ts would build if it did not reuse ours.
parsed.searchParams.set("options", "-c default_transaction_read_only=on");
const READ_ONLY_URL = parsed.toString();
process.env.DATABASE_URL = READ_ONLY_URL;

register("./lib/ts-hooks.mjs", import.meta.url, { data: { root: ROOT } });

const { PrismaClient } = await import(pathToFileURL(join(ROOT, "src/generated/prisma/index.js")).href);
const { PrismaPg } = await import("@prisma/adapter-pg");

const READ_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const baseClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: READ_ONLY_URL }) });
const prisma = baseClient.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!READ_OPS.has(operation)) {
          throw new Error(`access-parity-job is read-only; refused ${model}.${operation}`);
        }
        return query(args);
      },
    },
  },
});
// src/lib/prisma.ts reuses a cached client from globalThis when it carries
// every model delegate, which the extended client does.
globalThis.prisma = prisma;

const [{ prisma: appPrisma }, facts, harness] = await Promise.all([
  import(pathToFileURL(join(ROOT, "src/lib/prisma.ts")).href),
  import(pathToFileURL(join(ROOT, "src/lib/access/legacy-facts.ts")).href),
  import(pathToFileURL(join(ROOT, "src/lib/access/parity.ts")).href),
]);
if (appPrisma !== prisma) {
  console.error("src/lib/prisma.ts did not reuse the read-only client; the server-side guard still holds, but stop and check");
}

const [{ ro }] = await prisma.$queryRaw`SELECT current_setting('default_transaction_read_only') AS ro`;
if (ro !== "on") {
  console.error(`expected default_transaction_read_only=on, got ${ro}; refusing to run`);
  await baseClient.$disconnect();
  process.exit(2);
}

// ── Sampling ──────────────────────────────────────────────────────

const KINDS = ["space", "folder", "board", "item", "doc"];
const MAX_ORGS = 5;
const MAX_VIEWERS_PER_ORG = 10;
const VIEWERS_PER_LEVEL = 2;

/** Tenants with the most users first (an org with one user exercises nothing), id as the tiebreak. */
async function sampleOrgs() {
  if (ONLY_ORG) return [ONLY_ORG];
  const rows = await prisma.organization.findMany({
    select: { id: true },
    orderBy: [{ users: { _count: "desc" } }, { id: "asc" }],
    take: MAX_ORGS,
  });
  return rows.map((r) => r.id);
}

/** Up to two users per access level, so every rung of today's ladder is seen. */
async function sampleViewers(organizationId) {
  const rows = await prisma.user.findMany({
    where: { organizationId, deletedAt: null },
    select: {
      id: true,
      organizationId: true,
      accessLevel: true,
      status: true,
      _count: { select: { directReports: true } },
    },
    orderBy: [{ accessLevel: "asc" }, { id: "asc" }],
  });
  const perLevel = new Map();
  const out = [];
  for (const row of rows) {
    const n = perLevel.get(row.accessLevel) ?? 0;
    if (n >= VIEWERS_PER_LEVEL) continue;
    perLevel.set(row.accessLevel, n + 1);
    out.push({ ...row, hasReports: row._count.directReports > 0 });
    if (out.length >= MAX_VIEWERS_PER_ORG) break;
  }
  return out;
}

/** How many candidate rows per kind and org the picker sees (a window, not the whole table). */
const CANDIDATE_WINDOW = 400;

/**
 * Pick `take` rows from `candidates` (already in id order): first one per
 * bucket, in first-seen bucket order, then the rest in id order. `offset`
 * rotates the candidate list before picking so a nightly run walks the window.
 */
function pickSpread(candidates, bucketOf, take, offset) {
  if (candidates.length === 0) return [];
  const shift = offset % candidates.length;
  const rotated = candidates.slice(shift).concat(candidates.slice(0, shift));
  const seen = new Set();
  const first = [];
  const rest = [];
  for (const row of rotated) {
    const bucket = bucketOf(row);
    if (seen.has(bucket)) rest.push(row);
    else {
      seen.add(bucket);
      first.push({ ...row, bucket });
    }
  }
  return first.concat(rest.map((row) => ({ ...row, bucket: bucketOf(row) }))).slice(0, take);
}

const visBucket = (row) => `${row.visibility}${row._count.members > 0 ? "+members" : ""}`;

async function sampleObjects(organizationId, take, offset) {
  const window = { orderBy: { id: "asc" }, take: CANDIDATE_WINDOW };
  const withMembers = { id: true, visibility: true, _count: { select: { members: true } } };
  const [spaces, folders, boards, items, docs] = await Promise.all([
    prisma.space.findMany({ where: { organizationId }, select: withMembers, ...window }),
    prisma.folder.findMany({ where: { organizationId }, select: withMembers, ...window }),
    prisma.board.findMany({ where: { organizationId }, select: { ...withMembers, folderId: true }, ...window }),
    prisma.item.findMany({ where: { organizationId }, select: { id: true, boardId: true }, ...window }),
    prisma.doc.findMany({ where: { organizationId }, select: { id: true, entityType: true }, ...window }),
  ]);
  return {
    space: pickSpread(spaces, visBucket, take, offset),
    folder: pickSpread(folders, visBucket, take, offset),
    board: pickSpread(boards, (b) => `${visBucket(b)}${b.folderId ? "+folder" : ""}`, take, offset),
    item: pickSpread(items, (i) => `board:${i.boardId}`, take, offset),
    doc: pickSpread(docs, (d) => `anchor:${d.entityType ?? "none"}`, take, offset),
  };
}

/**
 * Deterministic pair order: viewer-only pairs first (they are cheap and cover
 * the tier helpers), then object index, kind, and a rotating slice of
 * VIEWERS_PER_OBJECT viewers, so consecutive objects meet different rungs of
 * the ladder and a --limit spans several objects per kind; cut at LIMIT.
 */
async function plan() {
  const orgs = await sampleOrgs();
  const pairs = [];
  const summary = [];
  for (const organizationId of orgs) {
    if (pairs.length >= LIMIT) break;
    const viewers = await sampleViewers(organizationId);
    if (viewers.length === 0) continue;
    const objects = await sampleObjects(organizationId, LIMIT, OFFSET);
    summary.push({
      organizationId,
      viewers: viewers.map((v) => `${v.accessLevel}${v.hasReports ? "+reports" : ""}`),
      objects: Object.fromEntries(KINDS.map((k) => [k, objects[k].length])),
      buckets: Object.fromEntries(KINDS.map((k) => [k, [...new Set(objects[k].map((o) => o.bucket))]])),
    });
    for (const viewer of viewers) {
      if (pairs.length >= LIMIT) break;
      pairs.push({ kind: "viewer", objectId: null, viewer });
    }
    const most = Math.max(...KINDS.map((k) => objects[k].length));
    let slot = 0;
    for (let i = 0; i < most && pairs.length < LIMIT; i++) {
      for (const kind of KINDS) {
        const object = objects[kind][i];
        if (!object) continue;
        const n = Math.min(VIEWERS_PER_OBJECT, viewers.length);
        for (let j = 0; j < n && pairs.length < LIMIT; j++) {
          const viewer = viewers[(slot * n + j) % viewers.length];
          pairs.push({ kind, objectId: object.id, viewer, bucket: object.bucket });
        }
        slot++;
      }
    }
  }
  return { orgs, pairs, summary };
}

// ── Cases: the same loader call per helper as the step-1 delegate ─

function legacyViewer(viewer) {
  return { userId: viewer.id, accessLevel: viewer.accessLevel, organizationId: viewer.organizationId };
}

/** What today's delegates do not load but the engine reads (spec 2.1, 5.1). */
function withViewerFacts(inputs, viewer) {
  return { ...inputs, status: viewer.status, hasReports: viewer.hasReports };
}

function makeCase(pair, helper, inputs) {
  return {
    id: `${pair.kind}:${pair.objectId ?? "-"}:${pair.viewer.id}:${helper}`,
    description: `${helper} for ${pair.viewer.accessLevel} on ${pair.kind} ${pair.objectId ?? ""}`.trim(),
    helper,
    input: withViewerFacts(inputs, pair.viewer),
  };
}

async function casesFor(pair) {
  const viewer = legacyViewer(pair.viewer);
  const id = pair.objectId;
  switch (pair.kind) {
    case "viewer": {
      const inputs = facts.emptyLegacyInputs(viewer);
      return [
        "createSpace",
        "canAccessTier:manager",
        "canAccessTier:hr-admin",
        "canAccessTier:org-admin",
        "isOrgAdmin",
        "isManager",
      ].map((h) => makeCase(pair, h, inputs));
    }
    case "space": {
      // space.ts:202 / :217 / :232 and access.ts:160 all use loadSpaceInputs.
      const { inputs } = await facts.loadSpaceInputs(id, viewer);
      return ["getSpaceForReader", "canEditSpace", "canEditSpace@create_child", "canContributeSpace", "resolveSpace"].map((h) =>
        makeCase(pair, h, inputs),
      );
    }
    case "folder": {
      // folder.ts:205 and access.ts:165.
      const { inputs } = await facts.loadFolderInputs(id, viewer);
      return ["folderVisibleTo", "folderReadable", "resolveFolder"].map((h) => makeCase(pair, h, inputs));
    }
    case "board": {
      // board.ts:623 (shallow), :645 and :671 (none), access.ts:170 (full).
      const [shallow, none, full] = await Promise.all([
        facts.loadBoardInputs(id, viewer, { folderDepth: "shallow" }),
        facts.loadBoardInputs(id, viewer, { folderDepth: "none" }),
        facts.loadBoardInputs(id, viewer, { folderDepth: "full" }),
      ]);
      return [
        makeCase(pair, "getBoardForReader", shallow.inputs),
        makeCase(pair, "canReadBoard", shallow.inputs),
        makeCase(pair, "canEditBoard", none.inputs),
        makeCase(pair, "canContributeBoard", none.inputs),
        makeCase(pair, "resolveBoard", full.inputs),
      ];
    }
    case "item": {
      // access.ts:188 resolveItem: loadItemInputs stops at the item row for an
      // org admin (rule A) because resolveItem returns at access.ts:275.
      const { inputs } = await facts.loadItemInputs(id, viewer);
      // api/items/[id]/route.ts is NOT delegated: after the item row it calls
      // getBoardForReader (board.ts:623, shallow) for every viewer, admins
      // included, and canContributeBoard on write. Feeding the admin-stopped
      // struct to itemRead/itemWrite would score "no board" as a denial the
      // route never gives, so refill the board the way the route reads it.
      let routeInputs = inputs;
      if (inputs.item && !inputs.board) {
        const board = await facts.loadBoardInputs(inputs.item.boardId, viewer, { folderDepth: "shallow" });
        routeInputs = { ...inputs, board: board.inputs.board, folder: board.inputs.folder, space: board.inputs.space };
      }
      return [
        makeCase(pair, "itemRead", routeInputs),
        makeCase(pair, "itemWrite", routeInputs),
        makeCase(pair, "resolveItem", inputs),
      ];
    }
    case "doc": {
      // doc-access.ts (full anchor) and access.ts:181 (resolveDoc skip).
      const [open, resolve] = await Promise.all([
        facts.loadDocInputs(id, viewer, { consumer: "docAccessible" }),
        facts.loadDocInputs(id, viewer, { consumer: "resolveDoc" }),
      ]);
      return [makeCase(pair, "docAccessible", open.inputs), makeCase(pair, "resolveDoc", resolve.inputs)];
    }
    default:
      return [];
  }
}

// ── Report ────────────────────────────────────────────────────────

function fmtAnswer(a) {
  return a.kind === "boolean" ? String(a.value) : a.value;
}

function fmtInput(i) {
  const parts = [`viewer=${i.accessLevel ?? "null"}`, `status=${i.status ?? "?"}`, `reports=${i.hasReports ? "y" : "n"}`];
  const obj = (label, o) => {
    if (!o) return;
    const bits = [];
    if (o.visibility) bits.push(o.visibility);
    if (o.memberRole) bits.push(`role=${o.memberRole}`);
    if (o.ancestorMemberRole) bits.push(`ancestor=${o.ancestorMemberRole}`);
    if (o.ownerId === i.userId) bits.push("owner");
    if (o.archived) bits.push("archived");
    parts.push(`${label}{${bits.join(",")}}`);
  };
  obj("space", i.space);
  obj("folder", i.folder);
  obj("board", i.board);
  if (i.item) {
    const bits = [];
    if (i.item.ownerId === i.userId) bits.push("dri");
    if (i.item.assigneeIds?.includes(i.userId)) bits.push("assignee");
    parts.push(`item{${bits.join(",")}}`);
  }
  if (i.doc) {
    parts.push(`doc{anchor=${i.doc.anchor.entityType ?? "none"}${i.doc.createdById === i.userId ? ",creator" : ""}}`);
  }
  return parts.join(" ");
}

const { orgs, pairs, summary } = await plan();

console.log(
  `access parity job   mode: ${DRY_RUN ? "dry-run" : "run"}   limit: ${LIMIT} pairs   offset: ${OFFSET}   viewers/object: ${VIEWERS_PER_OBJECT}   read-only: on`,
);
console.log(`orgs sampled: ${orgs.length}   pairs planned: ${pairs.length}`);
for (const s of summary) {
  console.log(`  org ${s.organizationId}: viewers [${s.viewers.join(", ")}]  objects ${JSON.stringify(s.objects)}`);
  for (const k of KINDS) if (s.buckets[k].length) console.log(`      ${k} buckets: ${s.buckets[k].join(", ")}`);
}
const byKind = {};
const objectsByKind = {};
for (const p of pairs) {
  byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  if (p.objectId) (objectsByKind[p.kind] ??= new Set()).add(p.objectId);
}
console.log(`pairs by kind: ${JSON.stringify(byKind)}`);
console.log(`distinct objects by kind: ${JSON.stringify(Object.fromEntries(Object.entries(objectsByKind).map(([k, s]) => [k, s.size])))}`);

if (DRY_RUN) {
  console.log("\ndry-run: nothing evaluated.");
  await baseClient.$disconnect();
  process.exit(0);
}

const cases = [];
for (const pair of pairs) cases.push(...(await casesFor(pair)));
const report = harness.runParity(cases);

const expectedByKey = {};
for (const m of report.expected) expectedByKey[m.expected.key] = (expectedByKey[m.expected.key] ?? 0) + 1;

console.log("");
console.log(`cases: ${report.total}   agreed: ${report.agreed}   expected mismatches: ${report.expected.length}   UNEXPECTED: ${report.unexpected.length}`);
if (report.expected.length) {
  console.log("\nexpected mismatches by key (each named in parity.ts EXPECTED_MISMATCHES):");
  for (const [key, n] of Object.entries(expectedByKey).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(4)}  ${key}`);
}
if (report.unexpected.length) {
  console.log("\nUNEXPECTED mismatches (each one blocks the step-4 flip):");
  for (const m of report.unexpected) {
    const c = cases.find((x) => x.id === m.caseId);
    console.log(`  ${m.caseId}`);
    console.log(`      legacy=${fmtAnswer(m.legacy)}  engine=${fmtAnswer(m.engine)}  ${c ? fmtInput(c.input) : ""}`);
  }
}
console.log(`\nexpectations not exercised by this sample: ${report.unusedExpectations.length} (informational; a sample cannot reach every fixture)`);

if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        limit: LIMIT,
        orgs,
        pairs: pairs.length,
        total: report.total,
        agreed: report.agreed,
        expectedByKey,
        unexpected: report.unexpected.map((m) => ({
          caseId: m.caseId,
          helper: m.helper,
          legacy: m.legacy,
          engine: m.engine,
          input: cases.find((x) => x.id === m.caseId)?.input ?? null,
        })),
        unusedExpectations: report.unusedExpectations,
      },
      null,
      2,
    ),
  );
  console.log(`report written to ${OUT}`);
}

await baseClient.$disconnect();
process.exit(report.unexpected.length ? 1 : 0);

// The node-access section of scripts/access-parity-job.mjs (Phase 8 stage E).
//
// For every sampled (person, object) pair it asks the LIVE resolver
// (node-access for Space, Folder, List, Doc, Table, Canvas, Form; item-gate
// for tasks; sop-access for SOP folders; canSeeGoal for goals; the legacy
// settings table for the Workspace door) and the engine (can() over
// loadFacts, which follows ACCESS_V2_TABLES), and classifies every difference
// through src/lib/access/node-parity.ts. Read-only: it calls loaders and
// resolvers only, over the job's read-only client.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NODE_KINDS = [
  ["space", "space"],
  ["folder", "folder"],
  ["list", "list"],
  ["doc", "doc"],
  ["table", "table"],
  ["canvas", "whiteboard"],
  ["form", "form"],
];

const SETTINGS_PAGES = ["overview", "identity", "locale", "apps", "members", "structure", "access", "tasks", "scoring", "security", "data", "audit", "api", "billing"];

export async function runNodeSection({ root, prisma, orgs, all, perKind, viewersPerOrg, log }) {
  const imp = (p) => import(pathToFileURL(join(root, p)).href);
  const [engine, viewerMod, orgRole, nodeAccess, parity, itemGate, sopAccess, goalAudience, legacySettings, flags, legacyLevels, permissions, matrixRules, accessSettings, resolve] = await Promise.all([
    imp("src/lib/access/index.ts"),
    imp("src/lib/access/viewer.ts"),
    imp("src/lib/access/org-role.ts"),
    imp("src/lib/access/node-access.ts"),
    imp("src/lib/access/node-parity.ts"),
    imp("src/lib/item-gate.ts"),
    imp("src/lib/sop-access.ts"),
    imp("src/lib/goal-audience.ts"),
    imp("src/lib/access/settings-legacy.ts"),
    imp("src/lib/access/flags.ts"),
    imp("src/lib/access/legacy-levels.ts"),
    imp("src/lib/permissions.ts"),
    imp("src/lib/access/matrix-rules.ts"),
    imp("src/lib/access/settings.ts"),
    imp("src/lib/access/resolve.ts"),
  ]);
  const flagState = { resolver: flags.accessV2Resolver(), tables: flags.accessV2Tables() };
  const cases = [];
  const errors = [];

  for (const organizationId of orgs) {
    const users = await prisma.user.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, accessLevel: true, status: true, _count: { select: { directReports: true } } },
      orderBy: [{ accessLevel: "asc" }, { id: "asc" }],
    });
    const viewers = all ? users : pickPerLevel(users, viewersPerOrg);
    if (viewers.length === 0) continue;

    const take = { orderBy: { id: "asc" }, take: perKind };
    const where = { organizationId };
    const [spaces, folders, lists, docs, tables, canvases, forms, items, sopFolders, goals] = await Promise.all([
      prisma.space.findMany({ where, select: { id: true, archivedAt: true }, ...take }),
      prisma.folder.findMany({ where, select: { id: true, archivedAt: true }, ...take }),
      prisma.board.findMany({ where, select: { id: true, archivedAt: true }, ...take }),
      prisma.doc.findMany({ where, select: { id: true }, ...take }),
      prisma.dataTable.findMany({ where, select: { id: true }, ...take }),
      prisma.whiteboard.findMany({ where, select: { id: true, archivedAt: true }, ...take }),
      prisma.formDefinition.findMany({ where, select: { id: true }, ...take }),
      prisma.item.findMany({ where, select: { id: true, ownerId: true, assigneeIds: true, archivedAt: true }, ...take }),
      prisma.sOPFolder.findMany({ where, select: { id: true }, ...take }),
      prisma.oKR.findMany({ where, select: { id: true, level: true, ownerId: true, departmentId: true }, ...take }),
    ]);
    const byKind = { space: spaces, folder: folders, list: lists, doc: docs, table: tables, canvas: canvases, form: forms };
    const orgRow = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
    const orgMatrix = orgRow?.settings?.permissions ?? null;
    const orgAccess = accessSettings.parseAccessSettings(orgRow?.settings?.access);
    log(`  node section org ${organizationId}: viewers ${viewers.length}  objects ${JSON.stringify(Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.length])))} items ${items.length} sopFolders ${sopFolders.length} goals ${goals.length}`);

    for (const u of viewers) {
      const level = u.accessLevel ?? null;
      const role = orgRole.orgRoleOf({ accessLevel: level });
      const base = {
        userId: u.id,
        organizationId,
        orgRole: role,
        isAgent: orgRole.isAgentOf(level),
        adminScopes: orgRole.adminScopesOf(role, null),
        peopleTeam: orgRole.isSeededPeopleTeam(level),
      };
      const viewer = await viewerMod.hydrate(base, {});
      const ctx = await nodeAccess.nodeCtxForUser(u.id, organizationId);
      const who = {
        userId: u.id,
        accessLevel: level,
        orgAdmin: legacyLevels.legacyIsAdminLevel(level),
        peopleTeam: !!viewer.peopleTeam,
        agent: level === "AGENT",
        hasReports: u._count.directReports > 0,
        status: u.status ?? "ACTIVE",
      };
      const session = { user: { id: u.id, organizationId, accessLevel: level } };

      // Node kinds: node-access in one batch, the engine per object.
      const refs = [];
      for (const [kind] of NODE_KINDS) for (const o of byKind[kind]) refs.push({ kind, id: o.id, archived: !!o.archivedAt });
      const truths = await nodeAccess.nodeRoles(ctx, refs.map((r) => ({ kind: r.kind, id: r.id })));
      for (const r of refs) {
        const engineType = NODE_KINDS.find(([k]) => k === r.kind)[1];
        try {
          const t = truths.get(`${r.kind}:${r.id}`) ?? { role: "none", via: { type: "none" } };
          const f = await engine.loadFacts(viewer, { type: engineType, id: r.id });
          const d = engine.decide(f, "view");
          const archived = !!f.object.archived || f.chain.some((l) => l.archived);
          cases.push({
            id: `node:${r.kind}:${r.id}:${u.id}`,
            section: "node",
            kind: r.kind,
            objectId: r.id,
            viewer: who,
            truth: parity.parityRoleOf(t.role),
            engine: d.allowed || d.role !== "none" ? parity.parityRoleOf(d.role) : "none",
            engineVia: d.via,
            truthVia: t.via?.type ?? "none",
            facts: { archived: r.archived || archived },
          });
        } catch (e) {
          errors.push(`${r.kind}:${r.id}:${u.id}: ${e?.message ?? e}`);
        }
      }

      // Tasks: item-gate is the live answer.
      for (const it of items) {
        try {
          const g = await itemGate.gateItem(it.id, { userId: u.id, accessLevel: level ?? "EMPLOYEE", organizationId, userName: null }, "view");
          const truth = "error" in g ? "none" : parity.parityRoleOf(g.decision.role);
          const f = await engine.loadFacts(viewer, { type: "item", id: it.id });
          const d = engine.decide(f, "view");
          cases.push({
            id: `node:item:${it.id}:${u.id}`,
            section: "node",
            kind: "item",
            objectId: it.id,
            viewer: who,
            truth,
            engine: d.allowed || d.role !== "none" ? parity.parityRoleOf(d.role) : "none",
            engineVia: d.via,
            truthVia: "error" in g ? "denied" : String(g.decision.via ?? ""),
            facts: {
              archived: !!it.archivedAt || !!f.object.archived || f.chain.some((l) => l.archived),
              assignee: it.ownerId === u.id || (it.assigneeIds ?? []).includes(u.id),
              creator: "error" in g ? false : !!g.isCreator,
              linkedList: "error" in g ? false : !!g.viaLinkedList,
            },
          });
        } catch (e) {
          errors.push(`item:${it.id}:${u.id}: ${e?.message ?? e}`);
        }
      }

      // SOP folders: sop-access is live.
      for (const f of sopFolders) {
        try {
          const grant = who.orgAdmin ? "OWNER" : await sopAccess.folderGrantRole(session, f.id);
          const truth = grant === "OWNER" ? "FULL" : grant === "EDITOR" ? "EDIT" : grant === "VIEWER" ? "VIEW" : "none";
          const d = await engine.can(viewer, "view", { type: "sop_folder", id: f.id });
          cases.push({
            id: `sop_folder:${f.id}:${u.id}`,
            section: "sop_folder",
            kind: "sop_folder",
            objectId: f.id,
            viewer: who,
            truth,
            engine: d.allowed || d.role !== "none" ? parity.parityRoleOf(d.role) : "none",
            engineVia: d.via,
          });
        } catch (e) {
          errors.push(`sop_folder:${f.id}:${u.id}: ${e?.message ?? e}`);
        }
      }

      // Goals: canSeeGoal is live (a view question).
      for (const g of goals) {
        try {
          const sees = await goalAudience.canSeeGoal(session, g);
          const d = await engine.can(viewer, "view", { type: "goal", id: g.id });
          cases.push({
            id: `goal:${g.id}:${u.id}`,
            section: "goal",
            kind: "goal",
            objectId: g.id,
            viewer: who,
            truth: sees ? "VIEW" : "none",
            engine: d.allowed ? "VIEW" : "none",
            engineVia: d.via,
          });
        } catch (e) {
          errors.push(`goal:${g.id}:${u.id}: ${e?.message ?? e}`);
        }
      }

      // The permission matrix's live cells (matrix-rules.ts) against the stored matrix.
      for (const row of matrixRules.MATRIX_CELL_RULES) {
        const legacy = permissions.checkPermission(level, orgMatrix, row.module, row.action);
        // matrixCellDecision is what hasPermission enforces (a narrowOnly
        // row intersects the rule with today's stored answer).
        const eng = matrixRules.matrixCellDecision(row.module, row.action, {
          orgRole: viewer.orgRole,
          isAgent: viewer.isAgent,
          peopleTeam: !!viewer.peopleTeam || orgAccess.peopleTeamUserIds.includes(u.id),
          hasReports: resolve.hasReports(viewer),
        }, orgAccess, legacy);
        cases.push({
          id: `matrix:${row.module}.${row.action}:${u.id}`,
          section: "matrix",
          kind: `${row.module}.${row.action}`,
          objectId: `${row.module}.${row.action}`,
          viewer: who,
          truth: legacy ? "VIEW" : "none",
          engine: eng ? "VIEW" : "none",
          engineVia: row.rule,
        });
      }

      // The Workspace settings door.
      for (const page of SETTINGS_PAGES) {
        try {
          const legacy = legacySettings.legacySettingsAllows(page, level);
          const d = await engine.can(viewer, "view", { type: "settings", page });
          cases.push({
            id: `settings:${page}:${u.id}`,
            section: "settings",
            kind: page,
            objectId: page,
            viewer: who,
            truth: legacy ? "VIEW" : "none",
            engine: d.allowed ? "VIEW" : "none",
            engineVia: d.via,
          });
        } catch (e) {
          errors.push(`settings:${page}:${u.id}: ${e?.message ?? e}`);
        }
      }
    }
  }

  const report = parity.runNodeParity(cases, flagState);
  // Informational breakdown of every mismatch, expected or not: kind, the
  // live via and the engine via, so a broad row never hides a cause.
  const breakdown = {};
  for (const c of cases) {
    if (c.truth === c.engine) continue;
    const k = `${c.section}/${c.kind} truth=${c.truth}(${c.truthVia ?? "-"}) engine=${c.engine}(${c.engineVia ?? "-"}) level=${c.viewer.accessLevel}`;
    breakdown[k] = (breakdown[k] ?? 0) + 1;
  }
  const bySection = {};
  for (const c of cases) {
    const s = (bySection[c.section] ??= { total: 0, agreed: 0 });
    s.total++;
    if (c.truth === c.engine) s.agreed++;
  }
  return { flagState, report, breakdown, bySection, errors };
}

function pickPerLevel(users, max) {
  const perLevel = new Map();
  const out = [];
  for (const u of users) {
    const n = perLevel.get(u.accessLevel) ?? 0;
    if (n >= 2) continue;
    perLevel.set(u.accessLevel, n + 1);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

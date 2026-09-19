/**
 * Live check of the Phase 2 item API contract, over HTTP, as two real users.
 *
 * Read-mostly and additive: it creates probe tasks and comments and cleans up
 * after itself. It never deletes anything it did not create, and it takes no
 * `--write` flag because it is not a data migration.
 *
 * Why it exists: vitest here runs pure modules in node with no database
 * (vitest.config.ts scopes the suite to src/lib), so the assignee and
 * personal-list regressions the spec names cannot be asserted end to end
 * there. `src/lib/item-gate.personal.test.ts` holds the durable source-level
 * guard; this is the live one.
 *
 * Usage (against a running dev server):
 *
 *   BASE=http://localhost:3007 \
 *   EMP_COOKIE="$(cat /path/to/emp.cookie)" \
 *   ADMIN_COOKIE="$(cat /path/to/admin.cookie)" \
 *   EMP_LIST=<a List id the employee can write to> \
 *   ADMIN_LIST=<a List id the admin can write to> \
 *     npx tsx scripts/verify-item-api.ts
 *
 * It prints one line per check and exits non-zero on the first failure.
 */

const BASE = process.env.BASE ?? "http://localhost:3007";
const EMP = process.env.EMP_COOKIE ?? "";
const ADMIN = process.env.ADMIN_COOKIE ?? "";
const EMP_LIST = process.env.EMP_LIST ?? "";
const ADMIN_LIST = process.env.ADMIN_LIST ?? "";

if (!EMP || !ADMIN || !EMP_LIST || !ADMIN_LIST) {
  console.error("Set EMP_COOKIE, ADMIN_COOKIE, EMP_LIST and ADMIN_LIST. See the header of this file.");
  process.exit(2);
}

let failures = 0;
const created: { id: string; cookie: string }[] = [];

function call(cookie: string, path: string, init: RequestInit = {}) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: `next-auth.session-token=${cookie}`,
      ...(init.headers ?? {}),
    },
  });
}

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

async function whoami(cookie: string): Promise<string> {
  const r = await call(cookie, "/api/me");
  const d = (await r.json()) as { user?: { id?: string }; id?: string };
  return d.user?.id ?? d.id ?? "";
}

async function createTask(cookie: string, listId: string, body: Record<string, unknown>): Promise<string> {
  const r = await call(cookie, `/api/boards/${listId}/items`, { method: "POST", body: JSON.stringify(body) });
  const d = (await r.json()) as { item?: { id?: string } };
  const id = d.item?.id ?? "";
  if (id) created.push({ id, cookie });
  return id;
}

async function main() {
  const empId = await whoami(EMP);

  // ── 1. An assignee with no role on the List ──────────────────────
  const assigned = await createTask(ADMIN, ADMIN_LIST, {
    title: "verify-item-api: assignee task",
    assigneeIds: [empId],
  });

  const got = await call(EMP, `/api/items/${assigned}`);
  const payload = (await got.json()) as {
    decision?: { role?: string; via?: string };
    breadcrumb?: unknown;
    watcherIds?: unknown;
  };
  check("assignee GET /api/items/[id]", got.status, 200);
  check("assignee decision.role", payload.decision?.role, "EDIT");
  check("assignee decision.via", payload.decision?.via, "assignee");
  check("GET carries a breadcrumb", typeof payload.breadcrumb, "object");
  check("GET carries watcherIds", Array.isArray(payload.watcherIds), true);

  check(
    "assignee PATCH (was 403 before Phase 2)",
    (await call(EMP, `/api/items/${assigned}`, { method: "PATCH", body: JSON.stringify({ status: "IN_PROGRESS" }) })).status,
    200,
  );
  check(
    "assignee GET comments (was 404 before Phase 2)",
    (await call(EMP, `/api/items/${assigned}/updates`)).status,
    200,
  );
  check(
    "assignee POST comment (was 404 before Phase 2)",
    (await call(EMP, `/api/items/${assigned}/updates`, { method: "POST", body: JSON.stringify({ body: "assignee comment" }) })).status,
    201,
  );
  check(
    "assignee GET activity (was 404 before Phase 2)",
    (await call(EMP, `/api/items/${assigned}/activity`)).status,
    200,
  );

  // ── 2. A personal-list task, which had NO thread at all ──────────
  const personal = await createTask(EMP, EMP_LIST, { title: "verify-item-api: personal task" });
  const posted = await call(EMP, `/api/items/${personal}/updates`, {
    method: "POST",
    body: JSON.stringify({ body: "a personal task has a thread" }),
  });
  check("personal POST comment (was 404 for EVERY personal task)", posted.status, 201);
  const read = await call(EMP, `/api/items/${personal}/updates`);
  const thread = (await read.json()) as { updates?: { body?: string }[] };
  check("personal GET comment back", thread.updates?.[0]?.body, "a personal task has a thread");
  check("personal GET activity", (await call(EMP, `/api/items/${personal}/activity`)).status, 200);

  // ── 3. Reads never 403 about a task ──────────────────────────────
  check(
    "a task id that does not exist is 404",
    (await call(EMP, "/api/items/cnot_a_real_id_at_all")).status,
    404,
  );

  // ── 4. The additive endpoints answer ─────────────────────────────
  check("GET subtasks", (await call(EMP, `/api/items/${personal}/subtasks`)).status, 200);
  const dup = await call(EMP, `/api/items/${personal}/duplicate`, { method: "POST" });
  check("POST duplicate", dup.status, 201);
  const dupBody = (await dup.json()) as { item?: { id?: string; title?: string } };
  if (dupBody.item?.id) created.push({ id: dupBody.item.id, cookie: EMP });
  check("duplicate names the copy", dupBody.item?.title, "verify-item-api: personal task (copy)");

  await call(EMP, `/api/items/${personal}`, { method: "DELETE" });
  check("POST restore", (await call(EMP, `/api/items/${personal}/restore`, { method: "POST" })).status, 200);

  // ── 5. `?around=` never 404s ─────────────────────────────────────
  const around = await call(EMP, `/api/items/${personal}/updates?around=cdefinitely_not_a_comment`);
  check("around= a dead comment id is 200", around.status, 200);
  check("around= says missing", ((await around.json()) as { missing?: boolean }).missing, true);

  // ── Cleanup ──────────────────────────────────────────────────────
  for (const row of created) {
    await call(row.cookie, `/api/items/${row.id}?hard=1`, { method: "DELETE" }).catch(() => {});
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

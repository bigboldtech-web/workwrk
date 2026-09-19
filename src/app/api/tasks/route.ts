// /api/tasks, RETIRED (410 Gone).
//
// Phase 2 W4, docs/plans/ui-refresh/spec-work-home.md section 4. Every task in
// this product is an `Item`. This route served the legacy `Task` table, whose
// rows were copied onto Items by scripts/migrate-legacy-tasks.ts; the table
// itself is kept readable for one release and is NOT deleted here.
//
// It answers 410 with a body naming its replacement for one release, so any
// caller outside this repo is told where to go rather than being handed the
// App Router's 404 HTML. The file comes out in the release after this one.

import { gone, RETIRED_TASK_ROUTES } from "@/lib/work/legacy-task-api";

const ROUTE = "/api/tasks";
const R = RETIRED_TASK_ROUTES[ROUTE];

function retired() {
  return gone(ROUTE, R.replacement, R.detail);
}

export const dynamic = "force-dynamic";

export async function GET() {
  return retired();
}

export async function POST() {
  return retired();
}

export async function PATCH() {
  return retired();
}

export async function DELETE() {
  return retired();
}


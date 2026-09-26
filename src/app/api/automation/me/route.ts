// GET /api/automation/me
//
// What this viewer may change in the Automation hub, so the pages render
// only the controls the write routes accept (spec-ai-automation audit issue
// 14: mutations disappear for viewers who lack the right). The same facts
// requireAutomation() computes for every write route:
//   canCreate  create, duplicate, use a template (every Member)
//   canManage  edit, publish, activate, deactivate, retry ANY workflow
//   isAdmin    archive any workflow, connections, per-person usage
// A creator's rights over their own workflow ride on each workflow row.

import { NextResponse } from "next/server";
import { requireAutomation } from "@/lib/automation/gate";

export async function GET() {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  return NextResponse.json(
    { canCreate: ctx.canCreate, canManage: ctx.canManage, isAdmin: ctx.isAdmin, userId: ctx.userId },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

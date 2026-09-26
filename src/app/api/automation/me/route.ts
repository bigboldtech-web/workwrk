// GET /api/automation/me
//
// What this viewer may change in the Automation hub, so the pages render
// only the controls the write routes accept (spec-ai-automation audit issue
// 14: mutations disappear for viewers who lack the right). The same facts
// requireAutomation() computes for every write route:
//   canManage  create, edit, publish, activate, deactivate, retry
//   isAdmin    delete a workflow, connections, per-person usage

import { NextResponse } from "next/server";
import { requireAutomation } from "@/lib/automation/gate";

export async function GET() {
  const ctx = await requireAutomation();
  if ("error" in ctx) return ctx.error;
  return NextResponse.json(
    { canManage: ctx.canManage, isAdmin: ctx.isAdmin },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

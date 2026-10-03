// GET /api/export/all: the whole workspace as one ZIP, streamed.
//
// What is in it, and what never is, is src/lib/export/workspace-export.server.ts:
// the people and HR tables, every Space, Folder, List and task with its
// description, checklist, tags, field values and comments, every Doc and SOP
// as Markdown and every table as CSV, with a manifest last. The archive is
// written as it is read (src/lib/zip-stream.ts), compressed, so a large
// workspace never sits in the server's memory and arrives at a fraction of
// its size.
//
// The whole organization in one ZIP (every person's email and access level
// included) is an Admin export, as the Data page says it is: an Owner or an
// Admin only (settingsWriteGate "data"), never an Agent or a Guest. One
// export of a workspace runs at a time. Who pulled it and when is in the
// audit log before the first byte is sent.

import { NextResponse } from "next/server";
import { getSessionOrFail, getOrgId, getUserId } from "@/lib/api-helpers";
import { logAuditEvent } from "@/lib/activity";
import { settingsWriteGate } from "@/lib/access/settings-write";
import { zipStream } from "@/lib/zip-stream";
import { prepareWorkspaceExport, takeExportSlot } from "@/lib/export/workspace-export.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const writeGate = await settingsWriteGate(session, "data", { read: true });
  if (!writeGate.ok) return writeGate.response;

  const orgId = getOrgId(session);
  const release = takeExportSlot(orgId);
  if (!release) {
    return NextResponse.json(
      { error: "An export of this workspace is already running. Try again when it finishes." },
      { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }

  const exportedAt = new Date();
  let prepared: Awaited<ReturnType<typeof prepareWorkspaceExport>>;
  try {
    prepared = await prepareWorkspaceExport(orgId, exportedAt, release);
  } catch (err) {
    release();
    console.error("[GET /api/export/all]", err);
    return NextResponse.json({ error: "Couldn't start the export. Try again in a minute." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  // A download the reader walks away from frees the slot at once.
  req.signal.addEventListener("abort", release, { once: true });

  const totalRows = Object.values(prepared.counts).reduce((a, b) => a + b, 0);
  logAuditEvent({
    type: "data.exported",
    actorId: getUserId(session),
    organizationId: orgId,
    description: `Exported tenant data (${totalRows} rows, with task, Doc, table and SOP content)`,
    targetType: "organization",
    metadata: { kind: "workspace", ...prepared.counts },
    severity: "warning",
  });

  const dateStr = exportedAt.toISOString().split("T")[0];
  return new Response(zipStream(prepared.entries, { modified: exportedAt }), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="workwrk-export-${dateStr}.zip"`,
      "Cache-Control": "no-store",
      // Straight through nginx: a workspace export can run for minutes.
      "X-Accel-Buffering": "no",
    },
  });
}

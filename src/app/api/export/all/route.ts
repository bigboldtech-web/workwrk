// GET /api/export/all: the whole workspace as one ZIP, streamed.
//
// What is in it, and what never is, is src/lib/export/workspace-export.server.ts:
// the people and HR tables, every Space, Folder, List and task with its
// description, checklist, tags, field values and comments (as spreadsheet
// CSVs and as exact JSON Lines copies), every Doc and SOP as Markdown and
// every table as CSV, with a manifest last. The archive is written as it is
// read (src/lib/zip-stream.ts), compressed, so a large workspace never sits
// in the server's memory and arrives at a fraction of its size.
//
// The whole organization in one ZIP (every person's email and access level
// included) is an Admin export, as the Data page says it is: an Owner or an
// Admin only (settingsWriteGate "data"), never an Agent or a Guest. One
// export of a workspace runs at a time.
//
// THE AUDIT ROW IS WRITTEN, AND CHECKED, BEFORE THE FIRST BYTE: if it cannot
// be written, nothing is sent. When the archive ends it says whether the
// export finished or stopped, so the Data page never calls a broken
// download an export.

import { NextResponse } from "next/server";
import { getSessionOrFail, getOrgId, getUserId } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { settingsWriteGate } from "@/lib/access/settings-write";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { zipStream } from "@/lib/zip-stream";
import { prepareWorkspaceExport, takeExportSlot, type ExportSummary } from "@/lib/export/workspace-export.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(req: Request) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const writeGate = await settingsWriteGate(session, "data", { read: true });
  if (!writeGate.ok) return writeGate.response;

  const orgId = getOrgId(session);
  const actorId = getUserId(session);
  const slot = takeExportSlot(orgId);
  if ("busy" in slot) {
    return NextResponse.json(
      {
        error:
          slot.busy === "workspace"
            ? "An export of this workspace is already running. Try again when it finishes."
            : "The server is busy with other exports. Try again in a few minutes.",
      },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } },
    );
  }
  const { release } = slot;
  // A reader who walks away, even while the small tables are still being
  // read, frees the slot at once.
  req.signal.addEventListener("abort", release, { once: true });

  const exportedAt = new Date();
  let auditId: string | null = null;
  let startMeta: Record<string, unknown> = {};
  const finish = (outcome: "completed" | "stopped", summary: ExportSummary) => {
    release();
    if (!auditId) return;
    const rows = Object.values(summary.rows).reduce((a, b) => a + b, 0);
    void prisma.activityLog
      .update({
        where: { id: auditId },
        data:
          outcome === "completed"
            ? {
                description: `Exported tenant data (${summary.files} files, with task, Doc, table and SOP content)`,
                metadata: { ...startMeta, status: "completed", rowsWritten: summary.rows, files: summary.files, rows } as Prisma.InputJsonValue,
              }
            : {
                description: "A workspace export stopped before it finished",
                metadata: { ...startMeta, status: "stopped", rowsWritten: summary.rows, files: summary.files } as Prisma.InputJsonValue,
              },
      })
      .catch((err) => console.error("[GET /api/export/all] audit update failed", err));
  };

  let prepared: Awaited<ReturnType<typeof prepareWorkspaceExport>>;
  try {
    prepared = await prepareWorkspaceExport(orgId, exportedAt, finish);
  } catch (err) {
    release();
    console.error("[GET /api/export/all]", err);
    return NextResponse.json({ error: "Couldn't start the export. Try again in a minute." }, { status: 500, headers: NO_STORE });
  }
  if (req.signal.aborted) {
    release();
    return new Response(null, { status: 499, headers: NO_STORE });
  }

  // Who pulled it and when, before any of it leaves.
  startMeta = { kind: "workspace", ...prepared.counts };
  try {
    const row = await prisma.activityLog.create({
      data: {
        type: "data.exported",
        actorId,
        organizationId: orgId,
        targetType: "organization",
        description: "Started a workspace export",
        metadata: { ...startMeta, status: "started" } as Prisma.InputJsonValue,
        ipAddress: clientIpFromHeaders(req.headers),
        userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
        severity: "warning",
      },
      select: { id: true },
    });
    auditId = row.id;
  } catch (err) {
    release();
    console.error("[GET /api/export/all] audit write failed", err);
    return NextResponse.json({ error: "Couldn't record the export, so it did not start. Try again in a minute." }, { status: 500, headers: NO_STORE });
  }

  const dateStr = exportedAt.toISOString().split("T")[0];
  return new Response(zipStream(prepared.entries, { modified: exportedAt }), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="workwrk-export-${dateStr}.zip"`,
      ...NO_STORE,
      // Straight through nginx: a workspace export can run for minutes.
      "X-Accel-Buffering": "no",
    },
  });
}

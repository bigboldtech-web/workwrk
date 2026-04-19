import { NextRequest } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  getOrgId,
  hasRole,
  jsonError,
} from "@/lib/api-helpers";

/**
 * GET /api/audit-log/export
 *
 * Admin-only, cryptographically-signed export of the ActivityLog.
 *
 * The file is a JSON Lines (.jsonl) stream. Each line is:
 *   { ts, actor, type, target, meta, h }
 * where `h` is the HMAC-SHA256 of the serialised record using the
 * org-level CRON_SECRET (or AUDIT_SIGNING_KEY if set). A final
 * `__manifest__` line contains a chain hash over every line's h —
 * verifiable offline without access to the server.
 *
 * Query:
 *   • from    — ISO start timestamp (default: -90d)
 *   • to      — ISO end timestamp (default: now)
 *   • type    — filter to one activity type
 */
export async function GET(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!hasRole(session, ["SUPER_ADMIN", "COMPANY_ADMIN"])) {
    return jsonError("Only admins can export the audit log", 403);
  }
  const orgId = getOrgId(session);

  const url = new URL(req.url);
  const toDate = url.searchParams.get("to")
    ? new Date(url.searchParams.get("to")!)
    : new Date();
  const fromDate = url.searchParams.get("from")
    ? new Date(url.searchParams.get("from")!)
    : new Date(toDate.getTime() - 90 * 24 * 60 * 60 * 1000);
  const type = url.searchParams.get("type");

  const key = process.env.AUDIT_SIGNING_KEY ?? process.env.CRON_SECRET ?? "";
  if (!key) {
    return jsonError(
      "Audit signing key not configured. Set AUDIT_SIGNING_KEY or CRON_SECRET in env.",
      503,
    );
  }

  const logs = await prisma.activityLog.findMany({
    where: {
      organizationId: orgId,
      createdAt: { gte: fromDate, lte: toDate },
      ...(type ? { type } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 50_000,
    select: {
      id: true,
      type: true,
      description: true,
      createdAt: true,
      actorId: true,
      targetId: true,
      targetType: true,
      metadata: true,
      severity: true,
    },
  });

  // Stream as JSONL with a running chain hash.
  const lines: string[] = [];
  let chainH = "0".repeat(64); // genesis
  for (const row of logs) {
    const serialized = JSON.stringify(row);
    const h = createHmac("sha256", key).update(chainH).update(serialized).digest("hex");
    chainH = h;
    lines.push(JSON.stringify({ ...row, h }));
  }
  lines.push(
    JSON.stringify({
      __manifest__: true,
      organizationId: orgId,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      count: logs.length,
      algorithm: "HMAC-SHA256, chained per-row",
      finalChainHash: chainH,
      exportedAt: new Date().toISOString(),
      exportedBy: session.user.email,
    }),
  );

  const body = lines.join("\n") + "\n";
  const filename = `audit-${orgId}-${fromDate.toISOString().slice(0, 10)}-to-${toDate.toISOString().slice(0, 10)}.jsonl`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Audit-Chain-Hash": chainH,
      "X-Audit-Row-Count": String(logs.length),
      "Cache-Control": "no-store",
    },
  });
}

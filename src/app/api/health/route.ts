// Public liveness check for UptimeRobot. Pings the DB with a cheap
// query so we surface "process is up but DB is unreachable" as 503
// rather than a misleading 200. Intentionally no auth, no rate limit
// — third-party uptime probes can't carry a session.
//
// Returns: 200 + { status, db, time } on success, 503 on DB failure.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        status: "ok",
        db: "ok",
        time: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        status: "degraded",
        db: "error",
        time: new Date().toISOString(),
        error: err instanceof Error ? err.message : "unknown",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

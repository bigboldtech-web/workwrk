// Public liveness check for UptimeRobot and for the deploy. Pings the DB with
// a cheap query so we surface "process is up but DB is unreachable" as 503
// rather than a misleading 200. Intentionally no auth, no rate limit:
// third-party uptime probes can't carry a session.
//
// Returns: 200 + { status, db, build, time } on success, 503 on DB failure.
// `build` is the BUILD_ID of the release this process serves, which is how the
// deploy knows the reload reached the new release (.github/workflows/deploy.yml).
// A failure says only that the database is unreachable: the driver's own
// message (host names, ports, the reason it refused) stays in the server log.
import { readFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

let buildId: string | null = null;
function currentBuild(): string {
  if (buildId === null) {
    try {
      buildId = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    } catch {
      buildId = "unknown";
    }
  }
  return buildId;
}

export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        status: "ok",
        db: "ok",
        build: currentBuild(),
        time: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[health] database check failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        status: "degraded",
        db: "error",
        build: currentBuild(),
        time: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

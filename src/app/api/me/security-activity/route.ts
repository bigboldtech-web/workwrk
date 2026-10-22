import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { MCP_SECURITY_COPY as S } from "@/lib/mcp/mcp-copy";
import { prisma } from "@/lib/prisma";

// The security-relevant slice of ActivityLog for the current user: what they
// did themselves (actorId), and, since the MCP server (docs/plans/mcp-server.md
// 7, step 4), every AI app row about them (actingForId), whoever wrote it:
// an app they connected, one their own Disconnect, an Owner or Admin's change
// or the system ended, and one caught using a key twice. Never another
// person's rows. An AI app row reads as the app by its frozen label and, for
// a disconnect, why (MCP_SECURITY_COPY); the metadata it is read from is
// never answered.
const SECURITY_TYPES = [
  "login",
  "logout",
  "password_changed",
  "password_reset",
  "mfa_enabled",
  "mfa_disabled",
  "signed_out_all_devices",
  "mfa_backup_codes_regenerated",
  "org.switch.in",
];

/** The AI app (MCP) rows about the person (src/lib/oauth/grants.ts). */
const MCP_APP_TYPES = ["mcp.app.connected", "mcp.app.revoked", "mcp.app.reuse_detected"];

type Row = { type: string; description: string; actorId: string | null; metadata: unknown };

/** An AI app row's line for the person; any other row keeps its own sentence. */
function securityLine(row: Row, userId: string): string {
  if (!MCP_APP_TYPES.includes(row.type)) return row.description;
  const m = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
  const app = typeof m.appName === "string" && m.appName.trim() ? m.appName.trim() : S.someApp;
  if (row.type === "mcp.app.connected") return m.again === true ? S.reconnected(app) : S.connected(app);
  if (row.type === "mcp.app.reuse_detected") return S.reuse(app);
  const reason = typeof m.reason === "string" ? m.reason : "";
  if (reason === "person" && row.actorId === userId) return S.disconnectedByYou(app);
  const why = Object.hasOwn(S.why, reason) ? (S.why as Record<string, string>)[reason] : null;
  return why ? S.disconnected(app, why) : S.disconnectedPlain(app);
}

/** GET /api/me/security-activity → the signed-in user's recent security events. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rows = await prisma.activityLog.findMany({
    where: {
      OR: [
        { actorId: userId, type: { in: SECURITY_TYPES } },
        { actingForId: userId, type: { in: MCP_APP_TYPES } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      type: true,
      description: true,
      ipAddress: true,
      severity: true,
      createdAt: true,
      // Read for an AI app row's line only, never answered.
      actorId: true,
      metadata: true,
    },
  });

  const events = rows.map(({ actorId, metadata, ...e }) => ({ ...e, description: securityLine({ type: e.type, description: e.description, actorId, metadata }, userId) }));
  return NextResponse.json({ events });
}

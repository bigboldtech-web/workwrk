import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Cron endpoint — permanently purges table rows that have sat in Trash for
 * more than 60 days (DataTableRow.deletedAt). Row deletes are SOFT (the grid
 * hides them, Trash recovers them); this is the only path that frees the
 * storage, matching the 60-day window the snapshot recycle bin uses.
 *
 * A single global deleteMany across every org — trashed rows are a bounded set
 * and this runs daily. Guard with CRON_SECRET in production.
 */
const RETENTION_DAYS = 60;

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
    const provided = header?.replace(/^Bearer\s+/i, "");
    if (provided !== cronSecret) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const res = await prisma.dataTableRow.deleteMany({
    where: { deletedAt: { lt: cutoff } },
  });
  return Response.json({ purged: res.count, cutoff: cutoff.toISOString() });
}

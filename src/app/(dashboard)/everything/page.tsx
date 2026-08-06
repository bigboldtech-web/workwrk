// Everything — ClickUp's workspace-wide All Tasks pane. One clean List
// (grouped by status) over every Item the viewer can read across all
// boards/spaces of their org, newest 500. Read-only: rows open in
// /item/[id]; the source-List chip jumps to the board.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Layers } from "lucide-react";
import { listEverythingItems } from "@/lib/everything";
import { EverythingView } from "./everything-view";

export const dynamic = "force-dynamic";

export default async function EverythingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const items = await listEverythingItems(u.organizationId, u.id, u.accessLevel ?? "EMPLOYEE");

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header — board-page style: title + item count */}
      <div className="px-4 pt-1.5 pb-1 flex items-center gap-2">
        <h1 className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-zinc-900">
          <Layers className="w-4 h-4 text-zinc-500" />
          <span>Everything</span>
        </h1>
        <span className="text-[12px] text-zinc-500 tabular-nums">
          {items.length === 500 ? "500+" : items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-4">
        <EverythingView items={items} currentUserId={u.id} />
      </div>
    </div>
  );
}

// PUT    /api/spaces/[id]/default-view { view }  pin a Space tab as the one
//                                              /spaces/<slug> opens first
// DELETE /api/spaces/[id]/default-view { view } unpin that view; the Space
//                                              opens Overview. Refused (409)
//                                              when another view is pinned now
//
// Stored at Space.settings.defaultView, a tab KEY (src/lib/work/space-default-view.ts
// is the rule every reader shares). Both verbs answer { defaultView }.
//
// The gate is the Space-level twin of the List pin's: read the Space
// (spaceForViewer, 404), then the contribute ladder (canContributeSpaceFor,
// 403), which is also the ladder the Space page gives its editing controls
// to (spaceCanEdit). The write goes through mutateSpaceSettings, so "is this
// view switched off" is decided on the LOCKED row and a module toggle racing
// the pin cannot leave a hidden pin behind.
//
// This file never reads the legacy access signal: itemCtx and the two Space
// wrappers are on files the access allow-list already carries.

import { NextResponse } from "next/server";
import { itemCtx } from "@/lib/item-gate";
import { mutateSpaceSettings } from "@/lib/space";
import { canContributeSpaceFor, spaceForViewer } from "@/lib/list-links-server";
import { hiddenSpaceViews, isSpaceViewKey, readSpaceDefaultView } from "@/lib/work/space-default-view";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function answer(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function gate(id: string) {
  const c = await itemCtx();
  if ("error" in c) {
    c.error.headers.set("Cache-Control", "no-store");
    return { error: c.error };
  }
  const space = await spaceForViewer(c, id);
  if (!space) return { error: answer({ error: "Not found" }, 404) };
  if (!(await canContributeSpaceFor(c, space.id))) {
    return { error: answer({ error: "Pinning a view for this Space needs Can edit access. Ask a Space admin." }, 403) };
  }
  return { spaceId: space.id };
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(id);
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => null)) as { view?: unknown } | null;
  const view = body?.view;
  if (!isSpaceViewKey(view)) return answer({ error: "That isn't a view this Space has." }, 400);

  try {
    const r = await mutateSpaceSettings(g.spaceId, (settings) =>
      hiddenSpaceViews(settings).includes(view)
        ? { patch: null, result: "hidden" as const }
        : { patch: { defaultView: view }, result: "ok" as const },
    );
    if (!r.found) return answer({ error: "Not found" }, 404);
    if (r.result === "hidden") return answer({ error: "That view is switched off in this Space." }, 400);
    return answer({ defaultView: readSpaceDefaultView(r.space.settings) });
  } catch (err) {
    // A failed write says so in words the menu's toast can show, and changes
    // nothing: the lock and the update are one transaction.
    console.error(`[default-view] PUT /api/spaces/${id}/default-view failed:`, err);
    return answer({ error: "Couldn't pin the view. Try again." }, 500);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gate(id);
  if ("error" in g) return g.error;
  // The caller names the view it means to unpin. The tabs are not realtime,
  // so a tab that still shows an old pin may unpin after someone pinned a
  // newer one; clearing whatever is stored would erase that newer pin. The
  // comparison runs on the LOCKED row, so a pin racing the unpin is seen.
  const body = (await req.json().catch(() => null)) as { view?: unknown } | null;
  const view = body?.view;
  if (!isSpaceViewKey(view)) return answer({ error: "Say which view to unpin." }, 400);
  try {
    const r = await mutateSpaceSettings(g.spaceId, (settings) =>
      readSpaceDefaultView(settings) === view
        ? { patch: { defaultView: null }, result: "ok" as const }
        : { patch: null, result: "stale" as const },
    );
    if (!r.found) return answer({ error: "Not found" }, 404);
    if (r.result === "stale") {
      return answer(
        {
          error: "That view isn't this Space's default any more, so nothing was unpinned. Refresh to see which view is pinned now.",
          defaultView: readSpaceDefaultView(r.space.settings),
        },
        409,
      );
    }
    return answer({ defaultView: null });
  } catch (err) {
    console.error(`[default-view] DELETE /api/spaces/${id}/default-view failed:`, err);
    return answer({ error: "Couldn't unpin the view. Try again." }, 500);
  }
}

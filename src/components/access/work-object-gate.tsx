// WorkObjectGate: the [id] layout of every Work address of an object
// (/spaces/[slug]/docs/[id], /work/docs/[id] and their siblings for tables,
// canvases, SOPs and forms). It works out where the object sits in Work for
// this viewer and hands that to the client provider, which renders the
// editor, a correction to the object's real address, the in-shell 404 or the
// error state (src/components/layout/os/work-placement.tsx).
//
// WHY A LAYOUT AND NOT THE PAGE. A layout renders when its segment's params
// change (another object, another address) and on router.refresh(), and
// never on a query-only navigation ("Layouts do not rerender on navigation,
// so they cannot access search params", node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/layout.md). So ?row, ?peek, ?new,
// ?tab and ?edit cost exactly what they cost on the canonical routes, and the
// gate's queries run once per object. The page under it is a client
// component that renders nothing sensitive on the server; the data boundary
// is the editors' own APIs, as on the canonical routes.
//
// IT NEVER REDIRECTS, and it never calls notFound() for an object state.
// Only the client knows whether an editor is already on screen (a refresh
// after a Move must never unmount one holding unsaved work), so the client
// decides. The one throw is the Tables module's Guest rule, which is the
// same notFound() /tables/[id] throws.
//
// It never calls requireSessionUser, whose bare redirect("/login") drops the
// return address: a signed-out visitor renders nothing here, and the
// dashboard layout's own client redirect sends them to /login with the
// callbackUrl (the edge gate does it first when it is on).
//
// Each route file passes its own editor in as children, so a doc route never
// ships the sheet or the canvas engine.

import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import { unstable_rethrow } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { addressHref, type ObjectKind, type WorkAt } from "@/lib/nav/object-href";
import { placeObject } from "@/lib/work/placement-server";
import type { WorkGate } from "@/lib/work/placement";
import { WorkPlacementProvider } from "@/components/layout/os/work-placement";
import { tablesModuleOffView } from "./tables-module-gate";
import { formGateAllows } from "./forms-gate";

export async function WorkObjectGate({ kind, id, at, children }: { kind: ObjectKind; id: string; at: WorkAt; children: ReactNode }) {
  const requested = addressHref(kind, id, at);
  const session = await getServerSession(authOptions);
  const user = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!session || !user?.id || !user.organizationId) {
    return <WorkPlacementProvider kind={kind} id={id} requested={requested} gate={{ state: "signedOut" }}>{children}</WorkPlacementProvider>;
  }

  // The same module-off state /tables/[id] shows, for Owners, Admins and
  // Members; a Guest gets the in-shell 404, thrown inside the helper.
  if (kind === "table") {
    const off = await tablesModuleOffView({ organizationId: user.organizationId });
    if (off) return off;
  }

  let gate: WorkGate;
  try {
    gate = kind === "form" && !(await formGateAllows(id, { id: user.id, organizationId: user.organizationId }))
      ? { state: "missing" }
      : await placeObject(kind, id, session);
  } catch (err) {
    unstable_rethrow(err);
    // The kind and the id only: never the viewer, never a name.
    console.error(`[work-object-gate] could not place ${kind} ${id}:`, err instanceof Error ? err.message : err);
    gate = { state: "error" };
  }
  return <WorkPlacementProvider kind={kind} id={id} requested={requested} gate={gate}>{children}</WorkPlacementProvider>;
}

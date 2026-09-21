"use client";

/* The body shared by the three create routes /sops/new/text, /sops/new/steps
 * and /sops/new/checklist (spec-process section 2): the SopEditorPage with
 * `sopId = null`, which creates the row on the first non-empty change and
 * moves the URL to /sops/[id]?edit=1. Nothing is written before that, so
 * leaving a blank page leaves nothing behind (the abandoned "Untitled" rows
 * came from pre-creating on a click).
 *
 * A stored `?id=` link on /sops/new/text or /sops/new/checklist is the SOP
 * page in edit mode: next.config.ts 308s it, and this is the twin that
 * answers on a process that predates the config edit (src/lib/nav/
 * retired-views.ts `legacySopEditorTarget`). A malformed `?id=` renders a
 * way back rather than a fresh row nobody asked for.
 *
 * Who may create is the same question POST /api/sops answers (`sops` /
 * `create`): a viewer without it gets the in-shell 404 at the door instead
 * of a 403 toast after typing a title.
 */

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { NotFoundView } from "@/components/access/not-found-view";
import { SopEditorPage } from "@/components/sops/sop-editor-page";
import { useRole } from "@/hooks/use-role";
import { isMalformedLegacySopId, legacySopEditorTarget } from "@/lib/nav/retired-views";
import type { SopKind } from "@/lib/sop-kind";

export function SopCreateRoute({ kind }: { kind: SopKind }) {
  const router = useRouter();
  const pathname = usePathname() || "/sops/new";
  const search = useSearchParams();
  const { canManageSOPs } = useRole();
  const legacyTarget = legacySopEditorTarget(pathname, search?.toString() ?? "");
  const brokenLink = isMalformedLegacySopId(pathname, search?.toString() ?? "");
  const folderId = search?.get("folderId") || null;

  // The /sops/new?type=X rows in next.config.ts land here with `type` riding
  // along (Next appends the matched source query to every config redirect).
  // The kind is the route now, so the residue is dropped the way the legacy
  // `?id=` link is normalised: one router.replace, loop-free because the
  // replacement has no `type`.
  const residue = search?.has("type") ? (() => {
    const rest = new URLSearchParams(search.toString());
    rest.delete("type");
    const qs = rest.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  })() : null;

  useEffect(() => {
    if (legacyTarget) router.replace(legacyTarget);
    else if (residue) router.replace(residue);
  }, [legacyTarget, residue, router]);

  if (legacyTarget) return null;

  if (brokenLink) {
    return (
      <>
        <OsPageHeader title="SOP" back={{ fallbackHref: "/sops", label: "SOPs" }} />
        <OsEmptyView
          variant="error"
          title="This link is broken"
          hint="The SOP it points to could not be read from the address. Open the SOP from the list instead."
          action={{ label: "Go to SOPs", href: "/sops" }}
        />
      </>
    );
  }

  // No create right: the in-shell 404 (spec-process section 1, denial shape
  // 1); the create doors are not offered to this viewer, so the URL is not
  // discoverable and there is no object to request access to.
  if (!canManageSOPs) return <NotFoundView />;

  return <SopEditorPage key={kind} sopId={null} kind={kind} initialFolderId={folderId} />;
}

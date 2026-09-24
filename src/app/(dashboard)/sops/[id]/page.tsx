"use client";

/* /sops/[id] and /sops/[id]?edit=1 (spec-process section 2): one SOP, whatever
 * its kind, on the one SopEditorPage. Read, run, acknowledge, edit, assign,
 * publish, present, share: every door is on that component; this file only
 * resolves the id and drops the `?id=` residue the /sops/new/*?id= 308s
 * carry through (Next passes the whole request query on to a redirect
 * destination, so the address bar read /sops/X?id=X&edit=1).
 *
 * The id is this segment's own param (use(params)), not useParams(): while
 * the task drawer is open, useParams() merges the drawer's [id] into the same
 * key. The Work door (/work/sops/[id]) renders the same SopEditorPage.
 */

import { use, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SopEditorPage } from "@/components/sops/sop-editor-page";

export default function SOPDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!searchParams?.has("id")) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("id");
    const qs = next.toString();
    router.replace(`/sops/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`);
  }, [searchParams, id, router]);

  return <SopEditorPage key={id} sopId={id} />;
}

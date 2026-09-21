"use client";

/* /sops/[id] and /sops/[id]?edit=1 (spec-process section 2): one SOP, whatever
 * its kind, on the one SopEditorPage. Read, run, acknowledge, edit, assign,
 * publish, present, share: every door is on that component; this file only
 * resolves the id and drops the `?id=` residue the /sops/new/*?id= 308s
 * carry through (Next passes the whole request query on to a redirect
 * destination, so the address bar read /sops/X?id=X&edit=1).
 */

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { SopEditorPage } from "@/components/sops/sop-editor-page";

export default function SOPDetailPage() {
  const { id } = useParams<{ id: string }>();
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

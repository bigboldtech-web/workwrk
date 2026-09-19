"use client";

// The /templates page body. It is the TemplateCenter in page mode plus the one
// thing only the page has: the URL's `?kind=` stays in sync with the pills, so
// a scoped link (Settings > Task system > Templates at ?kind=task, the Docs
// header "+" at ?kind=doc) lands on the right pill and a pill click produces a
// link somebody can send.

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TemplateCenter } from "@/components/templates/template-center";
import { useOsShell } from "@/components/layout/os/shell-context";
import { kindFromParam, kindParam, type TemplateKindKey } from "@/lib/templates/kinds";

export function TemplatesClient({
  initialKind,
  initialQuery,
  initialShowBuiltIn,
  initialLayout,
}: {
  initialKind: TemplateKindKey | null;
  initialQuery: string;
  initialShowBuiltIn: boolean;
  initialLayout: "grid" | "list";
}) {
  const router = useRouter();
  const { openCreateTask } = useOsShell();
  const pathname = usePathname();
  const params = useSearchParams();
  const [kind, setKind] = useState<TemplateKindKey | null>(initialKind);

  // The URL is the source: a back button, a pasted link and a pill click all
  // land in the same place.
  const fromUrl = kindFromParam(params.get("kind"));
  useEffect(() => { setKind(fromUrl); }, [fromUrl]);

  const onKindChange = useCallback(
    (next: TemplateKindKey | null) => {
      setKind(next);
      const qs = new URLSearchParams(params.toString());
      if (next) qs.set("kind", kindParam(next));
      else qs.delete("kind");
      const query = qs.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <TemplateCenter
      mode="page"
      kind={kind}
      onKindChange={onKindChange}
      initialQuery={initialQuery}
      // A Task template has no page to land on: the create-task modal IS its
      // destination. The page passed no handler at all, so a Task template
      // applied from here closed its detail modal, opened nothing, created
      // nothing, and still incremented usedCount.
      onApplied={(result) => {
        if (result.kind === "TASK") {
          openCreateTask(null, { name: result.name ?? "Template", config: result.config ?? {} });
        }
      }}
      initialShowBuiltIn={initialShowBuiltIn}
      initialLayout={initialLayout}
    />
  );
}

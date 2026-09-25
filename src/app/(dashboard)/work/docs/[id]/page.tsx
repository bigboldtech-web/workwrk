/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb */
// The crumb is declared one level up, by the WorkPlacementProvider this
// route's layout renders (Work > its place > {title}), from the first
// frame.
"use client";

// /work/docs/[id], the Work door for a doc. It renders DocEditorRoute, the
// same component /docs/[id] renders, never a copy; the component reads its
// Work placement from the provider.

import { use } from "react";
import { DocEditorRoute } from "@/components/docs/doc-editor-route";

export default function WorkDoorDocPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = use(params);
  const sp = use(searchParams);
  return <DocEditorRoute id={id} peek={typeof sp.peek === "string" ? sp.peek : null} />;
}

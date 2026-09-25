/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb */
// The crumb is declared one level up, by the WorkPlacementProvider this
// route's layout renders (Work > {title}), from the first frame.
"use client";

// /work/sops/[id], the Work door for an SOP. It renders SopEditorPage, the
// same component /sops/[id] renders, never a copy; the component reads its
// Work placement from the provider.

import { use } from "react";
import { SopEditorPage } from "@/components/sops/sop-editor-page";

export default function WorkDoorSopPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <SopEditorPage key={id} sopId={id} />;
}

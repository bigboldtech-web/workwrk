/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb */
// The crumb is declared one level up, by the WorkPlacementProvider this
// route's layout renders (Work > Space > {title}), from the first frame.
"use client";

// /spaces/[slug]/canvas/[id], a canvas in a Space, opened in Work. It renders
// CanvasEditor, the same component /canvas/[id] renders, never a copy; the
// component reads its Work placement from the provider.

import { use } from "react";
import { CanvasEditor } from "@/components/canvas/canvas-editor";

export default function WorkSpaceCanvasPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { id } = use(params);
  return <CanvasEditor key={id} canvasId={id} />;
}

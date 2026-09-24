/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb */
// The crumb is declared one level up, by the WorkPlacementProvider this
// route's layout renders (Work > its Space > {title}), from the first
// frame.
"use client";

// /work/canvas/[id], the Work door for a canvas. It renders CanvasEditor, the
// same component /canvas/[id] renders, never a copy; the component reads its
// Work placement from the provider.

import { use } from "react";
import { CanvasEditor } from "@/components/canvas/canvas-editor";

export default function WorkDoorCanvasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <CanvasEditor key={id} canvasId={id} />;
}

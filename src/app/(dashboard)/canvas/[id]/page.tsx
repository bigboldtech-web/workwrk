/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb */
// The crumb is declared one component down: CanvasEditor renders
// <Breadcrumb items/> from the canvas's Space and name, which the rule cannot
// see from this file.
"use client";

// /canvas/[id], the Docs hub's address of a canvas. The body is CanvasEditor
// (src/components/canvas/canvas-editor.tsx), the same editor the Work
// addresses render; its Excalidraw stylesheet import moved with it. key={id}
// states the rule that one canvas's editor is never reused for another.

import { use } from "react";
import { CanvasEditor } from "@/components/canvas/canvas-editor";

export default function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CanvasEditor key={id} canvasId={id} />;
}

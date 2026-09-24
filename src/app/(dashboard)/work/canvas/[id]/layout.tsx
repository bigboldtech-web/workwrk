// /work/canvas/[id]: the Work address of a canvas by id alone (the Work door).
//
// The door renders a canvas with no Space in place and moves a Space
// canvas to its Space-scoped address before the editor mounts.
// The gate is this [id] layout, not the page: it renders when the object or
// its address changes and on router.refresh(), never on a query-only
// navigation, and it hands the placement to the client provider (see
// src/components/access/work-object-gate.tsx). Props are typed by hand, not
// with the generated LayoutProps, so a type check never depends on the dev
// server having generated types for this route yet.

import type { ReactNode } from "react";
import { WorkObjectGate } from "@/components/access/work-object-gate";

export const dynamic = "force-dynamic";

export default async function WorkDoorCanvasLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <WorkObjectGate kind="canvas" id={id} at={{ scope: "work" }}>
      {children}
    </WorkObjectGate>
  );
}

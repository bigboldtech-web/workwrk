// /work/sops/[id]: the Work address of an SOP (the Work door).
//
// An SOP opened from Work stays in Work. SOPs have no Space and no Work
// tree row, so the door is their only Work address; the SOP centre's own
// API is the gate, exactly as on /sops/[id].
// The gate is this [id] layout, not the page: it renders when the object or
// its address changes and on router.refresh(), never on a query-only
// navigation, and it hands the placement to the client provider (see
// src/components/access/work-object-gate.tsx). Props are typed by hand, not
// with the generated LayoutProps, so a type check never depends on the dev
// server having generated types for this route yet.

import type { ReactNode } from "react";
import { WorkObjectGate } from "@/components/access/work-object-gate";

export const dynamic = "force-dynamic";

export default async function WorkDoorSopLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <WorkObjectGate kind="sop" id={id} at={{ scope: "work" }}>
      {children}
    </WorkObjectGate>
  );
}

// /spaces/[slug]/tables/[id]: the Work address of a table in a Space.
//
// A table opened from Work stays in Work. There is no tables/layout.tsx
// under /spaces/[slug]: the Tables module check runs inside WorkObjectGate,
// after its own session check, and shows the same module-off state as
// /tables/[id].
// The gate is this [id] layout, not the page: it renders when the object or
// its address changes and on router.refresh(), never on a query-only
// navigation, and it hands the placement to the client provider (see
// src/components/access/work-object-gate.tsx). Props are typed by hand, not
// with the generated LayoutProps, so a type check never depends on the dev
// server having generated types for this route yet.

import type { ReactNode } from "react";
import { WorkObjectGate } from "@/components/access/work-object-gate";

export const dynamic = "force-dynamic";

export default async function WorkSpaceTableLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  return (
    <WorkObjectGate kind="table" id={id} at={{ scope: "space", slug }}>
      {children}
    </WorkObjectGate>
  );
}

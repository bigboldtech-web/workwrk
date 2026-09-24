// /spaces/[slug]/docs/[id]: the Work address of a doc in a Space.
//
// A doc opened from Work stays in Work: the rail, the Work sidebar and the
// crumb all resolve to Work through ROUTE_HUB's "/spaces" row. {slug} is the
// doc's own Space; the gate corrects any other slug before the editor mounts.
// The gate is this [id] layout, not the page: it renders when the object or
// its address changes and on router.refresh(), never on a query-only
// navigation, and it hands the placement to the client provider (see
// src/components/access/work-object-gate.tsx). Props are typed by hand, not
// with the generated LayoutProps, so a type check never depends on the dev
// server having generated types for this route yet.

import type { ReactNode } from "react";
import { WorkObjectGate } from "@/components/access/work-object-gate";

export const dynamic = "force-dynamic";

export default async function WorkSpaceDocLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  return (
    <WorkObjectGate kind="doc" id={id} at={{ scope: "space", slug }}>
      {children}
    </WorkObjectGate>
  );
}

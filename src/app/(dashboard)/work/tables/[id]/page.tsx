/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb */
// The crumb is declared one level up, by the WorkPlacementProvider this
// route's layout renders (Work > its Space > {title}), from the first
// frame.
"use client";

// /work/tables/[id], the Work door for a table. It renders TableEditor, the
// same component /tables/[id] renders, never a copy; the component reads its
// Work placement from the provider.

import { use } from "react";
import { TableEditor } from "@/components/tables/table-editor";

export default function WorkDoorTablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <TableEditor key={id} tableId={id} />;
}

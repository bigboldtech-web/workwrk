/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb */
// The crumb is declared one component down: TableEditor renders
// <Breadcrumb items/> from the table's Space and name, which the rule cannot
// see from this file.
"use client";

// /tables/[id], the Tables hub's address of a table. The body is TableEditor
// (src/components/tables/table-editor.tsx), the same sheet the Work addresses
// render. key={id} states the rule that one table's sheet is never reused for
// another: the layout router already remounts this page when [id] changes.

import { use } from "react";
import { TableEditor } from "@/components/tables/table-editor";

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TableEditor key={id} tableId={id} />;
}

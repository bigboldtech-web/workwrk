/* eslint-disable workwrk-ds/dynamic-page-declares-breadcrumb */
// The crumb is declared one component down: BlockDocEditor renders
// <Breadcrumb items/> from the doc's anchor and title, which the rule cannot
// see from this file.
"use client";

// /docs/[id], the Docs hub's address of a doc: block-based page composer.
// The body is DocEditorRoute, the same component the Work addresses render
// (src/components/docs/doc-editor-route.tsx).

import { use } from "react";
import { DocEditorRoute } from "@/components/docs/doc-editor-route";

export default function DocPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = use(params);
  const sp = use(searchParams);
  return <DocEditorRoute id={id} peek={typeof sp.peek === "string" ? sp.peek : null} />;
}

"use client";

// /docs/[id] — block-based page composer.
// Legacy `{ html }` docs render in compat mode with a one-click
// "Convert to blocks" button (lossless: preserves all text).

import { use } from "react";
import { BlockDocEditor } from "@/components/docs/block-doc-editor";

export default function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <BlockDocEditor docId={id} />;
}

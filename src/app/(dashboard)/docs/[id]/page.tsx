"use client";

// /docs/[id] — block-based page composer.
//
// Single-doc by default; opens a side-by-side pane when ?peek=<otherId>
// is present in the URL. The split layout is rendered by DocSplitView,
// which owns the drag-resize divider and the close/swap controls on the
// peek pane.

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { BlockDocEditor } from "@/components/docs/block-doc-editor";
import { DocSplitView } from "@/components/docs/doc-split-view";

export default function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const peek = search.get("peek");

  if (peek && peek !== id) {
    return <DocSplitView primaryId={id} peekId={peek} />;
  }
  // key={id} forces a fresh editor instance per note. Without it, navigating
  // between notes reuses one instance whose stale bnDoc/title/lastUpdatedAtRef
  // could be autosaved onto the newly-opened note — clobbering its content.
  return <BlockDocEditor key={id} docId={id} />;
}

"use client";

// A doc's page body, shared by every address a doc opens at: /docs/[id] in
// the Docs hub, and /spaces/[slug]/docs/[id] and /work/docs/[id] in Work. One
// definition, so the three can never drift apart.
//
// Single doc by default; a side-by-side pane when ?peek=<otherId> is set.
// The split layout is DocSplitView, which owns the drag-resize divider and
// the close and swap controls on the peek pane.
//
// `peek` comes from the page's own searchParams, never useSearchParams():
// while the task drawer is open over a doc, the URL (and so useSearchParams)
// is the drawer's /item/<id>, which has no ?peek, and the split used to
// collapse and remount the primary editor the moment a task opened.

import { BlockDocEditor } from "./block-doc-editor";
import { DocSplitView } from "./doc-split-view";

export function DocEditorRoute({ id, peek }: { id: string; peek: string | null }) {
  if (peek && peek !== id) {
    return <DocSplitView primaryId={id} peekId={peek} />;
  }
  // key={id} forces a fresh editor instance per note. Without it, navigating
  // between notes reuses one instance whose stale bnDoc/title/lastUpdatedAtRef
  // could be autosaved onto the newly-opened note, clobbering its content.
  return <BlockDocEditor key={id} docId={id} />;
}

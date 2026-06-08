// Docs-area layout. Persists across /docs, /docs/[id] and /docs/trash so the
// open-note tab strip (DocTabsBar) survives navigation between notes.

import { DocTabsBar } from "@/components/docs/doc-tabs";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DocTabsBar />
      {children}
    </>
  );
}

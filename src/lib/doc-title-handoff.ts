// A rename made OUTSIDE an open doc's editor (a tree row's or a list row's
// Doc actions > Rename) handed to that editor, so the editor stays the one
// writer of its doc.
//
// Why: the editor saves with optimistic concurrency. It sends the updatedAt it
// last saw, and the server answers 409 when the row has moved on. A rename
// PUT from a row menu moved the row on behind the editor's back, so the next
// keystroke raised "Someone else saved this doc" against the person's OWN
// rename, the title input and the Work crumb kept the old name, and the
// strip's Dismiss ("mine wins") re-sent the old title and silently undid the
// rename. Opening a doc in place in Work puts its tree row and its editor on
// screen together, which made that easy to reach.
//
// With a handoff the editor takes the new title as if it had been typed into
// its own title input: one save, through its own writer, with its own
// updatedAt, so a real peer's version is still caught and never overwritten.
//
// Pure: a module-level registry and nothing else, so the test is node-only.

/**
 * An open editor's title writer. Resolves true when the editor saved (or
 * queued) the rename through its own writer; false when it cannot write (a
 * view-only or locked editor), in which case the caller saves the rename
 * itself and the editor has already shown the new title; "conflict" when the
 * editor's save ran into a real peer's newer version. Then the rename sits in
 * the editor unsaved, behind its conflict strip, and the caller must neither
 * save it nor say it was renamed: the server still holds the peer's title.
 */
export type DocTitleHandoff = boolean | "conflict";
export type DocTitleWriter = (title: string) => Promise<DocTitleHandoff>;

const writers = new Map<string, DocTitleWriter[]>();

/** An editor registers while its doc is loaded; the returned function unregisters it. */
export function registerDocTitleWriter(docId: string, writer: DocTitleWriter): () => void {
  const list = writers.get(docId) ?? [];
  list.push(writer);
  writers.set(docId, list);
  return () => {
    const cur = writers.get(docId);
    if (!cur) return;
    const i = cur.lastIndexOf(writer);
    if (i >= 0) cur.splice(i, 1);
    if (cur.length === 0) writers.delete(docId);
  };
}

/**
 * Hand a rename to the open editor of that doc, the most recently opened one
 * when two are mounted. Resolves true when an editor saved it, false when no
 * editor is open for it or the one open cannot write: the caller then saves
 * the rename with its own PUT, exactly as before.
 */
export async function handOffDocTitle(docId: string, title: string): Promise<DocTitleHandoff> {
  const list = writers.get(docId);
  const writer = list?.[list.length - 1];
  if (!writer) return false;
  try {
    return await writer(title);
  } catch {
    return false;
  }
}

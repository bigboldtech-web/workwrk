// What a local draft of a doc restores (block-doc-editor.tsx, the restore
// strip). Judged from the DRAFT, not from the doc's format now: the doc may
// have been converted from the old rich-text format since the draft was
// written.
//
// A draft holds a body to write back when it has blocks, or when it is an
// emptied block doc (every edit in the editor writes its BlockNote doc, so a
// doc someone emptied on purpose carries a non-null bnDoc). A draft with an
// empty body and no BlockNote doc was written by a save on an old-format doc
// (a rename or Cmd+S, before those saved only the title): writing its empty
// body would replace the doc's body for good, so only its title is restored.
// Null means "restore the title only".
export function draftBodyToRestore<B, P>(draft: { blocks: B[] | null; bnDoc: P[] | null }, oldFormatShown: boolean): B[] | null {
  if (!Array.isArray(draft.blocks)) return null;
  if (draft.blocks.length > 0) return draft.blocks;
  return !oldFormatShown && draft.bnDoc !== null ? draft.blocks : null;
}

// What a local draft of a doc restores (block-doc-editor.tsx, the restore
// strip). Judged from the DRAFT, not from the doc's format now: the doc may
// have been converted from the old rich-text format since the draft was
// written.
//
//   body             the draft holds a body: its blocks, or an emptied block
//                    doc (every edit in the editor writes its BlockNote doc,
//                    so a doc someone emptied on purpose carries a bnDoc).
//                    Its title, body and page settings are restored.
//   settings-only    an empty blocks array with no BlockNote doc, on a doc
//                    shown as blocks: its title and page settings (icon,
//                    cover, options) are restored over the LIVE body. A
//                    brand-new doc nobody has typed in writes drafts of this
//                    shape, so do saves of its icon or cover.
//   title-only       blocks null (a title-only save, whose request never
//                    carried page settings, so restoring its settings would
//                    put stale ones back), the old format on screen, or no
//                    body loaded: only the title. An old-format doc's saves
//                    wrote drafts with an empty body, and writing it would
//                    replace the doc's body for good.
//
// No plan ever writes an empty body that the draft did not mean.
export type DraftRestorePlan = "body" | "settings-only" | "title-only";

export function draftRestorePlan<B, P>(
  draft: { blocks: B[] | null; bnDoc: P[] | null },
  oldFormatShown: boolean,
  liveBodyLoaded: boolean,
): DraftRestorePlan {
  if (Array.isArray(draft.blocks) && draft.blocks.length > 0) return "body";
  if (Array.isArray(draft.blocks) && !oldFormatShown && draft.bnDoc !== null) return "body";
  if (!Array.isArray(draft.blocks)) return "title-only";
  if (!oldFormatShown && liveBodyLoaded) return "settings-only";
  return "title-only";
}

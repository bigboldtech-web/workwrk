import type { Block } from "./block-editor";

// Shared embed-preservation helpers for the BlockNote-backed editors (Notes
// AND Written SOPs). BlockNote can't render these legacy custom-embed kinds
// natively — `legacyBlocksToBN` renders them as paragraph proxies and the
// BN→legacy mirror loses their original data. To avoid destroying embeds (and
// pruning their EntityLink rows) on the first edit, callers freeze the
// originals on load via `collectLegacyCustomEmbeds`, then splice them back
// into the derived mirror via `rehydrateMirrorWithLegacyEmbeds` before saving.
//
// Kinds that BlockNote round-trips natively (e.g. "subpage", "callout") MUST
// NOT be in this set — freezing the original would mask in-BN edits.
export const LEGACY_CUSTOM_EMBED_KINDS = new Set<Block["kind"]>([
  "sop_card", "task_card", "note_card", "entity_link", "ai_write",
  "tasks_view", "studio_board", "sops_list", "meetings_view", "form", "data_table",
  "embed", "image", "file",
]);

export function collectLegacyCustomEmbeds(blocks: Block[]): Map<string, Block> {
  const m = new Map<string, Block>();
  for (const b of blocks) {
    if (LEGACY_CUSTOM_EMBED_KINDS.has(b.kind)) m.set(b.id, b);
  }
  return m;
}

// Splice preserved originals back into a BN-derived mirror. The mirror keeps
// block ordering; for each entry whose id matches a preserved legacy block we
// swap in the original. Entries without a preserved match pass through.
export function rehydrateMirrorWithLegacyEmbeds(mirror: Block[], preserved: Map<string, Block>): Block[] {
  if (preserved.size === 0) return mirror;
  return mirror.map((b) => preserved.get(b.id) ?? b);
}

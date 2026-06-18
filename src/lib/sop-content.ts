// Empty-content detection for SOP rows. We had four prod SOPs end up
// empty because the publish handler accepted blank form values and the
// inline emptiness check missed `content: {}`, `content: null`, and
// shapes that were a mix of declared+missing keys. Anything that mutates
// SOP.content should route through `isSOPContentEmpty` so the guard
// stays consistent across publish, edit, rollback, and any future paths.

export type SOPContentShape = {
  type?: string;
  html?: string;
  body?: string;
  steps?: unknown[];
  sections?: unknown[];
  blocks?: unknown[];
  bnDoc?: unknown[];
};

// A block array (the legacy `blocks` mirror, also kept alongside `bnDoc`) has
// content if any block carries non-empty text OR is a non-text kind (image,
// file, embed, divider, code, callout, sop_card, etc. — meaningful even with
// no text). Used so blocks/bnDoc SOPs aren't falsely judged empty.
const TEXT_BLOCK_KINDS = new Set([
  "paragraph", "h1", "h2", "h3", "bullet", "numbered", "quote", "todo",
]);
function blocksHaveContent(blocks: unknown[]): boolean {
  return blocks.some((b) => {
    if (!b || typeof b !== "object") return false;
    const blk = b as { kind?: string; text?: string };
    if (typeof blk.text === "string" && blk.text.replace(/<[^>]+>/g, "").trim() !== "") return true;
    if (blk.kind && !TEXT_BLOCK_KINDS.has(blk.kind)) return true;
    return false;
  });
}

export function isSOPContentEmpty(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "object") return true;

  const c = raw as SOPContentShape;
  if (Object.keys(c).length === 0) return true;

  if (typeof c.html === "string") {
    const stripped = c.html.replace(/<[^>]+>/g, "").trim();
    if (stripped !== "") return false;
  }
  if (typeof c.body === "string" && c.body.replace(/<[^>]+>/g, "").trim() !== "") return false;
  if (Array.isArray(c.steps) && c.steps.length > 0) return false;
  if (Array.isArray(c.sections) && c.sections.length > 0) return false;
  if (Array.isArray(c.blocks) && blocksHaveContent(c.blocks)) return false;
  // Defensive: bnDoc present with a populated mirror (mirror is always saved
  // alongside it). If the mirror is somehow missing, a multi-node bnDoc still
  // counts as content.
  if (Array.isArray(c.bnDoc) && c.bnDoc.length > 0) {
    if (Array.isArray(c.blocks) && blocksHaveContent(c.blocks)) return false;
    if (!Array.isArray(c.blocks) && c.bnDoc.length > 1) return false;
  }

  return true;
}

export function isSOPTitleEmpty(raw: unknown): boolean {
  return typeof raw !== "string" || raw.trim() === "";
}

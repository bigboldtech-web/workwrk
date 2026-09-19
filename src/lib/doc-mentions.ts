// doc-mentions.ts — finding the @-mention of a person inside a Doc or SOP's
// block content, and the excerpt that goes with it.
//
// It was private to `GET /api/me/mentions`. It is shared now because the
// mentions backfill (scripts/backfill-mentions.ts) has to find exactly the
// same blocks the page found, or the notifications it writes would point at
// block anchors that do not exist. One scanner, two readers.
//
// The shape it reads is the block-editor's: `{ blocks: [{ id, text?, body? }] }`
// with an inline mention pill carrying `data-id="<userId>"`. Anything it does
// not recognise yields no hits rather than throwing, because a malformed doc
// must never take down a list of notifications.

export interface MentionHit {
  blockId: string;
  excerpt: string;
}

/** Every block of this content that @-mentions `userId`. */
export function findMentionBlocks(content: unknown, userId: string): MentionHit[] {
  const out: MentionHit[] = [];
  if (!content || typeof content !== "object" || !userId) return out;
  const c = content as { blocks?: unknown[] };
  if (!Array.isArray(c.blocks)) return out;
  const target = `data-id="${userId}"`;
  for (const b of c.blocks) {
    if (!b || typeof b !== "object") continue;
    const block = b as Record<string, unknown>;
    const text = typeof block.text === "string" ? block.text : "";
    const body = typeof block.body === "string" ? block.body : "";
    if (!text.includes(target) && !body.includes(target)) continue;
    const blockId = String(block.id ?? "");
    // A block with no id has no anchor, so a notification pointing at it could
    // not scroll anywhere. Skipped rather than linked to the top of the doc.
    if (!blockId) continue;
    out.push({ blockId, excerpt: htmlToPlainExcerpt(`${text} ${body}`, 220) });
  }
  return out;
}

/** Block HTML reduced to one line of readable text. */
export function htmlToPlainExcerpt(html: string, max: number): string {
  const plain = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

/**
 * The deep link a mention notification carries. The Inbox's target parser
 * reads the `#b-` anchor back out of it, so this and
 * `parseNotificationLink` are two halves of one convention.
 */
export function mentionLink(source: "doc" | "sop", sourceId: string, blockId: string): string {
  return `/${source === "doc" ? "docs" : "sops"}/${sourceId}#b-${blockId}`;
}

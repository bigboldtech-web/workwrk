// Block-content ⇄ EntityLink synchronization.
//
// Whenever a doc or SOP's blocks change, we want the EntityLink graph
// to reflect the new outgoing references so backlinks, "related to",
// and discovery features stay O(1) lookups instead of org-wide scans.
//
// This walks the block list, extracts every reference we know about,
// then idempotently upserts the corresponding EntityLink rows and
// prunes any links the writer just removed.
//
// Reference shapes we extract:
//   - sop_card.sopId           → EMBEDDED link to SOP
//   - task_card.taskId         → EMBEDDED link to TASK
//   - note_card.noteId         → EMBEDDED link to DOC
//   - subpage.childDocId       → EMBEDDED link to DOC
//   - entity_link block        → EMBEDDED link to whatever the kind is
//   - inline @ pills (HTML)    → REFERENCES link, one per pill

import { prisma } from "@/lib/prisma";
import type { EntityLinkType, EntityLinkRelation } from "@/generated/prisma";

export type SourceKind = "DOC" | "SOP";

interface ExtractedRef {
  targetType: EntityLinkType;
  targetId: string;
  relationKind: EntityLinkRelation;
}

// All target types we currently emit links for. Kept narrow on purpose
// — adding more is a one-line change here when we wire new block kinds.
const KNOWN_INLINE_KINDS: Record<string, EntityLinkType> = {
  user: "USER",
  task: "TASK",
  board: "BOARD",
  sop: "SOP",
  kra: "KRA",
  space: "SPACE",
};

const ENTITY_LINK_KIND_MAP: Record<string, EntityLinkType> = {
  user: "USER",
  task: "TASK",
  board: "BOARD",
  sop: "SOP",
  kra: "KRA",
  space: "SPACE",
};

export function extractRefsFromContent(content: unknown): ExtractedRef[] {
  const out: ExtractedRef[] = [];
  if (!content || typeof content !== "object") return out;
  const c = content as { blocks?: unknown[] };
  if (!Array.isArray(c.blocks)) return out;

  for (const b of c.blocks) {
    if (!b || typeof b !== "object") continue;
    const block = b as Record<string, unknown>;
    const kind = String(block.kind ?? "");

    if (kind === "sop_card"  && typeof block.sopId === "string"  && block.sopId)
      out.push({ targetType: "SOP",  targetId: block.sopId,  relationKind: "EMBEDDED" });
    else if (kind === "task_card" && typeof block.taskId === "string" && block.taskId)
      out.push({ targetType: "TASK", targetId: block.taskId, relationKind: "EMBEDDED" });
    else if (kind === "note_card" && typeof block.noteId === "string" && block.noteId)
      out.push({ targetType: "DOC",  targetId: block.noteId, relationKind: "EMBEDDED" });
    else if (kind === "subpage"   && typeof block.childDocId === "string" && block.childDocId)
      out.push({ targetType: "DOC",  targetId: block.childDocId, relationKind: "EMBEDDED" });
    else if (kind === "entity_link") {
      const eKind = String(block.entityKind ?? "");
      const eId = String(block.entityId ?? "");
      const mapped = ENTITY_LINK_KIND_MAP[eKind];
      if (mapped && eId) out.push({ targetType: mapped, targetId: eId, relationKind: "EMBEDDED" });
    }

    // Inline mentions inside any text-bearing block's HTML:
    //   <a class="bmen-inline" data-kind="user" data-id="abc">@Alice</a>
    if (typeof block.text === "string" && block.text.includes("data-kind")) {
      const re = /<a\b[^>]*\bdata-kind="([a-z]+)"[^>]*\bdata-id="([^"]+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(block.text)) !== null) {
        const mapped = KNOWN_INLINE_KINDS[m[1]];
        if (mapped && m[2]) out.push({ targetType: mapped, targetId: m[2], relationKind: "REFERENCES" });
      }
    }
    // Same scan inside toggle bodies if present.
    if (typeof block.body === "string" && block.body.includes("data-kind")) {
      const re = /<a\b[^>]*\bdata-kind="([a-z]+)"[^>]*\bdata-id="([^"]+)"/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(block.body)) !== null) {
        const mapped = KNOWN_INLINE_KINDS[m[1]];
        if (mapped && m[2]) out.push({ targetType: mapped, targetId: m[2], relationKind: "REFERENCES" });
      }
    }
  }

  // Dedupe — same target referenced multiple times collapses to one
  // EntityLink row (the unique constraint enforces this anyway, but
  // pre-dedupe saves wasted upserts).
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.targetType}:${r.targetId}:${r.relationKind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function syncLinksFromBlocks(args: {
  organizationId: string;
  sourceType: SourceKind;
  sourceId: string;
  content: unknown;
  createdById?: string | null;
}): Promise<void> {
  const refs = extractRefsFromContent(args.content);
  const sourceType: EntityLinkType = args.sourceType === "DOC" ? "DOC" : "SOP";

  // Load the current outgoing links to compute the diff cheaply.
  const existing = await prisma.entityLink.findMany({
    where: {
      organizationId: args.organizationId,
      sourceType,
      sourceId: args.sourceId,
      relationKind: { in: ["EMBEDDED", "REFERENCES"] },
    },
    select: { id: true, targetType: true, targetId: true, relationKind: true },
  });

  const wantKey = (r: ExtractedRef) => `${r.targetType}:${r.targetId}:${r.relationKind}`;
  const wantSet = new Set(refs.map(wantKey));
  const stale = existing.filter((e) => !wantSet.has(`${e.targetType}:${e.targetId}:${e.relationKind}`));

  // Batch into a single transaction so a half-failed sync doesn't leave
  // the link graph in an inconsistent state. Upserts are idempotent on
  // the unique (source,target,relation) tuple.
  await prisma.$transaction([
    ...refs.map((r, idx) =>
      prisma.entityLink.upsert({
        where: {
          sourceType_sourceId_targetType_targetId_relationKind: {
            sourceType,
            sourceId: args.sourceId,
            targetType: r.targetType,
            targetId: r.targetId,
            relationKind: r.relationKind,
          },
        },
        update: { position: idx },
        create: {
          organizationId: args.organizationId,
          sourceType,
          sourceId: args.sourceId,
          targetType: r.targetType,
          targetId: r.targetId,
          relationKind: r.relationKind,
          position: idx,
          createdById: args.createdById ?? null,
        },
      })
    ),
    ...(stale.length > 0
      ? [prisma.entityLink.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })]
      : []),
  ]);
}

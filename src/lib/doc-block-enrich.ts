// Doc / SOP block-content enrichment.
//
// Walks the `content.blocks` array and refreshes presigned GET URLs
// for image / file blocks that carry an `s3Key`. Mirrors the SOP
// screenshot enrichment pattern: the database holds the durable S3
// key, the API response holds a fresh 1-hour URL. Browsers cache by
// URL so as long as the user doesn't sit on a doc for >1 hour, the
// img tag never breaks.
//
// Falls through cleanly when S3 isn't configured (dev fallback).

import { isS3Configured, presignGetUrl } from "./s3";

export type EnrichableContent = unknown;

const PRESIGN_TTL_SECONDS = 60 * 60; // 1 hour

interface ImageOrFileBlock {
  kind: "image" | "file";
  s3Key?: string | null;
  url?: string;
  // pass through other fields untouched
  [k: string]: unknown;
}

export async function presignBlocksImagesAndFiles(content: EnrichableContent): Promise<EnrichableContent> {
  if (!isS3Configured()) return content;
  if (!content || typeof content !== "object") return content;
  const c = content as { blocks?: unknown[] };
  if (!Array.isArray(c.blocks)) return content;

  // Collect blocks that need refresh.
  const toRefresh: { idx: number; key: string }[] = [];
  for (let i = 0; i < c.blocks.length; i++) {
    const b = c.blocks[i];
    if (!b || typeof b !== "object") continue;
    const block = b as ImageOrFileBlock;
    if ((block.kind === "image" || block.kind === "file") && typeof block.s3Key === "string" && block.s3Key) {
      toRefresh.push({ idx: i, key: block.s3Key });
    }
  }
  if (toRefresh.length === 0) return content;

  // Re-sign in parallel.
  const signed = await Promise.all(
    toRefresh.map(async (entry) => {
      try { return { idx: entry.idx, url: await presignGetUrl(entry.key, PRESIGN_TTL_SECONDS) }; }
      catch { return { idx: entry.idx, url: null }; }
    })
  );

  const nextBlocks = [...c.blocks];
  for (const s of signed) {
    if (!s.url) continue;
    const b = nextBlocks[s.idx] as ImageOrFileBlock;
    nextBlocks[s.idx] = { ...b, url: s.url };
  }
  return { ...(c as object), blocks: nextBlocks };
}

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
  const c = content as { blocks?: unknown[]; bnDoc?: unknown[] };

  // Phase A — legacy `blocks` array (still populated as the BN-derived
  // mirror; preserved legacy image/file blocks carry s3Key, so this is
  // the workhorse path).
  const nextBlocks = await refreshLegacyImageBlocks(c.blocks);

  // Phase B — BlockNote's native `bnDoc` array. No-op today because the
  // default BN image block doesn't carry s3Key; included so when we wire
  // BN's uploader through our S3 layer, the per-read presign Just Works
  // without touching the API route.
  const nextBnDoc = await refreshBnDocImageBlocks(c.bnDoc);

  if (nextBlocks === c.blocks && nextBnDoc === c.bnDoc) return content;
  return {
    ...(c as object),
    ...(nextBlocks !== c.blocks ? { blocks: nextBlocks } : {}),
    ...(nextBnDoc !== c.bnDoc ? { bnDoc: nextBnDoc } : {}),
  };
}

async function refreshLegacyImageBlocks(blocks: unknown[] | undefined): Promise<unknown[] | undefined> {
  if (!Array.isArray(blocks)) return blocks;
  const toRefresh: { idx: number; key: string }[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || typeof b !== "object") continue;
    const block = b as ImageOrFileBlock;
    if ((block.kind === "image" || block.kind === "file") && typeof block.s3Key === "string" && block.s3Key) {
      toRefresh.push({ idx: i, key: block.s3Key });
    }
  }
  if (toRefresh.length === 0) return blocks;

  const signed = await Promise.all(
    toRefresh.map(async (entry) => {
      try { return { idx: entry.idx, url: await presignGetUrl(entry.key, PRESIGN_TTL_SECONDS) }; }
      catch { return { idx: entry.idx, url: null }; }
    })
  );

  const next = [...blocks];
  for (const s of signed) {
    if (!s.url) continue;
    next[s.idx] = { ...(next[s.idx] as ImageOrFileBlock), url: s.url };
  }
  return next;
}

// BlockNote image/file blocks look like { type: "image"|"file", props: { url, s3Key? } }.
// We treat s3Key as an optional escape hatch — when the upload pipeline
// sets it, the presigner refreshes it. Default BN blocks won't trigger
// any rewrite.
async function refreshBnDocImageBlocks(bnDoc: unknown[] | undefined): Promise<unknown[] | undefined> {
  if (!Array.isArray(bnDoc)) return bnDoc;
  const toRefresh: { idx: number; key: string }[] = [];
  for (let i = 0; i < bnDoc.length; i++) {
    const b = bnDoc[i];
    if (!b || typeof b !== "object") continue;
    const block = b as { type?: string; props?: { s3Key?: unknown } };
    if ((block.type === "image" || block.type === "file") && block.props && typeof block.props.s3Key === "string" && block.props.s3Key) {
      toRefresh.push({ idx: i, key: block.props.s3Key });
    }
  }
  if (toRefresh.length === 0) return bnDoc;

  const signed = await Promise.all(
    toRefresh.map(async (entry) => {
      try { return { idx: entry.idx, url: await presignGetUrl(entry.key, PRESIGN_TTL_SECONDS) }; }
      catch { return { idx: entry.idx, url: null }; }
    })
  );

  const next = [...bnDoc];
  for (const s of signed) {
    if (!s.url) continue;
    const original = next[s.idx] as { props?: Record<string, unknown> };
    next[s.idx] = { ...original, props: { ...(original.props ?? {}), url: s.url } };
  }
  return next;
}

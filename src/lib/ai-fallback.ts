// ai-fallback — a safety net for model availability. If a caller's chosen model
// has been retired or isn't available on the key, retry once on a model that is
// always available. Pure (only the Anthropic SDK type), so it's unit-tested
// without pulling in prisma or the org-key machinery.
//
// Motivated by a real outage: a hardcoded model id (claude-sonnet-4-20250514)
// was retired and every request 404'd. One bad model id should degrade the
// feature, never take it down.

import type Anthropic from "@anthropic-ai/sdk";

// Cheap, fast, and reliably available on the shared account.
export const SAFE_FALLBACK_MODEL = "claude-haiku-4-5-20251001";

/** True when the error is Anthropic rejecting the MODEL itself (retired /
 *  unknown / not available on this key), not a transient or usage error. */
export function isModelUnavailable(err: unknown): boolean {
  const e = err as { status?: number; error?: { error?: { type?: string; message?: string } }; message?: string };
  if (e?.status === 404) return true;
  if (e?.error?.error?.type === "not_found_error") return true;
  const msg = (e?.error?.error?.message || e?.message || "").toLowerCase();
  return /\bmodel\b/.test(msg);
}

/** messages.create with a one-shot retry on SAFE_FALLBACK_MODEL when the chosen
 *  model turns out to be unavailable. Otherwise identical to
 *  client.messages.create (same params, same result). */
export async function createMessageWithFallback(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  try {
    return await client.messages.create(params);
  } catch (err) {
    if (isModelUnavailable(err) && params.model !== SAFE_FALLBACK_MODEL) {
      console.warn(`[ai-fallback] model "${params.model}" unavailable — retrying on ${SAFE_FALLBACK_MODEL}`);
      return await client.messages.create({ ...params, model: SAFE_FALLBACK_MODEL });
    }
    throw err;
  }
}

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { createMessageWithFallback, isModelUnavailable, SAFE_FALLBACK_MODEL } from "./ai-fallback";

const params: Anthropic.MessageCreateParamsNonStreaming = {
  model: "claude-sonnet-4-retired",
  max_tokens: 10,
  messages: [{ role: "user", content: "hi" }],
};
const clientWith = (create: ReturnType<typeof vi.fn>) =>
  ({ messages: { create } } as unknown as Anthropic);

describe("isModelUnavailable", () => {
  it("recognises a model 404 / not_found, ignores usage errors", () => {
    expect(isModelUnavailable({ status: 404 })).toBe(true);
    expect(isModelUnavailable({ error: { error: { type: "not_found_error", message: "model: x" } } })).toBe(true);
    expect(isModelUnavailable({ error: { error: { type: "rate_limit_error", message: "slow down" } } })).toBe(false);
    expect(isModelUnavailable({ status: 500 })).toBe(false);
  });
});

describe("createMessageWithFallback", () => {
  it("retries once on the safe model when the chosen model is unavailable", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce({ status: 404, error: { error: { type: "not_found_error", message: "model: claude-sonnet-4-retired" } } })
      .mockResolvedValueOnce({ id: "ok" });
    const res = await createMessageWithFallback(clientWith(create), params);
    expect(res).toEqual({ id: "ok" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].model).toBe(SAFE_FALLBACK_MODEL);
  });

  it("does NOT retry a transient / usage error", async () => {
    const create = vi.fn().mockRejectedValue({ status: 429, error: { error: { type: "rate_limit_error" } } });
    await expect(createMessageWithFallback(clientWith(create), params)).rejects.toBeTruthy();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does NOT loop when the chosen model already is the safe fallback", async () => {
    const create = vi.fn().mockRejectedValue({ status: 404 });
    await expect(createMessageWithFallback(clientWith(create), { ...params, model: SAFE_FALLBACK_MODEL })).rejects.toBeTruthy();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

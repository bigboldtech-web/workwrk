// The automation chain depth of what is running now (review round 3).
//
// An automation's AI teammate step runs a whole turn as its creator, and the
// teammate's own edits (a task moved, a field set) dispatch events like the
// person's own. Without this, those events read as depth 0 and the chain
// limit (engine.ts MAX_CHAIN_DEPTH) never applied: a teammate that changes
// a field could fire its own automation again and again, each pass spending
// a question. Everything dispatched inside withAutomationDepth carries the
// run's depth + 1 (webhookDispatcher.ts dispatchEvent stamps it).
//
// Server-only.

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ depth: number }>();

/** Run `fn` with every event it dispatches counted at this chain depth. */
export function withAutomationDepth<T>(depth: number, fn: () => Promise<T>): Promise<T> {
  return store.run({ depth }, fn);
}

/** The chain depth of the automation work running now, or null outside one. */
export function automationDepthNow(): number | null {
  return store.getStore()?.depth ?? null;
}

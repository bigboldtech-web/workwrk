// Saving a view's settings, one queue per view.
//
// Every per-view setting a List page writes (filters, saved filters, columns,
// group by and its direction, sort, column widths, pinned columns, row height)
// is a KEY of View.config. They used to go out as independent fire-and-forget
// PATCHes of the whole config, so two quick changes raced (the slower one won
// with its stale copy of the other key), a failure was a toast at best and the
// change was simply gone, and navigating away mid-save was a coin toss.
//
// Now every write is a `configPatch` (PATCH /api/boards/[id]/views/[viewId]
// merges it over the stored config on a locked row) through this queue:
//
//   * patches merge while they wait, and a later value of a key wins;
//   * exactly ONE request is in flight per view; the next goes when it lands;
//   * a patch that failed on the way (not reached, a server failure) keeps
//     its keys dirty, under anything newer, so the next save or the failure
//     toast's "Try again" (flush) sends them again. Nothing is retried in a
//     loop on its own;
//   * a patch the server REFUSED (the person may not save this view, or it is
//     gone) is said once and not kept: sending it again with a later save
//     would only be refused again, and would raise the same toast each time;
//   * a List page that mounts with the view's config fresh from the server
//     lets go of keys an earlier visit failed to save (discardFailed): the
//     screen now shows the stored values, and a key it does not show must
//     never ride along with a later, unrelated save and overwrite someone
//     else's newer value;
//   * the queue is module level, so an in-app navigation does not cancel a
//     save that is on its way; small bodies go with `keepalive` so a tab close
//     does not either.
//
// `createViewConfigQueue` is the pure machine (its sender is injected, so a
// test can hold every request open); `viewConfigQueue` is the per-view
// singleton the canvas and the table share.

import { accessMessage } from "@/lib/access-message";

export type ViewPatch = Record<string, unknown>;
/** `retryable` false means refused: the same patch would be refused again. */
export type SendResult = { ok: true } | { ok: false; message: string; retryable?: boolean };

export interface QueueState {
  status: "idle" | "saving" | "error";
  /** The sentence for the last failure; null once a save lands. */
  message: string | null;
  /** Whether a Try again can help: false after a refusal. */
  retryable: boolean;
}

/** Waiting patches merged: a later value of a key wins. */
export function mergeViewPatch(pending: ViewPatch, patch: ViewPatch): ViewPatch {
  return { ...pending, ...patch };
}

/** What stays dirty after `sent` failed: its keys, under anything queued since. */
export function afterFailure(pending: ViewPatch, sent: ViewPatch): ViewPatch {
  return { ...sent, ...pending };
}

const SAVE_FAILED = "Couldn't save the view settings.";

export interface ViewConfigQueue {
  enqueue(patch: ViewPatch): void;
  /** Send whatever is dirty now; true when everything has landed. */
  flush(): Promise<boolean>;
  /**
   * Let go of keys a failed save left dirty, when nothing is on its way. For
   * a page that has just read the view's config from the server.
   */
  discardFailed(): void;
  subscribe(fn: (state: QueueState) => void): () => void;
  state(): QueueState;
  pending(): ViewPatch;
}

export function createViewConfigQueue(send: (patch: ViewPatch) => Promise<SendResult>): ViewConfigQueue {
  let pending: ViewPatch = {};
  let inflight: Promise<void> | null = null;
  let current: QueueState = { status: "idle", message: null, retryable: true };
  const listeners = new Set<(s: QueueState) => void>();

  const setState = (next: QueueState) => {
    current = next;
    for (const fn of listeners) {
      try {
        fn(next);
      } catch {
        // A listener that throws must not stop the queue.
      }
    }
  };
  const dirty = () => Object.keys(pending).length > 0;

  const pump = async (): Promise<void> => {
    while (dirty()) {
      const sent = pending;
      pending = {};
      setState({ status: "saving", message: null, retryable: true });
      let res: SendResult;
      try {
        res = await send(sent);
      } catch {
        res = { ok: false, message: SAVE_FAILED, retryable: true };
      }
      if (!res.ok) {
        const retryable = res.retryable !== false;
        if (retryable) pending = afterFailure(pending, sent);
        setState({ status: "error", message: res.message || SAVE_FAILED, retryable });
        return;
      }
    }
    setState({ status: "idle", message: null, retryable: true });
  };

  const kick = () => {
    if (inflight) return;
    inflight = pump().finally(() => {
      inflight = null;
    });
  };

  return {
    enqueue(patch) {
      pending = mergeViewPatch(pending, patch);
      kick();
    },
    async flush() {
      if (inflight) await inflight;
      if (dirty()) {
        kick();
        if (inflight) await inflight;
      }
      return current.status !== "error" && !dirty();
    },
    discardFailed() {
      if (inflight || current.status !== "error") return;
      pending = {};
      setState({ status: "idle", message: null, retryable: true });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    state: () => current,
    pending: () => ({ ...pending }),
  };
}

const queues = new Map<string, ViewConfigQueue>();

/** The one queue for this view, shared by every component that saves it. */
export function viewConfigQueue(boardId: string, viewId: string): ViewConfigQueue {
  const key = `${boardId}:${viewId}`;
  let q = queues.get(key);
  if (!q) {
    q = createViewConfigQueue(async (patch) => {
      const wire = JSON.stringify({ configPatch: patch });
      const res = await fetch(`/api/boards/${boardId}/views/${viewId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: wire,
        // Outlives the page when small; a body over the 64KB keepalive cap
        // would be refused outright, which is the loss this avoids.
        keepalive: wire.length < 60_000,
      });
      if (res.ok) return { ok: true };
      const body = await res.json().catch(() => null);
      // A server failure or a rate limit can pass on a second try; any other
      // answer is a refusal of this patch.
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      return { ok: false, message: accessMessage(body, SAVE_FAILED), retryable };
    });
    queues.set(key, q);
  }
  return q;
}

// The Teams hub's field writes (Edit details, the org chart's edit mode,
// the Departments and Job titles autosaves), made durable.
//
// Every one of these writes SETS a value (PATCH one field of a person, PUT
// the whole dotted-line list, PATCH a department's name), so sending it a
// second time changes nothing: it is safe to retry, which is what the
// shell's offline banner ("Changes will save when you reconnect") promises.
// Before this file a failed save was one attempt and a red word: close the
// dialog and the edit was gone.
//
//   * one slot per target (method + url): bodies merge while they wait, a
//     later value of a key wins, and exactly one request is in flight per
//     target;
//   * a transient failure (offline, a 5xx) keeps the body and retries on a
//     backoff (1s, 2s, 4s ... capped at 30s) and at once when the browser
//     comes back online; the caller hears `retrying` so the field can say
//     "Not saved, retrying";
//   * a refusal (a 4xx) is said once and dropped: the same body would be
//     refused again;
//   * the queue is module level, so closing the dialog or navigating inside
//     the app never cancels a save on its way, and a tab close flushes what
//     is still waiting with `keepalive`.
//
// `createRecordWriteQueue` is the pure machine (sender, timer and clock are
// injected so a test drives every branch); `recordWriteQueue` is the
// browser singleton.

export type WriteMethod = "PATCH" | "PUT" | "POST";
export type WriteBody = Record<string, unknown>;

export type SendOutcome =
  | { ok: true; data?: unknown }
  | { ok: false; transient: boolean; error: string; status?: number; data?: unknown };

export type WriteResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; status?: number; data?: unknown };

export interface WriteHooks {
  /** Called once when the first attempt failed transiently and a retry is scheduled. */
  onRetrying?: (error: string) => void;
}

interface Slot {
  method: WriteMethod;
  url: string;
  pending: WriteBody | null;
  inFlight: boolean;
  attempt: number;
  timer: unknown;
  waiters: Array<{ resolve: (r: WriteResult) => void; hooks: WriteHooks; told: boolean }>;
}

export interface RecordWriteQueue {
  write(method: WriteMethod, url: string, body: WriteBody, hooks?: WriteHooks): Promise<WriteResult>;
  /** Try every waiting slot now (the browser came back online). */
  retryAll(): void;
  /** Bodies still waiting (for the keepalive flush on a tab close). */
  waiting(): Array<{ method: WriteMethod; url: string; body: WriteBody }>;
  /** How many targets have an unsaved change. */
  size(): number;
}

export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

export function createRecordWriteQueue(deps: {
  send: (method: WriteMethod, url: string, body: WriteBody) => Promise<SendOutcome>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}): RecordWriteQueue {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const slots = new Map<string, Slot>();

  const settle = (slot: Slot, r: WriteResult, count: number) => {
    const done = slot.waiters.splice(0, count);
    for (const w of done) w.resolve(r);
  };

  const pump = async (key: string) => {
    const slot = slots.get(key);
    if (!slot || slot.inFlight || !slot.pending) return;
    if (slot.timer) { clearTimer(slot.timer); slot.timer = null; }
    const body = slot.pending;
    const covered = slot.waiters.length;
    slot.pending = null;
    slot.inFlight = true;
    let out: SendOutcome;
    try {
      out = await deps.send(slot.method, slot.url, body);
    } catch (e) {
      out = { ok: false, transient: true, error: e instanceof Error ? e.message : "Not saved" };
    }
    slot.inFlight = false;
    if (out.ok) {
      slot.attempt = 0;
      settle(slot, { ok: true, data: out.data }, covered);
    } else if (!out.transient) {
      slot.attempt = 0;
      settle(slot, { ok: false, error: out.error, status: out.status, data: out.data }, covered);
    } else {
      // Keep it, under anything newer that arrived while it was on its way.
      slot.pending = { ...body, ...(slot.pending ?? {}) };
      for (const w of slot.waiters) {
        if (!w.told) { w.told = true; w.hooks.onRetrying?.(out.error); }
      }
      const delay = retryDelayMs(slot.attempt);
      slot.attempt += 1;
      slot.timer = setTimer(() => { slot.timer = null; void pump(key); }, delay);
      return;
    }
    if (slot.pending) void pump(key);
    else if (slot.waiters.length === 0) slots.delete(key);
  };

  return {
    write(method, url, body, hooks = {}) {
      const key = `${method} ${url}`;
      let slot = slots.get(key);
      if (!slot) {
        slot = { method, url, pending: null, inFlight: false, attempt: 0, timer: null, waiters: [] };
        slots.set(key, slot);
      }
      // A PUT replaces the whole resource: the newest body is the whole truth.
      slot.pending = method === "PUT" ? { ...body } : { ...(slot.pending ?? {}), ...body };
      const p = new Promise<WriteResult>((resolve) => slot!.waiters.push({ resolve, hooks, told: false }));
      void pump(key);
      return p;
    },
    retryAll() {
      for (const [key, slot] of slots) {
        if (slot.pending && !slot.inFlight) { slot.attempt = 0; void pump(key); }
      }
    },
    waiting() {
      const out: Array<{ method: WriteMethod; url: string; body: WriteBody }> = [];
      for (const slot of slots.values()) if (slot.pending) out.push({ method: slot.method, url: slot.url, body: slot.pending });
      return out;
    },
    size() {
      let n = 0;
      for (const slot of slots.values()) if (slot.pending || slot.inFlight) n += 1;
      return n;
    },
  };
}

// ── The browser singleton ─────────────────────────────────────────

async function browserSend(method: WriteMethod, url: string, body: WriteBody): Promise<SendOutcome> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, transient: true, error: "You're offline" };
  }
  const text = await res.text().catch(() => "");
  let data: unknown = undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
  if (res.ok) return { ok: true, data };
  const error = (data as { error?: unknown } | undefined)?.error;
  const message = typeof error === "string" && error ? error : res.status >= 500 ? "The server didn't save it" : "Not saved";
  // 401 is a dead session: retrying would never land, the shell's session
  // dialog takes it from there.
  return { ok: false, transient: res.status >= 500 || res.status === 408 || res.status === 429, error: message, status: res.status, data };
}

let singleton: RecordWriteQueue | null = null;

export function recordWriteQueue(): RecordWriteQueue {
  if (singleton) return singleton;
  const q = createRecordWriteQueue({ send: browserSend });
  singleton = q;
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => q.retryAll());
    window.addEventListener("pagehide", () => {
      for (const w of q.waiting()) {
        const raw = JSON.stringify(w.body);
        // keepalive bodies are capped at 64KB by the browser.
        if (raw.length > 60_000) continue;
        try {
          void fetch(w.url, { method: w.method, headers: { "content-type": "application/json" }, body: raw, keepalive: true, credentials: "same-origin" });
        } catch {
          // Nothing more can be done as the page goes away.
        }
      }
    });
  }
  return q;
}

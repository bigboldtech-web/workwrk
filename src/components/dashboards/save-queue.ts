// The dashboard save queue: every edit to a dashboard's cards, layout and
// name goes through here, one PATCH at a time.
//
// MODULE-SCOPED ON PURPOSE. The queues live in a Map from dashboard id to one
// queue, outside React, so leaving the canvas inside the app never cancels a
// save: the PATCH in flight lands, the next one is sent, and coming back to
// the page picks up the same state (pending, failed or stopped). A real
// unload is covered twice: beforeunload asks the browser's leave question
// whenever a save is pending or in flight, and pagehide sends one keepalive
// PATCH when nothing is in flight and the body is small enough for the
// browser to carry. Anything else stays in the local draft, which the next
// open offers back (DraftRestoreStrip).
//
// THE MODEL (pure rules in src/lib/dashboards/dashboard-editor.ts):
//   base       what the server last confirmed: updatedAt, name, cards as sent
//   local      what is on screen; every edit changes it FIRST
//   removedIds cards removed since the last confirmed save
// A save sends local at base's version; its answer decides what happens
// (classifySaveResponse): ok moves base forward, conflict stops and keeps a
// draft, widget_missing re-reads and retries once at the same version,
// invalid / forbidden / gone / unauthorized stop and say why, and a network
// or server failure retries after 1, 3 and 9 seconds before it asks for a
// Retry. Nothing retries forever and nothing is cleared silently.
//
// Client-only: fetch, localStorage and window events. No React.

import {
  buildDashboardPatch,
  classifySaveResponse,
  dataKey,
  draftHasUnmergedEdits,
  mergeMissingWidgets,
  rebaseDashboard,
  stableStringify,
  type DashboardSnapshot,
} from "@/lib/dashboards/dashboard-editor";
import { dashboardMessage } from "@/lib/dashboards/dashboard-messages";
import { isSpaceOverviewId } from "@/lib/dashboards/dashboard-access";
import { draftKey, parseDraft, serializeDraft, type DraftEnvelope } from "@/lib/local-draft";
import type { EditorWidget } from "@/lib/dashboards/widgets";

export interface Confirmed extends DashboardSnapshot {
  updatedAt: string;
}

/** What the local draft holds: enough to rebase the edits onto any later version. */
export interface DraftPayload {
  base: Confirmed;
  local: DashboardSnapshot;
  removedIds: string[];
}

export type QueueStatus = "idle" | "saving" | "retrying" | "saved" | "error" | "conflict" | "stopped";
export type StopReason = "invalid" | "forbidden" | "gone" | "unauthorized" | "widget_missing";

export interface QueueState {
  id: string;
  base: Confirmed | null;
  local: DashboardSnapshot | null;
  removedIds: string[];
  status: QueueStatus;
  stopReason: StopReason | null;
  /** The sentence shown beside a stopped or failed save. */
  message: string | null;
  inFlight: boolean;
  lastSavedAt: Date | null;
  /** A draft holding edits the server does not have, offered back by DraftRestoreStrip. */
  draftOffer: DraftEnvelope<DraftPayload> | null;
}

type ToastFn = (
  message: string,
  opts?: { tone?: "info" | "success" | "danger"; action?: { label: string; onClick: () => void } },
) => void;

type LiveRead =
  | { ok: true; snapshot: Confirmed; canEdit: boolean }
  | { ok: false; status: number; body: unknown };

const DEBOUNCE_MS = 350;
const RETRY_DELAYS = [1000, 3000, 9000];
/** Under the 64 KB a keepalive request may carry, with room for headers. */
const KEEPALIVE_MAX = 60_000;

function readDraft(id: string): DraftEnvelope<DraftPayload> | null {
  try {
    return parseDraft<DraftPayload>(window.localStorage.getItem(draftKey("dashboard", id)));
  } catch {
    return null;
  }
}

/** Is this a draft this release wrote? A malformed one is never restored. */
function usableDraft(env: DraftEnvelope<DraftPayload> | null): env is DraftEnvelope<DraftPayload> {
  const p = env?.payload;
  return !!p && !!p.base && typeof p.base.updatedAt === "string" && Array.isArray(p.base.widgets) && !!p.local && Array.isArray(p.local.widgets) && Array.isArray(p.removedIds);
}

export async function readLiveDashboard(id: string): Promise<LiveRead> {
  let status = 0;
  let body: unknown = null;
  try {
    const res = await fetch(`/api/dashboards/${encodeURIComponent(id)}`, { cache: "no-store" });
    status = res.status;
    body = await res.json().catch(() => null);
  } catch {
    return { ok: false, status: 0, body: null };
  }
  if (status < 200 || status >= 300) return { ok: false, status, body };
  const d = (body as { dashboard?: { name?: string; updatedAt?: string; widgets?: EditorWidget[] }; canEdit?: boolean })?.dashboard;
  if (!d || typeof d.updatedAt !== "string") return { ok: false, status: 500, body };
  return {
    ok: true,
    snapshot: { updatedAt: d.updatedAt, name: String(d.name ?? ""), widgets: Array.isArray(d.widgets) ? d.widgets : [] },
    canEdit: (body as { canEdit?: boolean }).canEdit === true,
  };
}

export class DashboardQueue {
  private state: QueueState;
  private listeners = new Set<() => void>();
  private savedListeners = new Set<(changedIds: string[]) => void>();
  private forbiddenListeners = new Set<() => void>();
  private toast: ToastFn | null = null;
  private mounted = 0;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private missingRetried = false;

  constructor(id: string) {
    this.state = {
      id,
      base: null,
      local: null,
      removedIds: [],
      status: "idle",
      stopReason: null,
      message: null,
      inFlight: false,
      lastSavedAt: null,
      draftOffer: null,
    };
  }

  // ── subscription ───────────────────────────────────────────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getState = (): QueueState => this.state;

  onSaved(fn: (changedIds: string[]) => void): () => void {
    this.savedListeners.add(fn);
    return () => {
      this.savedListeners.delete(fn);
    };
  }

  onForbidden(fn: () => void): () => void {
    this.forbiddenListeners.add(fn);
    return () => {
      this.forbiddenListeners.delete(fn);
    };
  }

  /**
   * A mounted surface lends the queue the shell's toast. The function is kept
   * after unmount, so a failure that lands after the person has left the
   * page still says so (the shell's toast provider outlives the page).
   */
  attach(toast: ToastFn): () => void {
    this.toast = toast;
    this.mounted += 1;
    return () => {
      this.mounted = Math.max(0, this.mounted - 1);
    };
  }

  private set(patch: Partial<QueueState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // ── reading ────────────────────────────────────────────────────────

  /** Local differs from what the server confirmed. */
  hasUnsaved(): boolean {
    const { base, local, removedIds } = this.state;
    if (!base || !local) return false;
    if (removedIds.length > 0) return true;
    return local.name !== base.name || stableStringify(local.widgets) !== stableStringify(base.widgets);
  }

  /**
   * A save is waiting, on the wire, or failed on the network with Retry still
   * worth pressing: the leave prompt's question. A stopped or conflicted
   * queue does not ask, because staying would not help (the reason is on the
   * page and the draft keeps the changes for the next open).
   */
  busy(): boolean {
    const s = this.state.status;
    if (this.state.inFlight) return true;
    if (s === "conflict" || s === "stopped") return false;
    return this.hasUnsaved();
  }

  /** Is this card's current version the one the server has (its save landed)? */
  isCardSaved(id: string): boolean {
    const b = this.state.base?.widgets.find((w) => w.id === id);
    const l = this.state.local?.widgets.find((w) => w.id === id);
    return !!b && !!l && dataKey(b) === dataKey(l);
  }

  /**
   * The server's copy, as the page just read it. A queue that still holds
   * work (a save waiting, failed or stopped) keeps its local state: that is
   * the point of it outliving the page. Otherwise base and local become the
   * server's, and a draft whose edits the server does not have is offered
   * back.
   */
  hydrate(server: Confirmed) {
    const holding = this.state.base && (this.hasUnsaved() || this.state.inFlight || this.state.status === "conflict" || this.state.status === "stopped" || this.state.status === "error");
    if (holding) return;
    const env = readDraft(this.state.id);
    let draftOffer: DraftEnvelope<DraftPayload> | null = null;
    // Offered when its edits are not on the server yet, whatever the clocks
    // say: a save still in flight at close, or another editor's later save,
    // leaves a draft older than the row that the server never merged.
    if (usableDraft(env) && draftHasUnmergedEdits(env.payload, server)) draftOffer = env;
    else if (env) this.clearDraft();
    this.set({
      base: server,
      local: { name: server.name, widgets: server.widgets },
      removedIds: [],
      status: "idle",
      stopReason: null,
      message: null,
      draftOffer,
    });
  }

  // ── the draft ──────────────────────────────────────────────────────

  private writeDraft() {
    const { base, local, removedIds, id } = this.state;
    if (!base || !local) return;
    const payload: DraftPayload = { base, local, removedIds };
    try {
      window.localStorage.setItem(draftKey("dashboard", id), serializeDraft(payload));
    } catch {
      /* quota or private mode: the server save still runs */
    }
  }

  private clearDraft() {
    try {
      window.localStorage.removeItem(draftKey("dashboard", this.state.id));
    } catch {
      /* ignore */
    }
  }

  /** DraftRestoreStrip's Restore: the draft's edits rebased onto the version now on screen. */
  restoreDraft(payload: DraftPayload) {
    const base = this.state.base;
    if (!base) return;
    const r = rebaseDashboard(payload.base, payload.local, base);
    this.set({ local: { name: r.name, widgets: r.widgets }, removedIds: r.removedIds, draftOffer: null, status: "idle", stopReason: null, message: null });
    this.writeDraft();
    this.schedule(0);
  }

  /** DraftRestoreStrip's Discard. */
  discardDraft() {
    this.clearDraft();
    this.set({ draftOffer: null });
  }

  // ── edits ──────────────────────────────────────────────────────────

  /**
   * One edit: local changes first, the draft is written, and a save is
   * queued. While the queue is stopped or in conflict the edit is kept on
   * screen and in the draft, and nothing is sent until the person resolves
   * it (Retry, Reload or Dismiss).
   */
  mutate(fn: (s: { name: string; widgets: EditorWidget[]; removedIds: string[] }) => { name: string; widgets: EditorWidget[]; removedIds: string[] }, opts: { immediate?: boolean } = {}) {
    const { local, base } = this.state;
    if (!local || !base) return;
    const next = fn({ name: local.name, widgets: local.widgets, removedIds: this.state.removedIds });
    this.set({ local: { name: next.name, widgets: next.widgets }, removedIds: next.removedIds });
    this.writeDraft();
    if (this.state.status === "conflict" || this.state.status === "stopped") return;
    this.schedule(opts.immediate ? 0 : DEBOUNCE_MS);
  }

  private schedule(ms: number) {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.flush();
    }, ms);
  }

  /** The Retry beside a stopped or failed save: the same changes, sent again. */
  retry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.attempt = 0;
    this.missingRetried = false;
    this.set({ status: "idle", stopReason: null, message: null });
    void this.flush();
  }

  private stop(reason: StopReason, message: string) {
    this.writeDraft();
    this.set({ status: "stopped", stopReason: reason, message });
    this.tellIfAway();
  }

  private enterConflict() {
    // Re-written now, so the draft is newer than the version that beat it and
    // the restore strip can offer it after a Reload.
    this.writeDraft();
    this.set({ status: "conflict", stopReason: null, message: null });
    this.tellIfAway();
  }

  /** A failure that lands after the person left the page still reaches them. */
  private tellIfAway() {
    if (this.mounted > 0 || !this.toast) return;
    const name = this.state.local?.name || "this dashboard";
    this.toast(`Your last changes to ${name} weren't saved.`, {
      tone: "danger",
      action: { label: "Try again", onClick: () => this.retry() },
    });
  }

  // ── sending ────────────────────────────────────────────────────────

  async flush(opts: { keepalive?: boolean } = {}): Promise<void> {
    if (this.state.inFlight) return; // the landing PATCH sends the rest
    const { base, local } = this.state;
    if (!base || !local) return;
    const s = this.state.status;
    if (s === "conflict" || s === "stopped") return;
    if (!this.hasUnsaved()) {
      if (s === "saving" || s === "retrying") this.set({ status: "saved" });
      return;
    }
    const body = buildDashboardPatch({
      expectedUpdatedAt: base.updatedAt,
      widgets: local.widgets,
      removedIds: this.state.removedIds,
      name: local.name !== base.name ? local.name : undefined,
    });
    const sent = { name: local.name, widgets: local.widgets, removedIds: body.removedWidgetIds };
    this.set({ inFlight: true, status: this.state.status === "retrying" ? "retrying" : "saving" });
    let status = 0;
    let payload: unknown = null;
    try {
      const res = await fetch(`/api/dashboards/${encodeURIComponent(this.state.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(opts.keepalive ? { keepalive: true } : {}),
      });
      status = res.status;
      payload = await res.json().catch(() => null);
    } catch {
      status = 0;
    }
    this.set({ inFlight: false });

    switch (classifySaveResponse(status, payload)) {
      case "ok": {
        this.attempt = 0;
        this.missingRetried = false;
        const updatedAt = (payload as { dashboard?: { updatedAt?: unknown } } | null)?.dashboard?.updatedAt;
        const prev = base;
        const nextBase: Confirmed = { updatedAt: typeof updatedAt === "string" ? updatedAt : prev.updatedAt, name: sent.name, widgets: sent.widgets };
        const sentRemoved = new Set(sent.removedIds);
        this.set({ base: nextBase, removedIds: this.state.removedIds.filter((id) => !sentRemoved.has(id)), lastSavedAt: new Date(), message: null });
        // The cards whose DATA changed in this save refresh now, never before:
        // a new card is not fetched until it is stored, and a move or a
        // rename never refetches.
        const before = new Map(prev.widgets.map((w) => [w.id, w] as const));
        const changed = sent.widgets
          .filter((w) => w.kind === "stat" || w.kind === "chart" || w.kind === "list")
          .filter((w) => {
            const p = before.get(w.id);
            return !p || dataKey(p) !== dataKey(w);
          })
          .map((w) => w.id);
        if (this.hasUnsaved()) {
          this.writeDraft();
          this.set({ status: "saving" });
          void this.flush();
        } else {
          this.clearDraft();
          this.set({ status: "saved" });
        }
        if (changed.length) for (const l of this.savedListeners) l(changed);
        return;
      }
      case "conflict":
        this.enterConflict();
        return;
      case "widget_missing": {
        const live = await readLiveDashboard(this.state.id);
        if (!live.ok) {
          this.stop("widget_missing", dashboardMessage(live.body, "This dashboard changed while you were editing. Reload it and try again."));
          return;
        }
        if (live.snapshot.updatedAt !== base.updatedAt) {
          this.enterConflict();
          return;
        }
        if (this.missingRetried) {
          this.stop("widget_missing", dashboardMessage({ error: "widget_missing" }, "This dashboard changed while you were editing."));
          return;
        }
        this.missingRetried = true;
        const ids = Array.isArray((payload as { ids?: unknown })?.ids) ? ((payload as { ids: unknown[] }).ids.filter((x) => typeof x === "string") as string[]) : [];
        const current = this.state.local;
        if (current) this.set({ local: { ...current, widgets: mergeMissingWidgets(current.widgets, live.snapshot.widgets, ids) } });
        this.writeDraft();
        void this.flush();
        return;
      }
      case "invalid":
        this.stop("invalid", dashboardMessage(payload, "This change couldn't be saved."));
        return;
      case "forbidden":
        // A Space's Overview widgets belong to the Space's managers, so the
        // sentence names what the person actually lost.
        this.stop(
          "forbidden",
          isSpaceOverviewId(this.state.id)
            ? "You can no longer change this Space's widgets, so your last changes weren't saved."
            : "You can no longer edit this dashboard, so your last changes weren't saved.",
        );
        for (const l of this.forbiddenListeners) l();
        return;
      case "gone":
        this.stop(
          "gone",
          isSpaceOverviewId(this.state.id)
            ? "This Space is no longer shared with you. Your last changes to its widgets weren't saved."
            : "This dashboard was deleted or is no longer shared with you. Your last changes weren't saved.",
        );
        return;
      case "unauthorized":
        this.stop("unauthorized", "Your session ended. Sign in again; your changes are kept on this device.");
        return;
      case "retry": {
        if (this.attempt < RETRY_DELAYS.length) {
          const delay = RETRY_DELAYS[this.attempt];
          this.attempt += 1;
          this.set({ status: "retrying" });
          if (this.retryTimer) clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.flush();
          }, delay);
        } else {
          this.attempt = 0;
          this.writeDraft();
          this.set({ status: "error", message: "Your last changes weren't saved." });
          this.tellIfAway();
        }
        return;
      }
    }
  }

  /**
   * Resolves once the queue has nothing left to send (ok), or has stopped
   * (the sentence it stopped with). A dialog that saved through the queue
   * waits on this before it closes, so a refused save keeps it open with its
   * input. Retrying in the background keeps it waiting.
   */
  settle(): Promise<{ ok: true } | { ok: false; message: string; conflict: boolean }> {
    return new Promise((resolve) => {
      const check = (): boolean => {
        const s = this.state;
        if (s.status === "conflict") {
          resolve({ ok: false, message: dashboardMessage({ error: "conflict" }, "Someone else saved this dashboard."), conflict: true });
          return true;
        }
        if (s.status === "stopped" || s.status === "error") {
          resolve({ ok: false, message: s.message ?? "Your last changes weren't saved.", conflict: false });
          return true;
        }
        if (!s.inFlight && !this.debounce && !this.retryTimer && !this.hasUnsaved()) {
          resolve({ ok: true });
          return true;
        }
        return false;
      };
      if (check()) return;
      const off = this.subscribe(() => {
        if (check()) off();
      });
    });
  }

  // ── conflict ───────────────────────────────────────────────────────

  /**
   * ConflictStrip's Reload: the live version on screen, the draft kept, so
   * the restore strip offers the edits back (rebased) or lets them go.
   */
  async reloadLive(): Promise<{ ok: true; canEdit: boolean } | { ok: false; message: string }> {
    const live = await readLiveDashboard(this.state.id);
    if (!live.ok) return { ok: false, message: dashboardMessage(live.body, "Couldn't reload this dashboard.") };
    this.writeDraft();
    const env = readDraft(this.state.id);
    this.set({
      base: live.snapshot,
      local: { name: live.snapshot.name, widgets: live.snapshot.widgets },
      removedIds: [],
      status: "idle",
      stopReason: null,
      message: null,
      draftOffer: usableDraft(env) ? env : null,
    });
    return { ok: true, canEdit: live.canEdit };
  }

  /**
   * ConflictStrip's Dismiss, the established "keep going": my edits rebased
   * onto the live version (my changes where I made them, theirs everywhere
   * else, nothing of theirs resurrected or overwritten), saved at its version.
   */
  async keepMine(): Promise<{ ok: true } | { ok: false; message: string }> {
    const { base, local } = this.state;
    if (!base || !local) return { ok: false, message: "Nothing to keep." };
    const live = await readLiveDashboard(this.state.id);
    if (!live.ok) return { ok: false, message: dashboardMessage(live.body, "Couldn't reach this dashboard.") };
    const r = rebaseDashboard(base, local, live.snapshot);
    this.set({ base: live.snapshot, local: { name: r.name, widgets: r.widgets }, removedIds: r.removedIds, status: "idle", stopReason: null, message: null });
    this.writeDraft();
    await this.flush();
    return { ok: true };
  }

  // ── unload ─────────────────────────────────────────────────────────

  /**
   * One keepalive PATCH, only when it can succeed (nothing in flight, so its
   * version is current) and the browser can carry it. It is an ordinary
   * flush, so when the page is not unloaded after all (a page restored from
   * the back-forward cache) its answer moves base forward like any save, and
   * the waiting debounce never sends the same change a second time at a
   * version it has already used.
   */
  flushOnPagehide() {
    const { base, local, inFlight, status } = this.state;
    if (!base || !local || inFlight || status === "conflict" || status === "stopped") return;
    if (!this.hasUnsaved()) return;
    const body = JSON.stringify(
      buildDashboardPatch({ expectedUpdatedAt: base.updatedAt, widgets: local.widgets, removedIds: this.state.removedIds, name: local.name !== base.name ? local.name : undefined }),
    );
    // Too big for keepalive: nothing is sent, and the draft holds the changes.
    if (body.length >= KEEPALIVE_MAX) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    void this.flush({ keepalive: true });
  }
}

const queues = new Map<string, DashboardQueue>();
let unloadWired = false;

function wireUnload() {
  if (unloadWired || typeof window === "undefined") return;
  unloadWired = true;
  window.addEventListener("beforeunload", (e) => {
    for (const q of queues.values()) {
      if (q.busy()) {
        e.preventDefault();
        // Older engines still read returnValue to show the prompt.
        e.returnValue = "";
        return;
      }
    }
  });
  window.addEventListener("pagehide", () => {
    for (const q of queues.values()) q.flushOnPagehide();
  });
}

/** The one queue for this dashboard, for the life of the tab. */
export function dashboardQueue(id: string): DashboardQueue {
  let q = queues.get(id);
  if (!q) {
    q = new DashboardQueue(id);
    queues.set(id, q);
  }
  wireUnload();
  return q;
}

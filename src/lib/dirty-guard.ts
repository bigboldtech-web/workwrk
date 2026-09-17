// Dirty-state registry (settings-architecture.md section 8.5), the pure half
// of `useDirtyGuard`. Forms register while dirty; anything that is about to
// navigate away asks `confirmLeave()` first. The confirm UI is pluggable:
// the shell installs its DialogProvider-based confirm, the fallback is
// window.confirm, and a test installs whatever it likes.

export type LeaveDecision = "save" | "discard" | "stay";

export interface LeaveConfirmer {
  (opts: { count: number }): Promise<LeaveDecision>;
}

const dirty = new Map<string, { onSave?: () => Promise<boolean> | boolean }>();
const listeners = new Set<() => void>();
let confirmer: LeaveConfirmer | null = null;

function emit() {
  for (const cb of listeners) cb();
}

export function registerDirty(id: string, opts: { onSave?: () => Promise<boolean> | boolean } = {}): () => void {
  dirty.set(id, opts);
  emit();
  return () => {
    if (dirty.has(id)) {
      dirty.delete(id);
      emit();
    }
  };
}

export function hasDirty(): boolean {
  return dirty.size > 0;
}

export function dirtyCount(): number {
  return dirty.size;
}

export function subscribeDirty(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Test seam. */
export function clearDirty(): void {
  dirty.clear();
  emit();
}

export function setLeaveConfirmer(fn: LeaveConfirmer | null): void {
  confirmer = fn;
}

function fallbackConfirm(): Promise<LeaveDecision> {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return Promise.resolve("stay");
  return Promise.resolve(window.confirm("You have unsaved changes. Leave without saving?") ? "discard" : "stay");
}

/**
 * True when it is fine to navigate away: nothing is dirty, or the person
 * chose Discard, or chose Save and every save succeeded. A failed save keeps
 * the form dirty and answers false, so the guard stays armed.
 */
export async function confirmLeave(): Promise<boolean> {
  if (dirty.size === 0) return true;
  const decision = await (confirmer ?? fallbackConfirm)({ count: dirty.size });
  if (decision === "stay") return false;
  if (decision === "discard") return true;
  const saves = [...dirty.values()].map((d) => (d.onSave ? d.onSave() : true));
  const results = await Promise.all(saves.map((s) => Promise.resolve(s).catch(() => false)));
  return results.every(Boolean);
}

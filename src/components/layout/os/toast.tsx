"use client";

// The one toast (design-system 5.7): bottom-left, a bordered white card with
// a 16px glyph, one line, an optional second line, one text action (Undo or
// a named action) and a close. 5s, 8s with an action, max 3 stacked. Never a
// coloured background, never a banner. `useOsToast` keeps its API:
//
//   toast("Saved")
//   toast("Task archived", { onUndo })
//   toast("Couldn't save", { tone: "danger", action: { label: "Try again", onClick } })
//   toast("Cell didn't save", { key: "cell-save" }); dismiss("cell-save")
//
// A `key` makes a toast a single slot: a second toast with the same key
// replaces the first instead of stacking, and dismiss(key) takes it down
// when the thing it reported is over (a save that failed and then landed
// on Retry must not keep saying it failed).

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

type ToastTone = "info" | "success" | "danger";

type Toast = {
  id: number;
  key?: string;
  message: string;
  description?: string;
  tone: ToastTone;
  onUndo?: () => void;
  action?: { label: string; onClick: () => void };
};

export type ToastOptions = {
  onUndo?: () => void;
  action?: { label: string; onClick: () => void };
  description?: string;
  tone?: ToastTone;
  /** One slot per key: replaces a live toast with the same key. */
  key?: string;
};

type ToastCtx = {
  toast: (message: string, opts?: ToastOptions) => void;
  /** Remove every live toast carrying this key. */
  dismiss: (key: string) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

let _id = 0;
const MAX_STACK = 3;

/** The stack after pushing `next`: a keyed toast first drops any live toast
 *  with the same key (replace, not stack), then the newest MAX_STACK stay. */
export function pushToast<T extends { key?: string }>(items: readonly T[], next: T, max = MAX_STACK): T[] {
  const kept = next.key ? items.filter((x) => x.key !== next.key) : items;
  return [...kept, next].slice(-max);
}

export function OsToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const remove = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback<ToastCtx["toast"]>((message, opts) => {
    const id = ++_id;
    const tone: ToastTone = opts?.tone ?? (/couldn'?t|failed|not saved/i.test(message) ? "danger" : "info");
    setItems((xs) => pushToast(xs, { id, key: opts?.key, message, description: opts?.description, tone, onUndo: opts?.onUndo, action: opts?.action }));
    const ms = opts?.onUndo || opts?.action ? 8000 : 5000;
    setTimeout(() => remove(id), ms);
  }, [remove]);

  const dismiss = useCallback<ToastCtx["dismiss"]>((key) => {
    setItems((xs) => (xs.some((x) => x.key === key) ? xs.filter((x) => x.key !== key) : xs));
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {mounted
        ? createPortal(
            <div className="os-toasts workwrk-os" role="region" aria-label="Notifications" aria-live="polite">
              {items.map((t) => {
                const Glyph = t.tone === "success" ? CircleCheck : t.tone === "danger" ? CircleAlert : Info;
                return (
                  <div key={t.id} className={`os-toast os-toast-tone-${t.tone}`}>
                    <Glyph className="os-toast__glyph" strokeWidth={1.5} aria-hidden />
                    <span className="os-toast__body">
                      <span className="os-toast__msg">{t.message}</span>
                      {t.description ? <span className="os-toast__desc">{t.description}</span> : null}
                    </span>
                    {t.onUndo ? (
                      <button type="button" className="os-toast__action" onClick={() => { t.onUndo?.(); remove(t.id); }}>
                        Undo
                      </button>
                    ) : t.action ? (
                      <button type="button" className="os-toast__action" onClick={() => { t.action?.onClick(); remove(t.id); }}>
                        {t.action.label}
                      </button>
                    ) : null}
                    <button type="button" className="os-toast__close" onClick={() => remove(t.id)} aria-label="Dismiss">
                      <X strokeWidth={1.5} aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </Ctx.Provider>
  );
}

export function useOsToast() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Soft fallback for when components are imported outside the provider
    return { toast: (_m: string, _o?: ToastOptions) => {}, dismiss: () => {} };
  }
  return ctx;
}

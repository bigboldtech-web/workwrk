"use client";

// The one toast (design-system 5.7): bottom-left, a bordered white card with
// a 16px glyph, one line, an optional second line, one text action (Undo or
// a named action) and a close. 5s, 8s with an action, max 3 stacked. Never a
// coloured background, never a banner. `useOsToast` keeps its API:
//
//   toast("Saved")
//   toast("Task archived", { onUndo })
//   toast("Couldn't save", { tone: "danger", action: { label: "Try again", onClick } })

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

type ToastTone = "info" | "success" | "danger";

type Toast = {
  id: number;
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
};

type ToastCtx = {
  toast: (message: string, opts?: ToastOptions) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

let _id = 0;
const MAX_STACK = 3;

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
    setItems((xs) => [...xs, { id, message, description: opts?.description, tone, onUndo: opts?.onUndo, action: opts?.action }].slice(-MAX_STACK));
    const ms = opts?.onUndo || opts?.action ? 8000 : 5000;
    setTimeout(() => remove(id), ms);
  }, [remove]);

  const value = useMemo(() => ({ toast }), [toast]);

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
    return { toast: (_m: string, _o?: ToastOptions) => {} };
  }
  return ctx;
}

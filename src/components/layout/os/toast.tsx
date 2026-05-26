"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Toast = {
  id: number;
  message: string;
  onUndo?: () => void;
};

type ToastCtx = {
  toast: (message: string, opts?: { onUndo?: () => void }) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

let _id = 0;

export function OsToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const remove = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback<ToastCtx["toast"]>((message, opts) => {
    const id = ++_id;
    setItems((xs) => [...xs, { id, message, onUndo: opts?.onUndo }]);
    setTimeout(() => remove(id), 3200);
  }, [remove]);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {mounted
        ? createPortal(
            <div className="os-toasts workwrk-os" aria-live="polite">
              {items.map((t) => (
                <div key={t.id} className="os-toast">
                  <span className={`os-toast__dot ${t.onUndo ? "os-toast__dot--undo" : ""}`} />
                  <span>{t.message}</span>
                  {t.onUndo ? (
                    <button
                      type="button"
                      className="os-toast__undo"
                      onClick={() => { t.onUndo?.(); remove(t.id); }}
                    >
                      Undo
                    </button>
                  ) : null}
                </div>
              ))}
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
    return { toast: (_m: string, _o?: { onUndo?: () => void }) => {} };
  }
  return ctx;
}

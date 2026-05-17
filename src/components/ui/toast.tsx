"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (opts: { type: ToastType; title: string; description?: string }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const icons: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

// Phase G16 — toast colors resolve via the locked signal tokens (B).
// One CSS-var swap → light + dark + future theme tweaks propagate.
const styles: Record<ToastType, string> = {
  success: "border-[color:var(--signal-success-border)] bg-[color:var(--signal-success-bg)] text-[color:var(--signal-success-fg)]",
  error: "border-[color:var(--signal-danger-border)] bg-[color:var(--signal-danger-bg)] text-[color:var(--signal-danger-fg)]",
  warning: "border-[color:var(--signal-warning-border)] bg-[color:var(--signal-warning-bg)] text-[color:var(--signal-warning-fg)]",
  info: "border-[color:var(--signal-info-border)] bg-[color:var(--signal-info-bg)] text-[color:var(--signal-info-fg)]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (opts: { type: ToastType; title: string; description?: string }) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, ...opts }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    []
  );

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value: ToastContextValue = {
    toast: addToast,
    success: (title, description) => addToast({ type: "success", title, description }),
    error: (title, description) => addToast({ type: "error", title, description }),
    warning: (title, description) => addToast({ type: "warning", title, description }),
    info: (title, description) => addToast({ type: "info", title, description }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Stacked top-right. Slide-down + fade entrance, soft elevation,
          consistent radius. Toast width capped so long messages wrap. */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => {
          const Icon = icons[t.type];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3.5 backdrop-blur-md",
                "shadow-[0_10px_30px_-6px_rgba(0,0,0,0.22)] dark:shadow-[0_12px_30px_-8px_rgba(0,0,0,0.6)]",
                "animate-in slide-in-from-top-2 fade-in duration-200",
                styles[t.type],
              )}
            >
              <Icon size={16} className="mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold leading-tight">{t.title}</p>
                {t.description && (
                  <p className="text-[12.5px] mt-1 opacity-80 leading-snug">{t.description}</p>
                )}
              </div>
              <button
                onClick={() => remove(t.id)}
                className="shrink-0 opacity-60 hover:opacity-100 transition-fast -mt-0.5 -mr-1 p-1 rounded hover:bg-black/5 dark:hover:bg-white/5"
                aria-label="Dismiss"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

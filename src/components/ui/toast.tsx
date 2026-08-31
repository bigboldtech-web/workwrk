"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { X, CheckCircle, AlertTriangle, AlertCircle, Info, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "warning" | "info" | "neutral";

/** A button rendered under a toast (e.g. Join / Dismiss on an incoming call). */
export interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export interface ToastOptions {
  type: ToastType;
  title: string;
  description?: string;
  /** Custom leading element (e.g. an avatar) — replaces the type icon. */
  icon?: ReactNode;
  /** Action buttons under the body. */
  actions?: ToastAction[];
  /** Click the toast body (e.g. to open a conversation). */
  onClick?: () => void;
  /** ms before auto-dismiss. Default 4000; 0 = stays until dismissed/acted. */
  durationMs?: number;
  /** Replaces an existing toast with the same key instead of stacking a
   *  duplicate (e.g. one ringing toast per call). */
  dedupeKey?: string;
}

interface Toast extends Omit<ToastOptions, "durationMs"> {
  id: string;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  /** Remove a toast by its dedupeKey (e.g. stop ringing when a call ends). */
  dismissKey: (dedupeKey: string) => void;
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
  neutral: Bell,
};

// Phase G16 — toast colors resolve via the locked signal tokens (B).
// One CSS-var swap → light + dark + future theme tweaks propagate.
const styles: Record<ToastType, string> = {
  success: "border-[color:var(--signal-success-border)] bg-[color:var(--signal-success-bg)] text-[color:var(--signal-success-fg)]",
  error: "border-[color:var(--signal-danger-border)] bg-[color:var(--signal-danger-bg)] text-[color:var(--signal-danger-fg)]",
  warning: "border-[color:var(--signal-warning-border)] bg-[color:var(--signal-warning-bg)] text-[color:var(--signal-warning-fg)]",
  info: "border-[color:var(--signal-info-border)] bg-[color:var(--signal-info-bg)] text-[color:var(--signal-info-fg)]",
  // Neutral = a plain surface, for notifications (a message/call), which
  // shouldn't read as success/error.
  neutral: "border-zinc-200 bg-white/95 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((opts: ToastOptions) => {
    const { durationMs, dedupeKey, ...rest } = opts;
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => {
      // A dedupeKey replaces any standing toast with the same key.
      const base = dedupeKey ? prev.filter((t) => t.dedupeKey !== dedupeKey) : prev;
      return [...base, { id, dedupeKey, ...rest }];
    });
    const dur = durationMs ?? 4000;
    if (dur > 0) setTimeout(() => remove(id), dur);
  }, [remove]);

  const dismissKey = useCallback((dedupeKey: string) => {
    setToasts((prev) => prev.filter((t) => t.dedupeKey !== dedupeKey));
  }, []);

  const value: ToastContextValue = {
    toast: addToast,
    success: (title, description) => addToast({ type: "success", title, description }),
    error: (title, description) => addToast({ type: "error", title, description }),
    warning: (title, description) => addToast({ type: "warning", title, description }),
    info: (title, description) => addToast({ type: "info", title, description }),
    dismissKey,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Stacked top-right. Slide-down + fade entrance, soft elevation,
          consistent radius. Toast width capped so long messages wrap. */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => {
          const Icon = icons[t.type];
          const clickable = !!t.onClick;
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
              {t.icon ? (
                <div className="mt-0.5 shrink-0">{t.icon}</div>
              ) : (
                <Icon size={16} className="mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div
                  className={cn(clickable && "cursor-pointer")}
                  onClick={clickable ? () => { t.onClick?.(); remove(t.id); } : undefined}
                >
                  <p className="text-[14.5px] font-semibold leading-tight">{t.title}</p>
                  {t.description && (
                    <p className="text-[13.5px] mt-1 opacity-80 leading-snug line-clamp-3">{t.description}</p>
                  )}
                </div>
                {t.actions && t.actions.length > 0 && (
                  <div className="mt-2.5 flex items-center gap-2">
                    {t.actions.map((a, i) => (
                      <button
                        key={i}
                        onClick={() => { a.onClick(); remove(t.id); }}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-fast",
                          a.primary
                            ? "bg-[var(--os-brand)] text-white hover:bg-[var(--os-brand-hover)]"
                            : "border border-current/20 opacity-80 hover:opacity-100",
                        )}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
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

"use client";

// Small shared pieces of the Staff console's list and record pages
// (spec-admin-backoffice section 1 and section 2): the "Updated {relative}"
// meta, the focus refetch after 60 seconds, the About this page modal, the
// console's 400/560/720 modals and plain confirm, the inline error row, the
// row "..." trigger and copy-to-clipboard. Built on the design system's
// primitives; no new visual primitive.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RowMoreButton } from "@/components/ui/table-card";
import { formatRelative, type DateFormatPrefs } from "@/lib/format/date";
import { cn } from "@/lib/utils";

/** The field and button classes the console's modals share (the product's modal set). */
export const FIELD =
  "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand disabled:opacity-60";
export const LABEL = "text-sm font-medium text-ink-2";
export const BTN_GHOST =
  "inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50";
export const BTN_PRIMARY =
  "inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4";
export const BTN_DANGER =
  "inline-flex h-9 items-center gap-2 rounded-md bg-danger-solid px-3 text-base font-medium text-white hover:opacity-90 disabled:bg-active disabled:text-ink-4";
export const BTN_SECONDARY =
  "inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover disabled:opacity-50";
export const TEXT_LINK = "font-medium text-brand-deep hover:underline";

/** The four-dot in-flight loader that replaces a button's icon (never a spinner). */
export function PendingDots() {
  return (
    <span className="os-pending" role="status" aria-label="Working">
      <i /><i /><i /><i />
    </span>
  );
}

/**
 * "Updated {relative}" for the title row, re-rendered every 30 seconds so
 * "just now" does not sit there for an hour.
 */
export function UpdatedMeta({ at, prefs }: { at: number | null; prefs: DateFormatPrefs }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!at) return null;
  return <span className="whitespace-nowrap text-xs font-medium text-ink-2">Updated {formatRelative(at, prefs)}</span>;
}

/** Data older than this refetches when the window comes back into focus (spec 2.2 Realtime). */
export const STALE_AFTER_MS = 60_000;

/** Calls `refetch` on focus or on the tab becoming visible, when the data is older than 60 seconds. */
export function useStaleRefetch(refetch: () => void, loadedAt: number | null) {
  const ref = useRef({ refetch, loadedAt });
  useEffect(() => {
    ref.current = { refetch, loadedAt };
  });
  useEffect(() => {
    const onFocus = () => {
      const { refetch: run, loadedAt: at } = ref.current;
      if (document.visibilityState !== "visible") return;
      if (at !== null && Date.now() - at > STALE_AFTER_MS) run();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);
}

/** A console modal at one of the design system's widths. Esc, the X and an outside click close it unless `busy`. */
export function ConsoleModal({
  open,
  onClose,
  width,
  title,
  description,
  busy = false,
  children,
  footer,
  onSubmit,
  initialFocus = true,
}: {
  open: boolean;
  onClose: () => void;
  width: 400 | 560 | 720;
  title: ReactNode;
  description?: ReactNode;
  busy?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  onSubmit?: () => void;
  /** False keeps Radix from focusing the first control (a field focuses itself). */
  initialFocus?: boolean;
}) {
  const w = width === 400 ? "max-w-[400px]" : width === 560 ? "max-w-[560px]" : "max-w-[720px]";
  const body = (
    <>
      <DialogTitle className="pe-8 text-lg font-semibold text-ink">{title}</DialogTitle>
      {description ? <DialogDescription className="text-base text-ink-2">{description}</DialogDescription> : null}
      {children}
      {footer ? <div className="mt-2 flex items-center justify-end gap-2">{footer}</div> : null}
    </>
  );
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent
        className={cn(w, "os-chrome gap-3 border-line bg-raised p-6 text-ink")}
        onOpenAutoFocus={initialFocus ? undefined : (e) => e.preventDefault()}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
      >
        {onSubmit ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) onSubmit();
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy) {
                e.preventDefault();
                onSubmit();
              }
            }}
          >
            {body}
          </form>
        ) : (
          <div className="flex flex-col gap-3">{body}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "..." > About this page: a 400 modal of text with one ghost Close. */
export function AboutDialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <ConsoleModal
      open={open}
      onClose={onClose}
      width={400}
      title={title}
      footer={<button type="button" onClick={onClose} className={BTN_GHOST}>Close</button>}
    >
      <div className="text-base leading-relaxed text-ink-2">{children}</div>
    </ConsoleModal>
  );
}

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
}

/** A 400 confirm with a destructive primary. Esc and Cancel never confirm. */
export function ConfirmDialog({
  request,
  busy = false,
  onConfirm,
  onCancel,
}: {
  request: ConfirmRequest | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConsoleModal
      open={!!request}
      onClose={onCancel}
      width={400}
      busy={busy}
      title={
        <span className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-danger-bg">
            <AlertTriangle className="h-4 w-4 text-danger-text" strokeWidth={1.5} aria-hidden />
          </span>
          {request?.title}
        </span>
      }
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={busy} className={BTN_GHOST}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className={BTN_DANGER}>
            {busy ? <PendingDots /> : null}
            {request?.confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-base leading-relaxed text-ink-2">{request?.body}</div>
    </ConsoleModal>
  );
}

/** The inline failure row inside a card: "Could not load companies. Retry". */
export function InlineRetry({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-row text-ink-2">
      {text}
      <button type="button" onClick={onRetry} className={TEXT_LINK}>Retry</button>
    </span>
  );
}

/*
 * The company names the console's lists have already shown, by id, so the
 * company drawer opened from a row names the company in its header before
 * its own fetch returns (spec 2.3). Module scope: it lives as long as the tab
 * and holds only names this staff member's own lists were sent.
 */
const knownNames = new Map<string, string>();
export function rememberCompanyNames(companies: readonly ({ id: string; name: string } | null | undefined)[]): void {
  for (const c of companies) if (c?.id && c.name) knownNames.set(c.id, c.name);
  if (knownNames.size > 2000) knownNames.clear();
}
export function knownCompanyName(id: string): string | null {
  return knownNames.get(id) ?? null;
}

/**
 * A list page's own query string. While the company drawer is open over the
 * list (the @drawer intercept) the URL is the company's, so the list would
 * otherwise read the company URL's search params, drop its filters and
 * refetch unfiltered behind the drawer (spec 2.2: the list stays mounted with
 * its filters). Off its own path, this keeps the last query the list had.
 */
export function useListSearchKey(listPath: string): { spKey: string; onList: boolean } {
  const pathname = usePathname() || listPath;
  const live = useSearchParams().toString();
  const onList = pathname === listPath;
  const [kept, setKept] = useState(live);
  if (onList && kept !== live) setKept(live);
  return { spKey: onList ? live : kept, onList };
}

/** A 32px ghost "..." for a table row, handing its own button back as the menu's anchor. */
export function RowMenuTrigger({
  onOpen,
  open,
  label,
}: {
  onOpen: (ref: React.RefObject<HTMLButtonElement | null>) => void;
  open?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return <RowMoreButton buttonRef={ref} open={open} onClick={() => onOpen(ref)} label={label} />;
}

/** Copy to the clipboard with a toast either way. */
export function useCopy(toast: (msg: string, opts?: { tone?: "danger" }) => void) {
  return useCallback(
    async (text: string, what: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast(`${what} copied`);
      } catch {
        toast(`Couldn't copy the ${what.toLowerCase()}`, { tone: "danger" });
      }
    },
    [toast],
  );
}

/** A view pill's count: rendered only once the server has answered. */
export function ViewCount({ n }: { n: number | null | undefined }) {
  if (n == null) return null;
  return <span className="text-xs font-medium tabular-nums text-ink-2">{new Intl.NumberFormat().format(n)}</span>;
}

/** Download a server CSV (an authenticated same-origin GET) as a file. */
export function downloadHref(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

"use client";

// Small shared pieces for the My settings pages and their dialogs, on the
// design tokens (no literal hex, no Loader2): the four button weights, the
// four-dot pending glyph, the label chip, the outcome line, the 36px text
// input and the dialog frame the
// account dialogs share (ui/dialog underneath, so pickers inside stay DOM
// children and focus stays trapped).

import { forwardRef, useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
// The borderless buttons carry SettingsRow's ghost marker: where a row
// stacks on a phone, a ghost control's text lines up with the label
// (settings-cleanup Phase 3 review, L7).
import { GHOST_MARK } from "@/components/settings/settings-row";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-focus)]";

export const btn = {
  primary: cn(base, "h-9 bg-brand px-4 text-white hover:bg-brand-hover"),
  secondary: cn(base, "h-8 border border-line-strong bg-raised px-3 text-ink hover:bg-hover"),
  ghost: cn(base, GHOST_MARK, "h-8 px-3 text-ink-2 hover:bg-hover hover:text-ink"),
  danger: cn(base, "h-9 bg-[var(--os-danger-solid)] px-4 text-white hover:opacity-90"),
  dangerGhost: cn(base, GHOST_MARK, "h-8 px-3 text-danger-text hover:bg-[var(--os-danger-bg)]"),
  link: "text-sm font-medium text-brand-deep underline-offset-4 hover:underline",
};

/** The four-dot pending glyph (design-system 5.10), sized for a button. */
export function Pending({ label = "Working" }: { label?: string }) {
  return (
    <span className="os-pending" role="status" aria-label={label}>
      <i /><i /><i /><i />
    </span>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextInput({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid ? true : undefined}
        className={cn(
          // At most 560 (settings-cleanup B1): a card fills its 760 column, an
          // input keeps its own width and never stretches across it.
          "h-9 w-full max-w-[560px] rounded-md border bg-raised px-3 text-base text-ink placeholder:text-ink-3 outline-none focus:shadow-[0_0_0_3px_var(--os-focus-halo)]",
          invalid ? "border-[var(--os-danger-solid)]" : "border-line-strong focus:border-brand",
          className,
        )}
        {...rest}
      />
    );
  },
);

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">
      {children}
    </label>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-danger-text">
      {children}
    </p>
  );
}

/**
 * A neutral 12/500 label chip (design-system 5.9) beside a row's label:
 * "Primary" on a calendar, "Not checked by WorkwrK" on an AI app. The look
 * of the Coming soon chip, so a label chip is one thing everywhere.
 */
export const TAG = "inline-flex h-5 shrink-0 items-center rounded-sm border border-line bg-subtle px-1.5 text-xs font-medium text-ink-2";

/**
 * One outcome line inside a card, never a box (settings-cleanup B4): an
 * icon and 13px text, success in --os-ink-2 with a green tick, a problem in
 * --os-danger-text with a warning sign. A connect that worked or did not,
 * a connection that stopped working. `children` may end with its own link.
 */
export function OutcomeLine({ tone, children, role }: { tone: "ok" | "bad"; children: ReactNode; role?: "status" | "alert" }) {
  return (
    <p role={role} className={cn("m-0 flex items-start gap-2 text-sm", tone === "ok" ? "text-ink-2" : "text-danger-text")}>
      {tone === "ok" ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-text" strokeWidth={2} aria-hidden />
      ) : (
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      )}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** A banner inside a dialog for a server error (never a raw stack). */
export function DialogBanner({ tone = "danger", children }: { tone?: "danger" | "info"; children: ReactNode }) {
  if (!children) return null;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-md px-3 py-2 text-sm",
        tone === "danger" ? "bg-[var(--os-danger-bg)] text-danger-text" : "bg-[var(--os-brand-soft)] text-ink",
      )}
    >
      {children}
    </div>
  );
}

/**
 * The account dialog frame: 400px (confirm) or 560px (form), a 16/600 title,
 * an optional one-line description, the body and a footer row. `dismissable`
 * false removes every way out but the footer (the Security hold dialog);
 * `onEscape` lets a dialog confirm before closing (unsaved backup codes).
 */
export function AccountDialog({
  open,
  onOpenChange,
  title,
  description,
  width = 560,
  children,
  footer,
  dismissable = true,
  onEscape,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  width?: 400 | 560;
  children?: ReactNode;
  footer?: ReactNode;
  dismissable?: boolean;
  onEscape?: (e: KeyboardEvent) => void;
}) {
  // Focus goes back to what had it when the dialog opened (settings-cleanup
  // fix M2). These dialogs open from state, never from a Radix Dialog.Trigger,
  // and with no trigger Radix's own close step focuses nothing, so focus fell
  // to the page: a Rail apps picker that asked "Change who sees Planner?"
  // lost its place on Cancel. Read in a layout effect, before the dialog's
  // focus scope moves focus inside it.
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open || typeof document === "undefined") return;
    const a = document.activeElement;
    returnTo.current = a instanceof HTMLElement && a !== document.body ? a : null;
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(v) => { if (dismissable || v) onOpenChange(v); }}>
      <DialogContent
        className={cn(
          "gap-0 p-0 text-ink",
          width === 400 ? "max-w-[400px]" : "max-w-[560px]",
          !dismissable && "[&>button:last-child]:hidden",
          "max-[640px]:bottom-0 max-[640px]:top-auto max-[640px]:max-h-[100dvh] max-[640px]:w-full max-[640px]:max-w-none max-[640px]:translate-y-0 max-[640px]:rounded-b-none",
        )}
        onEscapeKeyDown={(e) => {
          // A Picker open inside the dialog (the office's time zone) is
          // closed alone by ui/dialog before this runs (dialog-escape.ts),
          // never the dialog with the draft in it; a popover open behind
          // the dialog is not, so this no longer asks the stack itself
          // (final Settings review, L5: it closed that popover instead).
          if (!dismissable) { e.preventDefault(); return; }
          onEscape?.(e);
        }}
        onPointerDownOutside={(e) => { if (!dismissable) e.preventDefault(); }}
        onInteractOutside={(e) => { if (!dismissable) e.preventDefault(); }}
        onCloseAutoFocus={(e) => {
          const back = returnTo.current;
          returnTo.current = null;
          if (back && back.isConnected) {
            e.preventDefault();
            back.focus({ preventScroll: true });
          }
        }}
      >
        <div className="flex min-h-14 items-center border-b border-line px-5 pe-12">
          <DialogTitle className="text-lg font-semibold text-ink">{title}</DialogTitle>
        </div>
        <div className="flex flex-col gap-4 px-5 py-5">
          {description ? <DialogDescription className="text-base text-ink-2">{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
          {children}
        </div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3 max-[640px]:sticky max-[640px]:bottom-0 max-[640px]:bg-raised">
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

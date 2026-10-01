"use client";

// Small shared pieces for the My settings pages and their dialogs, on the
// design tokens (no literal hex, no Loader2): the four button weights, the
// four-dot pending glyph, the 36px text input and the dialog frame the
// account dialogs share (ui/dialog underneath, so pickers inside stay DOM
// children and focus stays trapped).

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-focus)]";

export const btn = {
  primary: cn(base, "h-9 bg-brand px-4 text-white hover:bg-brand-hover"),
  secondary: cn(base, "h-8 border border-line-strong bg-raised px-3 text-ink hover:bg-hover"),
  ghost: cn(base, "h-8 px-3 text-ink-2 hover:bg-hover hover:text-ink"),
  danger: cn(base, "h-9 bg-[var(--os-danger-solid)] px-4 text-white hover:opacity-90"),
  dangerGhost: cn(base, "h-8 px-3 text-danger-text hover:bg-[var(--os-danger-bg)]"),
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
          "h-9 w-full rounded-md border bg-raised px-3 text-base text-ink placeholder:text-ink-3 outline-none focus:shadow-[0_0_0_3px_var(--os-focus-halo)]",
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
          if (!dismissable) { e.preventDefault(); return; }
          onEscape?.(e);
        }}
        onPointerDownOutside={(e) => { if (!dismissable) e.preventDefault(); }}
        onInteractOutside={(e) => { if (!dismissable) e.preventDefault(); }}
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

"use client";

// ChromePopover: the one non-modal overlay container the frame's menus use
// (the Create menu, the bell, Help, the avatar menu, the workspace menu). A
// Radix Popover so focus is trapped and returned and outside-click closes it,
// registered in the LayerStack so Esc closes the top layer only (spec-shell
// 1.5), styled once on tokens (design-system 5.6).

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useLayer, type LayerKind } from "./shell-context";

export function ChromePopover({
  open,
  onOpenChange,
  trigger,
  children,
  width = 280,
  align = "end",
  side = "bottom",
  sideOffset = 6,
  className,
  layerId,
  kind = "popover",
  ariaLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  width?: number;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  className?: string;
  layerId: string;
  kind?: LayerKind;
  ariaLabel?: string;
}) {
  useLayer(open, { id: layerId, kind, close: () => onOpenChange(false) });
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={8}
          aria-label={ariaLabel}
          style={{ width }}
          className={cn(
            "workwrk-os os-chrome os-portal-panel z-[60] rounded-lg border border-line bg-raised text-ink shadow-[var(--os-shadow-pop)] outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            className,
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** A 32px chrome icon button: the bar's hit area, icons 20px chrome-fg-2. */
export function ChromeIconButton({
  label, children, onClick, className, ref, active, ...rest
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  active?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className" | "children">) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-chrome-fg-2 hover:bg-chrome-hov hover:text-chrome-fg",
        active && "bg-chrome-hov text-chrome-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

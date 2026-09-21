"use client";

// SidebarCreateMenu — the generic per-app "+" popover. Renders whatever
// CreateAction rows the active app declared (AppEntry.createActions) on
// the shared MenuList/MenuItem/MorePortal primitives so no app hand-rolls
// its own menu. Apps with exactly ONE visible action never see this —
// hub-sidebar fires the action directly. Apps with none render no "+".
//
// Also exports the two pieces hub-sidebar needs for the single-action
// path: useCreateActionContext (shell helpers) and runCreateAction (the
// onSelect > href > event resolution order).

import { useMemo, useRef, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { MorePortal } from "./more-portal";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { useOsShell } from "./shell-context";
import { useOsToast } from "./toast";
import { usePrompt } from "@/components/ui/dialog-provider";
import { Fragment } from "react";
import { NEW_EVENT_PREFIX, type CreateAction, type CreateActionContext } from "./apps-catalog";

/**
 * The icon-tile tint when a row names none.
 *
 * `var(--os-brand)` and not a hex literal: the brand colour is a token that
 * the theme picker rebinds and that dark mode re-points, so a hardcoded
 * #0073EA is a colour that stops following the workspace. It is read as a
 * custom property because the tint is composed at runtime
 * (`color-mix` for the 10 percent wash behind the glyph).
 */
const BRAND_TINT = "var(--os-brand)";

/** Shell helpers every CreateAction runs with (router push, quick-task modal, …). */
export function useCreateActionContext(): CreateActionContext {
  const router = useRouter();
  const { openCreateTask, bumpRowVersion } = useOsShell();
  const { toast } = useOsToast();
  const prompt = usePrompt();
  return useMemo(
    () => ({
      push: (href: string) => router.push(href),
      toast,
      prompt,
      openCreateTask,
      bumpRowVersion,
    }),
    [router, toast, prompt, openCreateTask, bumpRowVersion],
  );
}

/** Resolve one action: custom onSelect wins, then href, then window event. */
export function runCreateAction(action: CreateAction, ctx: CreateActionContext) {
  if (action.onSelect) {
    void action.onSelect(ctx);
    return;
  }
  if (action.href) {
    ctx.push(action.href);
    return;
  }
  if (action.event && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(`${NEW_EVENT_PREFIX}${action.event}`));
  }
}

export function SidebarCreateMenu({
  anchorRef,
  open,
  onClose,
  actions,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
  actions: CreateAction[];
}) {
  const ctx = useCreateActionContext();
  const panelRef = useRef<HTMLDivElement>(null);
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <MorePortal anchorRef={anchorRef} panelRef={panelRef} width={264} open={open} placement="below">
        {/* Tokens, not zinc and not white: this panel has to follow the theme
            and dark mode like every other popover (design-system section 1). */}
        <div className="overflow-hidden rounded-xl border border-line bg-raised p-2 shadow-[var(--os-shadow-pop)]">
          <MenuList>
            {actions.map((action, i) => {
              const Icon = action.icon ?? Plus;
              const tint = action.iconColor ?? BRAND_TINT;
              // A rule above the first rendered row would be a line under the
              // menu's own top edge, so it is dropped at index 0. That happens
              // whenever every row before the separator was gated away.
              const rule = action.separatorBefore && i > 0;
              return (
                <Fragment key={action.label}>
                {rule ? <li className="my-1 h-px bg-line" role="separator" /> : null}
                <MenuItem
                  variant="inset"
                  leading={
                    <span
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                      style={{ background: `color-mix(in srgb, ${tint} 10%, transparent)` }}
                    >
                      <Icon className="h-3.5 w-3.5" style={{ color: tint }} />
                    </span>
                  }
                  label={action.label}
                  description={action.description}
                  onClick={() => {
                    onClose();
                    runCreateAction(action, ctx);
                  }}
                />
                </Fragment>
              );
            })}
          </MenuList>
        </div>
      </MorePortal>
    </>
  );
}

"use client";

// SidebarCreateMenu — the generic per-app "+" popover. Renders whatever
// CreateAction rows the active app declared (AppEntry.createActions) on
// the shared MenuList/MenuItem/MorePortal primitives so no app hand-rolls
// its own menu. Apps with exactly ONE visible action never see this —
// click-sidebar fires the action directly. Apps with none render no "+".
//
// Also exports the two pieces click-sidebar needs for the single-action
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
import { NEW_EVENT_PREFIX, type CreateAction, type CreateActionContext } from "./apps-catalog";

const BRAND_BLUE = "#0073EA";

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
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_14px_34px_rgba(0,0,0,0.14)] p-2">
          <MenuList>
            {actions.map((action) => {
              const Icon = action.icon ?? Plus;
              const tint = action.iconColor ?? BRAND_BLUE;
              return (
                <MenuItem
                  key={action.label}
                  variant="inset"
                  leading={
                    <span
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                      style={{ background: `${tint}1a` }}
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
              );
            })}
          </MenuList>
        </div>
      </MorePortal>
    </>
  );
}

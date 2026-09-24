"use client";

// SheetMenuBar (spec-tables-forms section 2 /tables/[id], "Menu bar 36"):
// the six MenuList triggers of the sheet, File · Edit · View · Insert ·
// Format · Data, at 14/400 ink with a 6px-radius hover. It sits in the
// design system's views-row slot, which a table leaves free (a table has one
// view and no "+ View").
//
//   - Click opens a menu under its trigger; with one open, hovering another
//     trigger switches to it (Sheets' behaviour), Left and Right move between
//     menus, Down or Enter on a focused trigger opens it, Esc closes.
//   - Under 900px the six collapse into one 36px "Menu" button whose panel
//     nests each menu as a submenu (spec section 1, Mobile and narrow).
//   - A row the viewer's role cannot use is ABSENT from the spec the page
//     passes, never disabled; the one exception is a row blocked for a
//     temporary reason (a stream in flight), which carries its reason as a
//     tooltip.
//
// Presentational: every row is a handler the page owns.

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Menu as MenuIcon, type LucideIcon } from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSeparator, MenuSubmenu } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { tidyMenu } from "@/lib/sheet-menu";

export { tidyMenu };

export type SheetMenuItem =
  | { separator: true }
  | {
      label: string;
      icon?: LucideIcon;
      shortcut?: string;
      onSelect?: () => void;
      /** A check on the right: a View toggle or the current choice. */
      checked?: boolean;
      destructive?: boolean;
      /** Temporarily blocked; `title` names why. */
      disabled?: boolean;
      title?: string;
      /** A nested menu (Download, Freeze, Zoom, Number, ...). */
      submenu?: SheetMenuItem[];
      /** Any leading node (a colour swatch). */
      leading?: ReactNode;
    };

export interface SheetMenuSpec {
  key: string;
  label: string;
  items: SheetMenuItem[];
}

function Rows({ items, close, onSelected }: { items: SheetMenuItem[]; close: () => void; onSelected?: () => void }) {
  return (
    <>
      {tidyMenu(items).map((it, i) => {
        if ("separator" in it) return <MenuSeparator key={`sep-${i}`} />;
        if (it.submenu && it.submenu.length > 0) {
          return (
            <MenuSubmenu key={it.label} icon={it.icon} label={it.label} width={220}>
              <Rows items={it.submenu} close={close} onSelected={onSelected} />
            </MenuSubmenu>
          );
        }
        return (
          <MenuItem
            key={it.label}
            icon={it.icon}
            leading={it.leading}
            label={it.label}
            shortcut={it.shortcut}
            selected={it.checked}
            destructive={it.destructive}
            disabled={it.disabled}
            title={it.title}
            role={it.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
            onClick={() => { if (it.disabled) return; close(); it.onSelect?.(); onSelected?.(); }}
          />
        );
      })}
    </>
  );
}

const TRIGGER = "inline-flex h-8 items-center rounded-md px-3 text-base text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-[var(--os-focus)]";

/**
 * `onAfterSelect` runs after any item's own onSelect. It exists because the
 * menu is a portal: choosing an item unmounts the list that held focus, so
 * focus fell to <body> and the next keys went nowhere (Insert > Row below,
 * then typing, did nothing until a click). The page passes a handler that
 * returns focus to the grid only if nothing else has claimed it, so an item
 * that opens a dialog keeps the dialog's focus.
 */
export function SheetMenuBar({ menus, className, onAfterSelect }: { menus: SheetMenuSpec[]; className?: string; onAfterSelect?: () => void }) {
  // The open menu and the trigger it hangs under, set together from events
  // (never read from a ref during render).
  const [openState, setOpenState] = useState<{ key: string; el: HTMLElement | null } | null>(null);
  const open = openState?.key ?? null;
  const [narrowOpen, setNarrowOpen] = useState(false);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const narrowRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpenState(null), []);
  const setOpen = useCallback((next: string | null | ((cur: string | null) => string | null)) => {
    setOpenState((cur) => {
      const key = typeof next === "function" ? next(cur?.key ?? null) : next;
      return key ? { key, el: triggerRefs.current[key] ?? null } : null;
    });
  }, []);
  const visible = menus.filter((m) => tidyMenu(m.items).length > 0);

  const move = (from: string, dir: 1 | -1) => {
    const i = visible.findIndex((m) => m.key === from);
    const next = visible[(i + dir + visible.length) % visible.length];
    if (!next) return;
    setOpen(next.key);
    triggerRefs.current[next.key]?.focus();
  };

  const openMenu = open ? visible.find((m) => m.key === open) : null;
  const anchorEl = openState?.el ?? null;
  const anchor = useMemo(() => ({ current: anchorEl }), [anchorEl]);

  return (
    <div className={cn("os-chrome flex h-9 shrink-0 items-center gap-1 px-4", className)}>
      {/* Wide: six triggers. */}
      <div role="menubar" aria-label="Table menus" className="flex items-center gap-1 max-[900px]:hidden">
        {visible.map((m) => (
          <button
            key={m.key}
            ref={(el) => { triggerRefs.current[m.key] = el; }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === m.key}
            className={cn(TRIGGER, open === m.key && "bg-active")}
            onClick={() => setOpen((o) => (o === m.key ? null : m.key))}
            onMouseEnter={() => { if (open && open !== m.key) setOpen(m.key); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(m.key); }
              else if (e.key === "ArrowRight") { e.preventDefault(); if (open) move(m.key, 1); else { const i = visible.findIndex((x) => x.key === m.key); triggerRefs.current[visible[(i + 1) % visible.length].key]?.focus(); } }
              else if (e.key === "ArrowLeft") { e.preventDefault(); if (open) move(m.key, -1); else { const i = visible.findIndex((x) => x.key === m.key); triggerRefs.current[visible[(i - 1 + visible.length) % visible.length].key]?.focus(); } }
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      {openMenu ? (
        <MorePortal key={openMenu.key} anchorRef={anchor} width={260} open placement="below" onClose={close}>
          <div
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") { e.preventDefault(); move(openMenu.key, 1); }
              else if (e.key === "ArrowLeft") { e.preventDefault(); move(openMenu.key, -1); }
            }}
          >
            <MenuList aria-label={openMenu.label} style={{ minWidth: 260 }}>
              <Rows items={openMenu.items} close={close} onSelected={onAfterSelect} />
            </MenuList>
          </div>
        </MorePortal>
      ) : null}

      {/* Narrow: one "Menu" button nesting the six. */}
      <button
        ref={narrowRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={narrowOpen}
        onClick={() => setNarrowOpen((o) => !o)}
        className={cn(TRIGGER, "gap-2 min-[901px]:hidden", narrowOpen && "bg-active")}
      >
        <MenuIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        Menu
        <ChevronDown className="h-3.5 w-3.5 text-ink-2" strokeWidth={1.5} aria-hidden />
      </button>
      {narrowOpen ? (
        <MorePortal anchorRef={narrowRef} width={240} open placement="below" onClose={() => setNarrowOpen(false)}>
          <MenuList aria-label="Table menus" style={{ minWidth: 240 }}>
            {visible.map((m) => (
              <MenuSubmenu key={m.key} label={m.label} width={240}>
                <Rows items={m.items} close={() => setNarrowOpen(false)} onSelected={onAfterSelect} />
              </MenuSubmenu>
            ))}
          </MenuList>
        </MorePortal>
      ) : null}
    </div>
  );
}

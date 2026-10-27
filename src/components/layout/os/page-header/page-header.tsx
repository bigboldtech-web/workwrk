"use client";

// OsPageHeader, OsViewsRow, OsToolbar: the one page pattern (design-system
// 4.4, spec-shell 1.15). Three thin rows on the white canvas, padding-inline
// 24, always in this order:
//
//   title row 40   [Back] [tile] Title            ghost actions  [Ask AI]
//   views row 36   text-tab pills (only when a surface has more than one view)
//   toolbar 44     Filter  Sort  Group | view switcher      [+ Primary] [...]
//
// The title row was 48 with a 22px title and a 36px tile until 2026-09-24,
// when the founder read the header as too big; it is now 40 with an 18px
// title (text-title) and a 20px tile, and the view pills are 28 / 14.
//
// Real props only. There is no description line (it lives in "..." > About),
// no fake people, no inert Share / Invite trio, no filled star. The Ask AI
// slot renders only when the AI hub is visible to the viewer; otherwise the
// slot is empty, never a disabled button. The one blue button on a page is
// the toolbar's `primary`, whose handler is required by the type, so a page
// can never render a control that does nothing.
//
// Sizing: the header is drawn on the 4px grid in px like the rest of the
// frame. Its root carries `.os-chrome` (tokens.css), which rebinds the
// spacing and radius variables the Tailwind utilities read, so under the
// product's 14px root h-10 / h-9 / h-11 / px-6 render at 40 / 36 / 44 / 24
// and not at 87.5% of that. Anything a page drops into `actions`, `left`
// or `right` inherits the same scale.

import Link from "next/link";
import { createElement, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  Funnel,
  MoreHorizontal,
  Plus,
  Rows3,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EntityTile, type EntityTileProps } from "@/components/ui/entity-tile";
import { BackButton } from "@/components/ui/back-button";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { Picker } from "@/components/ui/picker";
import { returnFocusOnClose } from "@/components/ui/return-focus";
import { MorePortal } from "../more-portal";
import { useLayer, useLayerStack, useOsShell } from "../shell-context";
import { askSidekick } from "../empty-view";
import { SHELL_LABELS } from "@/lib/nav/labels";

/* ───────────────────────────── types ───────────────────────────── */

/** A handler is required: a rendered control always does something. */
export type ActionHandler =
  | { onClick: () => void; href?: undefined }
  | { href: string; onClick?: undefined };

/** The one blue button (36px, --os-brand, 16px Plus by default). */
export type PrimaryAction = ActionHandler & {
  label: string;
  /** `href` is a plain document URL (an API export), not a client route. */
  external?: boolean;
  /** Defaults to Plus. */
  icon?: LucideIcon | null;
  /** In flight: the label stays, a monochrome four-dot mini-loader replaces the icon. */
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  /** A fused 36px chevron half ("Create from template", a kind chooser). */
  split?: { label: string; onClick: () => void };
};

export type HeaderMenuEntry =
  | ({
      label: string;
      icon?: LucideIcon;
      destructive?: boolean;
      disabled?: boolean;
      title?: string;
      /**
       * A Display-menu switch rather than a command: the row keeps ONE name
       * ("Notes", not "Show notes" flipping to "Hide notes") and carries the
       * state as a check, so the menu says what is on instead of what the
       * next click would do. Rendered as role="menuitemcheckbox".
       */
      checked?: boolean;
      /** A checkable row stays open so several can be toggled in one visit. */
      keepOpen?: boolean;
    } & ActionHandler)
  | { separator: true };

export interface ViewSwitcherOption {
  key: string;
  label: string;
  icon: LucideIcon;
}

export interface OsToolbarProps {
  /** The Filter chip: a 36px toggle that opens the FilterPanel. */
  filter?: { open: boolean; onToggle: () => void; count?: number };
  /**
   * The Sort control: a 36px ghost chip. With `options` the chip opens the
   * orders itself, in the one Picker anchored under the chip (SortChip);
   * without them `onClick` is the page's own.
   */
  sort?: {
    onClick?: () => void;
    label?: string;
    active?: boolean;
    /** The orders the chip offers, default first. */
    options?: readonly { value: string; label: string }[];
    /** The order in force. */
    value?: string;
    onChange?: (value: string) => void;
    /** Names the list of orders ("Sort people"). */
    menuLabel?: string;
  };
  /** Group (Board and List surfaces only). */
  group?: { onClick: () => void; label?: string; active?: boolean };
  /** The view-type switcher: a run of 32px icon buttons. */
  switcher?: { value: string; options: ViewSwitcherOption[]; onChange: (key: string) => void };
  /** Page-owned controls at the left (a period stepper, a segmented control, a search field). */
  left?: ReactNode;
  /** Page-owned ghost or secondary controls at the right, before the primary. */
  right?: ReactNode;
  primary?: PrimaryAction;
  /** The bordered "..." square: Display, Import, Export, Automations, Settings. */
  menu?: HeaderMenuEntry[];
  className?: string;
}

export interface OsPageHeaderProps {
  title: string;
  /**
   * Replaces the h1 with a caller-drawn title (an input with the same
   * metrics in edit mode, or the title followed by its status and kind
   * chips). `title` stays the accessible name and the document title.
   */
  titleSlot?: ReactNode;
  /** `EntityTile size="md"` before the title (Space and List pages). */
  tile?: EntityTileProps;
  /** Full pages reached from a list: the parent name and where to land with no history. */
  back?: { fallbackHref: string; label: string };
  /** Ghost page actions (Share, Copy link, Edit). Real controls only. */
  actions?: ReactNode;
  /**
   * Secondary page actions behind a 28px ghost "..." at the end of the title
   * row (design-system 4.4: "Share, ..."), so a detail page with many actions
   * keeps its title readable at tablet width. Doc pages have no toolbar, so
   * this is their only overflow.
   */
  more?: HeaderMenuEntry[];
  /** The Ask AI slot. Renders only when the AI hub is visible to the viewer. */
  askAi?: boolean | { prompt?: string };
  /** `AutosaveIndicator` on autosaving surfaces (design-system 5.17). */
  autosave?: ReactNode;
  /** The views row: `ViewTab` pills. Omit on single-view surfaces. */
  views?: ReactNode;
  /** Right end of the views row: the ghost "+ View", an overflow, a live dot. */
  viewsTrailing?: ReactNode;
  /** The toolbar row. Renders when given, or when `primary` / `menu` are. */
  toolbar?: OsToolbarProps;
  /** Shorthand for `toolbar.primary`. */
  primary?: PrimaryAction;
  /** Shorthand for `toolbar.menu`. */
  menu?: HeaderMenuEntry[];
  className?: string;
  /** Test and layout hook. */
  id?: string;
}

/* ─────────────────────────── shared bits ─────────────────────────── */

const GHOST_28 =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink";

const CHIP_36 =
  "inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink";

/**
 * The toolbar's toggle chip (Filter, Sort, Group), for a toggle that lives
 * in a settings row instead (Locale's working days): the same chip at the
 * 32px a row control takes (settings-cleanup B5 and Phase 5), `--os-active`
 * with `--os-ink` while pressed. One look for every toggle chip.
 *
 * `outlined` is for a ROW of toggles read side by side (the seven working
 * days), where the pale pressed fill alone (about 1.24:1 on the card) is no
 * state cue and hover used to wash it out: a 1px `--os-ink` border while
 * pressed and `--os-line-strong` while not, and the pressed fill kept on
 * hover (Phase 5 review, M1). The toolbar's chips never pass it, so they are
 * unchanged.
 */
export function toggleChipClass(pressed: boolean, opts: { outlined?: boolean } = {}): string {
  return cn(
    CHIP_36,
    "h-8",
    pressed && "bg-active text-ink",
    opts.outlined && (pressed ? "border border-ink hover:bg-active" : "border border-line-strong"),
  );
}

/** The monochrome four-dot mini-loader that replaces a button's icon in flight. */
function PendingDots() {
  return (
    <span className="os-pending" role="status" aria-label="Working">
      <i /><i /><i /><i />
    </span>
  );
}

/**
 * The Ask AI slot: 28px ghost, Sparkles, label "Ask AI". Present only when
 * the AI hub is visible to the viewer (the create menu uses the same read).
 */
function AskAiSlot({ prompt }: { prompt?: string }) {
  const { askAiVisible } = useOsShell();
  const entitled = askAiVisible;
  if (!entitled) return null;
  return (
    <button type="button" onClick={() => askSidekick(prompt)} className={GHOST_28} title={`${SHELL_LABELS.askAi} (⌘J)`}>
      <Sparkles className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      {SHELL_LABELS.askAi}
    </button>
  );
}

/* ───────────────────────────── title row ───────────────────────────── */

export function OsPageHeader({
  title,
  titleSlot,
  tile,
  back,
  actions,
  more,
  askAi,
  autosave,
  views,
  viewsTrailing,
  toolbar,
  primary,
  menu,
  className,
  id,
}: OsPageHeaderProps) {
  const toolbarProps: OsToolbarProps | null =
    toolbar || primary || menu ? { ...(toolbar ?? {}), primary: toolbar?.primary ?? primary, menu: toolbar?.menu ?? menu } : null;
  return (
    <div id={id} className={cn("os-head os-chrome shrink-0 bg-app", className)}>
      <div className="flex h-10 items-center gap-2 px-6">
        {/* On a phone the Back label gives way (arrow only) so the title keeps
            the room; the parent's name stays in the button's aria-label and title. */}
        {back ? <BackButton fallbackHref={back.fallbackHref} label={back.label} compactOnPhone className="me-0.5" /> : null}
        {tile ? <EntityTile size="md" {...tile} /> : null}
        {titleSlot ? (
          <div className="flex min-w-0 flex-1 items-center gap-2" aria-label={title}>{titleSlot}</div>
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-title font-semibold text-ink">{title}</h1>
        )}
        {autosave ? <div className="shrink-0">{autosave}</div> : null}
        {actions ? <div className="os-head__actions flex shrink-0 items-center gap-1">{actions}</div> : null}
        {more && more.length > 0 ? <HeaderMenu entries={more} variant="ghost" label="More page actions" /> : null}
        {askAi ? <AskAiSlot prompt={typeof askAi === "object" ? askAi.prompt : undefined} /> : null}
      </div>
      {views ? <OsViewsRow trailing={viewsTrailing}>{views}</OsViewsRow> : null}
      {toolbarProps ? <OsToolbar {...toolbarProps} /> : null}
    </div>
  );
}

/**
 * The header's pending state (spec-shell 2.2): an 18px bar 40% wide in a 40px
 * title row, optionally the skeleton views row and toolbar. A page that
 * fetches its object before it can name it renders this instead of a
 * placeholder title that swaps once the fetch lands; `loading.tsx` renders
 * it too, so the route loader and the in-page pending state are one drawing.
 */
export function OsPageHeaderSkeleton({ views = false, toolbar = false, className }: { views?: boolean; toolbar?: boolean; className?: string }) {
  const bar = "rounded bg-skeleton os-skeleton-pulse";
  return (
    <div className={cn("os-head os-chrome shrink-0 bg-app", className)} aria-busy="true" aria-label="Loading">
      <div className="flex h-10 items-center px-6">
        <span className={`${bar} h-[18px] w-[40%]`} />
      </div>
      {views ? (
        <div className="os-row flex h-9 items-center gap-2 px-6">
          <span className={`${bar} h-7 w-16`} />
          <span className={`${bar} h-7 w-20`} />
          <span className={`${bar} h-7 w-14`} />
        </div>
      ) : null}
      {toolbar ? (
        <div className="os-toolbar flex h-11 items-center gap-2 px-6">
          <span className={`${bar} h-9 w-20`} />
          <span className={`${bar} h-9 w-16`} />
          <span className="flex-1" />
          <span className={`${bar} h-9 w-28`} />
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── views row ───────────────────────────── */

/**
 * The 36px views row. Children are `ViewTab` pills; `trailing` is the ghost
 * "+ View" or the "•••" overflow. Never render it for a single-view surface.
 */
export function OsViewsRow({ children, trailing, className, "aria-label": ariaLabel }: {
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div className={cn("os-row flex h-9 min-w-0 items-center gap-1 px-6", className)}>
      <div role="tablist" aria-label={ariaLabel ?? "Views"} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto os-no-scrollbar">
        {children}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-1">{trailing}</div> : null}
    </div>
  );
}

/* ───────────────────────────── toolbar ───────────────────────────── */

function PrimaryButton({ action }: { action: PrimaryAction }) {
  const Icon = action.icon === undefined ? Plus : action.icon;
  const disabled = Boolean(action.disabled || action.busy);
  const base =
    "inline-flex h-9 items-center gap-2 bg-brand px-3 text-base font-medium text-white transition-colors duration-[var(--os-dur-fast)] hover:bg-brand-hover active:bg-brand-pressed disabled:bg-active disabled:text-ink-4";
  const shape = action.split ? "rounded-s-md" : "rounded-md";
  const inner = (
    <>
      {action.busy ? <PendingDots /> : Icon ? <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : null}
      <span>{action.label}</span>
    </>
  );
  // A disabled link leaves the tab order too (tabIndex -1), so keyboard focus
  // never lands on a control that pointer-events-none has made inert.
  const main =
    action.href !== undefined && action.external ? (
      <a href={action.href} title={action.title} className={cn(base, shape, disabled && "pointer-events-none")} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>
        {inner}
      </a>
    ) : action.href !== undefined ? (
      <Link href={action.href} title={action.title} className={cn(base, shape, disabled && "pointer-events-none")} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>
        {inner}
      </Link>
    ) : (
      <button type="button" onClick={action.onClick} title={action.title} disabled={disabled} className={cn(base, shape)}>
        {inner}
      </button>
    );
  if (!action.split) return main;
  return (
    <span className="inline-flex shrink-0 items-stretch">
      {main}
      <button
        type="button"
        onClick={action.split.onClick}
        aria-label={action.split.label}
        title={action.split.label}
        disabled={disabled}
        className="inline-flex h-9 w-9 items-center justify-center rounded-e-md border-s border-white/25 bg-brand text-white hover:bg-brand-hover active:bg-brand-pressed disabled:bg-active disabled:text-ink-4"
      >
        <ChevronDown className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </button>
    </span>
  );
}

/**
 * The "..." menu. `bordered` is the toolbar's 36px square (Display, Import,
 * Export, Automations, Settings); `ghost` is the title row's 28px overflow.
 * Esc closes it through the LayerStack; an outside pointer-down closes it
 * through a document listener, never through a full-screen backdrop that
 * would sit over the toast and modal layers.
 */
function HeaderMenu({ entries, variant = "bordered", label = "More options" }: { entries: HeaderMenuEntry[]; variant?: "bordered" | "ghost"; label?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useLayer(open, { kind: "popover", close: () => setOpen(false) });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          variant === "bordered"
            ? "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line-strong bg-raised text-ink-2 hover:bg-hover hover:text-ink"
            : cn(GHOST_28, "w-7 justify-center px-0"),
          open && "bg-active text-ink",
        )}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </button>
      <MorePortal anchorRef={btnRef} width={220} maxWidth={360} open={open} panelRef={panelRef} placement="below">
        <MenuList aria-label="Page options">
          {entries.map((e, i) =>
            "separator" in e ? (
              <MenuSeparator key={`sep-${i}`} />
            ) : (
              <MenuItem
                key={`${e.label}-${i}`}
                icon={e.icon}
                label={e.label}
                destructive={e.destructive}
                disabled={e.disabled}
                title={e.title}
                href={e.href}
                role={e.checked === undefined ? undefined : "menuitemcheckbox"}
                aria-checked={e.checked}
                selected={e.checked}
                onClick={() => {
                  if (!(e.keepOpen ?? e.checked !== undefined)) setOpen(false);
                  e.onClick?.();
                }}
              />
            ),
          )}
        </MenuList>
      </MorePortal>
    </>
  );
}

/**
 * The Sort chip's accessible name (pure; tested): its visible words first,
 * then what it is, so "Role" is read as "Role, sort order" and never as a
 * bare word; the default chip already says "Sort" and keeps its text.
 */
export function sortChipName(label: string): string | undefined {
  return label === "Sort" ? undefined : `${label}, sort order`;
}

/**
 * The Sort chip that opens its own orders (settings-cleanup Phase 4): the one
 * Picker, anchored under the chip itself (never at a hand-measured offset),
 * placed so it is seen whole (autoPlace: a phone, a short window), opening on
 * the order in force, and handing focus back to the chip after a pick, Esc
 * or a click outside, as PickerSelect does. Never a search box: the orders
 * are a short fixed list (the Picker's noSearch).
 */
function SortChip({ sort, options }: { sort: NonNullable<OsToolbarProps["sort"]>; options: readonly { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const listboxId = `sort${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const label = sort.label ?? "Sort";
  const close = (reason: "select" | "dismiss") => {
    setOpen(false);
    returnFocusOnClose(reason, triggerRef.current, wrapRef.current);
  };
  return (
    <span ref={wrapRef} className="relative inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={sortChipName(label)}
        onClick={() => setOpen((v) => !v)}
        className={cn(CHIP_36, (sort.active || open) && "bg-active text-ink")}
      >
        <ArrowUpDown className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        {label}
      </button>
      <Picker
        open={open}
        onClose={() => close("dismiss")}
        ariaLabel={sort.menuLabel ?? "Sort"}
        listboxId={listboxId}
        selected={sort.value ?? null}
        // A short fixed list of orders, read whole: no search box over it
        // (Phase 4 review, L6; People's seven orders had drawn one).
        noSearch
        autoPlace
        highlightSelected
        width={240}
        sections={[{ options: options.map((o) => ({ value: o.value, label: o.label })) }]}
        onSelect={(v) => {
          close("select");
          if (v !== sort.value) sort.onChange?.(v);
        }}
      />
    </span>
  );
}

export function OsToolbar({ filter, sort, group, switcher, left, right, primary, menu, className }: OsToolbarProps) {
  const hasLeft = Boolean(filter || sort || group || switcher || left);
  // ONE PRIMARY ON SCREEN (design-system principle 1: "while a drawer or
  // modal with its own primary is open, the page's primary is not rendered
  // at all"). Opening the create-task modal over a List put its blue "Create
  // task" beside the page's own blue "+ Create task", which is two blues
  // competing for the same click. The page's is the one that gives way,
  // because the thing in front is what the person is doing. It reads the
  // whole stack, not the top layer: a picker opened inside that modal is a
  // popover on top of it, and the modal's own primary is still showing.
  // useLayerStack, not useOsShell: the Staff console renders this header
  // with a LayerStackProvider and no product shell (shell-context.tsx).
  const blockingLayerOpen = useLayerStack()?.blockingLayerOpen ?? false;
  const primaryHidden = blockingLayerOpen;
  const shownPrimary = primaryHidden ? undefined : primary;
  return (
    // Under 768 the right cluster (search, the primary, "...") wraps onto a
    // second line instead of painting over the Filter and Sort chips: the
    // header may grow, it may never overlap itself (spec 1, Mobile / narrow).
    <div className={cn("os-toolbar flex h-11 min-w-0 items-center gap-2 px-6 max-md:h-auto max-md:min-h-11 max-md:flex-wrap max-md:py-1", className)}>
      {hasLeft ? (
        // Under 768 the left cluster is as wide as its chips (min-w-fit), not
        // squeezable to zero. With min-w-0 it shrank to whatever the right
        // cluster left, so the row never wrapped and the Table and Cards
        // switch spilled out under "..." on a 390 phone: a tap on Cards
        // opened the menu. Sized to its content, the row's flex-wrap sends
        // the right cluster to its own line instead. The cluster also wraps
        // its own chips, so one wider than the phone still stays inside it
        // (fit-content never grows past the row). Desktop keeps min-w-0 so
        // a search field in `left` still narrows beside the primary.
        <div className="flex min-w-0 flex-1 items-center gap-2 max-md:min-w-fit max-md:flex-wrap">
          {filter ? (
            <button
              type="button"
              onClick={filter.onToggle}
              aria-pressed={filter.open}
              className={cn(CHIP_36, filter.open && "bg-active text-ink")}
            >
              <Funnel className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {filter.count ? `Filter · ${filter.count}` : "Filter"}
            </button>
          ) : null}
          {sort?.options ? (
            <SortChip sort={sort} options={sort.options} />
          ) : sort ? (
            <button type="button" onClick={sort.onClick} aria-pressed={sort.active} className={cn(CHIP_36, sort.active && "bg-active text-ink")}>
              <ArrowUpDown className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {sort.label ?? "Sort"}
            </button>
          ) : null}
          {group ? (
            <button type="button" onClick={group.onClick} aria-pressed={group.active} className={cn(CHIP_36, group.active && "bg-active text-ink")}>
              <Rows3 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {group.label ?? "Group"}
            </button>
          ) : null}
          {switcher ? (
            <>
              {filter || sort || group ? <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden /> : null}
              <div role="radiogroup" aria-label="View type" className="flex items-center gap-0.5">
                {switcher.options.map((o) => {
                  const on = o.key === switcher.value;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={o.label}
                      title={o.label}
                      onClick={() => switcher.onChange(o.key)}
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-md",
                        on ? "bg-brand-soft text-brand-deep" : "text-ink-2 hover:bg-hover hover:text-ink",
                      )}
                    >
                      {createElement(o.icon, { className: "h-4 w-4", strokeWidth: 1.5, "aria-hidden": true })}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
          {left}
        </div>
      ) : (
        <div className="min-w-0 flex-1" />
      )}
      {right || shownPrimary || menu ? (
        // On its own line under 768 the right cluster is still capped at the
        // row (max-w-full) and wraps its own controls from the right. Files
        // passes a search, a split Upload and "...", 336px against a 278px
        // row on a 390 phone, and "..." was painted past the screen edge
        // where nobody could reach it.
        <div className="flex shrink-0 items-center gap-2 max-md:ms-auto max-md:max-w-full max-md:flex-wrap max-md:justify-end">
          {right}
          {shownPrimary ? <PrimaryButton action={shownPrimary} /> : null}
          {menu && menu.length > 0 ? <HeaderMenu entries={menu} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** A 28px ghost action for the title row's `actions` slot (Share, Copy link, Edit). */
export type HeaderActionProps = ActionHandler & {
  /** Omit for an icon-only 28px square; then `aria-label` is the name. */
  label?: ReactNode;
  icon?: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  "aria-label"?: string;
};

export function HeaderAction({
  label, icon, onClick, href, active, disabled, title, className, "aria-label": ariaLabel,
}: HeaderActionProps) {
  const cls = cn(GHOST_28, !label && "w-7 justify-center px-0", active && "bg-active text-ink", disabled && "pointer-events-none text-ink-4", className);
  const inner = (
    <>
      {icon ? createElement(icon, { className: "h-4 w-4", strokeWidth: 1.5, "aria-hidden": true }) : null}
      {label}
    </>
  );
  if (href) {
    // A disabled link is not a link: no navigation, no tab stop, same look.
    if (disabled) {
      return (
        <span className={cls} title={title} aria-label={ariaLabel} aria-disabled="true">
          {inner}
        </span>
      );
    }
    return (
      <Link href={href} className={cls} title={title} aria-label={ariaLabel} aria-current={active ? "page" : undefined}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls} title={title} aria-label={ariaLabel} aria-pressed={active}>
      {inner}
    </button>
  );
}

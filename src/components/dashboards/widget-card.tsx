"use client";

// A dashboard card, in monday's grammar, with two chromes:
//
//   dashboard  the /dashboards/[id] canvas: a surface card, 1px line, radius
//              12, a 40px header (a grip on hover for editors, the title
//              15/500, a funnel when a filter is on, a 28px "..." for
//              editors: Settings, Rename, Delete)
//   overview   a Space's Overview tab: the look of the built-in Overview
//              cards (rounded, 1px line, 16px padding, a 12/600 title in a
//              `dash-card-handle` header) so widgets and built-in cards read
//              as one grid
//
// A card the viewer cannot read is a muted card with a lock and "Not shared
// with you": no title and no settings, and for an editor only Remove. A card
// this release cannot interpret ("made in a newer version") is shown to
// editors with Remove only and round-trips untouched. Neither moves.

import { useEffect, useRef, useState } from "react";
import { Funnel, GripVertical, Lock, MoreHorizontal, Pencil, Settings2, Trash2 } from "lucide-react";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { SkeletonLines } from "@/components/ui/skeleton";
import { ruleActive } from "@/lib/dashboards/widget-math";
import type { EditorWidget } from "@/lib/dashboards/widgets";
import { registryFor } from "./widget-registry";
import type { CardData } from "./use-dashboard";
import { cn } from "@/lib/utils";

// widget-data.ts WIDGET_ROW_CAP: a card reads at most this many tasks.
const ROW_CAP_LABEL = "Counted from the 5,000 most recently updated tasks";

export interface WidgetCardProps {
  widget: EditorWidget;
  data: CardData | undefined;
  chrome: "dashboard" | "overview";
  /** The viewer edits this dashboard (owner, admin, or a Space manager on an Overview). */
  canEdit: boolean;
  /** The card can be dragged now (an editor, a data or text card, a wide enough screen). */
  movable: boolean;
  /** Its latest settings have been saved, so a data retry asks for the right thing. */
  saved: boolean;
  onSettings?: () => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
  onRetryData?: () => void;
  onTextChange?: (text: string) => void;
}

function CardMenu({ items, label }: { items: Array<{ label: string; icon: typeof Pencil; onClick: () => void; destructive?: boolean } | "separator">; label: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(
          "widget-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink",
          open && "bg-active text-ink",
        )}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </button>
      <MorePortal anchorRef={btn} width={200} open={open} placement="below" onClose={() => setOpen(false)}>
        <MenuList aria-label={label}>
          {items.map((it, i) =>
            it === "separator" ? (
              <MenuSeparator key={`sep-${i}`} />
            ) : (
              <MenuItem
                key={it.label}
                icon={it.icon}
                label={it.label}
                destructive={it.destructive}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              />
            ),
          )}
        </MenuList>
      </MorePortal>
    </>
  );
}

function TitleEditor({ value, onSave, onCancel, className }: { value: string; onSave: (v: string) => void; onCancel: () => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    const t = draft.trim();
    if (!t) {
      onCancel();
      return;
    }
    if (t !== value) onSave(t.slice(0, 120));
    else onCancel();
  };
  return (
    <input
      ref={ref}
      value={draft}
      maxLength={120}
      aria-label="Widget title"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      onBlur={commit}
      className={cn("widget-no-drag min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-1.5 text-ink outline-none focus:border-[var(--os-focus)]", className)}
    />
  );
}

function Message({ children, action }: { children: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-3 text-center">
      <p className="m-0 text-sm text-ink-2">{children}</p>
      {action ? (
        <button type="button" onClick={action.onClick} className="widget-no-drag text-sm font-medium text-brand-deep hover:underline">
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function CardBody({ widget, data, canEdit, saved, onRetryData, onTextChange }: Pick<WidgetCardProps, "widget" | "data" | "canEdit" | "saved" | "onRetryData" | "onTextChange">) {
  if (widget.kind === "hidden" || widget.kind === "passthrough") return null;
  const entry = registryFor(widget.kind);
  if (!entry) return null;
  if (widget.kind === "notes") {
    return <>{entry.Body({ widgetId: widget.id, result: { kind: "notes" }, canEdit, text: widget.text, onTextChange })}</>;
  }
  if (!data || data.state === "loading") return <SkeletonLines lines={3} className="px-1" />;
  const retry = saved && onRetryData ? { label: "Try again", onClick: onRetryData } : undefined;
  if (data.state === "failed") return <Message action={retry}>Couldn&apos;t load this widget</Message>;
  const r = data.result;
  if (r.kind === "error") return <Message action={retry}>Couldn&apos;t load this widget</Message>;
  if (r.kind === "empty") return <Message>None of its Lists are shared with you</Message>;
  if (r.kind === "hidden") return <Message>Not shared with you</Message>;
  const truncated = "truncated" in r && r.truncated === true;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">{entry.Body({ widgetId: widget.id, result: r, canEdit })}</div>
      {truncated ? <p className="m-0 shrink-0 pt-1 text-xs text-ink-2">{ROW_CAP_LABEL}</p> : null}
    </div>
  );
}

export function WidgetCard(props: WidgetCardProps) {
  const { widget, chrome, canEdit, movable, onSettings, onRename, onDelete } = props;
  const [renaming, setRenaming] = useState(false);
  const locked = widget.kind === "hidden" || widget.kind === "passthrough";
  const title = "title" in widget ? widget.title : "";
  const filtered = !locked && widget.kind !== "notes" && widget.filter.rules.some(ruleActive);

  const menuItems: Array<{ label: string; icon: typeof Pencil; onClick: () => void; destructive?: boolean } | "separator"> = [];
  if (canEdit && locked && onDelete) menuItems.push({ label: "Remove", icon: Trash2, onClick: onDelete, destructive: true });
  if (canEdit && !locked) {
    if (onSettings) menuItems.push({ label: "Settings", icon: Settings2, onClick: onSettings });
    if (onRename) menuItems.push({ label: "Rename", icon: Pencil, onClick: () => setRenaming(true) });
    if (onDelete) {
      if (menuItems.length) menuItems.push("separator");
      menuItems.push({ label: "Delete", icon: Trash2, onClick: onDelete, destructive: true });
    }
  }
  const menu = menuItems.length ? <CardMenu items={menuItems} label="Widget options" /> : null;

  if (widget.kind === "hidden") {
    return (
      <section
        data-widget-id={widget.id}
        className={cn(
          "flex h-full w-full flex-col overflow-hidden border border-line bg-subtle",
          chrome === "dashboard" ? "rounded-[var(--os-r-lg)]" : "rounded-xl p-4",
        )}
        aria-label="Not shared with you"
      >
        <div className={cn("flex items-center justify-end", chrome === "dashboard" ? "h-10 px-2" : "")}>{menu}</div>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-3 pb-3 text-center">
          <Lock className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden />
          <p className="m-0 text-sm text-ink-2">Not shared with you</p>
        </div>
      </section>
    );
  }

  const header =
    chrome === "dashboard" ? (
      <div className={cn("relative flex h-10 shrink-0 items-center gap-1.5 ps-3 pe-2", movable && "widget-drag-handle cursor-grab active:cursor-grabbing")}>
        {/* The grip sits in the header's left padding, so the title lines up
            with the body whether or not the viewer can move the card. */}
        {movable ? (
          <GripVertical className="pointer-events-none absolute start-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3 opacity-0 group-hover/card:opacity-100" strokeWidth={1.5} aria-hidden />
        ) : null}
        {renaming && onRename ? (
          <TitleEditor
            value={title}
            className="h-7 text-row font-medium"
            onSave={(t) => {
              setRenaming(false);
              onRename(t);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <h3 className="m-0 min-w-0 flex-1 truncate text-row font-medium text-ink" title={locked ? undefined : title}>
            {locked ? "Widget" : title}
          </h3>
        )}
        {filtered ? <Funnel className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.5} aria-label="Filtered" /> : null}
        {menu}
      </div>
    ) : (
      <div className={cn("dash-card-handle mb-2 flex shrink-0 items-center justify-between gap-2 select-none", movable && "cursor-grab active:cursor-grabbing")}>
        {renaming && onRename ? (
          <TitleEditor
            value={title}
            className="h-6 text-xs font-semibold"
            onSave={(t) => {
              setRenaming(false);
              onRename(t);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <h2 className="m-0 min-w-0 flex-1 truncate text-xs font-semibold text-ink">{locked ? "Widget" : title}</h2>
        )}
        <span className="flex shrink-0 items-center gap-1">
          {filtered ? <Funnel className="h-3.5 w-3.5 text-ink-3" strokeWidth={1.5} aria-label="Filtered" /> : null}
          {menu}
        </span>
      </div>
    );

  return (
    <section
      data-widget-id={widget.id}
      className={cn(
        "group/card flex h-full w-full flex-col overflow-hidden border border-line bg-raised",
        chrome === "dashboard" ? "rounded-[var(--os-r-lg)]" : "rounded-xl p-4",
      )}
    >
      {header}
      <div className={cn("min-h-0 flex-1", chrome === "dashboard" ? "px-3 pb-3" : "")}>
        {widget.kind === "passthrough" ? (
          <Message>This widget was made in a newer version</Message>
        ) : (
          <CardBody {...props} />
        )}
      </div>
    </section>
  );
}

"use client";

// WidgetShell — WidgetCard chrome + the shared "..." menu every dashboard
// widget gets: Rename (prompt dialog), Source picker (All tasks vs a
// specific List) for data-driven widgets, and Remove (confirm dialog).

import { useRef, useState, type ReactNode } from "react";
import { Check, Database, List, Pencil, Trash2 } from "lucide-react";
import { WidgetCard } from "@/components/dashboard/widget-card";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSectionLabel, MenuSeparator } from "@/components/ui/menu";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import type { DashWidget, WidgetSource } from "../widget-types";

export interface BoardOption {
  id: string;
  name: string;
}

/** Widget types whose body reads task data and therefore has a Source. */
const SOURCED_TYPES = new Set<DashWidget["type"]>(["task-list", "stat", "battery", "chart"]);

export function WidgetShell({
  widget,
  boards,
  onRename,
  onRemove,
  onSourceChange,
  onRefresh,
  children,
}: {
  widget: DashWidget;
  boards: BoardOption[];
  onRename: (title: string) => void;
  onRemove: () => void;
  onSourceChange: (source: WidgetSource) => void;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const prompt = usePrompt();
  const confirm = useConfirm();

  const hasSource = SOURCED_TYPES.has(widget.type);
  const source = widget.config.source ?? { kind: "all" as const };
  const sourceLabel = source.kind === "board"
    ? boards.find((b) => b.id === source.boardId)?.name ?? source.boardName ?? "List"
    : "All tasks";

  const rename = async () => {
    const name = await prompt({
      title: "Rename card",
      defaultValue: widget.title,
      placeholder: "Card name",
      submitLabel: "Rename",
      required: true,
    });
    const trimmed = name?.trim();
    if (trimmed && trimmed !== widget.title) onRename(trimmed.slice(0, 120));
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Remove card?",
      description: `"${widget.title}" will be removed from this dashboard.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) onRemove();
  };

  return (
    <WidgetCard
      title={widget.title}
      moreRef={moreRef}
      onRefresh={onRefresh}
      onMore={() => { setSourceOpen(false); setMenuOpen((v) => !v); }}
    >
      {children}
      <MorePortal anchorRef={moreRef} width={200} open={menuOpen} placement="below">
        <MenuList onMouseLeave={() => setMenuOpen(false)}>
          <MenuItem icon={Pencil} label="Rename" onClick={() => { setMenuOpen(false); void rename(); }} />
          {hasSource ? (
            <MenuItem
              icon={Database}
              label="Source"
              description={sourceLabel}
              onClick={() => { setMenuOpen(false); setSourceOpen(true); }}
            />
          ) : null}
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Remove card" destructive onClick={() => { setMenuOpen(false); void remove(); }} />
        </MenuList>
      </MorePortal>
      <MorePortal anchorRef={moreRef} width={230} open={sourceOpen} placement="below">
        <MenuList onMouseLeave={() => setSourceOpen(false)}>
          <MenuSectionLabel>Card source</MenuSectionLabel>
          <MenuItem
            icon={Database}
            label="All tasks"
            selected={source.kind === "all"}
            trailing={source.kind === "all" ? <Check className="h-3.5 w-3.5 text-zinc-500" /> : undefined}
            onClick={() => { setSourceOpen(false); onSourceChange({ kind: "all" }); }}
          />
          <MenuSeparator />
          <div className="max-h-60 overflow-y-auto">
            {boards.length === 0 ? (
              <div className="px-2 py-1.5 text-[13px] text-zinc-400">No Lists yet</div>
            ) : (
              boards.map((b) => {
                const active = source.kind === "board" && source.boardId === b.id;
                return (
                  <MenuItem
                    key={b.id}
                    icon={List}
                    label={b.name}
                    selected={active}
                    trailing={active ? <Check className="h-3.5 w-3.5 text-zinc-500" /> : undefined}
                    onClick={() => {
                      setSourceOpen(false);
                      onSourceChange({ kind: "board", boardId: b.id, boardName: b.name });
                    }}
                  />
                );
              })
            )}
          </div>
        </MenuList>
      </MorePortal>
    </WidgetCard>
  );
}

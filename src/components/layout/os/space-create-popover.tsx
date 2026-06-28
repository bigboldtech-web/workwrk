"use client";

// SpaceCreatePopover — the per-Space "+" menu (matches the ClickUp
// pattern from the 2026-06-03 screenshot). Anchored to the row's
// "+" trigger. Each option fires its respective creator: List + Folder
// open dialogs; Doc + Whiteboard POST + redirect; the rest are stubs
// until their primitives land.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, ListChecks, FolderPlus, FileText, BarChart3, Brush, ClipboardCheck,
  Download, LayoutTemplate, ChevronRight, Database,
} from "lucide-react";
import { useOsToast } from "./toast";
import { useOsShell } from "./shell-context";
import { MorePortal } from "./more-portal";
import { MenuItem, MenuList, MenuSeparator, MenuSectionLabel } from "@/components/ui/menu";

interface Props {
  spaceId: string;
  onRequestBoard: () => void;
  onRequestFolder: () => void;
  onCreated?: () => void;
}

export function SpaceCreateTrigger({
  spaceId,
  onRequestBoard,
  onRequestFolder,
  onCreated,
}: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`p-0.5 rounded transition-colors ${
          open ? "text-zinc-900 bg-zinc-200" : "text-zinc-500 hover:bg-zinc-200"
        }`}
        aria-label="Create inside this Space"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Create"
      >
        <Plus className="w-3 h-3" />
      </button>

      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={280} open={open} placement="right">
        <SpaceCreateMenu
          spaceId={spaceId}
          onRequestBoard={() => {
            setOpen(false);
            onRequestBoard();
          }}
          onRequestFolder={() => {
            setOpen(false);
            onRequestFolder();
          }}
          onCreated={() => {
            setOpen(false);
            onCreated?.();
          }}
        />
      </MorePortal>
    </span>
  );
}

function SpaceCreateMenu({
  spaceId,
  onRequestBoard,
  onRequestFolder,
  onCreated,
}: {
  spaceId: string;
  onRequestBoard: () => void;
  onRequestFolder: () => void;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const { openTemplateCenter } = useOsShell();
  const [busyKind, setBusyKind] = useState<string | null>(null);

  const stub = (label: string) => () => toast(`${label} creation coming soon`);

  const createDoc = async () => {
    setBusyKind("doc");
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Untitled note",
          entityType: "SPACE",
          entityId: spaceId,
        }),
      });
      const data = await res.json();
      const id = data?.doc?.id;
      if (!id) throw new Error();
      onCreated?.();
      router.push(`/docs/${id}`);
    } catch {
      toast("Couldn't create doc");
    } finally {
      setBusyKind(null);
    }
  };

  const createWhiteboard = async () => {
    setBusyKind("whiteboard");
    try {
      const res = await fetch("/api/whiteboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Untitled whiteboard", spaceId }),
      });
      const data = await res.json();
      const id = data?.whiteboard?.id;
      if (!id) throw new Error();
      onCreated?.();
      router.push(`/whiteboards/${id}`);
    } catch {
      toast("Couldn't create whiteboard");
    } finally {
      setBusyKind(null);
    }
  };

  const createDatabase = async () => {
    setBusyKind("database");
    try {
      const res = await fetch("/api/tables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Untitled table", spaceId }),
      });
      const data = await res.json();
      const id = data?.id ?? data?.data?.id;
      if (!id) throw new Error();
      onCreated?.();
      router.push(`/tables/${id}`);
    } catch {
      toast("Couldn't create database");
    } finally {
      setBusyKind(null);
    }
  };

  return (
    <MenuList className="px-1.5">
      <MenuSectionLabel className="px-2">Create</MenuSectionLabel>

      {/* Structural items — the two things you make most, with descriptions. */}
      <MenuItem
        variant="inset"
        icon={ListChecks}
        iconClassName="text-zinc-700 dark:text-zinc-200"
        label="List"
        description="Track tasks, projects, people & more"
        onClick={onRequestBoard}
      />
      <MenuItem
        variant="inset"
        icon={FolderPlus}
        iconClassName="text-zinc-700 dark:text-zinc-200"
        label="Folder"
        description="Group Lists, Docs & more"
        onClick={onRequestFolder}
      />

      <MenuSeparator />

      {/* Content primitives — single line, one accent color each (no gradients). */}
      <MenuItem
        variant="inset"
        icon={FileText}
        iconClassName="text-blue-500"
        label="Doc"
        busy={busyKind === "doc"}
        onClick={createDoc}
      />
      <MenuItem
        variant="inset"
        icon={BarChart3}
        iconClassName="text-violet-500"
        label="Dashboard"
        onClick={stub("Dashboard")}
      />
      <MenuItem
        variant="inset"
        icon={Brush}
        iconClassName="text-amber-500"
        label="Whiteboard"
        busy={busyKind === "whiteboard"}
        onClick={createWhiteboard}
      />
      <MenuItem
        variant="inset"
        icon={Database}
        iconClassName="text-emerald-500"
        label="Database"
        busy={busyKind === "database"}
        onClick={createDatabase}
      />
      <MenuItem
        variant="inset"
        icon={ClipboardCheck}
        iconClassName="text-indigo-500"
        label="Form"
        onClick={stub("Form")}
      />

      <MenuSeparator />

      <MenuItem
        variant="inset"
        icon={Download}
        iconClassName="text-zinc-500 dark:text-zinc-400"
        label="Imports"
        trailing={<ChevronRight className="h-3.5 w-3.5 text-zinc-400" />}
        onClick={stub("Imports")}
      />
      <MenuItem
        variant="inset"
        icon={LayoutTemplate}
        iconClassName="text-zinc-500 dark:text-zinc-400"
        label="Templates"
        onClick={() => { onCreated?.(); openTemplateCenter({ applyContext: { spaceId } }); }}
      />
    </MenuList>
  );
}

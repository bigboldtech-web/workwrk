"use client";

// SpaceCreatePopover — the per-Space "+" menu (matches the ClickUp
// pattern from the 2026-06-03 screenshot). Anchored to the row's
// "+" trigger. Each option fires its respective creator: List + Folder
// open dialogs; Doc + Whiteboard POST + redirect; the rest are stubs
// until their primitives land.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, ListChecks, FolderPlus, FileText, BarChart3, Brush, ClipboardCheck,
  Download, LayoutTemplate, ChevronRight, Loader2, Database,
} from "lucide-react";
import { useOsToast } from "./toast";

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

      {open ? (
        <div
          ref={panelRef}
          className="absolute left-full top-0 ml-1 z-[70] w-[280px]"
        >
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
        </div>
      ) : null}
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
  const [busyKind, setBusyKind] = useState<string | null>(null);

  const stub = (label: string) => () => toast(`${label} creation coming soon`);

  const createDoc = async () => {
    setBusyKind("doc");
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Untitled doc",
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
    <div
      role="menu"
      className="bg-white rounded-xl border border-zinc-200 shadow-2xl py-1.5"
    >
      <SectionLabel>Create</SectionLabel>
      <MenuItem
        Icon={ListChecks}
        label="List"
        subtitle="Track tasks, projects, people & more"
        onClick={onRequestBoard}
      />
      <MenuItem
        Icon={FolderPlus}
        label="Folder"
        subtitle="Group Lists, Docs & more"
        onClick={onRequestFolder}
      />
      <MenuItem
        Icon={FileText}
        label="Doc"
        busy={busyKind === "doc"}
        onClick={createDoc}
      />
      <MenuItem
        Icon={BarChart3}
        label="Dashboard"
        onClick={stub("Dashboard")}
      />
      <MenuItem
        Icon={Brush}
        label="Whiteboard"
        busy={busyKind === "whiteboard"}
        onClick={createWhiteboard}
      />
      <MenuItem
        Icon={Database}
        label="Database"
        subtitle="Flexible spreadsheet · CRM, lists, anything"
        busy={busyKind === "database"}
        onClick={createDatabase}
      />
      <MenuItem
        Icon={ClipboardCheck}
        label="Form"
        onClick={stub("Form")}
      />

      <div className="h-px bg-zinc-100 my-1.5" />

      <MenuItem
        Icon={Download}
        label="Imports"
        trailing={<ChevronRight className="h-3.5 w-3.5 text-zinc-400" />}
        onClick={stub("Imports")}
      />
      <MenuItem
        Icon={LayoutTemplate}
        label="Templates"
        onClick={stub("Templates")}
      />
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-zinc-400 font-semibold">
      {children}
    </div>
  );
}

function MenuItem({
  Icon,
  label,
  subtitle,
  trailing,
  busy,
  onClick,
}: {
  Icon: typeof Plus;
  label: string;
  subtitle?: string;
  trailing?: ReactNode;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={busy}
      className="w-full text-left flex items-center gap-3 px-3 py-2 hover:bg-zinc-50 disabled:opacity-50"
    >
      <Icon className="h-4 w-4 text-zinc-500 shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium text-zinc-900">{label}</span>
        {subtitle ? (
          <span className="block text-[11.5px] text-zinc-500 mt-0.5 leading-snug">{subtitle}</span>
        ) : null}
      </span>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" /> : trailing}
    </button>
  );
}

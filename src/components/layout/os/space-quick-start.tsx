"use client";

// SpaceQuickStart — empty-state tile grid for the Space detail page.
// Replaces the static decorative tiles from Phase 42a with a real
// 4-button client island:
//   List     → opens CreateListModal (the one List dialog; "Board" and the
//              second dialog are retired, spec-spaces-lists section 0)
//   Folder   → opens NewFolderDialog
//   Doc      → POST /api/docs { entityType: SPACE, entityId } → /docs/[id]
//   Database → POST /api/tables { spaceId } → /tables/[id]
//
// Each tile sits on the Space's accent color (left border + tinted icon)
// so the empty state feels like part of THIS Space, not a generic CTA.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Database, FileText, FolderPlus, LayoutGrid,
} from "lucide-react";
import { NewFolderDialog } from "./new-folder-dialog";
import { useOsShell } from "./shell-context";
import { useOsToast } from "./toast";
import { Dots } from "@/components/ui/dots";

interface Props {
  spaceId: string;
  accent: string;
}

export function SpaceQuickStart({ spaceId, accent }: Props) {
  const router = useRouter();
  const { toast } = useOsToast();
  const { openCreateList } = useOsShell();
  const [folderOpen, setFolderOpen] = useState(false);
  const [busy, setBusy] = useState<"doc" | "table" | null>(null);

  const createDoc = async () => {
    setBusy("doc");
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Couldn't create doc");
        return;
      }
      const data = await res.json();
      router.push(`/docs/${data.doc.id}`);
    } finally {
      setBusy(null);
    }
  };

  const createTable = async () => {
    setBusy("table");
    try {
      const res = await fetch("/api/tables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Untitled table", spaceId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Couldn't create table");
        return;
      }
      const table = await res.json();
      if (table?.id) router.push(`/tables/${table.id}`);
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6">
      <div className="mb-4">
        <div className="text-xs font-semibold text-zinc-900 mb-1">Get started in this Space</div>
        <p className="text-xs text-zinc-500">
          Add a primitive to begin tracking work. You can change everything later — nothing is locked in.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile
          Icon={LayoutGrid}
          label="List"
          blurb="Tasks, with their own statuses"
          accent={accent}
          onClick={() => openCreateList({ spaceId })}
        />
        <Tile
          Icon={FolderPlus}
          label="Folder"
          blurb="Group related lists"
          accent={accent}
          onClick={() => setFolderOpen(true)}
        />
        <Tile
          Icon={FileText}
          label="Doc"
          blurb="Notes · spec · meeting"
          accent={accent}
          onClick={createDoc}
          busy={busy === "doc"}
        />
        <Tile
          Icon={Database}
          label="Table"
          blurb="Rows, columns and formulas"
          accent={accent}
          onClick={createTable}
          busy={busy === "table"}
        />
      </div>

      <NewFolderDialog
        open={folderOpen}
        onOpenChange={setFolderOpen}
        spaceId={spaceId}
        parentFolderId={null}
        onCreated={() => { setFolderOpen(false); router.refresh(); }}
      />
    </section>
  );
}

function Tile({
  Icon,
  label,
  blurb,
  accent,
  onClick,
  busy,
}: {
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  blurb: string;
  accent: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="text-start p-3 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 transition-colors disabled:opacity-60"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <Icon className="w-4 h-4" style={{ color: accent }} />
        {busy ? <Dots variant="pending" /> : null}
      </div>
      <div className="text-base font-semibold text-zinc-900">{label}</div>
      <div className="text-xs text-zinc-500 mt-0.5">{blurb}</div>
    </button>
  );
}

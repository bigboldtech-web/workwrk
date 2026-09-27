// PathContainerView: the page of a Space or Folder the viewer only passes
// through (decision A3, a path container).
//
// Someone given a List, a doc, a canvas or a table deep inside a Space sees
// the Space and the Folders above it as NAMED CONTAINERS on the way there and
// nothing more: no member list, no settings, no counts, no Overview widgets,
// no Share control, no "..." menu, no create control. They hold no role on
// the container, so the page offers nothing a role would. The rows are
// exactly the branches the viewer's Work tree renders under this container
// (node-tree.ts pathViewRows), each opening at its own address, where its
// own gate decides.
//
// Server component: the page hands it plain data.

import Link from "next/link";
import { Brush, FileText } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { BackButton } from "@/components/ui/back-button";
import { EntityTile } from "@/components/ui/entity-tile";
import type { PlacementCrumb } from "@/lib/work/placement";

export interface PathContainerRow {
  kind: "folder" | "list" | "doc" | "table" | "canvas";
  id: string;
  name: string;
  href: string;
  icon: string | null;
  color: string | null;
  /** The row is itself a path container (a Folder on the way to something deeper). */
  path: boolean;
}

export interface PathContainerViewProps {
  kind: "space" | "folder";
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  /** The crumbs above this container, root first (empty for a Space). */
  trail: PlacementCrumb[];
  rows: PathContainerRow[];
}

const KIND_LABEL: Record<PathContainerRow["kind"], string> = {
  folder: "Folder",
  list: "List",
  doc: "Doc",
  table: "Table",
  canvas: "Canvas",
};

function RowGlyph({ row }: { row: PathContainerRow }) {
  switch (row.kind) {
    case "folder":
      return <EntityTile size="sm" icon={row.icon} color={row.color} name={row.name} fallback="folder" />;
    case "list":
      return <EntityTile size="sm" icon={row.icon} color={row.color} name={row.name} fallback="list" />;
    case "table":
      return <EntityTile size="sm" icon={row.icon} color={row.color} name={row.name} fallback="table" />;
    case "doc":
      return <FileText className="h-4 w-4 shrink-0 text-ink-2" aria-hidden />;
    case "canvas":
      return <Brush className="h-4 w-4 shrink-0 text-ink-2" aria-hidden />;
  }
}

export function PathContainerView({ kind, name, icon, color, trail, rows }: PathContainerViewProps) {
  // Back goes one level up the path: the nearest crumb that opens, else Work.
  const up = [...trail].reverse().find((c) => c.href);
  const back = up?.href ? { href: up.href, label: up.label } : kind === "space" ? { href: "/spaces", label: "Spaces" } : { href: "/home", label: "Work" };
  const crumbs = kind === "space" && trail.length === 0 ? [{ label: "Spaces", href: "/spaces" }, { label: name }] : [...trail, { label: name }];

  return (
    <div className="flex h-full flex-col bg-app">
      <Breadcrumb items={crumbs} />
      <div className="flex h-[40px] items-center gap-2 px-6">
        <BackButton fallbackHref={back.href} label={back.label} className="me-0.5" />
        <EntityTile size="md" icon={icon} color={color} name={name} fallback={kind === "folder" ? "folder" : null} />
        <h1 className="min-w-0 text-title font-semibold text-ink">
          <span className="block truncate" title={name}>{name}</span>
        </h1>
      </div>
      <p className="px-6 pb-3 text-base text-ink-2">Only what was shared with you is shown here.</p>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <ul className="max-w-3xl overflow-hidden rounded-xl border border-line bg-raised">
          {rows.length === 0 ? (
            <li className="px-3 py-4 text-base text-ink-2">Nothing here is shared with you any more.</li>
          ) : (
            rows.map((row) => (
              <li key={`${row.kind}:${row.id}`} className="border-b border-line-soft last:border-b-0">
                <Link href={row.href} className="flex h-9 items-center gap-2 px-3 transition-colors hover:bg-hover">
                  <RowGlyph row={row} />
                  <span className="min-w-0 flex-1 truncate text-base text-ink">{row.name || `Untitled ${KIND_LABEL[row.kind].toLowerCase()}`}</span>
                  <span className="shrink-0 text-xs text-ink-2">{KIND_LABEL[row.kind]}</span>
                </Link>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

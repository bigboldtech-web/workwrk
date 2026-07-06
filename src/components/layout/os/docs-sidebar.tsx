"use client";

// DocsSidebar — the ClickUp-style left panel for the Docs section.
//
// Header ("Docs" + create button) is rendered by ClickSidebarBody; this is the
// scrolling body: a fixed nav (All Docs / My Docs / Shared with me / Private /
// Meeting Notes / Archived) that drives the main list via ?view=, then
// Favorites, Recent Pages and Popular Wikis sections.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  FileText, User, Users, Lock, Archive, NotebookPen, Star, BookOpen,
  MoreHorizontal, type LucideIcon,
} from "lucide-react";
import { useSidebarSearch } from "./sidebar-search-context";
import { NoteActionMenu, useNoteMenu } from "@/components/docs/note-actions-menu";
import { renderNoteIcon } from "@/components/docs/note-icon";

type DocRow = {
  id: string;
  title: string;
  emoji?: string | null;
  entityType?: string | null;
  createdById?: string | null;
  parentId?: string | null;
  updatedAt: string;
};

type ViewKey = "all" | "my" | "shared" | "private" | "meeting" | "archived";

export function DocsSidebar() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const params = useSearchParams();
  const { query } = useSidebarSearch();
  const { data: session } = useSession();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const noteMenu = useNoteMenu();

  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [docsRes, prefRes] = await Promise.all([
        fetch("/api/docs", { cache: "no-store" }),
        fetch("/api/preferences", { cache: "no-store" }).catch(() => null),
      ]);
      if (docsRes.ok) {
        const d = await docsRes.json();
        setDocs((d.docs ?? d.data ?? []) as DocRow[]);
      } else setDocs([]);
      if (prefRes?.ok) {
        const p = await prefRes.json();
        setFavIds(new Set<string>(p.effective?.home?.favoriteDocIds ?? []));
      }
    } catch { setDocs([]); }
  }, []);
  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, [load]);
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener("workwrk:docs-changed", onChange);
    window.addEventListener("workwrk:favs-changed", onChange);
    return () => {
      window.removeEventListener("workwrk:docs-changed", onChange);
      window.removeEventListener("workwrk:favs-changed", onChange);
    };
  }, [load]);

  const activeView: ViewKey | null = pathname === "/docs" ? ((params.get("view") as ViewKey) || "all") : null;

  const { myCount, sharedCount } = useMemo(() => {
    let mine = 0, shared = 0;
    for (const d of docs ?? []) {
      if (d.createdById && d.createdById === meId) mine++;
      else if (d.createdById && d.createdById !== meId) shared++;
    }
    return { myCount: mine, sharedCount: shared };
  }, [docs, meId]);

  const q = query.trim().toLowerCase();
  const recent = useMemo(() => {
    const list = [...(docs ?? [])]
      .filter((d) => !q || d.title.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return list.slice(0, 6);
  }, [docs, q]);
  const favorites = useMemo(
    () => (docs ?? []).filter((d) => favIds.has(d.id) && (!q || d.title.toLowerCase().includes(q))),
    [docs, favIds, q],
  );

  const NAV: Array<{ key: ViewKey; label: string; Icon: LucideIcon; badge?: number }> = [
    { key: "all", label: "All Docs", Icon: FileText },
    { key: "my", label: "My Docs", Icon: User, badge: myCount },
    { key: "shared", label: "Shared with me", Icon: Users, badge: sharedCount },
    { key: "private", label: "Private", Icon: Lock },
    { key: "meeting", label: "Meeting Notes", Icon: NotebookPen },
    { key: "archived", label: "Archived", Icon: Archive },
  ];

  return (
    <div className="flex flex-col">
      {/* Primary nav */}
      <ul className="flex flex-col gap-0.5">
        {NAV.map((n) => {
          const active = activeView === n.key;
          return (
            <li key={n.key}>
              <Link
                href={n.key === "all" ? "/docs" : `/docs?view=${n.key}`}
                className={`flex items-center gap-2 h-8 px-2 rounded-md text-[13px] ${
                  active ? "bg-zinc-100 text-zinc-900 font-medium" : "text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                <n.Icon className="w-4 h-4 text-zinc-500 shrink-0" />
                <span className="flex-1 truncate">{n.label}</span>
                {n.badge && n.badge > 0 ? (
                  <span className="text-[11px] text-zinc-400 tabular-nums">{n.badge}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Favorites */}
      <SectionLabel>Favorites</SectionLabel>
      {favorites.length === 0 ? (
        <EmptyCard Icon={Star} text="Star a Doc to see it here" />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {favorites.map((d) => (
            <DocLink key={`fav-${d.id}`} doc={d} onMenu={(e) => noteMenu.open(e, { id: d.id, title: d.title, favorite: true })} onOpen={() => router.push(`/docs/${d.id}`)} active={pathname === `/docs/${d.id}`} />
          ))}
        </ul>
      )}

      {/* Recent Pages */}
      <SectionLabel>Recent Pages</SectionLabel>
      {docs === null ? (
        <div className="px-2 py-1.5 text-[11.5px] text-zinc-400">Loading…</div>
      ) : recent.length === 0 ? (
        <EmptyCard Icon={FileText} text="Recently opened docs appear here" />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {recent.map((d) => (
            <DocLink key={`rec-${d.id}`} doc={d} onMenu={(e) => noteMenu.open(e, { id: d.id, title: d.title, favorite: favIds.has(d.id) })} onOpen={() => router.push(`/docs/${d.id}`)} active={pathname === `/docs/${d.id}`} />
          ))}
          <li>
            <Link href="/docs" className="flex items-center gap-2 h-7 px-2 rounded-md text-[12.5px] text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600">
              <MoreHorizontal className="w-4 h-4 shrink-0" />
              <span>More</span>
            </Link>
          </li>
        </ul>
      )}

      {/* Popular Wikis */}
      <SectionLabel>Popular Wikis</SectionLabel>
      <EmptyCard Icon={BookOpen} text="Most viewed and active Wikis appear here" />

      {noteMenu.menu && (
        <NoteActionMenu
          target={noteMenu.menu.target}
          x={noteMenu.menu.x}
          y={noteMenu.menu.y}
          onClose={noteMenu.close}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{children}</div>;
}

function EmptyCard({ Icon, text }: { Icon: LucideIcon; text: string }) {
  return (
    <div className="mx-0.5 my-1 rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-5 text-center">
      <Icon className="w-4 h-4 mx-auto text-zinc-300" />
      <p className="mt-1.5 text-[11.5px] text-zinc-400 leading-snug">{text}</p>
    </div>
  );
}

function DocLink({ doc, active, onOpen, onMenu }: {
  doc: DocRow;
  active: boolean;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <li
      className={`group/doc flex items-center gap-2 h-7 px-2 rounded-md text-[13px] cursor-pointer ${
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
      }`}
      onClick={onOpen}
      onContextMenu={onMenu}
    >
      <span className="w-4 shrink-0 grid place-items-center text-[13px] [&_svg]:w-3.5 [&_svg]:h-3.5 [&_img]:w-4 [&_img]:h-4 [&_img]:rounded-[3px] [&_img]:object-cover">
        {doc.emoji ? renderNoteIcon(doc.emoji) : <FileText className="w-3.5 h-3.5 text-zinc-400" />}
      </span>
      <span className="truncate flex-1">{doc.title || "Untitled"}</span>
      <button
        type="button"
        className="opacity-0 group-hover/doc:opacity-100 w-5 h-5 grid place-items-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 shrink-0"
        aria-label="Doc actions"
        onClick={(e) => { e.stopPropagation(); onMenu(e); }}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}

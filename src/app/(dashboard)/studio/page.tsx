"use client";

/* Studio — user-built boards.
 *
 *  GET  /api/studio/boards         list all boards in this org
 *  POST /api/studio/boards         create
 *
 * Grouped by productSlug (CRM, Tasks, ITSM, etc.). Each board renders
 * as a colored card with layout chip + item count + last-updated time.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LayoutGrid, Plus, Search, Loader2, Columns, ClipboardList, ChevronRight,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type Layout = "TABLE" | "KANBAN";

type ApiBoard = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  layout: Layout;
  productSlug?: string | null;
  workspaceId?: string | null;
  color?: string | null;
  updatedAt: string;
  _count?: { items?: number };
};

const SLUG_LABELS: Record<string, string> = {
  crm: "CRM", tasks: "Tasks", itsm: "ITSM", helpdesk: "Helpdesk",
  recruiting: "Recruiting", marketing: "Marketing", procurement: "Procurement",
  expenses: "Expenses", finance: "Finance",
};
const SLUG_COLORS: Record<string, string> = {
  crm: C.green, tasks: C.blue, itsm: C.orange, helpdesk: C.red,
  recruiting: C.purple, marketing: C.pink, procurement: C.brown,
  expenses: C.indigo, finance: C.teal, standalone: C.gray, default: C.indigo,
};

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function StudioPage() {
  const [rows, setRows] = useState<ApiBoard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/studio/boards");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.boards ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("studio");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function newBoard() {
    const name = window.prompt("Board name?")?.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/studio/boards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          layout: "TABLE",
          fields: [{ key: "name", label: "Name", type: "TEXT" }],
        }),
      });
      if (!res.ok) {
        if (res.status === 403) toast("Manager-level access required to create boards");
        else toast(`Couldn't create board (HTTP ${res.status})`);
        return;
      }
      void load();
    } catch { toast("Couldn't create board"); }
    finally { setCreating(false); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((b) =>
      b.name.toLowerCase().includes(q) ||
      (b.description ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const grouped = useMemo(() => {
    const m = new Map<string, ApiBoard[]>();
    for (const b of filtered) {
      const k = b.productSlug ?? "standalone";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(b);
    }
    return Array.from(m.entries()).sort(([a], [b]) => (SLUG_LABELS[a] ?? a).localeCompare(SLUG_LABELS[b] ?? b));
  }, [filtered]);

  const totalItems = (rows ?? []).reduce((acc, b) => acc + (b._count?.items ?? 0), 0);

  return (
    <>
      <OsTitleBar
        title="Studio"
        Icon={LayoutGrid}
        iconGradient={GRAD.tealGreen}
        description={rows === null ? "Loading…" : `${rows.length} board${rows.length === 1 ? "" : "s"} · ${totalItems} item${totalItems === 1 ? "" : "s"} · no-code`}
        people={[PEOPLE.bb, PEOPLE.mk, PEOPLE.sc]}
        morePeople={4}
      />

      <div className="studio__toolbar">
        <div className="studio__search">
          <Search />
          <input
            type="search"
            placeholder="Search boards…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button type="button" className="studio__new" onClick={newBoard} disabled={creating}>
          {creating ? <><Loader2 className="studio__spin" /> Creating…</> : <><Plus /> New board</>}
        </button>
      </div>

      {loadError ? (
        <OsEmptyView Icon={LayoutGrid} iconGradient={GRAD.redPink} title="Couldn't load boards" subtitle={`API error: ${loadError}.`} cta="Retry" />
      ) : rows === null ? (
        <div className="studio__loading">Loading boards…</div>
      ) : rows.length === 0 ? (
        <OsEmptyView Icon={LayoutGrid} iconGradient={GRAD.tealGreen} title="No studio boards yet" subtitle="Spin up custom boards with the columns you actually need — pick TABLE or KANBAN, drop in fields, share the route." chips={["Table", "Kanban", "Status", "Files", "Timeline"]} cta="New board" />
      ) : filtered.length === 0 ? (
        <div className="studio__loading">Nothing matches &ldquo;{search}&rdquo;.</div>
      ) : (
        <div className="studio">
          {grouped.map(([slug, boards]) => {
            const color = SLUG_COLORS[slug] ?? SLUG_COLORS.default;
            const label = SLUG_LABELS[slug] ?? (slug === "standalone" ? "Standalone" : slug);
            return (
              <section key={slug} className="studio__section">
                <header className="studio__section-head">
                  <span className="studio__section-dot" style={{ background: color }} />
                  <h2>{label}</h2>
                  <span className="studio__section-count">{boards.length} board{boards.length === 1 ? "" : "s"}</span>
                </header>
                <div className="studio__grid">
                  {boards.map((b) => <BoardCard key={b.id} board={b} color={SLUG_COLORS[b.productSlug ?? "standalone"] ?? SLUG_COLORS.default} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function BoardCard({ board, color }: { board: ApiBoard; color: string }) {
  const items = board._count?.items ?? 0;
  const Icon = board.layout === "KANBAN" ? Columns : ClipboardList;
  return (
    <Link href={`/studio/boards/${board.slug}`} className="board-card">
      <header className="board-card__head" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 70%, #fff))` }}>
        <Icon />
      </header>
      <div className="board-card__body">
        <h3>{board.name}</h3>
        {board.description && <p>{board.description.length > 70 ? board.description.slice(0, 70) + "…" : board.description}</p>}
      </div>
      <footer className="board-card__foot">
        <span>{items} item{items === 1 ? "" : "s"}</span>
        <span className="board-card__chip" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>{board.layout === "KANBAN" ? "Kanban" : "Table"}</span>
        <span className="board-card__time">{relTime(board.updatedAt)}</span>
        <ChevronRight className="board-card__arrow" />
      </footer>
    </Link>
  );
}

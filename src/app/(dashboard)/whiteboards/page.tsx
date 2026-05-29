"use client";

/* Whiteboards — gallery of boards (no table).
 *
 *  GET  /api/whiteboards
 *  POST /api/whiteboards { name, productSlug? }
 *
 * Sections:
 *   - "Recently edited" (top 4, hero strip)
 *   - Grouped by productSlug (CRM, Tasks, ITSM, ..., General)
 *
 * Each tile uses a real thumbnail when available; otherwise renders a
 * tinted grid-paper placeholder with a scribble glyph in the
 * category's color — so a brand-new wall of boards still looks alive.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Frame, Plus, Search, Pencil, ChevronRight, Clock, Loader2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiWhiteboard = {
  id: string;
  name: string;
  description?: string | null;
  thumbnail?: string | null;
  ownerId: string;
  productSlug?: string | null;
  lastEditedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

const SLUG_LABEL: Record<string, string> = {
  crm: "CRM", tasks: "Tasks", itsm: "ITSM", helpdesk: "Helpdesk",
  recruiting: "Recruiting", marketing: "Marketing", procurement: "Procurement",
  finance: "Finance", general: "General",
};
const SLUG_HUE: Record<string, string> = {
  crm: "var(--os-c-green)", tasks: "var(--os-c-blue)", itsm: "var(--os-c-red)",
  helpdesk: "var(--os-c-orange)", recruiting: "var(--os-c-purple)",
  marketing: "var(--os-c-pink)", procurement: "var(--os-c-brown)",
  finance: "var(--os-c-teal)", general: "var(--os-c-indigo)",
};

function relTime(iso?: string | null): string {
  if (!iso) return "never edited";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function WhiteboardsPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<ApiWhiteboard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whiteboards");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiWhiteboard[] = data.whiteboards ?? data.data ?? (Array.isArray(data) ? data : []);
      setBoards(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("whiteboards");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function createBoard() {
    const name = window.prompt("Whiteboard name?", "Untitled whiteboard")?.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/whiteboards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const wb: ApiWhiteboard = data.whiteboard ?? data.data ?? data;
      router.push(`/whiteboards/${wb.id}`);
    } catch { toast("Couldn't create whiteboard"); }
    finally { setCreating(false); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boards ?? [];
    return (boards ?? []).filter((b) =>
      b.name.toLowerCase().includes(q) || (b.description ?? "").toLowerCase().includes(q),
    );
  }, [boards, search]);

  // Recently-edited strip = top 4 by lastEditedAt desc (must have edit time).
  const recent = useMemo(() => {
    return [...filtered]
      .filter((b) => b.lastEditedAt)
      .sort((a, b) => new Date(b.lastEditedAt!).getTime() - new Date(a.lastEditedAt!).getTime())
      .slice(0, 4);
  }, [filtered]);

  // Group everything else by productSlug.
  const grouped = useMemo(() => {
    const m = new Map<string, ApiWhiteboard[]>();
    for (const b of filtered) {
      const k = b.productSlug ?? "general";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(b);
    }
    // Sort each group by updatedAt desc, sort groups by label.
    return Array.from(m.entries())
      .map(([slug, items]) => ({
        slug,
        label: SLUG_LABEL[slug] ?? slug,
        items: items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filtered]);

  const total = boards?.length ?? 0;

  return (
    <>
      <OsTitleBar
        title="Whiteboards"
        Icon={Frame}
        iconGradient={GRAD.indigoBlue}
        description={boards === null ? "Loading…" : `${total} board${total === 1 ? "" : "s"} · ${grouped.length} categor${grouped.length === 1 ? "y" : "ies"}`}
        people={[PEOPLE.bb, PEOPLE.sc]}
        morePeople={6}
        actions={
          <div className="wb__head-actions">
            <div className="wb__search">
              <Search />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a board…"
              />
            </div>
            <button type="button" className="wb__new" onClick={createBoard} disabled={creating}>
              {creating ? <><Loader2 className="wb__spin" /> Creating…</> : <><Plus /> New whiteboard</>}
            </button>
          </div>
        }
      />

      {loadError ? (
        <OsEmptyView Icon={Frame} iconGradient={GRAD.redPink} title="Couldn't load whiteboards" subtitle={`API error: ${loadError}`} cta="Retry" />
      ) : boards === null ? (
        <div className="wb__loading">Loading whiteboards…</div>
      ) : total === 0 ? (
        <OsEmptyView Icon={Frame} iconGradient={GRAD.indigoBlue} title="No whiteboards yet" subtitle="Sketch flows, map architectures, brainstorm anything. Drag, draw, drop sticky notes — your canvas lives one click away." chips={["Flows", "Architecture", "Brainstorms", "Sticky notes"]} cta="New whiteboard" />
      ) : filtered.length === 0 ? (
        <div className="wb__loading">Nothing matches &ldquo;{search}&rdquo;.</div>
      ) : (
        <div className="wb">
          {/* Recently edited strip (only when not searching, and we have data) */}
          {!search && recent.length > 0 && (
            <section className="wb__section">
              <header className="wb__section-head">
                <Clock className="wb__section-icon" />
                <h2>Recently edited</h2>
                <span className="wb__section-count">{recent.length}</span>
              </header>
              <div className="wb__strip">
                {recent.map((b) => <Tile key={`r-${b.id}`} board={b} large />)}
              </div>
            </section>
          )}

          {/* Categories */}
          {grouped.map((g) => {
            const hue = SLUG_HUE[g.slug] ?? SLUG_HUE.general;
            return (
              <section key={g.slug} className="wb__section">
                <header className="wb__section-head">
                  <span className="wb__section-dot" style={{ background: hue }} />
                  <h2>{g.label}</h2>
                  <span className="wb__section-count">{g.items.length}</span>
                </header>
                <div className="wb__grid">
                  {g.items.map((b) => <Tile key={b.id} board={b} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function Tile({ board, large }: { board: ApiWhiteboard; large?: boolean }) {
  const slug = board.productSlug ?? "general";
  const hue = SLUG_HUE[slug] ?? SLUG_HUE.general;
  return (
    <Link href={`/whiteboards/${board.id}`} className={`wb-card ${large ? "is-large" : ""}`} style={{ ["--wb-hue" as string]: hue }}>
      <div className="wb-card__thumb">
        {board.thumbnail ? (
          <img src={board.thumbnail} alt={board.name} />
        ) : (
          <Placeholder />
        )}
        <span className="wb-card__open"><Pencil /> Open canvas</span>
      </div>
      <div className="wb-card__body">
        <h3 className="wb-card__name">{board.name}</h3>
        {board.description && <p className="wb-card__desc">{board.description.length > 80 ? board.description.slice(0, 80) + "…" : board.description}</p>}
        <div className="wb-card__meta">
          <span className="wb-card__slug">{SLUG_LABEL[slug] ?? slug}</span>
          <span className="wb-card__time">{relTime(board.lastEditedAt ?? board.updatedAt)}</span>
          <ChevronRight className="wb-card__arrow" />
        </div>
      </div>
    </Link>
  );
}

/* Placeholder: grid-paper background with a soft scribble path so empty
 * tiles still feel like "whiteboards" rather than empty boxes. Inline
 * SVG keeps it color-tinted via currentColor. */
function Placeholder() {
  return (
    <div className="wb-card__placeholder" aria-hidden>
      <svg viewBox="0 0 220 130" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="wbgrid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="220" height="130" fill="url(#wbgrid)" />
        {/* A wavy scribble + two boxes + arrow — universally "whiteboardy" */}
        <path d="M 20 80 Q 40 50, 60 70 T 110 75" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2" fill="none" strokeLinecap="round" />
        <rect x="130" y="40" width="44" height="26" rx="4" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2" fill="none" />
        <rect x="160" y="78" width="44" height="26" rx="4" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" fill="none" />
        <path d="M 152 53 L 158 53 M 156 50 L 158 53 L 156 56" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

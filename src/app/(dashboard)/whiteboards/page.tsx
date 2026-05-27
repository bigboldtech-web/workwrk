"use client";

/* Whiteboards — gallery of boards. Not a table.
 *
 * Each board is a tile with thumbnail (or fallback grid pattern), name,
 * last-edited time, surface chip (CRM, Tasks, etc.), and a "Open" CTA
 * that navigates to /whiteboards/[id] where the actual canvas lives.
 * "+ New whiteboard" creates a board and immediately opens it.
 *
 * GET  /api/whiteboards
 * POST /api/whiteboards { name, productSlug? }
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Frame, Plus, Search, Pencil } from "lucide-react";
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

function timeAgo(iso?: string | null): string {
  if (!iso) return "never edited";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
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
      setBoards(data.whiteboards ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("whiteboards");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function createBoard() {
    setCreating(true);
    try {
      const name = window.prompt("Whiteboard name?", "Untitled whiteboard")?.trim();
      if (!name) { setCreating(false); return; }
      const res = await fetch("/api/whiteboards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const wb: ApiWhiteboard = data.whiteboard ?? data.data ?? data;
      router.push(`/whiteboards/${wb.id}`);
    } catch { toast("Couldn't create whiteboard"); }
    finally { setCreating(false); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boards ?? [];
    return (boards ?? []).filter((b) => b.name.toLowerCase().includes(q) || (b.description ?? "").toLowerCase().includes(q));
  }, [boards, search]);

  const total = boards?.length ?? 0;

  return (
    <div className="wb">
      <header className="wb__head">
        <div className="wb__head-l">
          <div className="wb__icon"><Frame /></div>
          <div>
            <h1 className="wb__title">Whiteboards</h1>
            <div className="wb__sub">{boards === null ? "Loading…" : `${total} board${total === 1 ? "" : "s"} · click any tile to open the canvas`}</div>
          </div>
        </div>
        <div className="wb__actions">
          <div className="wb__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a board…" />
          </div>
          <button type="button" className="wb__new" onClick={createBoard} disabled={creating}>
            <Plus /> {creating ? "Creating…" : "New whiteboard"}
          </button>
        </div>
      </header>

      {loadError ? (
        <div className="wb__error">{loadError}</div>
      ) : boards === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="wb__empty">
          <Frame />
          <div>
            <h3>{search ? "Nothing matches that search." : "No whiteboards yet"}</h3>
            <p>{search ? "Try a different name." : "Sketch flows, map architectures, brainstorm anything. Drag, draw, drop sticky notes — the canvas lives at /whiteboards/[id]."}</p>
            {!search && <button type="button" className="wb__new" onClick={createBoard}><Plus /> Create your first whiteboard</button>}
          </div>
        </div>
      ) : (
        <div className="wb__grid">
          {filtered.map((b) => {
            const slug = b.productSlug ?? "general";
            const hue = SLUG_HUE[slug] ?? SLUG_HUE.general;
            return (
              <a key={b.id} href={`/whiteboards/${b.id}`} className="wb-card">
                <div className="wb-card__thumb" style={{ ["--wb-hue" as string]: hue }}>
                  {b.thumbnail ? (
                    <img src={b.thumbnail} alt={b.name} />
                  ) : (
                    <div className="wb-card__placeholder" aria-hidden>
                      <Pencil />
                    </div>
                  )}
                </div>
                <div className="wb-card__body">
                  <h3 className="wb-card__name">{b.name}</h3>
                  {b.description ? <p className="wb-card__desc">{b.description}</p> : null}
                  <div className="wb-card__meta">
                    <span className="wb-card__slug" style={{ background: hue }}>{SLUG_LABEL[slug] ?? slug}</span>
                    <span className="wb-card__time">{timeAgo(b.lastEditedAt)}</span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

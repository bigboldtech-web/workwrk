"use client";

/* Dev · Roadmap — quarterly outcome grid.
 *
 * Now / Next / Later columns (mapped from RoadmapStatus). Each item
 * card: theme chip, priority pill (P0/P1/P2/P3), effort × impact dots,
 * quarter tag, owner, parent breadcrumb. Hide done by default.
 *
 * GET /api/dev/roadmap
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Map as MapIcon, Plus, Sparkles, ChevronRight } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type Priority = "P0" | "P1" | "P2" | "P3";
type Status = "EXPLORING" | "VALIDATING" | "BUILDING" | "SHIPPED" | "ARCHIVED";

type ApiItem = {
  id: string; title: string; description?: string | null;
  theme?: string | null; priority: Priority; status: Status;
  quarter?: string | null; ownerId?: string | null;
  effortPoints?: number | null; impactScore?: number | null;
  parentId?: string | null;
  publicVisible: boolean;
};

const STATUS_LABEL: Record<Status, string> = {
  EXPLORING: "Exploring", VALIDATING: "Validating", BUILDING: "Building",
  SHIPPED: "Shipped", ARCHIVED: "Archived",
};
const STATUS_HUE: Record<Status, string> = {
  EXPLORING: "var(--os-c-indigo)", VALIDATING: "var(--os-c-purple)",
  BUILDING: "var(--os-c-orange)", SHIPPED: "var(--os-c-green)", ARCHIVED: "var(--os-c-darkgray)",
};
const COL_ORDER: Status[] = ["EXPLORING", "VALIDATING", "BUILDING", "SHIPPED"];

const PRIO_HUE: Record<Priority, string> = {
  P0: "var(--os-c-red)", P1: "var(--os-c-orange)",
  P2: "var(--os-c-blue)", P3: "var(--os-c-darkgray)",
};

export default function DevRoadmapPage() {
  const [items, setItems] = useState<ApiItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/roadmap");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.data ?? data.items ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("dev");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const themes = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items ?? []) {
      if (!i.theme) continue;
      m.set(i.theme, (m.get(i.theme) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) => b - a);
  }, [items]);

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (activeTheme) list = list.filter((i) => i.theme === activeTheme);
    return list.filter((i) => i.status !== "ARCHIVED");
  }, [items, activeTheme]);

  const grouped = useMemo(() => {
    const m = new Map<Status, ApiItem[]>();
    for (const s of COL_ORDER) m.set(s, []);
    const prioRank: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    for (const i of filtered) m.get(i.status)?.push(i);
    for (const [, arr] of m) arr.sort((a, b) => prioRank[a.priority] - prioRank[b.priority]);
    return m;
  }, [filtered]);

  const total = items?.length ?? 0;
  const shippedThisQ = (items ?? []).filter((i) => i.status === "SHIPPED").length;

  return (
    <div className="rmap">
      <header className="rmap__head">
        <div className="rmap__head-l">
          <div className="rmap__icon"><MapIcon /></div>
          <div>
            <h1 className="rmap__title">Roadmap</h1>
            <div className="rmap__sub">
              {items === null ? "Loading…" : `${total} item${total === 1 ? "" : "s"} · ${shippedThisQ} shipped · ${themes.length} theme${themes.length === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>
        <button type="button" className="rmap__new"><Plus /> New item</button>
      </header>

      {themes.length > 0 && (
        <nav className="rmap__themes">
          <button type="button" className={!activeTheme ? "is-active" : ""} onClick={() => setActiveTheme(null)}>All themes <em>{total}</em></button>
          {themes.map(([t, n]) => (
            <button key={t} type="button" className={activeTheme === t ? "is-active" : ""} onClick={() => setActiveTheme(t)}>{t} <em>{n}</em></button>
          ))}
        </nav>
      )}

      {loadError ? (
        <div className="rmap__error">{loadError}</div>
      ) : items === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : (items ?? []).length === 0 ? (
        <div className="rmap__empty">
          <Sparkles />
          <div>
            <h3>Your roadmap is empty</h3>
            <p>Capture the bets you&apos;re making this quarter — themed, prioritised, sized.</p>
          </div>
        </div>
      ) : (
        <div className="rmap__cols">
          {COL_ORDER.map((s) => {
            const items = grouped.get(s) ?? [];
            return (
              <section key={s} className="rmap__col">
                <header style={{ borderTop: `3px solid ${STATUS_HUE[s]}` }}>
                  <h2>{STATUS_LABEL[s]}</h2>
                  <span>{items.length}</span>
                </header>
                <div className="rmap__col-body">
                  {items.length === 0 ? (
                    <div className="rmap__col-empty">—</div>
                  ) : items.map((i) => (
                    <article key={i.id} className="rmap-item">
                      <header>
                        <span className="rmap-item__prio" style={{ background: PRIO_HUE[i.priority] }}>{i.priority}</span>
                        {i.theme && <span className="rmap-item__theme">{i.theme}</span>}
                        {i.quarter && <span className="rmap-item__q">{i.quarter}</span>}
                      </header>
                      <h3>{i.title}</h3>
                      {i.description && <p>{i.description.length > 120 ? i.description.slice(0, 120) + "…" : i.description}</p>}
                      <footer>
                        {i.effortPoints != null && <span>Effort: {i.effortPoints}pts</span>}
                        {i.impactScore != null && <span>· Impact {i.impactScore}/10</span>}
                      </footer>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

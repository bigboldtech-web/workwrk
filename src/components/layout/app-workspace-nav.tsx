"use client";

// AppWorkspaceNav — Phase 4 of the monday polish.
//
// When the user is inside an app surface (e.g. /crm), this column is
// the app's *workspace* — the monday-dev "Tasks / Epics / Bugs Queue"
// tree shown in the second column. It replaces ProductSubNav, which
// only showed sibling products in the same suite.
//
// Layout:
//   Workspace eyebrow + product name
//   ▾ Workspace switcher (single workspace for v1; team-level
//     workspaces — Sales Team A, Sales Team B — land in a later pass)
//   Boards section (Pipeline / Leads / Accounts / …)
//   Other apps in this suite
//   Workspace home link
//
// When the active product has no boards declared in PRODUCT_BOARDS,
// we degrade to the previous suite-sibling layout so nothing breaks
// for products mid-conversion.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Home, Box, Sparkles, Plus, ChevronDown, Check, Loader2, X,
  Users as UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { WorkspaceMembersDialog } from "@/components/layout/workspace-members-dialog";
import {
  CalendarDays, BookOpen, Crosshair, MessageSquare, PenTool, Heart,
  Users, Briefcase, Star, GraduationCap, Banknote, TrendingUp,
  ShoppingCart, Package, Headphones, Megaphone, Code, Scale,
  DollarSign, Receipt, FileText, BookText, Target, Shield, Truck,
} from "lucide-react";
import { PRODUCT_CATALOG, type CatalogProduct } from "@/lib/products/catalog";
import { CONVERTED_PRODUCTS, PRODUCT_BOARDS, type ProductBoard } from "@/lib/products/boards";
import { useRole } from "@/hooks/use-role";

const ICON_MAP: Record<string, LucideIcon> = {
  CalendarDays, BookOpen, Crosshair, MessageSquare, PenTool, Heart,
  Users, Briefcase, Star, GraduationCap, Banknote, TrendingUp,
  ShoppingCart, Package, Headphones, Megaphone, Code, Scale,
  DollarSign, Receipt, FileText, BookText, Target, Shield, Truck,
};

const SUITE_LABEL: Record<CatalogProduct["suite"], string> = {
  CROSS: "Workspace",
  SALES: "Sales",
  MARKETING: "Marketing",
  ENGINEERING: "Engineering",
  IT: "IT",
  SUPPORT: "Support",
  PEOPLE: "HR & People",
  OPERATIONS: "Operations",
  FINANCE: "Finance",
  LEGAL: "Legal",
};

function findProductForPath(pathname: string): CatalogProduct | null {
  let best: CatalogProduct | null = null;
  let bestLen = 0;
  for (const p of PRODUCT_CATALOG) {
    if (!p.pathPrefix) continue;
    if (pathname === p.pathPrefix || pathname.startsWith(p.pathPrefix + "/")) {
      if (p.pathPrefix.length > bestLen) {
        best = p;
        bestLen = p.pathPrefix.length;
      }
    }
  }
  return best;
}

function shortName(product: CatalogProduct): string {
  return product.name.replace(/^WorkwrK\s+/, "");
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  color: string | null;
  description: string | null;
  memberCount: number;
}

/** localStorage key for the user's last-active workspace per product —
 *  so reloading /crm puts them back into the workspace they were
 *  using. The server doesn't need to know yet; this is a UI hint
 *  until data-scoping by workspace lands. */
function activeWsStorageKey(productSlug: string) {
  return `workwrk.activeWorkspace.${productSlug}`;
}

export function AppWorkspaceNav() {
  const pathname = usePathname();
  const { isAdmin, isManager } = useRole();
  const showManagerBoards = isAdmin || isManager;
  const canCreateWorkspace = isAdmin || isManager;

  // Workspace switcher state. Lives per-product: fetched from
  // /api/workspaces?product=<slug>, persisted in localStorage so the
  // user lands back in the same workspace on reload. Hooks must run
  // unconditionally, so they sit ABOVE the early-null return below.
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [wsLoading, setWsLoading] = useState(false);
  const [activeWsId, setActiveWsId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [membersModalWs, setMembersModalWs] = useState<{ id: string; name: string } | null>(null);
  const [newWsName, setNewWsName] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const switcherRef = useRef<HTMLDivElement | null>(null);

  // Resolve the active product slug from the path. We do it eagerly
  // here (vs. inside the effect) so the effect deps stay primitive.
  const currentProductSlug = (() => {
    const p = findProductForPath(pathname);
    return p?.slug ?? null;
  })();

  const loadWorkspaces = useCallback(async (productSlug: string) => {
    setWsLoading(true);
    setWsError(null);
    try {
      const r = await fetch(`/api/workspaces?product=${encodeURIComponent(productSlug)}`);
      if (!r.ok) {
        setWorkspaces([]);
        return;
      }
      const data = await r.json();
      const list: WorkspaceRow[] = data.workspaces ?? [];
      setWorkspaces(list);
      // Restore last-active selection from localStorage, falling back
      // to the default workspace when nothing's been picked yet.
      if (typeof window !== "undefined") {
        const stored = window.localStorage.getItem(activeWsStorageKey(productSlug));
        const match = stored ? list.find((w) => w.id === stored) : null;
        const fallback = list.find((w) => w.isDefault) ?? list[0] ?? null;
        setActiveWsId((match ?? fallback)?.id ?? null);
      }
    } finally {
      setWsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentProductSlug) {
      setWorkspaces([]);
      setActiveWsId(null);
      return;
    }
    loadWorkspaces(currentProductSlug);
  }, [currentProductSlug, loadWorkspaces]);

  // Close the popover when the user clicks anywhere outside it.
  useEffect(() => {
    if (!switcherOpen) return;
    const handler = (e: MouseEvent) => {
      if (!switcherRef.current) return;
      if (!switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
        setNewWsName("");
        setWsError(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [switcherOpen]);

  const selectWorkspace = (id: string) => {
    setActiveWsId(id);
    setSwitcherOpen(false);
    if (typeof window !== "undefined" && currentProductSlug) {
      window.localStorage.setItem(activeWsStorageKey(currentProductSlug), id);
      // Same-tab signal so `useActiveWorkspace` picks up the change
      // without waiting for a focus/storage event. Cross-tab is
      // already handled by the native `storage` event.
      window.dispatchEvent(new CustomEvent("workwrk:workspace-change"));
    }
  };

  // Studio boards inside this (product, workspace) scope — surfaces
  // user-built boards alongside the canonical ones so the workspace
  // nav reflects what the team has actually customized.
  interface StudioBoardRow {
    id: string;
    name: string;
    slug: string;
    layout: "TABLE" | "KANBAN";
  }
  const [studioBoards, setStudioBoards] = useState<StudioBoardRow[]>([]);
  const loadStudioBoards = useCallback(
    async (productSlug: string, workspaceId: string | null) => {
      const params = new URLSearchParams({ product: productSlug });
      if (workspaceId) params.set("workspace", workspaceId);
      try {
        const r = await fetch(`/api/studio/boards?${params.toString()}`);
        if (!r.ok) { setStudioBoards([]); return; }
        const d = await r.json();
        setStudioBoards(
          (d.boards ?? []).map((b: { id: string; name: string; slug: string; layout: "TABLE" | "KANBAN" }) => ({
            id: b.id, name: b.name, slug: b.slug, layout: b.layout,
          })),
        );
      } catch {
        setStudioBoards([]);
      }
    },
    [],
  );

  useEffect(() => {
    if (!currentProductSlug) {
      setStudioBoards([]);
      return;
    }
    loadStudioBoards(currentProductSlug, activeWsId);
  }, [currentProductSlug, activeWsId, loadStudioBoards]);

  const handleCreateWorkspace = async () => {
    if (!currentProductSlug || !newWsName.trim() || creatingWs) return;
    setCreatingWs(true);
    setWsError(null);
    try {
      const r = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: currentProductSlug, name: newWsName.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setWsError(d.error || "Failed to create workspace");
        return;
      }
      // Refresh + jump into the new one so the user sees it active.
      await loadWorkspaces(currentProductSlug);
      if (d.workspace?.id) selectWorkspace(d.workspace.id);
      setNewWsName("");
    } finally {
      setCreatingWs(false);
    }
  };

  const current = findProductForPath(pathname);
  if (!current) return null;

  // Only show the boards tree once a product's routes have been wired
  // up (CONVERTED_PRODUCTS). Otherwise the workspace nav degrades to
  // the previous "single product link + suite siblings" layout so we
  // don't generate dead links into 404s.
  const boardsWired = CONVERTED_PRODUCTS.has(current.slug);
  const boards = boardsWired ? (PRODUCT_BOARDS[current.slug] ?? []) : [];
  const visibleBoards = boards.filter((b) => !b.managerOnly || showManagerBoards);
  const siblings = PRODUCT_CATALOG
    .filter((p) => p.suite === current.suite && p.pathPrefix && p.slug !== current.slug)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const ProductIcon = ICON_MAP[current.iconKey] ?? Box;
  const suiteLabel = SUITE_LABEL[current.suite];

  const isBoardActive = (board: ProductBoard) => {
    const href = `${current.pathPrefix}/${board.key}`;
    if (pathname === href || pathname.startsWith(href + "/")) return true;
    // /crm landing → pipeline (default) so the default board shows
    // as active when the user is on the bare product path.
    if (board.default && pathname === current.pathPrefix) return true;
    return false;
  };

  return (
    <aside className="app-subnav app-workspace" aria-label={`${shortName(current)} workspace`}>
      {/* Combined app header + workspace switcher. Previously this was
          three stacked stripes (suite eyebrow + product title row +
          workspace switcher button). Collapsed into one row so the
          column reads as one nav, not two. Suite label is invisible
          (the slim AppRail's "Workspace" tab already conveys
          "you are in the workspace area"). */}
      {(() => {
        const active = workspaces.find((w) => w.id === activeWsId) ?? null;
        const wsLabel = active?.name ?? (wsLoading ? "" : "Main workspace");
        return (
          <div ref={switcherRef} className="app-workspace-switcher-wrap">
            <button
              type="button"
              className="app-workspace-header-row"
              title={`Switch workspace · ${suiteLabel}`}
              aria-label={`${shortName(current)} · ${wsLabel} · switch workspace`}
              aria-expanded={switcherOpen}
              onClick={() => setSwitcherOpen((v) => !v)}
            >
              <span className={`app-workspace-icon hue-${current.hue}`} aria-hidden>
                <ProductIcon size={13} />
              </span>
              <span className="app-workspace-header-titles">
                <span className="app-workspace-header-name truncate">{shortName(current)}</span>
                <span className="app-workspace-header-ws truncate">
                  {wsLoading && !active ? "Loading…" : wsLabel}
                </span>
              </span>
              <ChevronDown
                size={12}
                className={"app-workspace-switcher-caret" + (switcherOpen ? " is-open" : "")}
                aria-hidden
              />
            </button>

            {switcherOpen && (
              <div className="app-workspace-switcher-pop" role="dialog" aria-label="Workspaces">
                <div className="app-workspace-switcher-heading">
                  <span>Workspaces in {shortName(current)}</span>
                  <button
                    type="button"
                    className="app-workspace-switcher-close"
                    onClick={() => { setSwitcherOpen(false); setNewWsName(""); setWsError(null); }}
                    aria-label="Close"
                  >
                    <X size={11} />
                  </button>
                </div>

                {wsLoading && workspaces.length === 0 ? (
                  <div className="app-workspace-switcher-loading">
                    <Loader2 size={12} className="animate-spin" /> Loading…
                  </div>
                ) : workspaces.length === 0 ? (
                  <div className="app-workspace-switcher-empty">No workspaces yet.</div>
                ) : (
                  <ul className="app-workspace-switcher-list">
                    {workspaces.map((w) => (
                      <li key={w.id} className="app-workspace-switcher-row">
                        <button
                          type="button"
                          className={
                            "app-workspace-switcher-item" +
                            (w.id === activeWsId ? " is-active" : "")
                          }
                          onClick={() => selectWorkspace(w.id)}
                          title={w.description ?? undefined}
                        >
                          <span className={`app-workspace-switcher-dot hue-${current.hue}`} aria-hidden />
                          <span className="app-workspace-switcher-item-name truncate">{w.name}</span>
                          {w.isDefault && (
                            <span className="app-workspace-switcher-tag">Default</span>
                          )}
                          {!w.isDefault && w.memberCount > 0 && (
                            <span className="app-workspace-switcher-meta">{w.memberCount}</span>
                          )}
                          {w.id === activeWsId && (
                            <Check size={11} className="app-workspace-switcher-check" />
                          )}
                        </button>
                        {canCreateWorkspace && (
                          <button
                            type="button"
                            className="app-workspace-switcher-members"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSwitcherOpen(false);
                              setMembersModalWs({ id: w.id, name: w.name });
                            }}
                            title="Manage members"
                            aria-label="Manage members"
                          >
                            <UsersIcon size={10} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canCreateWorkspace && (
                  <div className="app-workspace-switcher-create">
                    <p className="app-workspace-switcher-create-label">New workspace</p>
                    <div className="app-workspace-switcher-create-row">
                      <input
                        type="text"
                        value={newWsName}
                        onChange={(e) => setNewWsName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleCreateWorkspace();
                          }
                        }}
                        placeholder={`e.g. ${shortName(current)} Team B`}
                        disabled={creatingWs}
                        className="app-workspace-switcher-create-input"
                      />
                      <button
                        type="button"
                        onClick={handleCreateWorkspace}
                        disabled={creatingWs || !newWsName.trim()}
                        className="app-workspace-switcher-create-btn"
                      >
                        {creatingWs ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                      </button>
                    </div>
                    {wsError && (
                      <p className="app-workspace-switcher-error">{wsError}</p>
                    )}
                    <p className="app-workspace-switcher-hint">
                      Teams build their own workspaces inside an app — customizations land here in a follow-up.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      <nav className="app-subnav-list app-workspace-list">
        {visibleBoards.length > 0 && (
          <>
            <div className="app-workspace-section-row">
              <span className="app-workspace-section-label">Boards</span>
            </div>

            {visibleBoards.map((board) => {
              const Icon = board.Icon;
              const href = `${current.pathPrefix}/${board.key}`;
              const active = isBoardActive(board);
              return (
                <Link
                  key={board.key}
                  href={href}
                  className={"app-subnav-item" + (active ? " is-active" : "")}
                  aria-current={active ? "page" : undefined}
                  title={board.tagline}
                >
                  <Icon size={14} />
                  <span className="truncate">{board.name}</span>
                </Link>
              );
            })}
          </>
        )}

        {visibleBoards.length === 0 && (
          // Fallback for products that haven't been converted to the
          // boards model yet — keep linking to the product root so
          // the page still loads.
          <Link
            href={current.landingHref ?? current.pathPrefix ?? "#"}
            className={
              "app-subnav-item" +
              (pathname === current.pathPrefix ? " is-active" : "")
            }
          >
            <ProductIcon size={14} />
            <span>{shortName(current)}</span>
          </Link>
        )}

        {/* Studio boards — user-built tables/kanbans scoped to this
            (product, workspace). The "+" link sends the user to Studio
            to author a new one. */}
        <div className="app-workspace-section-row" style={{ marginTop: 6 }}>
          <span className="app-workspace-section-label">Studio boards</span>
          <Link
            href="/studio"
            className="app-workspace-add"
            aria-label="Build a board in Studio"
            title="Build a board in Studio"
          >
            <Plus size={11} />
          </Link>
        </div>
        {studioBoards.length === 0 ? (
          <Link href="/studio" className="app-subnav-item app-workspace-sidekick" title="Open Studio">
            <Plus size={13} />
            <span>Build your team&rsquo;s own board</span>
          </Link>
        ) : (
          studioBoards.map((b) => {
            const href = `/studio/boards/${b.slug}`;
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={b.id}
                href={href}
                className={"app-subnav-item" + (active ? " is-active" : "")}
                aria-current={active ? "page" : undefined}
              >
                <Box size={14} />
                <span className="truncate">{b.name}</span>
              </Link>
            );
          })
        )}

        {/* Per-board AI Sidekick context — every app surface gets a
            scoped sidekick entry that knows the active product. */}
        <div className="app-subnav-divider" />
        <Link
          href={`/sidekick?context=${current.slug}`}
          className="app-subnav-item app-workspace-sidekick"
          title={`Ask Sidekick about ${shortName(current)}`}
        >
          <Sparkles size={14} />
          <span>Sidekick</span>
          <span className="app-workspace-sidekick-tag">AI</span>
        </Link>

        {siblings.length > 0 && (
          <>
            <div className="app-workspace-section-row" style={{ marginTop: 6 }}>
              <span className="app-workspace-section-label">More in {suiteLabel}</span>
            </div>
            {siblings.map((p) => {
              const Icon = ICON_MAP[p.iconKey] ?? Box;
              const href = p.landingHref ?? p.pathPrefix!;
              return (
                <Link
                  key={p.slug}
                  href={href}
                  className="app-subnav-item app-workspace-sibling"
                  title={p.tagline}
                >
                  <Icon size={13} />
                  <span className="truncate">{shortName(p)}</span>
                  {p.status === "COMING_SOON" && (
                    <span className="app-subnav-soon">Soon</span>
                  )}
                </Link>
              );
            })}
          </>
        )}

        <div className="app-subnav-divider" />
        {/* `?stay=1` bypasses the department-aware landing redirect on
            /dashboard so this link lands a Sales person on the actual
            dashboard, not back on /crm. See app/(dashboard)/dashboard/page.tsx. */}
        <Link href="/dashboard?stay=1" className="app-subnav-item app-workspace-home">
          <Home size={13} />
          <span>Workspace home</span>
        </Link>
      </nav>

      {membersModalWs && (
        <WorkspaceMembersDialog
          workspaceId={membersModalWs.id}
          workspaceName={membersModalWs.name}
          onClose={() => setMembersModalWs(null)}
        />
      )}
    </aside>
  );
}

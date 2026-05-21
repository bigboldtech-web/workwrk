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
import {
  Home, Box, Sparkles, Plus, ChevronDown,
  type LucideIcon,
} from "lucide-react";
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

export function AppWorkspaceNav() {
  const pathname = usePathname();
  const { isAdmin, isManager } = useRole();
  const showManagerBoards = isAdmin || isManager;

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
      {/* App header — product name + icon. Hue accent picked up from
          the catalog so each app reads visually distinct. */}
      <header className="app-workspace-header">
        <p className="app-subnav-eyebrow">{suiteLabel}</p>
        <div className="app-workspace-title-row">
          <span className={`app-workspace-icon hue-${current.hue}`} aria-hidden>
            <ProductIcon size={14} />
          </span>
          <h2 className="app-subnav-title">{shortName(current)}</h2>
        </div>
      </header>

      {/* Workspace switcher (single workspace v1; multi-workspace UX
          arrives with team-built customizations in a follow-up pass). */}
      <button
        type="button"
        className="app-workspace-switcher"
        title="Switch workspace"
        // Single-workspace org for now; click is a no-op until the
        // multi-workspace flow lands.
      >
        <span className={`app-workspace-switcher-dot hue-${current.hue}`} aria-hidden />
        <span className="app-workspace-switcher-name truncate">Main workspace</span>
        <ChevronDown size={12} className="app-workspace-switcher-caret" aria-hidden />
      </button>

      <nav className="app-subnav-list app-workspace-list">
        {visibleBoards.length > 0 && (
          <>
            <div className="app-workspace-section-row">
              <span className="app-workspace-section-label">Boards</span>
              <button
                type="button"
                className="app-workspace-add"
                aria-label="Add board"
                title="Add board (Studio)"
              >
                <Plus size={11} />
              </button>
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
        <Link href="/dashboard" className="app-subnav-item app-workspace-home">
          <Home size={13} />
          <span>Workspace home</span>
        </Link>
      </nav>
    </aside>
  );
}

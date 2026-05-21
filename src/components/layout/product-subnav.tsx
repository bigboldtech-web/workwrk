"use client";

// ProductSubNav — Phase 3 of the monday polish.
//
// When the user is inside a product page (e.g. /crm), this column
// renders the *suite workspace* — i.e. all the products that share a
// suite. A Sales user clicking around in CRM sees CRM + Success in
// the sub-nav and can flip between them in one click. Renders null
// when the current path doesn't map to any product (dashboard,
// sidekick, agents, settings, etc.) so the main canvas reflows wide.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Box, type LucideIcon } from "lucide-react";
import {
  CalendarDays, BookOpen, Crosshair, MessageSquare, PenTool, Heart,
  Users, Briefcase, Star, GraduationCap, Banknote, TrendingUp,
  ShoppingCart, Package, Headphones, Megaphone, Code, Scale,
  DollarSign, Receipt, FileText, BookText, Target, Shield, Truck,
} from "lucide-react";
import { PRODUCT_CATALOG, type CatalogProduct } from "@/lib/products/catalog";

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
  // Longest prefix match so /people/[id] still resolves to People.
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

export function ProductSubNav() {
  const pathname = usePathname();
  const current = findProductForPath(pathname);
  if (!current) return null;

  const siblings = PRODUCT_CATALOG
    .filter((p) => p.suite === current.suite && p.pathPrefix)
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const suiteLabel = SUITE_LABEL[current.suite];

  return (
    <aside className="app-subnav" aria-label={`${suiteLabel} workspace`}>
      <header className="app-subnav-header">
        <p className="app-subnav-eyebrow">Workspace</p>
        <h2 className="app-subnav-title">{suiteLabel}</h2>
      </header>

      <nav className="app-subnav-list">
        <Link
          href="/dashboard"
          className="app-subnav-item"
        >
          <Home size={14} />
          <span>Workspace home</span>
        </Link>

        <div className="app-subnav-divider" />

        {siblings.map((p) => {
          const Icon = ICON_MAP[p.iconKey] ?? Box;
          const active = p.slug === current.slug;
          const href = p.pathPrefix!;
          const shortName = p.name.replace(/^WorkwrK\s+/, "");
          return (
            <Link
              key={p.slug}
              href={href}
              className={"app-subnav-item" + (active ? " is-active" : "")}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={14} />
              <span>{shortName}</span>
              {p.status === "COMING_SOON" && (
                <span className="app-subnav-soon">Soon</span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

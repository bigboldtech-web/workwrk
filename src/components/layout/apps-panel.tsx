"use client";

// AppsPanel — Phase 2. Opens from the top-right grid icon, mirrors
// monday.com's "Work OS products" picker. Reads the canonical
// catalog and groups by suite so the Sales person sees CRM/Success
// together, the HR person sees People/Recruit/Perform/Learn/Pay/
// Benefits together, etc.
//
// Apps render as compact tiles — icon + name + tagline. Clicking a
// tile routes to that product's pathPrefix.

import Link from "next/link";
import { useState } from "react";
import { PRODUCT_CATALOG, type CatalogProduct } from "@/lib/products/catalog";
import {
  CalendarDays, BookOpen, Crosshair, MessageSquare, PenTool, Heart,
  Users, Briefcase, Star, GraduationCap, Banknote, TrendingUp,
  ShoppingCart, Package, Headphones, Megaphone, Code, Scale,
  DollarSign, Receipt, FileText, BookText, Target, Shield, Truck,
  Box, Search as SearchIcon,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  CalendarDays, BookOpen, Crosshair, MessageSquare, PenTool, Heart,
  Users, Briefcase, Star, GraduationCap, Banknote, TrendingUp,
  ShoppingCart, Package, Headphones, Megaphone, Code, Scale,
  DollarSign, Receipt, FileText, BookText, Target, Shield, Truck,
  Box,
};

// Suite → human label + display order. Anything not listed falls to
// the bottom under "Other".
const SUITE_LABELS: { suite: CatalogProduct["suite"]; label: string }[] = [
  { suite: "CROSS", label: "Workspace" },
  { suite: "SALES", label: "Sales" },
  { suite: "MARKETING", label: "Marketing" },
  { suite: "ENGINEERING", label: "Engineering" },
  { suite: "IT", label: "IT" },
  { suite: "SUPPORT", label: "Support" },
  { suite: "PEOPLE", label: "HR & People" },
  { suite: "OPERATIONS", label: "Operations" },
  { suite: "FINANCE", label: "Finance" },
  { suite: "LEGAL", label: "Legal" },
];

const HUE_BG: Record<CatalogProduct["hue"], string> = {
  blue: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300",
  green: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300",
  violet: "bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300",
  pink: "bg-pink-50 dark:bg-pink-950/30 text-pink-700 dark:text-pink-300",
  teal: "bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300",
  sky: "bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300",
  rose: "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300",
  lime: "bg-lime-50 dark:bg-lime-950/30 text-lime-700 dark:text-lime-300",
  slate: "bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300",
};

interface AppsPanelProps {
  onClose: () => void;
}

export function AppsPanel({ onClose }: AppsPanelProps) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (p: CatalogProduct) =>
    !q || p.name.toLowerCase().includes(q) || p.tagline.toLowerCase().includes(q);

  return (
    <>
      <button
        type="button"
        aria-label="Close apps panel"
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />
      <div
        className="fixed top-14 right-4 z-50 w-[420px] max-h-[78vh] overflow-y-auto rounded-xl border border-border bg-surface shadow-2xl"
        role="dialog"
        aria-label="Work OS products"
      >
        <div className="sticky top-0 z-10 bg-surface border-b border-border px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Work OS products</p>
            <Link
              href="/store"
              onClick={onClose}
              className="text-xs text-violet-600 hover:text-violet-700"
            >
              Browse all →
            </Link>
          </div>
          <div className="relative">
            <SearchIcon size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products…"
              className="w-full pl-7 pr-3 py-1.5 rounded-md border border-border bg-surface-2 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500"
              autoFocus
            />
          </div>
        </div>

        <div className="p-3 space-y-4">
          {SUITE_LABELS.map(({ suite, label }) => {
            const items = PRODUCT_CATALOG
              .filter((p) => p.suite === suite)
              .filter(matches)
              .sort((a, b) => a.displayOrder - b.displayOrder);
            if (items.length === 0) return null;
            return (
              <section key={suite}>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-2 mb-1.5 px-1">
                  {label}
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map((p) => {
                    const Icon = ICON_MAP[p.iconKey] ?? Box;
                    const href = p.pathPrefix ?? `/store/${p.slug}`;
                    return (
                      <Link
                        key={p.slug}
                        href={href}
                        onClick={onClose}
                        className="group flex items-center gap-2 rounded-lg border border-transparent hover:border-border hover:bg-surface-2 px-2 py-1.5 transition-colors"
                      >
                        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${HUE_BG[p.hue]}`}>
                          <Icon size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-foreground truncate">{p.name.replace(/^WorkwrK\s+/, "")}</span>
                          <span className="block text-[10px] text-muted-2 truncate">{p.tagline}</span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {q && PRODUCT_CATALOG.filter(matches).length === 0 && (
            <p className="text-xs text-muted-2 text-center py-6">No products match &ldquo;{query}&rdquo;</p>
          )}
        </div>
      </div>
    </>
  );
}

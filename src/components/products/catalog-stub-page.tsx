"use client";

// CatalogStubPage — a friendly "coming soon" landing for product
// slugs declared in the catalog (`status: COMING_SOON`) whose route
// files haven't been built yet. Replaces the bare 404 that clicking
// these from /store or the Apps Panel used to produce, and gives the
// AI marketplace a path to flesh out before launch.
//
// Each stub reads from PRODUCT_CATALOG so the icon, tagline, suite,
// seeded-agents list, and description stay in one place — drop the
// real route in later and the stub falls out of the rotation
// automatically.

import Link from "next/link";
import {
  Sparkles, Bell, ArrowLeft, Box,
  CalendarDays, BookOpen, Crosshair, MessageSquare, PenTool, Heart,
  Users, Briefcase, Star, GraduationCap, Banknote, TrendingUp,
  ShoppingCart, Package, Headphones, Megaphone, Code, Scale,
  DollarSign, Receipt, FileText, BookText, Target, Shield, Truck,
  Activity, type LucideIcon,
} from "lucide-react";
import { PRODUCT_CATALOG } from "@/lib/products/catalog";

const ICON_MAP: Record<string, LucideIcon> = {
  CalendarDays, BookOpen, Crosshair, MessageSquare, PenTool, Heart,
  Users, Briefcase, Star, GraduationCap, Banknote, TrendingUp,
  ShoppingCart, Package, Headphones, Megaphone, Code, Scale,
  DollarSign, Receipt, FileText, BookText, Target, Shield, Truck, Activity,
};

const HUE_BG: Record<string, string> = {
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

interface Props {
  slug: string;
}

export function CatalogStubPage({ slug }: Props) {
  const product = PRODUCT_CATALOG.find((p) => p.slug === slug);
  if (!product) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <Link href="/store" className="text-xs text-violet-600 hover:text-violet-700 inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={12} /> Back to Product Store
        </Link>
        <h1 className="text-xl font-semibold mb-1">Product not found</h1>
        <p className="text-sm text-muted-2">No product registered for slug &ldquo;{slug}&rdquo;.</p>
      </div>
    );
  }
  const Icon = ICON_MAP[product.iconKey] ?? Box;
  const hueClasses = HUE_BG[product.hue] ?? HUE_BG.slate;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <Link href="/store" className="text-xs text-muted-2 hover:text-foreground inline-flex items-center gap-1 mb-6">
        <ArrowLeft size={12} /> Back to Product Store
      </Link>

      <div className="rounded-2xl border border-dashed border-violet-300/40 dark:border-violet-700/40 bg-gradient-to-br from-violet-50/40 to-transparent dark:from-violet-950/20 p-8">
        <div className="flex items-start gap-4 mb-5">
          <span className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl ${hueClasses}`}>
            <Icon size={24} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[10px] font-semibold uppercase tracking-wider mb-2">
              <Sparkles size={10} /> Coming soon
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">{product.name}</h1>
            <p className="text-sm text-muted">{product.tagline}</p>
          </div>
        </div>

        <p className="text-sm text-foreground/80 leading-relaxed mb-5">
          {product.description}
        </p>

        {product.seededAgents && product.seededAgents.length > 0 && (
          <div className="mb-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-2 mb-1.5">Ships with these agents</p>
            <div className="flex flex-wrap gap-1.5">
              {product.seededAgents.map((a) => (
                <span key={a} className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-foreground/80 font-mono">
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}

        {product.seededTemplates && product.seededTemplates.length > 0 && (
          <div className="mb-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-2 mb-1.5">Starter templates</p>
            <div className="flex flex-wrap gap-1.5">
              {product.seededTemplates.map((t) => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-foreground/80">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-3 border-t border-violet-200/40 dark:border-violet-800/40">
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-medium opacity-60 cursor-not-allowed"
          >
            <Bell size={12} /> Notify me when it ships
          </button>
          <Link
            href="/store"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-muted hover:text-foreground hover:bg-surface text-xs font-medium"
          >
            Browse other products
          </Link>
        </div>

        <p className="text-[11px] text-muted-2 mt-4">
          In the meantime: most teams build a custom version of this in <Link href="/studio" className="underline text-violet-600 hover:text-violet-700">Studio</Link> — same data shape, your own columns, deploys instantly.
        </p>
      </div>
    </div>
  );
}

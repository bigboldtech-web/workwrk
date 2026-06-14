// Marketing topbar — restrained, ClickUp-style. White surface, hairline
// border on scroll, slate links, BLACK pill CTA (no rainbow). Mega
// menus drop quiet white cards.

"use client";

import Link from "next/link";
import { appHref } from "@/lib/app-url";
import { useEffect, useState, useRef } from "react";
import { ChevronDown, ArrowRight, Menu, X } from "lucide-react";
import { LogoLockup } from "@/components/brand/logo";
import { HUBS, HUES } from "@/components/marketing/primitives";

export function MarketingTopbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<"product" | "solutions" | "resources" | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 backdrop-blur transition-colors ${
        scrolled
          ? "bg-white/90 border-b border-slate-200"
          : "bg-white/70 border-b border-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center group flex-shrink-0"
          aria-label="workwrk home"
        >
          <LogoLockup size={20} />
        </Link>

        <nav className="hidden lg:flex items-center gap-1 text-sm">
          <MenuTrigger
            label="Product"
            isOpen={openMenu === "product"}
            onEnter={() => setOpenMenu("product")}
            onLeave={() => setOpenMenu(null)}
          >
            <ProductMenu />
          </MenuTrigger>
          <MenuTrigger
            label="Solutions"
            isOpen={openMenu === "solutions"}
            onEnter={() => setOpenMenu("solutions")}
            onLeave={() => setOpenMenu(null)}
          >
            <SolutionsMenu />
          </MenuTrigger>
          <FlatLink href="/pricing">Pricing</FlatLink>
          <FlatLink href="/customers">Customers</FlatLink>
          <MenuTrigger
            label="Resources"
            isOpen={openMenu === "resources"}
            onEnter={() => setOpenMenu("resources")}
            onLeave={() => setOpenMenu(null)}
          >
            <ResourcesMenu />
          </MenuTrigger>
        </nav>

        <div className="hidden sm:flex items-center gap-1">
          <Link
            href={appHref("/login")}
            className="text-sm text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg transition-colors"
          >
            Log in
          </Link>
          <Link
            href="/demo"
            className="hidden md:inline-flex items-center text-sm text-slate-700 hover:text-slate-900 px-3 py-2 rounded-lg font-medium transition-colors"
          >
            Get a demo
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center h-9 px-4 rounded-full bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors"
          >
            Sign up
          </Link>
        </div>

        <button
          className="lg:hidden p-2 -mr-2 rounded-lg hover:bg-slate-100 transition-colors"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={22} className="text-slate-700" />
        </button>
      </div>

      {mobileOpen && <MobileMenu onClose={() => setMobileOpen(false)} />}
    </header>
  );
}

// ── Menu trigger ──────────────────────────────────────────────────────

function MenuTrigger({
  label,
  isOpen,
  onEnter,
  onLeave,
  children,
}: {
  label: string;
  isOpen: boolean;
  onEnter: () => void;
  onLeave: () => void;
  children: React.ReactNode;
}) {
  const closeTimer = useRef<NodeJS.Timeout | null>(null);

  const handleEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    onEnter();
  };
  const handleLeave = () => {
    closeTimer.current = setTimeout(onLeave, 120);
  };

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        className={`px-3.5 py-2 rounded-lg font-medium flex items-center gap-1 transition-colors ${
          isOpen ? "text-slate-900" : "text-slate-600 hover:text-slate-900"
        }`}
        type="button"
      >
        {label}
        <ChevronDown
          size={13}
          className={`opacity-50 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full pt-3 z-50">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-[0_20px_50px_-20px_rgba(15,23,42,0.18)] overflow-hidden">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

function FlatLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3.5 py-2 rounded-lg text-slate-600 hover:text-slate-900 font-medium transition-colors"
    >
      {children}
    </Link>
  );
}

// ── Product mega menu ────────────────────────────────────────────────

function ProductMenu() {
  return (
    <div className="w-[600px] p-5 grid grid-cols-2 gap-1">
      <p className="col-span-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 px-3 pb-3">
        7 hubs · one platform
      </p>
      {HUBS.map((hub) => {
        const t = HUES[hub.hue];
        return (
          <Link
            key={hub.slug}
            href={`/features#${hub.slug}`}
            className="group flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center ${t.bgTint} ${t.text} text-sm font-bold flex-shrink-0`}
            >
              {hub.name[0]}
            </div>
            <div>
              <p className="font-semibold text-slate-900 text-sm leading-none">
                {hub.name}
              </p>
              <p className="text-xs text-slate-500 mt-1">{hub.tagline}</p>
            </div>
          </Link>
        );
      })}
      <Link
        href="/features"
        className="col-span-2 mt-2 flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <span className="text-sm font-semibold text-slate-900">See all features</span>
        <ArrowRight size={14} className="text-slate-500" />
      </Link>
    </div>
  );
}

// ── Solutions mega menu ──────────────────────────────────────────────

const INDUSTRIES: readonly { slug: string; name: string; desc: string }[] = [
  { slug: "technology",    name: "Technology",    desc: "Eng + GTM under one OS" },
  { slug: "healthcare",    name: "Healthcare",    desc: "Compliance-grade workflows" },
  { slug: "manufacturing", name: "Manufacturing", desc: "Shop floor + SOP + KPI" },
  { slug: "logistics",     name: "Logistics",     desc: "Fleet, hubs, daily routes" },
  { slug: "services",      name: "Services",      desc: "Projects, billables, capacity" },
  { slug: "sales",         name: "Sales",         desc: "Pipeline + people in one" },
  { slug: "real-estate",   name: "Real Estate",   desc: "Listings, leads, deals" },
];

function SolutionsMenu() {
  return (
    <div className="w-[520px] p-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 px-3 pb-3">
        Built for your industry
      </p>
      <div className="grid grid-cols-2 gap-1">
        {INDUSTRIES.map((ind) => (
          <Link
            key={ind.slug}
            href={`/industries/${ind.slug}`}
            className="group flex flex-col gap-0.5 p-3 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <p className="font-semibold text-slate-900 text-sm">{ind.name}</p>
            <p className="text-xs text-slate-500">{ind.desc}</p>
          </Link>
        ))}
      </div>
      <Link
        href="/industries"
        className="mt-3 flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <span className="text-sm font-semibold text-slate-900">All industries</span>
        <ArrowRight size={14} className="text-slate-500" />
      </Link>
    </div>
  );
}

// ── Resources mega menu ──────────────────────────────────────────────

function ResourcesMenu() {
  const RESOURCES: readonly { label: string; desc: string; href: string }[] = [
    { label: "Help Center", desc: "Guides, troubleshooting, onboarding", href: "/help-center" },
    { label: "Blog",        desc: "Operator playbooks + product news",   href: "/blog" },
    { label: "Changelog",   desc: "What shipped, week by week",          href: "/changelog" },
    { label: "Roadmap",     desc: "What's next on the build",            href: "/roadmap" },
    { label: "Developers",  desc: "API, SDKs, embeds",                   href: "/developers" },
    { label: "Security",    desc: "How we keep your data safe",          href: "/security" },
    { label: "FAQ",         desc: "Quick answers to common questions",   href: "/faq" },
    { label: "Compare",     desc: "How workwrk stacks up",               href: "/compare" },
  ];
  return (
    <div className="w-[520px] p-5 grid grid-cols-2 gap-1">
      {RESOURCES.map((r) => (
        <Link
          key={r.href}
          href={r.href}
          className="flex flex-col gap-0.5 p-3 rounded-xl hover:bg-slate-50 transition-colors"
        >
          <span className="font-semibold text-slate-900 text-sm">{r.label}</span>
          <span className="text-xs text-slate-500">{r.desc}</span>
        </Link>
      ))}
    </div>
  );
}

// ── Mobile drawer ────────────────────────────────────────────────────

function MobileMenu({ onClose }: { onClose: () => void }) {
  return (
    <div className="lg:hidden fixed inset-0 z-50 bg-white overflow-y-auto">
      <div className="flex items-center justify-between h-16 px-6 border-b border-slate-200">
        <Link href="/" onClick={onClose} className="flex items-center">
          <LogoLockup size={19} />
        </Link>
        <button
          onClick={onClose}
          className="p-2 -mr-2 rounded-lg hover:bg-slate-100"
          aria-label="Close menu"
        >
          <X size={22} className="text-slate-700" />
        </button>
      </div>
      <div className="px-6 py-6 space-y-8">
        <nav className="flex flex-col text-base font-semibold text-slate-900 divide-y divide-slate-100">
          <Link href="/features"    onClick={onClose} className="py-3.5">Product</Link>
          <Link href="/industries"  onClick={onClose} className="py-3.5">Solutions</Link>
          <Link href="/pricing"     onClick={onClose} className="py-3.5">Pricing</Link>
          <Link href="/customers"   onClick={onClose} className="py-3.5">Customers</Link>
          <Link href="/blog"        onClick={onClose} className="py-3.5">Blog</Link>
          <Link href="/help-center" onClick={onClose} className="py-3.5">Resources</Link>
        </nav>
        <div className="space-y-2 pt-2">
          <Link
            href="/signup"
            onClick={onClose}
            className="flex items-center justify-center h-12 rounded-full bg-slate-900 text-white font-semibold"
          >
            Sign up
          </Link>
          <Link
            href="/demo"
            onClick={onClose}
            className="flex items-center justify-center h-12 rounded-full border border-slate-200 text-slate-900 font-semibold"
          >
            Get a demo
          </Link>
          <Link
            href={appHref("/login")}
            onClick={onClose}
            className="block text-center py-3 text-sm text-slate-600"
          >
            Already have an account? Log in
          </Link>
        </div>
      </div>
    </div>
  );
}

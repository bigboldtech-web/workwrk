// Reusable white-theme top bar for the marketing site. ClickUp-style:
// sticky on scroll, soft hairline border, accented logo chip, prominent
// purple "Get a demo" button alongside a clean dark "Sign up" CTA.

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, ArrowRight } from "lucide-react";

export function MarketingTopbar() {
  // Solidify the topbar background on scroll — mimics ClickUp's
  // light glass-morphism that turns opaque past the hero fold.
  const [scrolled, setScrolled] = useState(false);
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
          ? "bg-white/95 border-b border-slate-200"
          : "bg-white/70 border-b border-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-900 to-slate-700 flex items-center justify-center group-hover:from-violet-600 group-hover:to-violet-500 transition-colors">
            <span className="text-white text-sm font-bold tracking-tight">W</span>
          </div>
          <span className="font-bold text-base text-slate-900 tracking-tight">workwrk</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-sm text-slate-600">
          <Link href="/features" className="px-3 py-2 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition-colors flex items-center gap-1">
            Product <ChevronDown size={12} className="opacity-60" />
          </Link>
          <Link href="/industries" className="px-3 py-2 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition-colors flex items-center gap-1">
            Solutions <ChevronDown size={12} className="opacity-60" />
          </Link>
          <Link href="/pricing" className="px-3 py-2 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition-colors">
            Pricing
          </Link>
          <Link href="/customers" className="px-3 py-2 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition-colors">
            Customers
          </Link>
          <Link href="/help-center" className="px-3 py-2 rounded-lg hover:bg-slate-100 hover:text-slate-900 transition-colors flex items-center gap-1">
            Resources <ChevronDown size={12} className="opacity-60" />
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden sm:inline-flex text-sm text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg transition-colors">
            Login
          </Link>
          <Link
            href="/demo"
            className="hidden sm:inline-flex items-center gap-1 text-sm text-violet-700 hover:text-violet-800 px-3 py-2 rounded-lg hover:bg-violet-50 transition-colors font-medium"
          >
            Get a demo <ArrowRight size={12} />
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center px-4 h-9 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.18)] transition-all"
          >
            Free Forever
          </Link>
        </div>
      </div>
    </header>
  );
}

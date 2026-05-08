// Reusable white-theme top bar for the marketing site. Extracted
// from the v2 landing so non-home marketing pages can render it via
// the marketing layout without each page re-implementing chrome.

import Link from "next/link";

export function MarketingTopbar() {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-slate-900 flex items-center justify-center">
            <span className="text-white text-xs font-bold">W</span>
          </div>
          <span className="font-semibold text-base text-slate-900">workwrk</span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm text-slate-600">
          <Link href="/features" className="hover:text-slate-900">Product</Link>
          <Link href="/industries" className="hover:text-slate-900">Solutions</Link>
          <Link href="/pricing" className="hover:text-slate-900">Pricing</Link>
          <Link href="/customers" className="hover:text-slate-900">Customers</Link>
          <Link href="/help-center" className="hover:text-slate-900">Resources</Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/demo" className="hidden sm:inline-flex text-sm text-slate-600 hover:text-slate-900">
            Get a demo
          </Link>
          <Link href="/login" className="hidden sm:inline-flex text-sm text-slate-600 hover:text-slate-900">
            Login
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center px-4 h-9 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}

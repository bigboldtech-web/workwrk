"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";

const links = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/industries", label: "Industries" },
  { href: "/blog", label: "Blog" },
  { href: "/about", label: "About" },
];

export function MarketingNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-[100] border-b border-[#2A2A3A]/50 bg-[#0A0A0F]/80 backdrop-blur-xl"
      aria-label="Main navigation"
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
        <Link href="/" className="mkt-logo" aria-label="TheywrK Home">
          theywrk<span style={{ opacity: 0.5 }}>.</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-[#E8E8F0] ${
                pathname === link.href ? "text-[#E8E8F0]" : "text-[#8888A0]"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <Link href="/login" className="btn-outline ml-2">
            Log In
          </Link>
          <Link href="/register" className="btn-primary">
            Start Free Trial
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="text-[#8888A0] md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-[#2A2A3A] bg-[#0A0A0F] px-6 py-6 md:hidden">
          <div className="flex flex-col gap-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`text-sm font-medium ${
                  pathname === link.href ? "text-[#E8E8F0]" : "text-[#8888A0]"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-4 flex flex-col gap-3">
              <Link href="/login" className="btn-outline w-full justify-center">
                Log In
              </Link>
              <Link href="/register" className="btn-primary w-full justify-center">
                Start Free Trial
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

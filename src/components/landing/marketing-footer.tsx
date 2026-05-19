// Marketing footer — ClickUp x Workday fusion.
//   - Rainbow rim at the top (echo of the hero gradients)
//   - Logo lockup + tagline
//   - 5 columns: Product / Solutions / Resources / Company / Legal
//   - Bottom strip: copyright, version, social
//
// Static. No client code needed.

import Link from "next/link";
import { LogoLockup } from "@/components/brand/logo";

export function MarketingFooter() {
  return (
    <footer className="relative bg-white border-t border-slate-200">

      <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-20 pb-10">
        <div className="grid grid-cols-2 md:grid-cols-12 gap-10 lg:gap-14">
          {/* ── Brand column ─────────────────────────────────────── */}
          <div className="col-span-2 md:col-span-4">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <LogoLockup size={24} />
            </Link>
            <p className="mt-5 text-slate-600 leading-relaxed max-w-sm">
              The business operating system for teams who outgrew spreadsheets
              but can&apos;t afford a Workday rollout. People, work, money,
              talent, culture &mdash; one platform.
            </p>
            <div className="mt-6 flex items-center gap-2">
              <SocialBtn href="https://twitter.com/workwrk" label="Twitter">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </SocialBtn>
              <SocialBtn href="https://linkedin.com/company/workwrk" label="LinkedIn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              </SocialBtn>
              <SocialBtn href="https://github.com/workwrk" label="GitHub">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
              </SocialBtn>
            </div>
          </div>

          {/* ── Link columns ─────────────────────────────────────── */}
          <FooterCol
            title="Product"
            links={[
              ["Features",  "/features"],
              ["Pricing",   "/pricing"],
              ["Changelog", "/changelog"],
              ["Roadmap",   "/roadmap"],
              ["Demo",      "/demo"],
            ]}
          />
          <FooterCol
            title="Solutions"
            links={[
              ["Industries", "/industries"],
              ["Customers",  "/customers"],
              ["Compare",    "/compare"],
              ["Partners",   "/partners"],
            ]}
          />
          <FooterCol
            title="Resources"
            links={[
              ["Help Center", "/help-center"],
              ["Blog",        "/blog"],
              ["FAQ",         "/faq"],
              ["Developers",  "/developers"],
              ["Security",    "/security"],
            ]}
          />
          <FooterCol
            title="Company"
            links={[
              ["About",   "/about"],
              ["Careers", "/careers"],
              ["Contact", "/contact"],
              ["Privacy", "/privacy"],
              ["Terms",   "/terms"],
            ]}
          />
        </div>

        <div className="mt-16 pt-8 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
          <span>&copy; {new Date().getFullYear()} WorkwrK Technologies. All rights reserved.</span>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-slate-700 transition">Privacy</Link>
            <Link href="/terms" className="hover:text-slate-700 transition">Terms</Link>
            <Link href="/cookies" className="hover:text-slate-700 transition">Cookies</Link>
            <Link href="/do-not-sell" className="hover:text-slate-700 transition">Do not sell my info</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<[string, string]>;
}) {
  return (
    <div className="col-span-1 md:col-span-2">
      <p className="font-bold text-slate-900 mb-4 text-sm tracking-tight">{title}</p>
      <ul className="space-y-2.5">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link
              href={href}
              className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SocialBtn({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="w-9 h-9 inline-flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-900 hover:text-white transition-colors"
    >
      {children}
    </Link>
  );
}

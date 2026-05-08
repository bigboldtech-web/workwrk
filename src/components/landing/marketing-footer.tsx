// Reusable white-theme footer for the marketing site.

import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="bg-white border-t border-slate-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-16 grid grid-cols-2 md:grid-cols-5 gap-8 text-sm">
        <div className="col-span-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-slate-900 flex items-center justify-center">
              <span className="text-white text-xs font-bold">W</span>
            </div>
            <span className="font-semibold text-slate-900">workwrk</span>
          </div>
          <p className="mt-4 text-slate-500 max-w-sm">
            One platform to run people, process, performance, spend, and
            growth. Built for teams who outgrew spreadsheets but can't
            afford Workday.
          </p>
        </div>
        <FooterCol title="Product" links={[
          ["Features", "/features"],
          ["Pricing", "/pricing"],
          ["Changelog", "/changelog"],
          ["Roadmap", "/roadmap"],
          ["Security", "/security"],
        ]} />
        <FooterCol title="Solutions" links={[
          ["Industries", "/industries"],
          ["Customers", "/customers"],
          ["Partners", "/partners"],
          ["Compare", "/compare"],
        ]} />
        <FooterCol title="Company" links={[
          ["About", "/about"],
          ["Blog", "/blog"],
          ["Help center", "/help-center"],
          ["Contact", "/contact"],
          ["Privacy", "/privacy"],
          ["Terms", "/terms"],
        ]} />
      </div>
      <div className="border-t border-slate-100 px-6 lg:px-10 py-6 text-xs text-slate-400 max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <span>© {new Date().getFullYear()} WorkWrk. All rights reserved.</span>
        <span className="font-mono">v4.0</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <p className="font-semibold text-slate-900 mb-4">{title}</p>
      <ul className="space-y-2.5">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-slate-500 hover:text-slate-900 transition-colors">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

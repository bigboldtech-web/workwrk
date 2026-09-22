// The marketing footer (marketing-concept.md 3 row 13).
//
// "product, modules, compare, how it connects, pricing, security, status,
// docs, log in, locale and currency, legal, badges once true."
//
// Two things are deliberately absent. There are no badge rows, because the
// badges are not held: the slots exist in the layout and the flags are
// false. And there are no social links, because the three that used to sit
// here pointed at profiles nothing in this repo proves exist, and a footer
// link to an empty profile is a small broken promise at the bottom of every
// page. Both come back the day someone confirms them.
//
// Every row below resolves today. A column only lists routes that ship.

import Link from "next/link";
import { LogoLockup } from "@/components/brand/logo";
import { flags } from "./config";
import { tuesday } from "./data/tuesday";
import { MODULE_ORDER, moduleHref } from "./product/module-page";
import "./shell/marketing-shell.css";
import "./footer.css";

interface FooterLink {
  label: string;
  href: string;
  shipped?: boolean;
}

const COLUMNS: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      // Back, with the surface. It was listed here behind shipped: false
      // while /how-it-connects had no page, which is a link to a blank page
      // rather than a link to a page that is nearly ready.
      { label: "How it connects", href: "/how-it-connects" },
      { label: "Pricing", href: "/pricing" },
      { label: "Compare", href: "/compare" },
      { label: "Price your stack", href: "/compare/your-stack" },
      { label: "Changelog", href: "/changelog" },
      { label: "Roadmap", href: "/roadmap" },
    ],
  },
  {
    // The eight module pages. A footer column is where a visitor who knows
    // which part they came for goes looking.
    //
    // "The parts", not "The blocks". The home page rebuild settled the word:
    // it says "Eight parts. One record.", and this heading sat directly
    // under that sentence on the same screen saying something else. The
    // links, their order and their destinations are unchanged. /features and
    // the eight chapter pages still say "blocks" in their own bodies, which
    // is a sweep for whoever owns those pages.
    title: "The parts",
    links: MODULE_ORDER.map((id) => ({
      label: tuesday.hubs.find((h) => h.id === id)?.label ?? id,
      href: moduleHref(id),
    })),
  },
  {
    title: "Solutions",
    links: [
      { label: "Industries", href: "/industries" },
      { label: "Partners", href: "/partners" },
      { label: "Customers", href: "/customers", shipped: flags.customersNavLink },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Help Center", href: "/help-center" },
      { label: "Blog", href: "/blog" },
      { label: "FAQ", href: "/faq" },
      { label: "Developers", href: "/developers" },
      { label: "Security", href: "/security" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
      { label: "Book a demo", href: "/demo" },
    ],
  },
];

const LEGAL: FooterLink[] = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Cookies", href: "/cookies" },
  { label: "Do not sell my info", href: "/do-not-sell" },
];

export function MarketingFooterV2() {
  const year = new Date().getFullYear();
  return (
    // `mk-type`, not `mk-os`: see the note in nav.tsx. A footer is not a
    // product frame, and rebinding the reading scale inside one arms a trap
    // for every later stage that writes a Tailwind spacing utility here.
    <footer className="mk-type mk-footer">
      <div className="mk-footer__inner">
        <div className="mk-footer__brand">
          <LogoLockup size={20} textColor="var(--os-ink)" />
          <p className="mk-caption mk-footer__line">
            One system for people, processes, work and goals.
          </p>
        </div>

        {COLUMNS.map((column) => {
          const links = column.links.filter((l) => l.shipped !== false);
          if (links.length === 0) return null;
          return (
            <nav key={column.title} className="mk-footer__col" aria-label={column.title}>
              <h2 className="mk-label mk-footer__title">{column.title}</h2>
              {links.map((link) => (
                <Link key={link.href} href={link.href} className="mk-footer__link mk-focus">
                  {link.label}
                </Link>
              ))}
            </nav>
          );
        })}
      </div>

      <div className="mk-footer__strip">
        {/* The currency toggle lands here with the pricing stage; it reads the
            same pricing source the cards and the receipt do. */}
        <span className="mk-caption">© {year} WorkwrK Technologies</span>
        <span className="mk-footer__legal">
          {LEGAL.map((link) => (
            <Link key={link.href} href={link.href} className="mk-footer__link mk-focus">
              {link.label}
            </Link>
          ))}
        </span>
      </div>
    </footer>
  );
}

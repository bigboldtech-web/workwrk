// The marketing navigation (marketing-concept.md 3 row 0, design-system 5.12).
//
// "Underline tabs exist nowhere in the app; the only underline is the
// marketing site nav." The rule separates the SITE from the PRODUCT: an
// underline is a marketing-site signal, and its absence inside a product
// frame is what tells a visitor at a glance which of the two they are
// looking at.
//
// It is not a rule of one underline per site. The module tour on the home
// page carries a second set of underline tabs, and it is the one other
// place on the site where a person chooses between eight peers with the
// content changing underneath: that is what an underline tab IS. What
// neither of them may do is appear inside a MarketingShell, because there
// it would be teaching the product's own chrome something the product does
// not do. It does not, and this note exists so nobody adds one.
//
// What it replaces, and why. The nav it supersedes was three hover-only
// mega menus: the triggers were buttons that opened on pointer enter and
// closed on a 120ms timer, with no click path and no key path, so 21 links
// were unreachable without a mouse. This one is flat links plus a native
// `details` disclosure for the narrow breakpoint, which means the browser
// owns the keyboard behaviour and there is no handler to get wrong.
//
// Link discipline: a nav row appears only when its route exists. The module
// pages and the connection map are later phases, so they are listed here
// with `shipped: false` and do not render. A nav that links to a 404 is the
// fastest way to lose a visitor.

import Link from "next/link";
import { LogoLockup } from "@/components/brand/logo";
import { LogInLink, PrimaryCta, SecondaryCta } from "./cta";
import { NavLinks } from "./nav-links";
import { NavProductMenu } from "./nav-product-menu";
import { DOT_HEX } from "./dots";
import { tuesday } from "./data/tuesday";
import { PART_LINE } from "./iconic/copy";
import { moduleHref } from "./product/module-page";
import { flags } from "./config";
import "./shell/marketing-shell.css";
import "./nav.css";

interface NavLink {
  label: string;
  href: string;
  shipped: boolean;
}

const NAV_LINKS: NavLink[] = [
  // "Product" is NOT in this list on desktop: it is the disclosure below,
  // and the row is kept here only so the mobile drawer, which is already a
  // disclosure, still carries a flat link to the index. A second nested
  // disclosure inside the drawer would be two summaries deep on the
  // breakpoint that carries most of the traffic.
  // /product, not /features, and only because /product now exists. It was
  // the marketing 404 until this build: the branch had eight chapters under
  // it and no index above them, so "Product" had to point somewhere else.
  // The index is the tour, which is the page a visitor pressing Product is
  // asking for. /features is the capability list and is still one click
  // away, from the footer and from every chapter.
  { label: "Product", href: "/product", shipped: true },
  // The explorable map. It was held out of this list while it had no page,
  // for the reason recorded above this row: the dev server answers an
  // unmatched marketing path with a 200 and an empty body rather than a
  // 404, so a `shipped: true` on a route that did not exist would have put
  // a link to a blank page in the nav and in the footer with nothing
  // failing. The page exists now, so the row does.
  { label: "How it connects", href: "/how-it-connects", shipped: true },
  { label: "Pricing", href: "/pricing", shipped: true },
  { label: "Compare", href: "/compare", shipped: true },
  { label: "Customers", href: "/customers", shipped: flags.customersNavLink },
  { label: "Tuesday", href: "/tuesday", shipped: true },
];

const LINKS = NAV_LINKS.filter((l) => l.shipped).map(({ label, href }) => ({ label, href }));

/** Everything but Product: that row is the disclosure on desktop. */
const DESKTOP_LINKS = LINKS.filter((l) => l.href !== "/product");

/** The routes the Product row is the "you are here" answer for. */
const PRODUCT_ROUTES = ["/features", "/product"] as const;

/**
 * The eight rows of the Product panel, built on the SERVER.
 *
 * One line each and one dot, and the line says what the part IS.
 *
 * IT USED TO SAY WHAT THE PART REPLACES, on all eight rows, in a navigation
 * that sits on all 49 routes including the home page. Three things were
 * wrong with that. The decided spine bans "replaces" lines from the module
 * list outright. The home page's own source asserts the vocabulary "does not
 * appear on this page at all", which was untrue while this nav was on it.
 * And it is the competitor-displacement framing the whole direction was
 * chosen to get away from: a chain of ownership is a claim a rival cannot
 * say back, whereas a replaces list invites exactly the feature-by-feature
 * comparison we lose by default. The vocabulary now lives only on /compare,
 * which is the page that names names on purpose.
 *
 * The lines are PART_LINE, the same eight sentences /product prints under
 * each part of its tour, so the nav and the tour cannot describe a part
 * differently, and a ninth part cannot appear here without a line.
 *
 * It is a server function handed to the island as children: the Tuesday
 * fixture is 850 lines and it stays out of the browser bundle.
 */
function ProductPanelRows() {
  return (
    <>
      {tuesday.hubs.map((hub) => {
        const line = PART_LINE[hub.id];
        return (
          <Link
            key={hub.id}
            href={moduleHref(hub.id)}
            className="mk-nav__panel-row mk-focus"
            data-cta={`nav-product-${hub.id}`}
          >
            <span className="mk-nav__panel-dot" style={{ background: DOT_HEX[hub.dot] }} aria-hidden />
            <span className="mk-nav__panel-name">{hub.label}</span>
            {line ? <span className="mk-nav__panel-note">{line}</span> : null}
          </Link>
        );
      })}
      {/* The index keeps its row, and the index is now the tour: one part at
          a time on the real surface, with the eight chapters under it.
          /features, the capability list, is still one click away from the
          footer and from every chapter, which is the same distance it was at
          before this row pointed here. */}
      <Link href="/product" className="mk-nav__panel-all mk-focus" data-cta="nav-product-all">
        All {tuesday.hubs.length} parts, one at a time
      </Link>
    </>
  );
}

export function MarketingNav() {
  return (
    // `mk-type`, not `mk-os`. `mk-os` rebinds the document font size to 14px
    // and the Tailwind spacing unit to 4px, which is right inside a product
    // frame and wrong on a 16px marketing document: a Tailwind spacing
    // utility written in the nav by a later stage would render at a quarter
    // of the size it does two elements away. The nav needs the token VALUES,
    // which `mk-tokens` on the site root already provides, and its own sizes
    // are written in px in nav.css.
    <header className="mk-type mk-nav">
      <nav className="mk-nav__bar" aria-label="Main">
        <Link href="/" className="mk-nav__logo mk-focus" aria-label="WorkwrK home">
          <LogoLockup size={20} textColor="var(--os-ink)" />
        </Link>

        <div className="mk-nav__links">
          <NavProductMenu label="Product" owns={PRODUCT_ROUTES}>
            <ProductPanelRows />
          </NavProductMenu>
          <NavLinks links={DESKTOP_LINKS} />
        </div>

        {/* Both doors, neither filled, and now neither blue.
            The funnel rule is that exactly one filled element sits in a
            viewport, and the colour rule is that one blue appears at most
            once per screen. The navigation is on screen at the same moment
            as every page's own hero, so anything coloured here is a second
            blue by construction: the version this replaces shipped a blue
            "Log in" and a blue bordered "Start free" above a hero that
            carried a blue button of its own, three blues in the first
            screen.
            So the two quieter doors are ink text links and the trial is one
            ink hairline button. Every destination, label and measurement id
            is unchanged: what moved is the colour. */}
        {/* TWO DOORS, NOT THREE. This carried "Log in", "Book a demo" and
            "Start free", and the first two sat 10px apart, which is less than
            the word spacing inside "Book a demo", so they read as one run of
            grey text rather than two controls. The page below ends on one
            button; the chrome above it was offering three. "Book a demo" is
            the one that goes: it is on the close of every page, in the
            footer, and it has its own route, so nothing is lost but the
            crowding. */}
        <div className="mk-nav__actions">
          <LogInLink />
          <PrimaryCta placement="nav" variant="ghost" size="compact" />
        </div>

        <details className="mk-nav__menu">
          {/* No `aria-label`.
              It said "Open the menu" in BOTH states, so an assistive
              technology user who had just opened the drawer was told the
              control opens it. A native `details` already exposes its
              expanded state, and the accessible name now comes from the
              visible word, which the stylesheet swaps with the disclosure:
              "Menu" closed, "Close" open. One name, two states, no handler
              to get wrong. */}
          <summary className="mk-focus">
            <span className="mk-nav__menu-open">Menu</span>
            <span className="mk-nav__menu-close">Close</span>
          </summary>
          <div className="mk-nav__drawer">
            <NavLinks links={LINKS} drawer />
            {/* Both doors, same as the desktop bar. The drawer used to carry
                only the primary, which made "Book a demo" unreachable from
                the navigation on a phone, on the breakpoint that carries
                most of the traffic. */}
            <div className="mk-nav__drawer-actions">
              <LogInLink placement="nav-mobile" />
              <SecondaryCta placement="nav-mobile" />
              <PrimaryCta placement="nav-mobile" variant="ghost" />
            </div>
          </div>
        </details>
      </nav>
    </header>
  );
}

// THE ICONIC KIT: the parts every page that is not the home page is made of.
//
// The home page sets the discipline and these eight pages keep it. There are
// six pieces here and nothing else, because a kit that grows a seventh piece
// every time a page wants something is how a site ends up with fourteen
// heading sizes:
//
//   Page      the scope, which carries the type ramp
//   Band      one idea, its ground and its air
//   Eyebrow   the section's name, small, above the headline
//   Claim     the page's h1, six words or fewer
//   Headline  a section's h2, six words or fewer
//   Line      one sentence under a headline, or one figure
//
// Every one of them is a Server Component. The only client code any page on
// this sheet runs is `Reveal`, which moves a section 24px as it arrives and
// does nothing else, and the pricing currency switch, which is the one
// control on the site whose absence would make a page untrue.
//
// WHAT IS NOT HERE, deliberately: a Card, a Grid and a Tile. Rule 5 is "no
// feature grid", and a kit that ships a card is a kit that gets a card grid
// on the day somebody is in a hurry.

import type { ReactNode } from "react";
import Link from "next/link";

import { PrimaryCta } from "../cta";
import { Reveal } from "../home/reveal.client";
import "./iconic.css";

/** The scope. One per page, wrapping everything the route renders. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mk-iconic">{children}</div>;
}

export interface BandProps {
  children: ReactNode;
  /** The grey ground. Twice per page at most, or white stops being the page. */
  ground?: "quiet";
  /**
   * `hero` is the first band, which pays less for its top air because the
   * navigation is already supplying some. `wide` is a band whose whole
   * design is the space around one sentence. `tight` continues the band
   * above it rather than opening a new idea.
   */
  air?: "wide" | "hero" | "tight";
  /** A reading column, for prose. Statements keep the full width. */
  width?: "read";
  /** Left aligned, for a document rather than a statement. */
  align?: "start";
  labelledBy?: string;
  id?: string;
  /**
   * The hero does not move. It is on screen at the first paint, so there is
   * nothing to reveal and any motion on it is motion the visitor sees happen
   * to the thing they came for.
   */
  still?: boolean;
}

export function Band({
  children,
  ground,
  air,
  width,
  align,
  labelledBy,
  id,
  still = false,
}: BandProps) {
  const inner = (
    <div className={`ic-wrap${align === "start" ? "" : " ic-center"}`} data-width={width}>
      {children}
    </div>
  );
  return (
    <section className="ic-sec" data-ground={ground} data-air={air} aria-labelledby={labelledBy} id={id}>
      {still ? inner : <Reveal className="ic-reveal">{inner}</Reveal>}
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="ic-eyebrow">{children}</p>;
}

/** The page's one h1. Six words or fewer, and a test counts them. */
export function Claim({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h1 className="ic-h1" id={id}>
      {children}
    </h1>
  );
}

/** A section's h2. Six words or fewer. */
export function Headline({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 className="ic-h2" id={id}>
      {children}
    </h2>
  );
}

/** The sentence under a claim. Larger than a section's line, and only one. */
export function Sub({ children }: { children: ReactNode }) {
  return <p className="ic-sub">{children}</p>;
}

/** The sentence under a headline. One sentence, always. */
export function Line({ children }: { children: ReactNode }) {
  return <p className="ic-line">{children}</p>;
}

/** A footnote: a source, a currency, a date. Never part of the argument. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="ic-note">{children}</p>;
}

/** The section's one object: a product frame, a diagram, a list, a table. */
export function Obj({ children }: { children: ReactNode }) {
  return <div className="ic-obj">{children}</div>;
}

/** A number, when the number is the object. */
export function Figure({ value, caption }: { value: string; caption?: string }) {
  return (
    <>
      <p className="ic-fig">{value}</p>
      {caption ? <p className="ic-figcap">{caption}</p> : null}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// THE FOUR OBJECTS A BAND IS ALLOWED TO ENUMERATE WITH.
//
// They live here, in the kit, and not in each page, for the reason the kit
// exists at all: the forty pages that were not rebuilt each drew their own
// list, and between them they shipped a three column card grid, a bordered
// step list with filled numerals, a row of pills and four different FAQs.
// One of each, for the whole site, and none of them has a border or a box.
// ════════════════════════════════════════════════════════════════════

export interface StackItem {
  /** The name, set at display size. It is what a visitor scans. */
  title: string;
  /** One line under it. Optional: a list of names is a legitimate object. */
  body?: string;
  /** When the name is a link. Rendered with its underline at rest. */
  href?: string;
  /** The measurement id, when there is a href. */
  cta?: string;
}

/**
 * A stack of names, each with a line under it. The site's one list object.
 *
 * It replaces every card grid on the site. A name at 34px with a sentence
 * under it is more legible than the same pair inside a white box with a
 * border and a radius, and it cannot become a three column grid on the day
 * somebody is in a hurry, because there is no column to add.
 */
export function Stack({ items }: { items: readonly StackItem[] }) {
  return (
    <ul className="ic-stack">
      {items.map((item) => {
        // A mailto is not a route. `next/link` would try to prefetch and to
        // client-navigate it, so an address gets a plain anchor and a path
        // gets the router.
        const external = item.href ? !item.href.startsWith("/") : false;
        return (
        <li key={item.title}>
          {item.href ? (
            external ? (
              <a className="ic-stackname mk-focus" href={item.href} data-cta={item.cta}>
                {item.title}
              </a>
            ) : (
              <Link className="ic-stackname mk-focus" href={item.href} data-cta={item.cta}>
                {item.title}
              </Link>
            )
          ) : (
            <span className="ic-stackname">{item.title}</span>
          )}
          {item.body ? <span className="ic-stackline">{item.body}</span> : null}
        </li>
        );
      })}
    </ul>
  );
}

/** A short ordered list, where the order is the idea. No boxes, no tiles. */
export function Steps({ items }: { items: readonly string[] }) {
  return (
    <ol className="ic-steps">
      {items.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

/** A wrapped run of short names. What a badge row is, without the badges. */
export function Terms({ items }: { items: readonly string[] }) {
  return (
    <ul className="ic-terms">
      {items.map((term) => (
        <li key={term}>{term}</li>
      ))}
    </ul>
  );
}

export interface QaItem {
  q: string;
  a: ReactNode;
}

/**
 * The questions. A native `details` each, so the browser owns the disclosure
 * and there is no handler to get wrong or to fail with scripting off.
 */
export function Qa({ items }: { items: readonly QaItem[] }) {
  return (
    <div className="ic-qa">
      {items.map((item) => (
        <details key={item.q}>
          <summary className="mk-focus">{item.q}</summary>
          <div className="ic-qa__a">{typeof item.a === "string" ? <p>{item.a}</p> : item.a}</div>
        </details>
      ))}
    </div>
  );
}

/**
 * The last band on a page: one line, one button, the page's only blue.
 *
 * Every route on the site closes with this, so "one closing line, one
 * button" is a thing the kit does rather than a thing forty pages each
 * remember to do.
 */
export function Close({ headline, placement }: { headline: string; placement: string }) {
  return (
    <Band air="wide" labelledBy={`${placement}-close`}>
      <Headline id={`${placement}-close`}>{headline}</Headline>
      <div className="ic-cta">
        <PrimaryCta placement={placement} />
      </div>
    </Band>
  );
}

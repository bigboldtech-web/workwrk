// The shell for the three legal documents: /privacy, /terms, /cookies.
//
// WHAT CAME OFF THEM, because it is the whole of the redesign:
//
//   The sticky two column table of contents. A contents list that follows
//   you down the page is chrome, and these are documents. It is now a plain
//   list at the top, in the reading column, which is where the contents page
//   of a document has always been.
//
//   The hue. Each of the three ran on a different accent from the legacy
//   primitives: violet on privacy, sky on terms, amber on cookies, with a
//   tinted eyebrow and tinted pills in the cookie table. Colour is almost
//   absent on this site and a legal page is the last place it earns its
//   keep.
//
//   The closing CTA band. A privacy policy that ends in a sales button is a
//   sales page wearing a privacy policy. These three end when they end.
//
// WHAT DID NOT CHANGE: one word of the bodies. They were put through a truth
// gate before this rebuild and the result is the reason these pages can
// ship: the fabricated regional compliance sentence, the six invented
// sub-processors, the three storage regions, the in-product privacy settings
// page that does not exist and the EU Data Protection Officer are all
// already gone. Each page passes its own sections in, and this file decides
// only how a document looks.

import type { ReactNode } from "react";

import { Band, Claim, Eyebrow, Page } from "./iconic";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

export function LegalDoc({
  eyebrow = "Legal",
  title,
  updated,
  lede,
  sections,
}: {
  eyebrow?: string;
  /** The document's name. It is the h1 and it is short. */
  title: string;
  /** The date this text last changed, in words. */
  updated: string;
  /** One sentence saying what the document is for. */
  lede: string;
  sections: readonly LegalSection[];
}) {
  return (
    <Page>
      <Band air="hero" labelledBy="legal-h1" still>
        <Eyebrow>{eyebrow}</Eyebrow>
        <Claim id="legal-h1">{title}</Claim>
        <p className="ic-sub">{lede}</p>
        <p className="ic-figcap">Last updated {updated}</p>
      </Band>

      <Band air="tight" width="read" align="start">
        <div className="ic-doc">
          <nav aria-label="On this page">
            <ol className="ic-toc">
              {sections.map((s) => (
                <li key={s.id}>
                  <a className="mk-focus" href={`#${s.id}`}>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {sections.map((s) => (
            <section key={s.id} id={s.id} className="ic-docsec" aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`} className="ic-doch">
                {s.title}
              </h2>
              <div className="ic-docbody">{s.body}</div>
            </section>
          ))}
        </div>
      </Band>
    </Page>
  );
}

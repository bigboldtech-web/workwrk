// The receipt OG card (marketing-concept.md 6.3 and 12 Phase 0 item 4).
//
// One route serves BOTH receipts, because they are one component with one
// model. /tuesday shares the Work Receipt; "Copy my receipt" shares the
// visitor's Stack Receipt, built from the query string. The image is drawn
// from the same model the page renders, so a shared card can never show a
// number the page does not.
//
//   /api/og/receipt                                  the Work Receipt
//   /api/og/receipt?kind=stack&seats=50&currency=USD&tools=wiki,team-chat
//   ...&prices=wiki:4,team-chat:11   the lines the sharer edited
//
// Satori renders a subset of CSS: flexbox only, no grid, and every element
// holding more than one child needs an explicit display. That is why this
// file repeats `display: "flex"` rather than sharing the page's stylesheet.
// It also cannot read CSS custom properties, so the token VALUES are
// written out here, exactly as the marketing scope defines them; the OG
// token test fails if the two drift.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";
import {
  parseReceiptQuery,
  stackReceiptModel,
  workReceiptModel,
  type ReceiptModel,
} from "@/components/marketing/receipt/receipt-model";
import { DOT_HEX } from "@/components/marketing/data/tuesday";

// The Node runtime, not the edge one, for one reason: the card has to be set
// in Inter. Satori does not inherit a page's webfont, so the typeface has to
// be handed to it as bytes, and ImageResponse's bundle ceiling is 500 KB,
// which two Inter weights do not fit inside. Read at request time from
// public/, cached in module scope after the first call, the font is not in
// the bundle at all and the second card onwards costs nothing.
export const runtime = "nodejs";

/** The marketing scope's token values, literal because Satori has no custom properties. */
const T = {
  canvas: "#FFFFFF",
  surface1: "#F6F7F9",
  line: "#E4E7EC",
  ink: "#1F2430",
  ink2: "#5C6779",
  ink3: "#98A2B3",
  navy: "#1B2537",
} as const;

// The four brand hexes come from the brand, through the fixture, exactly as
// every other marketing surface gets them. Satori cannot read a custom
// property, but it can read an imported constant, so the card has no reason
// to keep its own copy of the palette.
const DOT: Record<string, string> = DOT_HEX;
const DOT_ROW = [DOT_HEX.yellow, DOT_HEX.blue, DOT_HEX.red, DOT_HEX.green];

const FONT_DIR = join(process.cwd(), "public", "fonts");

let fontsPromise: Promise<Array<{ name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" }>> | null =
  null;

function interFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      readFile(join(FONT_DIR, "inter-400.ttf")),
      readFile(join(FONT_DIR, "inter-600.ttf")),
    ]).then(([regular, semibold]) => [
      { name: "Inter", data: regular.buffer.slice(regular.byteOffset, regular.byteOffset + regular.byteLength) as ArrayBuffer, weight: 400 as const, style: "normal" as const },
      { name: "Inter", data: semibold.buffer.slice(semibold.byteOffset, semibold.byteOffset + semibold.byteLength) as ArrayBuffer, weight: 600 as const, style: "normal" as const },
    ]);
    // A read that fails must not poison every later request.
    fontsPromise.catch(() => {
      fontsPromise = null;
    });
  }
  return fontsPromise;
}

function card(model: ReceiptModel) {
  const emphasis = model.totals.find((t) => t.emphasis);
  const quiet = model.totals.filter((t) => !t.emphasis);
  // A card is 630 tall and a work receipt is eleven lines long, so the row
  // size follows the row count. A short stack receipt breathes; a long work
  // receipt fits, and neither one gets cropped by the share card.
  const rowSize = model.rows.length > 8 ? 19 : 24;
  const rowPad = model.rows.length > 8 ? 4 : 7;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        backgroundColor: T.surface1,
        padding: 30,
        fontSize: 22,
        color: T.ink,
        // Named here so the card is the same typeface as the page it came
        // from. Satori falls back to its own face when the bytes are missing.
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          backgroundColor: T.canvas,
          border: `1px solid ${T.line}`,
          borderRadius: 12,
          padding: 28,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 20, fontWeight: 600, letterSpacing: 2, color: T.ink }}>
            {model.title}
          </div>
          <div style={{ display: "flex", fontSize: 18, color: T.ink2 }}>{model.meta}</div>
        </div>

        <div style={{ display: "flex", height: 1, backgroundColor: T.line, marginTop: 14, marginBottom: 10 }} />

        <div style={{ display: "flex", flexDirection: "column" }}>
          {model.rows.slice(0, 11).map((row) => (
            <div
              key={row.id}
              style={{ display: "flex", alignItems: "center", paddingTop: rowPad, paddingBottom: rowPad, fontSize: rowSize }}
            >
              {/* The struck cell is whichever one holds the words. */}
              <div
                style={{
                  display: "flex",
                  width: row.label ? 96 : 300,
                  color: row.struck ? T.ink3 : T.ink2,
                  textDecoration: row.struck && !row.label ? "line-through" : "none",
                }}
              >
                {row.lead}
              </div>
              <div
                style={{
                  display: "flex",
                  flexGrow: 1,
                  color: row.struck ? T.ink3 : T.ink,
                  textDecoration: row.struck ? "line-through" : "none",
                }}
              >
                {row.label || ""}
              </div>
              {row.meta ? <div style={{ display: "flex", color: T.ink3, marginRight: 16 }}>{row.meta}</div> : null}
              {row.dot ? (
                <div
                  style={{
                    display: "flex",
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: DOT[row.dot] ?? DOT_HEX.blue,
                    marginRight: 8,
                  }}
                />
              ) : null}
              {row.amount ? <div style={{ display: "flex", width: 150, justifyContent: "flex-end", color: T.ink2 }}>{row.amount}</div> : null}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", height: 1, backgroundColor: T.line, marginTop: 10, marginBottom: 10 }} />

        <div style={{ display: "flex", flexDirection: "column" }}>
          {quiet.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "baseline", fontSize: 20, color: T.ink2, paddingBottom: 3 }}>
              <div style={{ display: "flex", flexGrow: 1 }}>{t.label}</div>
              {t.note ? <div style={{ display: "flex", color: T.ink3, marginRight: 16 }}>{t.note}</div> : null}
              <div style={{ display: "flex", width: 190, justifyContent: "flex-end" }}>{t.value}</div>
            </div>
          ))}
          {emphasis ? (
            <div
              style={{ display: "flex", alignItems: "baseline", fontSize: 28, fontWeight: 600, color: T.ink, paddingTop: 4 }}
            >
              <div style={{ display: "flex", flexGrow: 1 }}>{emphasis.label}</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>{emphasis.value}</div>
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: 18,
            paddingTop: 14,
            borderTop: `1px solid ${T.line}`,
          }}
        >
          <div style={{ display: "flex", marginRight: 14 }}>
            {DOT_ROW.map((c) => (
              <div key={c} style={{ display: "flex", width: 12, height: 12, borderRadius: 6, backgroundColor: c, marginRight: 6 }} />
            ))}
          </div>
          <div style={{ display: "flex", flexGrow: 1, fontSize: 18, color: T.ink2 }}>{model.footer}</div>
          {model.mark ? <div style={{ display: "flex", fontSize: 18, color: T.ink, marginRight: 16 }}>{model.mark}</div> : null}
          <div style={{ display: "flex", fontSize: 18, color: T.navy }}>workwrk.com</div>
        </div>

        {/* The dated footnote, which the in-page receipt has always carried
            and the shared card dropped.
            The stack receipt prints fourteen category list prices. On the
            page they sit above "Typical list price, September 2026, editable"
            and are therefore a dated midpoint for a CATEGORY. On the card
            they were bare numbers with a company's name at the bottom, which
            turns the same figures into a price list we are asserting. The
            artefact that travels furthest is the one that needs the
            qualifier most. */}
        {model.footnote ? (
          <div style={{ display: "flex", marginTop: 10, fontSize: 15, color: T.ink3 }}>{model.footnote}</div>
        ) : null}
      </div>
    </div>
  );
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const parsed = parseReceiptQuery(params);
    const model =
      parsed.kind === "stack"
        ? stackReceiptModel({
            selected: parsed.selected,
            seats: parsed.seats,
            currency: parsed.currency,
            // The prices the sharer corrected. Without them the card that
            // unfurls from "Copy my receipt" quoted list prices under the
            // sharer's name, which is the one number on a shared artefact
            // that has to be theirs.
            overrides: parsed.overrides,
          })
        : workReceiptModel({ share: true });

    // A missing font file must not turn the most shared artefact on the site
    // into a 500. It falls back to Satori's own face, which is what shipped
    // before this, and the card still renders.
    const fonts = await interFonts().catch(() => undefined);

    return new ImageResponse(card(model), {
      width: 1200,
      height: 630,
      fonts,
      headers: {
        // The card is a pure function of the query string, so it caches hard.
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new Response("Could not render the receipt card", { status: 500 });
  }
}

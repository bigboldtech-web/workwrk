// The site's social card (marketing-concept.md 4 stop 6, 6.3, 8, 10 and
// decision D25).
//
// Concept 6.3 names it: "Home OG = the beat-6 pull-back frame". That is the
// last thing the Tuesday story does. The camera pulls back from the shell
// and shows eight tilted panels wired to the receipt the day just printed:
// the whole argument of the site as one object, which is exactly what a
// share card has to be.
//
// So the card is the page, at card size, on the page's own rules:
//
//   light only, white ground, one navy band, one blue accent
//   the four brand dots, which are the brand mark
//   Inter 600 on the display line, Inter 400 on the body, one weight each
//   the H1 the page actually carries, and its one sentence
//
// EVERY NUMBER AND EVERY WORD HERE IS SOURCED. The claim is the one in
// headline.ts, which the page renders too, so the card and the page cannot
// say different things. The eight panels are the fixture's hub list with the
// fixture's dots. The receipt rows come out of `workReceiptModel()`, the
// same function the page and the /tuesday card render, through the same
// truth gates, so a row cannot name a mechanism the site is not claiming.
// Nothing on this card is typed twice.
//
// Satori renders a subset of CSS: flexbox only, no grid, and every element
// with more than one child needs an explicit display. It also cannot read a
// custom property, which is why the token VALUES are written out here.
//
// Node runtime, not edge, for the same reason as the receipt card: Satori
// does not inherit a page's webfont, so Inter has to be handed to it as
// bytes, read from public/ at request time and cached in module scope.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { DOT_HEX, tuesday } from "@/components/marketing/data/tuesday";
import { heroHeadline } from "@/components/marketing/headline";
import { workReceiptModel } from "@/components/marketing/receipt/receipt-model";

export const runtime = "nodejs";
export const alt = "WorkwrK: every task knows who owns it.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The marketing scope's token values, literal because Satori has no custom properties. */
const T = {
  canvas: "#FFFFFF",
  surface1: "#F6F7F9",
  line: "#E4E7EC",
  ink: "#1F2430",
  ink2: "#5C6779",
  ink3: "#98A2B3",
  navy: "#1B2537",
  brand: "#0073EA",
} as const;

const DOT_ROW = [DOT_HEX.yellow, DOT_HEX.blue, DOT_HEX.red, DOT_HEX.green];

/**
 * The dot row, positioned over the "wr" that separates the two k letters.
 *
 * `left` is measured from the left edge of that two letter span, not from
 * the start of the word, so it needs no glyph metrics: "wr" at Inter 600 /
 * 27px is about 31px wide and the row is 4 dots of 6 plus 3 gaps of 3,
 * which is 33, so it overhangs by one pixel on each side and is centred.
 */
const DOT_SIZE = 6;
const DOTS_LEFT = -1;

/**
 * The tilt on each panel, in the order the fixture lists the hubs.
 *
 * Small and alternating, because the point of the pull-back is that eight
 * separate things are pointing at one place, not that they are scattered.
 * The concept's near-frontal limit is 12 degrees and nothing here is past
 * 4: a panel at this size stops being readable long before that.
 */
const TILT = [-6, 4.5, -3.5, 6, 5, -5, 3.5, -4.5];

const FONT_DIR = join(process.cwd(), "public", "fonts");

let fontsPromise: Promise<Array<{ name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" }>> | null =
  null;

function interFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      readFile(join(FONT_DIR, "inter-400.ttf")),
      readFile(join(FONT_DIR, "inter-600.ttf")),
    ]).then(([regular, semibold]) => [
      {
        name: "Inter",
        data: regular.buffer.slice(regular.byteOffset, regular.byteOffset + regular.byteLength) as ArrayBuffer,
        weight: 400 as const,
        style: "normal" as const,
      },
      {
        name: "Inter",
        data: semibold.buffer.slice(semibold.byteOffset, semibold.byteOffset + semibold.byteLength) as ArrayBuffer,
        weight: 600 as const,
        style: "normal" as const,
      },
    ]);
    // A read that fails must not poison every later request.
    fontsPromise.catch(() => {
      fontsPromise = null;
    });
  }
  return fontsPromise;
}

/**
 * One of the eight blocks, as a tilted panel with its dot, its label and its
 * own wire.
 *
 * The wire per panel is the point of the frame. The card used to draw eight
 * panels and ONE blue stub between the grid and the receipt, which reads as
 * a grid with a tick under it; concept 4 stop 6 is eight panels WIRED to the
 * receipt, and a wire that belongs to nothing in particular is the same
 * defect the spine had in the page. Each panel now drops its own 14px blue
 * hairline onto the rail that runs into the slab.
 *
 * It is a div rather than an SVG line because Satori renders a subset of CSS
 * and a 2px box is a hairline that cannot be got wrong.
 */
function Panel({ label, dot, tilt }: { label: string; dot: string; tilt: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: 148,
          height: 46,
          paddingLeft: 12,
          paddingRight: 12,
          borderRadius: 8,
          border: `1px solid ${T.line}`,
          backgroundColor: T.canvas,
          transform: `rotate(${tilt}deg)`,
        }}
      >
        <div style={{ display: "flex", width: 8, height: 8, borderRadius: 8, backgroundColor: dot }} />
        <div style={{ display: "flex", fontSize: 16, fontWeight: 600, color: T.ink }}>{label}</div>
      </div>
      <div style={{ display: "flex", width: 2, height: 14, backgroundColor: T.brand }} />
    </div>
  );
}

export default async function OgImage() {
  const headline = heroHeadline();
  const receipt = workReceiptModel({ share: true });
  // Four rows, one per dot the story resolves, so the slab reads as the
  // receipt rather than as a table: the ones that carry a colour are the
  // ones the storyboard hangs a dot on.
  const rows = receipt.rows.filter((row) => row.dot).slice(0, 4);
  const total = receipt.totals[0];

  let fonts: Awaited<ReturnType<typeof interFonts>> | undefined;
  try {
    fonts = await interFonts();
  } catch {
    // Satori falls back to its own face. A card in the wrong typeface is a
    // smaller problem than a share that renders nothing at all.
  }

  const hubs = tuesday.hubs.slice(0, 8);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: T.canvas,
          color: T.ink,
          fontFamily: "Inter",
          padding: 54,
        }}
      >
        {/* Left: the words the page opens with. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: 566,
            paddingRight: 32,
          }}
        >
          {/* The brand lockup: the four dots sit ABOVE the wordmark,
              centred over the "wr" that separates the two k letters of
              "workwrk". src/components/brand/logo.tsx is the geometry, and
              design-system section 7 quarantines the mark to that directory.
              Satori cannot render that component (no CSS custom properties,
              no stylesheet), so the arrangement is reproduced here and only
              here, which is why it is worth being exact about.

              It was drawn wrong: "workwr" + the dots + "k" put the row
              INLINE, between the r and the final k, splitting the word. The
              comment two lines above claimed the opposite, which is how it
              survived. The mark is the most reused asset the company has and
              this is the most shared surface it appears on. */}
          <div style={{ display: "flex", paddingTop: DOT_SIZE + 4 }}>
            <div style={{ display: "flex", fontSize: 27, fontWeight: 600, letterSpacing: "-0.03em" }}>
              <div style={{ display: "flex" }}>work</div>
              {/* The "wr" is the anchor. Splitting the word here is how
                  logo.tsx does it too, and for the same reason: the dots
                  have to sit over the gap between the two k letters at any
                  font width, without anybody measuring a glyph. */}
              <div style={{ display: "flex", position: "relative" }}>
                wr
                <div
                  style={{
                    display: "flex",
                    position: "absolute",
                    top: -(DOT_SIZE + 3),
                    left: DOTS_LEFT,
                    gap: 3,
                  }}
                >
                  {DOT_ROW.map((hex) => (
                    <div key={hex} style={{ display: "flex", width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE, backgroundColor: hex }} />
                  ))}
                </div>
              </div>
              <div style={{ display: "flex" }}>k</div>
            </div>
          </div>

          {/* NO EYEBROW, AND NO ATTRIBUTION UNDER IT.
              Both slots used to carry the same anonymous anecdote the home
              page opened with: "A 280-person services firm replaced 14
              tools in one quarter", over the name and role of the person
              credited with saying it. The quote exists in this repo as
              hardcoded JSX on our own login page and in no CRM record, no
              customer file and no signed permission, so the card was the
              strongest form of a claim the site cannot evidence: a named
              customer, travelling alone, to a stranger.

              The card now opens on the claim itself, which is ours to
              make. If a customer story becomes real and the customer
              agrees to it, this is a good place for it and it comes back
              with the evidence, not before. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                fontSize: 46,
                lineHeight: 1.06,
                letterSpacing: "-0.02em",
                fontWeight: 600,
              }}
            >
              {headline.h1Parts.map((part) => (
                <div key={part} style={{ display: "flex" }}>
                  {part}
                </div>
              ))}
            </div>
            {/* THE PAGE'S OWN SECOND SENTENCE, not a third one.
                This slot used to read "8 blocks, one data model, 14
                categories of tool it stands in for", which is true and is
                nowhere on the site: a share card and the page it opens said
                different things directly under the same H1. `headline.sub`
                is `headlineSub()`, the one gated positioning sentence that
                the hero, the meta description, the og:description and both
                JSON-LD descriptions already render, so the card now moves
                with the gate instead of beside it. */}
            <div style={{ display: "flex", fontSize: 21, color: T.ink2, lineHeight: 1.4 }}>{headline.sub}</div>
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 15,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: T.ink3,
            }}
          >
            People and project management
          </div>
        </div>

        {/* Right: the pull-back frame. Eight tilted panels, wired down into
            the receipt one task printed at the end of the day. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, width: 316, justifyContent: "center" }}>
            {hubs.map((hub, i) => (
              <Panel key={hub.id} label={hub.label} dot={DOT_HEX[hub.dot]} tilt={TILT[i] ?? 0} />
            ))}
          </div>

          {/* The rail the eight wires land on, and the one line down into the
              slab. Eight wires into one receipt is the sentence. */}
          <div style={{ display: "flex", width: 300, height: 2, backgroundColor: T.brand }} />
          <div style={{ display: "flex", width: 2, height: 16, backgroundColor: T.brand }} />
          <div style={{ display: "flex", width: 9, height: 9, borderRadius: 9, backgroundColor: T.brand }} />

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              /* 440, not 380. Two of the four receipt rows were ellipsis
                 truncated mid sentence ("SOP step 3 live, owner named on
                 the S..."), and the half that got cut was the half naming
                 the stop 2 mechanism, which is the one row on the card a
                 buyer is meant to read. The right column has 526px, so the
                 room was there. */
              width: 440,
              marginTop: 12,
              padding: 18,
              borderRadius: 10,
              border: `1px solid ${T.line}`,
              backgroundColor: T.surface1,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: T.ink,
                }}
              >
                {receipt.title}
              </div>
              <div style={{ display: "flex", fontSize: 13, color: T.ink2 }}>{receipt.meta}</div>
            </div>
            <div style={{ display: "flex", height: 1, backgroundColor: T.line, marginTop: 10, marginBottom: 8 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {rows.map((row) => (
                <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <div style={{ display: "flex", width: 42, color: T.ink2 }}>{row.lead}</div>
                  <div
                    style={{
                      display: "flex",
                      flex: 1,
                      color: T.ink,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {row.label}
                  </div>
                  {row.dot ? (
                    <div
                      style={{
                        display: "flex",
                        width: 7,
                        height: 7,
                        borderRadius: 7,
                        backgroundColor: DOT_HEX[row.dot],
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", height: 1, backgroundColor: T.line, marginTop: 10, marginBottom: 8 }} />
            {total ? (
              <div style={{ display: "flex", flexDirection: "column", fontSize: 14, fontWeight: 600, color: T.ink }}>
                <div style={{ display: "flex" }}>{total.label}</div>
                <div style={{ display: "flex", color: T.ink2, fontWeight: 400 }}>{total.value}</div>
              </div>
            ) : null}
          </div>

          {/* THE DISCLOSURE TRAVELS WITH THE PICTURE.
              Every cast bearing surface on the site carries
              `workspace.sidebarLabel`, and the work receipt on the page
              carries its own "a storyboard, not a customer" footer. This
              card showed "ONBOARD BLUEFIN FOODS" and a client's onboarding
              board with neither, and it is the one artefact that reaches a
              stranger with no page around it, so a reader could take
              Bluefin Foods for a named customer. That is exactly what the
              invented customer gate exists to stop. */}
          <div style={{ display: "flex", fontSize: 13, color: T.ink3, marginTop: 10 }}>
            {tuesday.workspace.sidebarLabel}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}

// The site's social card (marketing-concept.md 2, 8 and 10, decision D25).
//
// This is the one artefact every share of the site renders, and it was the
// last thing on the rebuild still drawn from the pre-rebuild site: black
// with acid green, a three-rectangle mark that is not the brand lockup, a
// "Replaces 15 disconnected tools" line against the 14 the page's own H1
// eyebrow uses, and a "Business Operating System, Made in India" footer
// against the decided PPMS positioning. A share card that contradicts the
// page it links to is the fastest way to lose the argument before anyone
// reads it.
//
// So it is the page, at card size, on the page's own rules:
//
//   light only, white ground, one navy band, one blue accent
//   the four brand dots, which are the brand mark
//   Inter 600 on the display line, Inter 400 on the body, one weight each
//   the H1 the page actually carries, and the customer's own number
//
// EVERY NUMBER HERE IS SOURCED. The tool count is realQuote.toolCount, the
// same field the hero eyebrow reads, so the card cannot invent a 15. The
// module count is the fixture's hub list. The headline is heroHeadline(),
// the same function the H1 calls. Nothing on this card is typed twice.
//
// Node runtime, not edge, for the same reason as the receipt card: Satori
// does not inherit a page's webfont, so Inter has to be handed to it as
// bytes, read from public/ at request time and cached in module scope.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { realQuote } from "@/components/marketing/config";
import { DOT_HEX, tuesday } from "@/components/marketing/data/tuesday";
import { heroHeadline } from "@/components/marketing/headline";

export const runtime = "nodejs";
export const alt = "WorkwrK: your people, processes, work and goals, snapped together.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The marketing scope's token values, literal because Satori has no custom properties. */
const T = {
  canvas: "#FFFFFF",
  ink: "#1F2430",
  ink2: "#5C6779",
  ink3: "#98A2B3",
  navy: "#1B2537",
} as const;

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

export default async function OgImage() {
  const headline = heroHeadline();
  let fonts: Awaited<ReturnType<typeof interFonts>> | undefined;
  try {
    fonts = await interFonts();
  } catch {
    // Satori falls back to its own face. A card in the wrong typeface is a
    // smaller problem than a share that renders nothing at all.
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: T.canvas,
          color: T.ink,
          fontFamily: "Inter",
          padding: 64,
        }}
      >
        {/* The wordmark: the four dots between the two k's, which is the
            brand mark and the only place the four hexes appear. */}
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 600, letterSpacing: "-0.03em" }}>workwr</div>
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            {DOT_ROW.map((hex) => (
              <div key={hex} style={{ display: "flex", width: 7, height: 7, borderRadius: 7, backgroundColor: hex }} />
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 600, letterSpacing: "-0.03em" }}>k</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              display: "flex",
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: T.ink2,
            }}
          >
            {headline.eyebrow}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 66,
              lineHeight: 1.05,
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
          <div style={{ display: "flex", fontSize: 26, color: T.ink2, lineHeight: 1.4 }}>
            {`People, processes, work and goals in one system. ${tuesday.hubs.length} blocks, one data model, ${realQuote.toolCount} categories of tool it stands in for.`}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              fontSize: 17,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: T.ink3,
            }}
          >
            People and project management
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 20px",
              borderRadius: 8,
              backgroundColor: T.navy,
              color: T.canvas,
              fontSize: 19,
              fontWeight: 600,
            }}
          >
            workwrk.com
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}

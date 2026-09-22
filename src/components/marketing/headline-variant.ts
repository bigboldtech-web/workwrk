// Which hero headline is live (marketing-concept.md 2.1, 12 Phase 2 item 12,
// decision 1: the connection headline is the control, "Cancel 14 tools. Keep
// one." is variant B, tested from day one).
//
// This is a LEAF. It imports nothing, and that is its whole reason to exist.
//
// The A/B is only worth running if the events can be split by variant, which
// means the measurement module has to know which headline the visitor saw.
// The obvious way to tell it is to import `heroHeadline`, and that would
// drag `headline.ts` into `instrumentation.ts`, which is a client module: via
// `config.ts` it pulls the whole 850 line Tuesday fixture into the browser
// bundle of every page that renders a button. One letter is not worth 40 KB.
//
// So the letter lives here, alone, and both sides read it: `headline.ts`
// chooses the copy, `instrumentation.ts` stamps the events.
//
// It is read at module scope so the server render inlines it: the H1 is the
// LCP element and must not wait for a client read to decide what it says.

export type HeadlineVariant = "a" | "b";

/** Anything but "b" is the control, so a typo cannot ship an empty hero. */
export function resolveVariant(raw: string | undefined): HeadlineVariant {
  return raw?.trim().toLowerCase() === "b" ? "b" : "a";
}

export const heroVariant: HeadlineVariant = resolveVariant(process.env.NEXT_PUBLIC_MARKETING_H1);

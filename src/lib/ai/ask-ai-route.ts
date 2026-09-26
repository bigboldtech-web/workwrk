// Where an Ask AI entry point takes you (spec-ai-automation sections 1.6 and
// 2, /sidekick Keyboard). Pure, so the one rule every entry point shares is
// testable without a browser.
//
//   - 1024 and wider, anywhere but /sidekick: the 360 panel opens beside the
//     page and pushes it.
//   - Below 1024 there is no room for a panel beside the content, and the
//     panel never overlays, so the entry point navigates to the full page.
//   - On /sidekick itself the page IS the thread: a second thread in a panel
//     would put two on screen, so the entry point stays on the page (with the
//     prompt, when there is one, as ?q=) and the composer takes focus.

export const ASK_AI_PANEL_MIN_WIDTH = 1024;

export type AskAiTarget =
  | { kind: "panel" }
  | { kind: "navigate"; href: string }
  | { kind: "focus-page" };

export function askAiTarget(opts: { width: number; pathname: string | null; prompt?: string | null }): AskAiTarget {
  const prompt = opts.prompt?.trim() ?? "";
  const onPage = opts.pathname === "/sidekick" || (opts.pathname ?? "").startsWith("/sidekick/");
  if (onPage && !prompt) return { kind: "focus-page" };
  if (onPage || opts.width < ASK_AI_PANEL_MIN_WIDTH) {
    return { kind: "navigate", href: prompt ? `/sidekick?q=${encodeURIComponent(prompt)}` : "/sidekick" };
  }
  return { kind: "panel" };
}

/** The event /sidekick listens for to focus its composer. */
export const ASK_AI_FOCUS_EVENT = "workwrk:ask-ai:focus-composer";

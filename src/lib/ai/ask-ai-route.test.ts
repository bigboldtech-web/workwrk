import { describe, expect, it } from "vitest";
import { askAiTarget } from "./ask-ai-route";

describe("askAiTarget", () => {
  it("opens the panel at 1024 and wider", () => {
    expect(askAiTarget({ width: 1024, pathname: "/home" })).toEqual({ kind: "panel" });
    expect(askAiTarget({ width: 1440, pathname: "/spaces/x", prompt: "hi" })).toEqual({ kind: "panel" });
  });

  it("navigates to the full page below 1024, carrying the prompt", () => {
    expect(askAiTarget({ width: 1023, pathname: "/home" })).toEqual({ kind: "navigate", href: "/sidekick" });
    expect(askAiTarget({ width: 800, pathname: "/home", prompt: "What is due?" })).toEqual({
      kind: "navigate",
      href: "/sidekick?q=What%20is%20due%3F",
    });
  });

  it("never opens a second thread on /sidekick", () => {
    expect(askAiTarget({ width: 1440, pathname: "/sidekick" })).toEqual({ kind: "focus-page" });
    expect(askAiTarget({ width: 1440, pathname: "/sidekick", prompt: "  " })).toEqual({ kind: "focus-page" });
    expect(askAiTarget({ width: 1440, pathname: "/sidekick", prompt: "x" })).toEqual({ kind: "navigate", href: "/sidekick?q=x" });
  });
});

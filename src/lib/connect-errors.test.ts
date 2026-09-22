import { describe, expect, it } from "vitest";
import { GOOGLE_CONNECT_ERRORS, googleConnectSentence } from "./connect-errors";

describe("googleConnectSentence", () => {
  it("has a plain sentence for every code the callback can send", () => {
    // The list is the one src/app/api/integrations/google-calendar/callback
    // actually produces, plus Google's own access_denied. If the callback
    // gains a code and this test is not updated, the person sees the raw
    // code, which is honest but is not a sentence.
    for (const code of GOOGLE_CONNECT_ERRORS) {
      const s = googleConnectSentence(code);
      expect(s).not.toBe(code);
      expect(s.length).toBeGreaterThan(8);
      // Sentence FRAGMENTS, because the card reads "Google Calendar did
      // not connect: {sentence}." around them: no trailing stop, and no
      // leading capital unless the word itself is a name ("Google").
      expect(s.endsWith(".")).toBe(false);
      expect(s[0] === s[0].toLowerCase() || s.startsWith("Google")).toBe(true);
    }
  });

  it("falls through to the raw code for anything it does not know", () => {
    // Deliberate: a code somebody can grep for beats a vague apology.
    expect(googleConnectSentence("weird_new_thing")).toBe("weird_new_thing");
    expect(googleConnectSentence("")).toBe("");
  });
});

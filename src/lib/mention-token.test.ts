import { describe, expect, it } from "vitest";
import { detectMention, surviving, type MentionRef } from "./mention-token";

describe("detectMention", () => {
  it("opens on @ at the start of the text", () => {
    expect(detectMention("@ad", 3)).toEqual({ start: 0, query: "ad" });
  });

  it("opens on @ after a space or an opening bracket", () => {
    expect(detectMention("ping @ad", 8)).toEqual({ start: 5, query: "ad" });
    expect(detectMention("(@ad", 4)).toEqual({ start: 1, query: "ad" });
  });

  // The reason the rule exists: an email address is not a mention.
  it("does not open inside an email address", () => {
    expect(detectMention("write to ada@b.test", 19)).toBeNull();
  });

  it("closes on a newline or a second @", () => {
    expect(detectMention("@ada\nnext", 9)).toBeNull();
    expect(detectMention("@ada @bob", 9)).toEqual({ start: 5, query: "bob" });
  });

  it("gives up on a token nobody would type", () => {
    expect(detectMention(`@${"x".repeat(41)}`, 42)).toBeNull();
  });

  it("reports an empty query the moment @ is typed", () => {
    expect(detectMention("hello @", 7)).toEqual({ start: 6, query: "" });
  });

  it("is null when there is no @ before the caret", () => {
    expect(detectMention("no mention here", 15)).toBeNull();
  });
});

describe("surviving", () => {
  const ada: MentionRef = { id: "u1", name: "Ada Lovelace" };
  const bob: MentionRef = { id: "u2", name: "Bob Ross" };

  it("reports only the people still named in the body", () => {
    expect(surviving([ada, bob], "hi @Ada Lovelace")).toEqual(["u1"]);
  });

  // The promise that stops a notification for a message that never names you.
  it("reports nobody when the token was edited out", () => {
    expect(surviving([ada], "hi there")).toEqual([]);
  });

  it("de-duplicates a person mentioned twice", () => {
    expect(surviving([ada, ada], "@Ada Lovelace and @Ada Lovelace")).toEqual(["u1"]);
  });

  it("reports nobody for an empty draft", () => {
    expect(surviving([ada, bob], "")).toEqual([]);
  });
});

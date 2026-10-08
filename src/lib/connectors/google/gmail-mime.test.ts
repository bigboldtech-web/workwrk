// The email as Gmail takes it (src/lib/connectors/google/gmail-mime.ts): no
// header can be planted through a subject, words that are not ASCII go as
// encoded words, a reply names what it answers, and two identical sends
// share one key whatever the order or case of their recipients.

import { describe, expect, it } from "vitest";
import { buildMime, decodeHeaderWords, dedupeKey, encodeHeaderWord, headerSafe, isEmailAddress, parseAddressList, rawOf } from "./gmail-mime";

const lines = (mime: string) => mime.split("\r\n");
const headerBlock = (mime: string) => mime.slice(0, mime.indexOf("\r\n\r\n"));
const bodyOf = (mime: string) => Buffer.from(mime.slice(mime.indexOf("\r\n\r\n") + 4).replace(/\r\n/g, ""), "base64").toString("utf8");

describe("buildMime", () => {
  it("never lets a subject start a header of its own", () => {
    const mime = buildMime({ to: ["olivia@proof.test"], cc: [], subject: "Hi\r\nBcc: x@evil.test", body: "Hello" });
    expect(lines(headerBlock(mime)).some((l) => /^bcc:/i.test(l))).toBe(false);
    expect(mime).toContain("Subject: Hi Bcc: x@evil.test\r\n");
    expect(headerSafe("a\nb\u0000c\rd")).toBe("a bc d");
  });

  it("writes To, Cc and the plain-text body, with no From and no Bcc header", () => {
    const mime = buildMime({ to: ["olivia@proof.test", "OLIVIA@proof.test"], cc: ["mia@proof.test"], subject: "Plan", body: "Line one\nLine two" });
    const head = lines(headerBlock(mime));
    expect(head).toContain("To: olivia@proof.test");
    expect(head).toContain("Cc: mia@proof.test");
    expect(head).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(head).toContain("Content-Transfer-Encoding: base64");
    expect(head.some((l) => /^(from|bcc):/i.test(l))).toBe(false);
    expect(bodyOf(mime)).toBe("Line one\r\nLine two");
  });

  it("refuses a recipient that is not one plain address, and an email to nobody", () => {
    expect(() => buildMime({ to: ["Max <max@proof.test>"], cc: [], subject: "x", body: "y" })).toThrow();
    expect(() => buildMime({ to: ["a@proof.test\r\nBcc: x@evil.test"], cc: [], subject: "x", body: "y" })).toThrow();
    expect(() => buildMime({ to: [], cc: ["mia@proof.test"], subject: "x", body: "y" })).toThrow();
  });

  it("encodes a subject that is not ASCII (RFC 2047), and reads back as written", () => {
    const subject = "Café plans for Zoë 🎉";
    const mime = buildMime({ to: ["olivia@proof.test"], cc: [], subject, body: "x" });
    const head = lines(headerBlock(mime));
    const at = head.findIndex((l) => l.startsWith("Subject:"));
    let end = at + 1;
    while (end < head.length && head[end].startsWith(" ")) end += 1;
    expect(head[at]).toMatch(/^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(decodeHeaderWords(head.slice(at, end).join("\r\n").replace(/^Subject: /, ""))).toBe(subject);
    // A long one is folded into words of at most 75 characters, never splitting a character.
    const long = encodeHeaderWord("é".repeat(120));
    for (const word of long.split("\r\n ")) expect(word.length).toBeLessThanOrEqual(75);
    expect(decodeHeaderWords(long)).toBe("é".repeat(120));
    // Plain ASCII stays as it is; ASCII that a client would decode is encoded.
    expect(encodeHeaderWord("Weekly status")).toBe("Weekly status");
    expect(encodeHeaderWord("=?UTF-8?B?SGk=?=")).toMatch(/^=\?UTF-8\?B\?/);
  });

  it("names what a reply answers", () => {
    const mime = buildMime({
      to: ["boss@ext.test"],
      cc: [],
      subject: "Re: Invoice due",
      body: "Paid.",
      inReplyTo: "<m2@mail.test>",
      references: "<m1@mail.test> <m2@mail.test>",
    });
    const head = headerBlock(mime);
    expect(head).toContain("In-Reply-To: <m2@mail.test>\r\n");
    expect(head).toContain("References: <m1@mail.test> <m2@mail.test>\r\n");
    expect(buildMime({ to: ["boss@ext.test"], cc: [], subject: "x", body: "y" })).not.toMatch(/In-Reply-To|References/);
  });
});

describe("rawOf", () => {
  it("is base64url with no padding", () => {
    const raw = rawOf(buildMime({ to: ["olivia@proof.test"], cc: [], subject: "Hi?>", body: "Ünïcode body ~~~ ???" }));
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(raw).not.toContain("=");
    expect(rawOf("a")).toBe("YQ");
  });
});

describe("dedupeKey", () => {
  it("ignores the order and case of the recipients, never the words or the thread", () => {
    const a = dedupeKey({ to: ["Olivia@proof.test", "mia@proof.test"], cc: ["Lea@proof.test"], subject: "Hi", body: "Hello" });
    const b = dedupeKey({ to: ["MIA@proof.test", "olivia@proof.test"], cc: ["lea@proof.test"], subject: "Hi", body: "Hello" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(dedupeKey({ to: ["olivia@proof.test", "mia@proof.test"], cc: ["lea@proof.test"], subject: "Hi", body: "Hello!" })).not.toBe(a);
    expect(dedupeKey({ to: ["olivia@proof.test", "mia@proof.test"], cc: ["lea@proof.test"], subject: "Hi", body: "Hello", threadId: "t1" })).not.toBe(a);
    expect(dedupeKey({ to: ["olivia@proof.test"], cc: ["mia@proof.test", "lea@proof.test"], subject: "Hi", body: "Hello" })).not.toBe(a);
  });
});

describe("addresses", () => {
  it("takes one plain address only", () => {
    for (const ok of ["max@proof.test", "o'brien+team@mail.example.co.uk", "max@proof.xn--p1ai"]) expect(isEmailAddress(ok), ok).toBe(true);
    // An encoded word a client would decode into another address (review of step 1).
    expect(isEmailAddress("=?utf-8?q?x=40evil.test?=@corp.com")).toBe(false);
    for (const bad of ["", "max", "max@", "@proof.test", "max@proof", "a b@proof.test", "<max@proof.test>", "max@proof.test, lea@proof.test", "max@@proof.test", `${"a".repeat(250)}@x.test`]) {
      expect(isEmailAddress(bad), bad).toBe(false);
    }
  });

  it("reads a header's list, and a name never adds an address", () => {
    expect(parseAddressList('"Chen, Max" <max@proof.test>, lea@proof.test, Mia <mia@proof.test>')).toEqual([
      { name: "Chen, Max", email: "max@proof.test" },
      { name: null, email: "lea@proof.test" },
      { name: "Mia", email: "mia@proof.test" },
    ]);
    // An encoded name that decodes to "x@evil.test, " is still only a name.
    const planted = `=?UTF-8?B?${Buffer.from("x@evil.test, ").toString("base64")}?= <real@proof.test>`;
    expect(parseAddressList(planted)).toEqual([{ name: "x@evil.test,", email: "real@proof.test" }]);
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
  });
});

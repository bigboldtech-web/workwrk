// Settings, API keys: what a key is, said truly (found while refreshing the
// API reference, 2026-10-19). A key carries scopes only, never a person: it
// was said to act as the person who made it; and the Admin scope was said to
// include key management, which no key can do (keys and webhooks need a
// signed-in session).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("Settings, API keys copy", () => {
  it("says a key is not tied to a person, and that Admin is not key management", () => {
    expect(src).toContain("A key is not tied to the person who made it: it reads and changes what its scopes allow across the whole workspace.");
    expect(src).toContain("Everything Write does, and inviting people. Keys and webhooks are managed only here, never with a key.");
    expect(src).not.toContain("acts as the person who made it");
    expect(src).not.toContain("key management included");
  });
});

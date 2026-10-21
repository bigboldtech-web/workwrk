// Client metadata and the label shown for an app (docs/plans/mcp-server.md
// Decision 3, 3.3, 3.4 appLabel, review H3, step 1 tests): no name is ever
// refused; "Claude Code (workwrk)", "WorkwrK Helper", an address-like name
// and "" are kept and shown as their redirect's label; "Claude" is shown as
// itself; private_key_jwt and implicit are refused.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appLabel, mixesScripts, nameIsMisleading, nameSkeleton } from "./app-label";
import { cleanClientName, parseClientMetadata } from "./client-meta";

const saved = { ...process.env };
beforeEach(() => {
  process.env.NEXTAUTH_URL = "https://app.workwrk.com";
  process.env.APP_HOST = "app.workwrk.com";
});
afterEach(() => {
  process.env = { ...saved };
});

const LOOPBACK = "http://127.0.0.1:18799/callback";
const reg = (o: Record<string, unknown>) => parseClientMetadata({ redirect_uris: [LOOPBACK], ...o });

describe("registration never refuses a name", () => {
  it("keeps 'Claude Code (workwrk)', 'WorkwrK Helper', an address-like name and an empty one", () => {
    for (const name of ["Claude Code (workwrk)", "WorkwrK Helper", "https://evil.example", "support@evil.example", "www.evil.example", "", undefined, 42]) {
      const r = reg({ client_name: name, token_endpoint_auth_method: "none" });
      expect(r.ok, String(name)).toBe(true);
    }
  });

  it("removes control and invisible characters, joins white space and cuts to 60", () => {
    expect(cleanClientName("Clau​de‮ Code\n\tApp")).toBe("Claude Code App");
    expect(cleanClientName("  ")).toBe("");
    expect([...cleanClientName("x".repeat(80))]).toHaveLength(60);
  });
});

describe("the label shown for an app", () => {
  it("shows the redirect's label for a name that could pass for WorkwrK or an address, or none", () => {
    expect(appLabel("Claude Code (workwrk)", LOOPBACK)).toBe("an app on this computer");
    expect(appLabel("WorkwrK Helper", "https://helper.example/cb")).toBe("helper.example");
    expect(appLabel("Work wrK Security Check", "https://helper.example/cb")).toBe("helper.example");
    expect(appLabel("ＷｏｒｋｗｒＫ", "https://helper.example/cb")).toBe("helper.example");
    expect(appLabel("https://evil.example", "https://evil.example/cb")).toBe("evil.example");
    expect(appLabel("google.com", "https://evil.example/cb")).toBe("evil.example");
    expect(appLabel("help@desk", LOOPBACK)).toBe("an app on this computer");
    expect(appLabel("", "cursor://anysphere.cursor-retrieval/cb")).toBe("the cursor app");
  });

  // Review of step 1, M2: NFKC alone let a look-alike "WorkwrK" through.
  it("catches look-alikes of WorkwrK by their skeleton: digits, Cyrillic and Greek letters, vv for w, accents", () => {
    const cyr = (c: number) => String.fromCodePoint(c);
    const looks = [
      "W0rkwrk Security",
      `W${cyr(0x043e)}rkwrk`, // Cyrillic o
      `Workwr${cyr(0x043a)}`, // Cyrillic k
      `Wor${cyr(0x043a)}w${cyr(0x0433)}k`, // Cyrillic k and a Cyrillic r look-alike
      `W${cyr(0x03bf)}rkwrk`, // Greek omicron
      `Workwr${cyr(0x03ba)}`, // Greek kappa
      `${cyr(0x03c9)}orkwrk`, // Greek omega for w
      "Vvorkwrk Helper",
      "VVorkvvrk",
      "Wörkwrķ", // accents
      "Wørkwrk",
      `Work${cyr(0x3164)}wrk`, // a Hangul filler between the halves
      "W o r k w r k",
    ];
    for (const name of looks) expect(appLabel(name, "https://helper.example/cb"), name).toBe("helper.example");
    expect(nameSkeleton("W0rk-VVrK")).toBe("workwrk");
  });

  it("treats a name mixing Latin with Cyrillic or Greek as misleading (UTS 39 mixed script)", () => {
    const cyrillicC = String.fromCodePoint(0x0421);
    expect(mixesScripts(`${cyrillicC}laude`)).toBe(true);
    expect(appLabel(`${cyrillicC}laude`, "https://claude.example/cb")).toBe("claude.example");
    expect(appLabel(`Claude ${String.fromCodePoint(0x03b1)}`, "https://claude.example/cb")).toBe("claude.example");
    // One script alone is no mix: a wholly Cyrillic or Greek name is shown.
    expect(mixesScripts("Помощник")).toBe(false);
    expect(appLabel("Помощник", LOOPBACK)).toBe("Помощник");
  });

  it("treats a name of only blank-rendering characters as empty", () => {
    for (const name of ["ㅤ", "⠀⠀", "ㅤ ᅟᅠ", "́́", "﻿​", "ﾠ"]) {
      expect(nameIsMisleading(name), JSON.stringify(name)).toBe(true);
      expect(appLabel(name, LOOPBACK)).toBe("an app on this computer");
    }
  });

  it("shows 'Claude' as itself, and other plain names too", () => {
    expect(appLabel("Claude", "https://claude.ai/api/mcp/auth_callback")).toBe("Claude");
    expect(appLabel("Cursor", "cursor://anysphere.cursor-retrieval/cb")).toBe("Cursor");
    expect(appLabel("VS Code 1.2", LOOPBACK)).toBe("VS Code 1.2");
    expect(nameIsMisleading("ChatGPT")).toBe(false);
  });
});

describe("the rest of the metadata", () => {
  it("refuses private_key_jwt and the implicit grant", () => {
    expect(reg({ token_endpoint_auth_method: "private_key_jwt" })).toMatchObject({ ok: false, error: "invalid_client_metadata" });
    expect(reg({ grant_types: ["implicit"] })).toMatchObject({ ok: false, error: "invalid_client_metadata" });
    expect(reg({ grant_types: ["refresh_token"] })).toMatchObject({ ok: false, error: "invalid_client_metadata" });
    expect(reg({ response_types: ["token"] })).toMatchObject({ ok: false, error: "invalid_client_metadata" });
  });

  it("defaults to client_secret_basic and both grant types, and drops logos, URIs and keys", () => {
    const r = reg({ logo_uri: "https://evil.example/logo.png", client_uri: "https://evil.example", jwks: { keys: [] }, scope: "everything" });
    expect(r).toEqual({ ok: true, meta: { name: "", redirectUris: [LOOPBACK], grantTypes: ["authorization_code", "refresh_token"], authMethod: "client_secret_basic" } });
  });

  it("refuses 0 or more than 5 redirect URIs, and any one that is not allowed", () => {
    expect(parseClientMetadata({ redirect_uris: [] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(parseClientMetadata({ redirect_uris: [1, 2, 3, 4, 5, 6].map((p) => `http://127.0.0.1:${p}/cb${p}`) })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(parseClientMetadata({ redirect_uris: [LOOPBACK, "https://app.workwrk.com/cb"] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(parseClientMetadata(["not", "an", "object"])).toMatchObject({ ok: false, error: "invalid_client_metadata" });
  });
});

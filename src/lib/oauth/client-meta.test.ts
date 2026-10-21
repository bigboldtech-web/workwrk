// Client metadata and the label shown for an app (docs/plans/mcp-server.md
// Decision 3, 3.3, 3.4 appLabel, review H3, step 1 tests): no name is ever
// refused; "Claude Code (workwrk)", "WorkwrK Helper", an address-like name
// and "" are kept and shown as their redirect's label; "Claude" is shown as
// itself; private_key_jwt and implicit are refused.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appLabel, nameIsMisleading } from "./app-label";
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

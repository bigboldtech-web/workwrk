// The AI teammates' own Google client (src/lib/connectors/google/config.ts):
// nothing is offered without its id, its secret, the sealing key and a
// product; production never sends tokens to a local stand-in; and the
// stand-in base moves every address.

import { describe, expect, it } from "vitest";
import { googleConfig, googleRevokeConfig } from "./config";

const FULL = {
  NODE_ENV: "development",
  GOOGLE_AGENT_CLIENT_ID: "client-id",
  GOOGLE_AGENT_CLIENT_SECRET: "client-secret",
  SECRETS_ENCRYPTION_KEY: "a-test-key",
  GOOGLE_AGENT_PRODUCTS: "gmail,calendar",
};

const env = (o: Record<string, string | undefined> = {}) => ({ ...FULL, ...o }) as NodeJS.ProcessEnv;

describe("googleConfig", () => {
  it("is null without the client id, the secret, the sealing key or a product", () => {
    expect(googleConfig(env())).not.toBeNull();
    expect(googleConfig(env({ GOOGLE_AGENT_CLIENT_ID: undefined }))).toBeNull();
    expect(googleConfig(env({ GOOGLE_AGENT_CLIENT_SECRET: "  " }))).toBeNull();
    expect(googleConfig(env({ SECRETS_ENCRYPTION_KEY: undefined }))).toBeNull();
    expect(googleConfig(env({ GOOGLE_AGENT_PRODUCTS: undefined }))).toBeNull();
    expect(googleConfig(env({ GOOGLE_AGENT_PRODUCTS: "drive,foo" }))).toBeNull();
  });

  it("never uses the sign-in client", () => {
    expect(googleConfig(env({ GOOGLE_AGENT_CLIENT_ID: undefined, GOOGLE_CLIENT_ID: "sign-in-client", GOOGLE_CLIENT_SECRET: "sign-in-secret" }))).toBeNull();
  });

  it("is null in production with a local or plain-http stand-in", () => {
    expect(googleConfig(env({ NODE_ENV: "production", GOOGLE_AGENT_BASE_URL: "http://127.0.0.1:8788" }))).toBeNull();
    expect(googleConfig(env({ NODE_ENV: "production", GOOGLE_AGENT_BASE_URL: "https://localhost:8788" }))).toBeNull();
    expect(googleConfig(env({ NODE_ENV: "production", GOOGLE_AGENT_BASE_URL: "https://[::1]:8788" }))).toBeNull();
    expect(googleConfig(env({ NODE_ENV: "production", GOOGLE_AGENT_BASE_URL: "http://stand-in.example.com" }))).toBeNull();
    // Any stand-in at all, https and far from this machine included (review of step 1).
    expect(googleConfig(env({ NODE_ENV: "production", GOOGLE_AGENT_BASE_URL: "https://standin.staging.example.com" }))).toBeNull();
    expect(googleConfig(env({ NODE_ENV: "production", GOOGLE_AGENT_BASE_URL: "https://localhost." }))).toBeNull();
    expect(googleConfig(env({ GOOGLE_AGENT_BASE_URL: "not an address" }))).toBeNull();
  });

  it("talks to Google itself when no stand-in is set", () => {
    expect(googleConfig(env({ NODE_ENV: "production" }))).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      revokeUrl: "https://oauth2.googleapis.com/revoke",
      gmailBase: "https://gmail.googleapis.com/gmail/v1",
      calendarBase: "https://www.googleapis.com/calendar/v3",
      products: ["gmail", "calendar"],
      standIn: false,
    });
  });

  it("moves all five addresses to the dev stand-in", () => {
    expect(googleConfig(env({ GOOGLE_AGENT_BASE_URL: "http://127.0.0.1:8788/" }))).toMatchObject({
      authUrl: "http://127.0.0.1:8788/o/oauth2/v2/auth",
      tokenUrl: "http://127.0.0.1:8788/token",
      revokeUrl: "http://127.0.0.1:8788/revoke",
      gmailBase: "http://127.0.0.1:8788/gmail/v1",
      calendarBase: "http://127.0.0.1:8788/calendar/v3",
      standIn: true,
    });
  });

  it("offers only the products the deployment lists", () => {
    expect(googleConfig(env({ GOOGLE_AGENT_PRODUCTS: "calendar" }))?.products).toEqual(["calendar"]);
  });
});

describe("googleRevokeConfig (review of step 2)", () => {
  it("still tells Google when no product is offered and no client is set, so the queue drains", () => {
    const off = env({ GOOGLE_AGENT_PRODUCTS: undefined, GOOGLE_AGENT_CLIENT_ID: undefined, GOOGLE_AGENT_CLIENT_SECRET: undefined });
    expect(googleConfig(off)).toBeNull();
    expect(googleRevokeConfig(off)).toEqual({ revokeUrl: "https://oauth2.googleapis.com/revoke", standIn: false });
  });

  it("waits without the sealing key: no queued token could be opened", () => {
    expect(googleRevokeConfig(env({ SECRETS_ENCRYPTION_KEY: undefined }))).toBeNull();
  });

  it("uses the stand-in outside production only", () => {
    expect(googleRevokeConfig(env({ GOOGLE_AGENT_BASE_URL: "http://127.0.0.1:8788/" }))).toEqual({ revokeUrl: "http://127.0.0.1:8788/revoke", standIn: true });
    expect(googleRevokeConfig(env({ NODE_ENV: "production", GOOGLE_AGENT_BASE_URL: "http://127.0.0.1:8788" }))).toEqual({
      revokeUrl: "https://oauth2.googleapis.com/revoke",
      standIn: false,
    });
    expect(googleRevokeConfig(env({ GOOGLE_AGENT_BASE_URL: "not an address" }))).toBeNull();
  });
});

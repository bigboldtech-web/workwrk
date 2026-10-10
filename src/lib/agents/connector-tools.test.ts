// The Gmail tools (src/lib/agents/connector-tools.ts,
// docs/plans/ai-teammates-phase3.md step 3) against a Google shaped as
// scripts/google-stand-in.mjs will be (fetch mocked), with the connector
// tables in memory
// (connector-test-db.ts): a search clips every part and says what is other
// people's words; a conversation is the newest ten and 20,000 characters, its
// attachments counted and never named; a send or a reply runs only from its
// approval, only as the Google account its card named, and once; what the
// person did not allow is refused before Google is asked anything.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/connectors/connector-test-db")).connectorDb }));
const acting = vi.hoisted(() => ({ person: null as Record<string, unknown> | null }));
vi.mock("./acting", () => ({ actingPersonFor: async () => acting.person }));

import { cdb, resetConnectorDb, seedConnection } from "@/lib/connectors/connector-test-db";
import { sealToken } from "@/lib/connectors/seal";
import { CONNECTOR_TOOLS_DEFS, READ_ANSWER_MAX } from "./connector-tools";
import { CONNECTOR_COPY, TEAMMATE_TOOL_ERRORS } from "./teammate-copy";
import type { ToolContext } from "./tools";

const BASE = "https://g.test";

const PERSON = { userId: "u-max", organizationId: "org1", name: "Max Chen", firstName: "Max", email: "max@proof.test", timezone: "UTC", orgRole: "MEMBER", viewer: {} };
const ACCOUNT = { sub: "sub-max", email: "max@mail.test" };

function ctx(o: { trigger?: string; actionId?: string } = {}): ToolContext {
  return {
    orgId: "org1",
    userId: "u-max",
    teammate: { agentId: "a1", agentName: "Inbox helper", sessionId: "s1", routineId: null, trigger: (o.trigger ?? "CHAT") as never, timezone: "UTC", ...(o.actionId ? { actionId: o.actionId } : {}) },
  };
}

const run = (tool: keyof typeof CONNECTOR_TOOLS_DEFS, input: Record<string, unknown>, c: ToolContext = ctx()) => CONNECTOR_TOOLS_DEFS[tool].handler(c, input) as Promise<Record<string, unknown>>;

// ── The stand-in Google ──────────────────────────────────────────────

type Reply = { status: number; json?: unknown } | "timeout";
type Route = (url: URL, body: unknown) => Reply;

let routes: Record<string, Route> = {};
let calls: Array<{ method: string; url: URL; body: unknown; auth: string | null }> = [];

function stubGoogle(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (raw: string, init?: RequestInit) => {
      const url = new URL(String(raw));
      const method = init?.method ?? "GET";
      // Gmail's requests are JSON; the token endpoint's is a form, kept as text.
      const text = typeof init?.body === "string" ? init.body : undefined;
      let body: unknown = undefined;
      if (text !== undefined) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      calls.push({ method, url, body, auth: new Headers(init?.headers).get("authorization") });
      const key = `${method} ${url.pathname}`;
      const route = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && key.startsWith(k.slice(0, -1)))?.[1];
      const r = route ? route(url, body) : { status: 404, json: { error: { code: 404 } } };
      if (r === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const header = (name: string, value: string) => ({ name, value });

/** A message as Gmail's metadata or full format answers it. */
function message(id: string, o: { from?: string; to?: string; subject?: string; snippet?: string; text?: string; attachment?: boolean; unread?: boolean } = {}) {
  const text = { mimeType: "text/plain", body: { data: b64(o.text ?? "Hello.") } };
  return {
    id,
    threadId: "t-invoice",
    labelIds: o.unread ? ["INBOX", "UNREAD"] : ["INBOX"],
    snippet: o.snippet ?? "Hello.",
    payload: {
      mimeType: o.attachment ? "multipart/mixed" : "text/plain",
      headers: [header("From", o.from ?? "Boss <boss@ext.test>"), header("To", o.to ?? "max@mail.test"), header("Subject", o.subject ?? "Invoice due"), header("Date", "Thu, 8 Oct 2026 09:00:00 +0000")],
      ...(o.attachment ? { parts: [text, { mimeType: "application/pdf", filename: "salary-review.pdf", body: { attachmentId: "att-secret-1", size: 2048 } }] } : { body: text.body }),
    },
  };
}

/** The raw message a POST sent, read back as text. */
function sentText(i = 0): string {
  const posts = calls.filter((c) => c.method === "POST");
  const b = posts[i]?.body as { raw?: string; message?: { raw?: string } } | undefined;
  return Buffer.from(String(b?.raw ?? b?.message?.raw ?? ""), "base64url").toString("utf8");
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_AGENT_CLIENT_ID", "stand-in");
  vi.stubEnv("GOOGLE_AGENT_CLIENT_SECRET", "stand-in");
  vi.stubEnv("SECRETS_ENCRYPTION_KEY", "b".repeat(64));
  vi.stubEnv("GOOGLE_AGENT_PRODUCTS", "gmail,calendar");
  vi.stubEnv("GOOGLE_AGENT_BASE_URL", BASE);
  resetConnectorDb();
  cdb.policy.set("org1", ["gmail"]);
  cdb.agents.push({
    id: "a1",
    slug: "inbox-helper",
    name: "Inbox helper",
    organizationId: "org1",
    status: "ENABLED",
    visibility: "PRIVATE",
    ownerId: "u-max",
    description: "Reads my mail",
    systemPrompt: "Be brief.",
    toolNames: ["search_email", "read_email", "draft_email", "send_email", "reply_email"],
    approvalRules: {},
    modelOverride: null,
    productSlug: null,
  });
  seedConnection({
    organizationId: "org1",
    userId: "u-max",
    accountSub: ACCOUNT.sub,
    accountEmail: ACCOUNT.email,
    products: ["gmail"],
    refreshTokenSealed: sealToken("refresh-token-value"),
    accessTokenSealed: sealToken("access-token-value"),
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  });
  acting.person = { ...PERSON };
  routes = {};
  calls = [];
  stubGoogle();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("who may use the person's Gmail, read at the call", () => {
  it("refuses without a teammate, and for a workspace teammate the person did not allow, before Google is asked anything", async () => {
    expect(await CONNECTOR_TOOLS_DEFS.search_email.handler({ orgId: "org1", userId: "u-max" }, { query: "x" })).toEqual({ error: TEAMMATE_TOOL_ERRORS.teammateOnly });
    cdb.agents[0].visibility = "WORKSPACE";
    cdb.agents[0].ownerId = "olivia";
    expect(await run("search_email", { query: "invoice" })).toEqual({ error: CONNECTOR_COPY.notAllowed("Inbox helper", "Gmail") });
    // The connection read is the person's own (Decision 5).
    expect(cdb.lookups).toEqual([{ organizationId: "org1", userId: "u-max" }]);
    expect(calls).toEqual([]);
  });

  it("stops at the next call once Gmail is turned off, or the teammate is paused", async () => {
    cdb.policy.set("org1", []);
    expect(await run("search_email", { query: "invoice" })).toEqual({ error: CONNECTOR_COPY.workspaceOff("Gmail") });
    cdb.policy.set("org1", ["gmail"]);
    cdb.agents[0].status = "DISABLED";
    expect(await run("search_email", { query: "invoice" })).toEqual({ error: CONNECTOR_COPY.teammateOff });
    expect(calls).toEqual([]);
  });

  it("leaves the calendar's tools not ready until step 4", async () => {
    expect(await run("list_events", { from: "2026-10-12" })).toEqual({ error: CONNECTOR_COPY.notYet });
  });
});

describe("search_email", () => {
  it("clips every part, skips a message gone since, says more matched, and carries the note (Decision 17)", async () => {
    routes[`GET /gmail/v1/users/me/messages`] = () => ({ status: 200, json: { messages: [{ id: "m1", threadId: "t1" }, { id: "gone", threadId: "t2" }, { id: "m3", threadId: "t3" }], nextPageToken: "more" } });
    routes[`GET /gmail/v1/users/me/messages/m1`] = () => ({
      status: 200,
      json: message("m1", { subject: "S".repeat(400), from: `"${"N".repeat(400)}" <boss@ext.test>`, snippet: `Tom &amp; Jerry ${"x".repeat(500)}`, unread: true }),
    });
    routes[`GET /gmail/v1/users/me/messages/m3`] = () => ({ status: 200, json: message("m3") });
    const r = await run("search_email", { query: "invoice", unreadOnly: true });
    const list = calls[0].url;
    expect(list.searchParams.get("q")).toBe("invoice is:unread");
    expect(list.searchParams.get("maxResults")).toBe("10");
    expect(calls[0].auth).toBe("Bearer access-token-value");
    expect(r).toMatchObject({ count: 2, partial: true, note: `${CONNECTOR_COPY.emailNote} ${CONNECTOR_COPY.moreEmails}` });
    const [first, second] = r.emails as Array<Record<string, unknown>>;
    expect((first.subject as string).length).toBe(200);
    // A long name is cut short; the address beside it never is (review of step 3).
    expect(first.from).toBe(`${"N".repeat(60)} <boss@ext.test>`);
    expect((first.snippet as string).length).toBe(200);
    expect((first.snippet as string).startsWith("Tom & Jerry")).toBe(true);
    expect(first).toMatchObject({ messageId: "m1", threadId: "t-invoice", unread: true });
    expect(second).toMatchObject({ messageId: "m3", subject: "Invoice due", from: "Boss <boss@ext.test>", unread: false });
    // Each message's own read asks only for its headers.
    expect(calls[1].url.searchParams.getAll("metadataHeaders")).toEqual(["From", "To", "Subject", "Date"]);
  });

  it("says what Google answered, in the person's words", async () => {
    routes[`GET /gmail/v1/users/me/messages`] = () => ({ status: 429 });
    expect(await run("search_email", { query: "invoice" })).toEqual({ error: CONNECTOR_COPY.googleBusy(30) });
  });

  it("cuts a long To list only between whole addresses, says how many it left out, and tells the model (review of step 3)", async () => {
    // Ten colleagues: about 380 characters. Before, the cut at 300 landed inside an address.
    const people = Array.from({ length: 10 }, (_, i) => `colleague.number${i}@finance.acme.test`);
    routes[`GET /gmail/v1/users/me/messages`] = () => ({ status: 200, json: { messages: [{ id: "m1", threadId: "t1" }] } });
    routes[`GET /gmail/v1/users/me/messages/m1`] = () => ({ status: 200, json: message("m1", { to: people.join(", ") }) });
    const r = await run("search_email", { query: "invoice" });
    const to = (r.emails as Array<{ to: string }>)[0].to;
    const shown = to.replace(/ and \d+ more address(es)?$/, "").split(", ");
    // Every address shown is one of the real ones, whole.
    for (const a of shown) expect(people).toContain(a);
    expect(to).toBe(CONNECTOR_COPY.moreAddresses(shown.join(", "), people.length - shown.length));
    expect(to.length).toBeLessThanOrEqual(300 + 40);
    expect(r).toMatchObject({ partial: true, note: `${CONNECTOR_COPY.emailNote} ${CONNECTOR_COPY.addressesCut}` });
  });

  it("refreshes an expired token once for the whole search, its list and every message read (review of step 3)", async () => {
    cdb.connections[0].accessTokenExpiresAt = new Date(Date.now() - 1000);
    routes[`POST /token`] = () => ({ status: 200, json: { access_token: "fresh-access-token", expires_in: 3600 } });
    routes[`GET /gmail/v1/users/me/messages`] = () => ({ status: 200, json: { messages: ["m1", "m2", "m3", "m4", "m5", "m6"].map((id) => ({ id, threadId: "t1" })) } });
    routes[`GET /gmail/v1/users/me/messages/*`] = (url) => ({ status: 200, json: message(url.pathname.split("/").pop() ?? "m") });
    const r = await run("search_email", { query: "invoice" });
    expect(r).toMatchObject({ count: 6 });
    // Before: one refresh, and one database write, for each of the seven requests.
    expect(calls.filter((c) => c.url.pathname === "/token")).toHaveLength(1);
    expect(calls.filter((c) => c.url.pathname.startsWith("/gmail/")).every((c) => c.auth === "Bearer fresh-access-token")).toBe(true);
  });
});

describe("read_email", () => {
  it("keeps the newest ten, 20,000 characters in all, counts attachments and never names one (Decisions 10 and 17)", async () => {
    const msgs = Array.from({ length: 12 }, (_, i) => message(`m${i}`, { text: `${i}`.padEnd(3000, "a"), attachment: i === 8 }));
    routes[`GET /gmail/v1/users/me/threads/t-invoice`] = (url) => (url.searchParams.get("format") === "full" ? { status: 200, json: { id: "t-invoice", messages: msgs } } : { status: 400 });
    const r = await run("read_email", { threadId: "t-invoice" });
    expect(r).toMatchObject({ threadId: "t-invoice", subject: "Invoice due", count: 12, earlier: 2, partial: true, note: `${CONNECTOR_COPY.emailNote} ${CONNECTOR_COPY.threadCut}` });
    const kept = r.messages as Array<{ messageId: string; body: string; bodyCut: boolean; attachments: number }>;
    expect(kept.map((m) => m.messageId)).toEqual(["m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11"]);
    // The newest six fit in 20,000; the older four read as cut.
    expect(kept.filter((m) => m.body === CONNECTOR_COPY.bodyCutMark).map((m) => m.messageId)).toEqual(["m2", "m3", "m4", "m5"]);
    expect(kept.filter((m) => m.body !== CONNECTOR_COPY.bodyCutMark).reduce((n, m) => n + m.body.length, 0)).toBeLessThanOrEqual(20_000);
    expect(kept.find((m) => m.messageId === "m8")?.attachments).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/salary-review|att-secret-1/);
  });

  it("always fits the model's limit with its note: the oldest bodies give way, the newest message never (review of step 3)", async () => {
    // Ten messages of 2,000 characters each fit the 20,000 for bodies, but
    // quotes double when written as JSON, and each carries a long To list.
    const many = Array.from({ length: 40 }, (_, i) => `person.number${i}@finance.acme.test`).join(", ");
    const msgs = Array.from({ length: 10 }, (_, i) => message(`m${i}`, { text: `${i}${'""'.repeat(999)}x`, to: many }));
    routes[`GET /gmail/v1/users/me/threads/t-invoice`] = () => ({ status: 200, json: { id: "t-invoice", messages: msgs } });
    const r = await run("read_email", { threadId: "t-invoice" });
    // Before: past 30,000 the executor kept only the first part, which lost the newest messages and the note.
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(READ_ANSWER_MAX);
    const kept = r.messages as Array<{ messageId: string; body: string; bodyCut: boolean }>;
    expect(kept.at(-1)?.messageId).toBe("m9");
    expect(kept.at(-1)?.body.startsWith("9")).toBe(true);
    expect(kept.at(-1)?.bodyCut).toBe(false);
    expect(kept[0].body).toBe(CONNECTOR_COPY.bodyCutMark);
    expect(r).toMatchObject({ partial: true, note: `${CONNECTOR_COPY.emailNote} ${CONNECTOR_COPY.threadCut} ${CONNECTOR_COPY.addressesCut}` });
  });

  it("finds the conversation of one message, and says when it is gone", async () => {
    routes[`GET /gmail/v1/users/me/messages/m1`] = (url) => (url.searchParams.get("format") === "minimal" ? { status: 200, json: { id: "m1", threadId: "t-invoice" } } : { status: 400 });
    routes[`GET /gmail/v1/users/me/threads/t-invoice`] = () => ({ status: 404 });
    expect(await run("read_email", { messageId: "m1" })).toEqual({ error: CONNECTOR_COPY.threadNotFound });
    expect(calls.map((c) => c.url.pathname)).toEqual(["/gmail/v1/users/me/messages/m1", "/gmail/v1/users/me/threads/t-invoice"]);
  });
});

describe("the writes", () => {
  const SEND = { to: ["olivia@proof.test"], cc: [], subject: "Hi", body: "Hello there", account: ACCOUNT, dedupeKey: "k1" };
  const REPLY = {
    threadId: "t-invoice",
    body: "Paid today.",
    to: ["boss@ext.test"],
    cc: [],
    subject: "Re: Invoice due",
    inReplyTo: "<abc@ext.test>",
    references: "<abc@ext.test>",
    account: ACCOUNT,
    dedupeKey: "k2",
  };

  it("never sends or replies without its approval (Decision 8)", async () => {
    routes[`POST /gmail/v1/users/me/messages/send`] = () => ({ status: 200, json: { id: "g1", threadId: "t1" } });
    expect(await run("send_email", SEND)).toEqual({ error: CONNECTOR_COPY.needsApproval });
    expect(await run("send_email", SEND, ctx({ trigger: "APPROVAL" }))).toEqual({ error: CONNECTOR_COPY.needsApproval });
    // An action id from a rule is not an approval.
    expect(await run("send_email", SEND, ctx({ trigger: "CHAT", actionId: "act1" }))).toEqual({ error: CONNECTOR_COPY.needsApproval });
    expect(await run("reply_email", REPLY, ctx({ trigger: "CHAT", actionId: "act1" }))).toEqual({ error: CONNECTOR_COPY.needsApproval });
    expect(calls).toEqual([]);
  });

  it("refuses when Google is now connected as another account than the card named (Decision 15)", async () => {
    routes[`POST /gmail/v1/users/me/messages/send`] = () => ({ status: 200, json: { id: "g1", threadId: "t1" } });
    const r = await run("send_email", { ...SEND, account: { sub: "sub-old", email: "max.old@mail.test" } }, ctx({ trigger: "APPROVAL", actionId: "act1" }));
    expect(r).toEqual({ error: CONNECTOR_COPY.accountChanged("max.old@mail.test", "max@mail.test") });
    // A card with no account on record is never sent as whatever is connected.
    expect(await run("send_email", { ...SEND, account: undefined }, ctx({ trigger: "APPROVAL", actionId: "act1" }))).toEqual({ error: CONNECTOR_COPY.accountUnknown });
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("answers a send Google did not confirm as unconfirmed, after exactly one attempt (Decision 24)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    routes[`POST /gmail/v1/users/me/messages/send`] = () => "timeout";
    const r = await run("send_email", SEND, ctx({ trigger: "APPROVAL", actionId: "act1" }));
    expect(r).toEqual({ error: CONNECTOR_COPY.unknownOutcomeEmail });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("sends what the card showed, once, with no Bcc and no From of its own", async () => {
    routes[`POST /gmail/v1/users/me/messages/send`] = () => ({ status: 200, json: { id: "g1", threadId: "t1" } });
    const r = await run("send_email", { ...SEND, subject: "Hi\r\nBcc: x@evil.test" }, ctx({ trigger: "APPROVAL", actionId: "act1" }));
    expect(r).toEqual({ ok: true, email: { id: "g1", threadId: "t1" } });
    const mime = sentText();
    expect(mime).toContain("To: olivia@proof.test\r\n");
    expect(mime).not.toMatch(/^Bcc:/m);
    expect(mime).not.toMatch(/^From:/m);
    expect(cdb.connections[0].lastUsedAgentId).toBe("a1");
  });

  it("replies in its conversation to the recipients fixed when it was proposed, with its headers", async () => {
    routes[`POST /gmail/v1/users/me/messages/send`] = () => ({ status: 200, json: { id: "g2", threadId: "t-invoice" } });
    const r = await run("reply_email", REPLY, ctx({ trigger: "APPROVAL", actionId: "act2" }));
    expect(r).toEqual({ ok: true, email: { id: "g2", threadId: "t-invoice" } });
    expect((calls[0].body as { threadId: string }).threadId).toBe("t-invoice");
    const mime = sentText();
    expect(mime).toContain("To: boss@ext.test\r\n");
    expect(mime).toContain("In-Reply-To: <abc@ext.test>\r\n");
    expect(mime).toContain("Subject: Re: Invoice due\r\n");
  });

  it("names each write's own failure: a draft Google didn't confirm is checked in Drafts, a refused email is not a search (review of step 3)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    routes[`POST /gmail/v1/users/me/drafts`] = () => "timeout";
    const draft = await run("draft_email", { to: ["boss@ext.test"], cc: [], subject: "Re: Invoice due", body: "Draft text", account: ACCOUNT });
    // Before: "Google didn't confirm it was sent. Check your Sent folder", for a draft that is never sent.
    expect(draft).toEqual({ error: CONNECTOR_COPY.unknownOutcomeDraft });
    routes[`POST /gmail/v1/users/me/messages/send`] = () => ({ status: 400, json: { error: { code: 400 } } });
    // Before: "Check the search words or the id".
    expect(await run("send_email", SEND, ctx({ trigger: "APPROVAL", actionId: "act1" }))).toEqual({ error: CONNECTOR_COPY.googleRejectedEmail });
  });

  it("at its approval, says a refusal before anything was sent can wait, and an unknown outcome cannot (review of step 3)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    routes[`POST /gmail/v1/users/me/messages/send`] = () => ({ status: 429 });
    expect(await run("send_email", SEND, ctx({ trigger: "APPROVAL", actionId: "act1" }))).toEqual({ error: CONNECTOR_COPY.googleBusy(30), held: "retry_later" });
    // A grant revoked at Google: the 401's refresh answers invalid_grant, and nothing was sent.
    routes[`POST /gmail/v1/users/me/messages/send`] = () => ({ status: 401 });
    routes[`POST /token`] = () => ({ status: 400, json: { error: "invalid_grant" } });
    expect(await run("send_email", SEND, ctx({ trigger: "APPROVAL", actionId: "act1" }))).toEqual({ error: CONNECTOR_COPY.needsReconnect, held: "connection_needed" });
    // The connection is now marked: the next approval meets it before Google.
    expect(await run("reply_email", REPLY, ctx({ trigger: "APPROVAL", actionId: "act2" }))).toEqual({ error: CONNECTOR_COPY.needsReconnect, held: "connection_needed" });
    // A send that may have happened is never offered again.
    resetConnectorDb();
    cdb.policy.set("org1", ["gmail"]);
    cdb.agents.push({ id: "a1", slug: "inbox-helper", name: "Inbox helper", organizationId: "org1", status: "ENABLED", visibility: "PRIVATE", ownerId: "u-max", description: "", systemPrompt: "", toolNames: [], approvalRules: {}, modelOverride: null, productSlug: null });
    seedConnection({ organizationId: "org1", userId: "u-max", accountSub: ACCOUNT.sub, accountEmail: ACCOUNT.email, products: ["gmail"], refreshTokenSealed: sealToken("r"), accessTokenSealed: sealToken("a"), accessTokenExpiresAt: new Date(Date.now() + 3_600_000) });
    routes[`POST /gmail/v1/users/me/messages/send`] = () => "timeout";
    expect(await run("send_email", SEND, ctx({ trigger: "APPROVAL", actionId: "act3" }))).toEqual({ error: CONNECTOR_COPY.unknownOutcomeEmail });
    // In a turn, nothing is held: only an approval can wait.
    routes[`POST /gmail/v1/users/me/drafts`] = () => ({ status: 429 });
    expect(await run("draft_email", { to: ["boss@ext.test"], cc: [], subject: "x", body: "y", account: ACCOUNT })).toEqual({ error: CONNECTOR_COPY.googleBusy(30) });
  });

  it("saves a draft as the account its preparation named, and sends nothing (Decision 7)", async () => {
    routes[`POST /gmail/v1/users/me/drafts`] = () => ({ status: 200, json: { id: "d1", message: { id: "m9", threadId: "t-invoice" } } });
    const r = await run("draft_email", { to: ["boss@ext.test"], cc: [], subject: "Re: Invoice due", body: "Draft text", threadId: "t-invoice", account: ACCOUNT });
    expect(r).toEqual({ ok: true, draft: { id: "d1" }, email: { threadId: "t-invoice" } });
    expect((calls[0].body as { message: { threadId: string } }).message.threadId).toBe("t-invoice");
    expect(calls.map((c) => c.url.pathname)).toEqual(["/gmail/v1/users/me/drafts"]);
  });
});

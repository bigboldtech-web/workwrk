// A Gmail write's card, decided before anything is proposed and again at its
// approval (src/lib/agents/connector-previews.ts, through previews.ts
// prepareCall; docs/plans/ai-teammates-phase3.md step 3): every recipient
// one plain address, lower case and once, at most 20; who is outside the
// workspace counted; a subject that can hide no header; a reply's recipients
// read from its conversation when proposed and never again; the Google
// account fixed on the card; the body the one field the person may edit;
// and a turn that read Google offering no "don't ask again". The connector
// tables are in memory (connector-test-db.ts) and Google is a fetch double.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/connectors/connector-test-db")).connectorDb }));

import { cdb, resetConnectorDb, seedConnection } from "@/lib/connectors/connector-test-db";
import { sealToken } from "@/lib/connectors/seal";
import { prepareCall, type PrepareContext, type Prepared } from "./previews";
import { CONNECTOR_COPY, EDIT_FIELD_LABELS } from "./teammate-copy";

const BASE = "https://g.test";
const ACCOUNT = { sub: "sub-max", email: "max@mail.test" };

function ctx(o: { trigger?: string; tainted?: boolean } = {}): PrepareContext {
  return {
    person: { userId: "u-max", organizationId: "org1", name: "Max Chen", firstName: "Max", email: "max@proof.test", timezone: "UTC" } as never,
    teammate: { agentId: "a1", agentName: "Inbox helper", trigger: (o.trigger ?? "CHAT") as never },
    ...(o.tainted ? { tainted: true } : {}),
  };
}

type Ok = Extract<Prepared, { ok: true }>;
const ok = (p: Prepared): Ok => {
  if (!p.ok) throw new Error(`refused: ${p.error}`);
  return p;
};

let threadMessages: unknown[] = [];
let calls: URL[] = [];

const header = (name: string, value: string) => ({ name, value });
function threadMessage(id: string, h: Record<string, string>, labels: string[] = ["INBOX"]) {
  return { id, threadId: "t1", labelIds: labels, payload: { headers: Object.entries(h).map(([k, v]) => header(k, v)) } };
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_AGENT_CLIENT_ID", "stand-in");
  vi.stubEnv("GOOGLE_AGENT_CLIENT_SECRET", "stand-in");
  vi.stubEnv("SECRETS_ENCRYPTION_KEY", "b".repeat(64));
  vi.stubEnv("GOOGLE_AGENT_PRODUCTS", "gmail");
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
    toolNames: ["draft_email", "send_email", "reply_email"],
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
  // Olivia works here; Mia through a second membership; Gil left.
  cdb.users.push(
    { id: "u-olivia", email: "Olivia@Proof.test", organizationId: "org1", deletedAt: null, status: "ACTIVE" },
    { id: "u-mia", email: "mia@proof.test", organizationId: "org2", deletedAt: null, status: "ACTIVE" },
    { id: "u-gil", email: "gil@proof.test", organizationId: "org1", deletedAt: null, status: "INACTIVE" },
  );
  cdb.memberships.push({ userId: "u-mia", organizationId: "org1" });
  threadMessages = [
    threadMessage("m1", { From: "Boss <boss@ext.test>", To: "max@mail.test", Subject: "Invoice due", "Message-ID": "<m1@ext.test>" }),
    threadMessage("m2", {
      From: "Boss <boss@ext.test>",
      "Reply-To": "Billing <billing@ext.test>",
      To: "max@mail.test",
      Cc: "mia@proof.test",
      Subject: "Invoice due",
      "Message-ID": "<m2@ext.test>",
      References: "<m1@ext.test>",
    }),
    // The person's own unsent draft is not the message replied to.
    threadMessage("m-draft", { From: "max@mail.test", To: "someone@else.test", Subject: "Re: Invoice due" }, ["DRAFT"]),
  ];
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (raw: string) => {
      const url = new URL(String(raw));
      calls.push(url);
      if (url.pathname === "/gmail/v1/users/me/threads/t1") {
        return new Response(JSON.stringify({ id: "t1", messages: url.searchParams.get("format") === "minimal" ? [{ id: "m2" }] : threadMessages }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("send_email's card", () => {
  it("checks every recipient, lower-cases and dedupes them, and counts who is outside the workspace", async () => {
    const r = ok(
      await prepareCall("send_email", { to: ["Olivia@Proof.test", "olivia@proof.test", "mia@proof.test"], cc: ["outsider@ext.test", "MIA@proof.test", "gil@proof.test"], subject: "Hi", body: "Hello there" }, ctx()),
    );
    expect(r.risk).toBe("IRREVERSIBLE");
    expect(r.input).toMatchObject({ to: ["olivia@proof.test", "mia@proof.test"], cc: ["outsider@ext.test", "gil@proof.test"], subject: "Hi", body: "Hello there", account: ACCOUNT });
    expect(typeof r.input.dedupeKey).toBe("string");
    expect(r.preview).toMatchObject({
      title: 'Send email "Hi"',
      body: "Hello there",
      lines: [
        CONNECTOR_COPY.toLine("olivia@proof.test, mia@proof.test"),
        CONNECTOR_COPY.ccLine("outsider@ext.test, gil@proof.test"),
        CONNECTOR_COPY.fromLine("max@mail.test"),
        // The outsider, and Gil, who is no longer a live person here.
        CONNECTOR_COPY.outsideLine(2),
        CONNECTOR_COPY.cantUnsend,
        CONNECTOR_COPY.noAttachments,
      ],
      target: { label: CONNECTOR_COPY.sentFolderTarget },
      // The body is the one field the person may change (Decision 14).
      editable: { field: "body", label: EDIT_FIELD_LABELS.message, maxLength: 8000 },
    });
    // Never "don't ask again" for mail in the person's name (Decision 8).
    expect(r.preview).not.toHaveProperty("alwaysKey");
  });

  it("refuses an address that is not one plain address, and more than 20 people", async () => {
    const named = await prepareCall("send_email", { to: ["Max <max@x.test>"], subject: "Hi", body: "x" }, ctx());
    expect(named).toEqual({ ok: false, error: CONNECTOR_COPY.badRecipient("Max <max@x.test>") });
    const many = await prepareCall(
      "send_email",
      { to: Array.from({ length: 15 }, (_, i) => `p${i}@ext.test`), cc: Array.from({ length: 6 }, (_, i) => `c${i}@ext.test`), subject: "Hi", body: "x" },
      ctx(),
    );
    expect(many).toEqual({ ok: false, error: CONNECTOR_COPY.tooManyRecipients });
  });

  it("takes a line break out of the subject, so it can start no header of its own", async () => {
    const r = ok(await prepareCall("send_email", { to: ["olivia@proof.test"], subject: "Hi\r\nBcc: x@evil.test", body: "x" }, ctx()));
    expect(r.input.subject).toBe("Hi Bcc: x@evil.test");
    expect(r.preview.title).toBe('Send email "Hi Bcc: x@evil.test"');
  });

  it("at its approval keeps the account the card named, and refuses another one connected since (Decision 15)", async () => {
    const first = ok(await prepareCall("send_email", { to: ["olivia@proof.test"], subject: "Hi", body: "x" }, ctx()));
    expect(ok(await prepareCall("send_email", first.input, ctx({ trigger: "APPROVAL" }))).input.account).toEqual(ACCOUNT);
    cdb.connections[0].accountSub = "sub-other";
    cdb.connections[0].accountEmail = "max.other@mail.test";
    expect(await prepareCall("send_email", first.input, ctx({ trigger: "APPROVAL" }))).toEqual({ ok: false, error: CONNECTOR_COPY.accountChanged("max@mail.test", "max.other@mail.test") });
  });

  it("is refused before Google is asked when the person did not allow this workspace teammate", async () => {
    cdb.agents[0].visibility = "WORKSPACE";
    cdb.agents[0].ownerId = "olivia";
    expect(await prepareCall("send_email", { to: ["olivia@proof.test"], subject: "Hi", body: "x" }, ctx())).toEqual({ ok: false, error: CONNECTOR_COPY.notAllowed("Inbox helper", "Gmail") });
    expect(calls).toEqual([]);
  });
});

describe("reply_email's card", () => {
  it("goes to the last message's Reply-To, in its conversation, with its headers, never to the person", async () => {
    const r = ok(await prepareCall("reply_email", { threadId: "t1", body: "Paid today." }, ctx()));
    expect(r.input).toMatchObject({
      threadId: "t1",
      to: ["billing@ext.test"],
      cc: [],
      subject: "Re: Invoice due",
      inReplyTo: "<m2@ext.test>",
      references: "<m1@ext.test> <m2@ext.test>",
      body: "Paid today.",
      account: ACCOUNT,
    });
    expect(r.preview.title).toBe('Reply to "Re: Invoice due"');
    expect(r.preview.lines).toContain(CONNECTOR_COPY.sameThread);
    expect(calls[0].searchParams.get("format")).toBe("metadata");
    // With replyAll: its To and Cc too, the person's own address left out.
    const all = ok(await prepareCall("reply_email", { threadId: "t1", body: "Paid today.", replyAll: true }, ctx()));
    expect(all.input).toMatchObject({ to: ["billing@ext.test"], cc: ["mia@proof.test"] });
  });

  it("at its approval runs the stored recipients only, even after someone new wrote in the thread (Decision 15)", async () => {
    const first = ok(await prepareCall("reply_email", { threadId: "t1", body: "Paid today." }, ctx()));
    threadMessages.push(threadMessage("m3", { From: "intruder@evil.test", To: "max@mail.test", Subject: "Re: Invoice due", "Message-ID": "<m3@evil.test>" }));
    calls = [];
    const approved = ok(await prepareCall("reply_email", { ...first.input, body: "Paid today, thanks." }, ctx({ trigger: "APPROVAL" })));
    expect(approved.input).toMatchObject({ to: ["billing@ext.test"], cc: [], inReplyTo: "<m2@ext.test>", body: "Paid today, thanks." });
    expect(JSON.stringify(approved)).not.toContain("intruder");
    // One read, only that the conversation is still there.
    expect(calls.map((u) => u.searchParams.get("format"))).toEqual(["minimal"]);
  });

  it("says when the conversation is gone", async () => {
    expect(await prepareCall("reply_email", { threadId: "t-gone", body: "x" }, ctx())).toEqual({ ok: false, error: CONNECTOR_COPY.threadNotFound });
  });
});

describe("draft_email's card", () => {
  it("is the person's own work, its body editable, and in a turn that read Google it asks, says why and offers no Don't ask (Decision 9)", async () => {
    const plain = ok(await prepareCall("draft_email", { to: ["boss@ext.test"], subject: "Re: Invoice due", body: "Draft text", threadId: "t1" }, ctx()));
    expect(plain.risk).toBe("INTERNAL");
    expect(plain.input).toMatchObject({ threadId: "t1", account: ACCOUNT });
    expect(plain.input).not.toHaveProperty("dedupeKey");
    expect(plain.preview).toMatchObject({
      title: 'Save draft "Re: Invoice due"',
      lines: [CONNECTOR_COPY.toLine("boss@ext.test"), CONNECTOR_COPY.fromLine("max@mail.test"), CONNECTOR_COPY.draftNothingSent, CONNECTOR_COPY.noAttachments],
      target: { label: CONNECTOR_COPY.draftsTarget },
      editable: { field: "body" },
      alwaysKey: "draft_email",
    });
    const tainted = ok(await prepareCall("draft_email", { to: ["boss@ext.test"], subject: "Re: Invoice due", body: "Draft text" }, ctx({ tainted: true })));
    expect(tainted.preview).not.toHaveProperty("alwaysKey");
    expect(tainted.preview).not.toHaveProperty("alwaysLabel");
    expect(tainted.preview.lines?.at(-1)).toBe(CONNECTOR_COPY.askedAfterReading);
  });
});

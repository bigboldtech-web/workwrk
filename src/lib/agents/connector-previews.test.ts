// A Gmail or Google Calendar write's card, decided before anything is
// proposed and again at its approval (src/lib/agents/connector-previews.ts,
// through previews.ts prepareCall; docs/plans/ai-teammates-phase3.md steps 3
// and 4): every recipient one plain address, lower case and once, at most
// 20; who is outside the workspace counted; a subject that can hide no
// header; a reply's recipients read from its conversation when proposed and
// never again; the Google account fixed on the card; the body the one field
// the person may edit; and a turn that read Google offering no "don't ask
// again". A calendar card is IRREVERSIBLE whenever it tells anyone else, only
// for events the person organizes (or, for an answer, is invited to), held
// to the event's etag, and fixed to moments, never words read again. The
// connector tables are in memory (connector-test-db.ts) and Google is a
// fetch double.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/lib/connectors/connector-test-db")).connectorDb }));

import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { cdb, resetConnectorDb, seedConnection } from "@/lib/connectors/connector-test-db";
import { sealToken } from "@/lib/connectors/seal";
import { prepareCall, type PrepareContext, type Prepared } from "./previews";
import { CONNECTOR_COPY, EDIT_FIELD_LABELS, EVENT_CHANGE_LABELS, changeLine } from "./teammate-copy";

const BASE = "https://g.test";
const ACCOUNT = { sub: "sub-max", email: "max@mail.test" };

/** `saved`: the zone the person chose, null when they never picked one (acting.ts savedTimezone); left out, `zone` is theirs. */
function ctx(o: { trigger?: string; tainted?: boolean; zone?: string; saved?: string | null } = {}): PrepareContext {
  return {
    person: { userId: "u-max", organizationId: "org1", name: "Max Chen", firstName: "Max", email: "max@proof.test", timezone: o.zone ?? "UTC", ...(o.saved !== undefined ? { savedTimezone: o.saved } : {}) } as never,
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
/** What Google's token endpoint answers a refresh (an approval's fresh token), and the thread read's status. */
let tokenReply: { status: number; json: unknown } = { status: 200, json: { access_token: "fresh-access-token", expires_in: 3600 } };
let threadStatus = 200;
/** Gmail's own requests only: an approval's refresh goes to the token endpoint. */
const gmailCalls = () => calls.filter((u) => u.pathname.startsWith("/gmail/"));

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
  tokenReply = { status: 200, json: { access_token: "fresh-access-token", expires_in: 3600 } };
  threadStatus = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (raw: string) => {
      const url = new URL(String(raw));
      calls.push(url);
      if (url.pathname === "/token") return new Response(JSON.stringify(tokenReply.json), { status: tokenReply.status });
      if (url.pathname === "/gmail/v1/users/me/threads/t1") {
        if (threadStatus !== 200) return new Response(JSON.stringify({ error: { code: threadStatus } }), { status: threadStatus });
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

  it("shows every word of a subject the title line cut, whole on a line of its own, on a send and a reply (review of step 4)", async () => {
    const subject = `Budget ${"x".repeat(100)} the words past the cut ${"y".repeat(60)}`;
    const r = ok(await prepareCall("send_email", { to: ["olivia@proof.test"], subject, body: "x" }, ctx()));
    // Before: only its first 79 characters, while Approve sent them all.
    expect(r.preview.title).not.toContain("past the cut");
    expect(r.preview.lines?.[0]).toBe(CONNECTOR_COPY.subjectLine(subject));
    // A subject the title holds whole has no line of its own.
    expect(ok(await prepareCall("send_email", { to: ["olivia@proof.test"], subject: "Hi", body: "x" }, ctx())).preview.lines?.[0]).toBe(CONNECTOR_COPY.toLine("olivia@proof.test"));
    // A reply's subject is the sender's own words.
    threadMessages = [threadMessage("m2", { From: "Boss <boss@ext.test>", To: "max@mail.test", Subject: subject, "Message-ID": "<m2@ext.test>" })];
    const reply = ok(await prepareCall("reply_email", { threadId: "t1", body: "Paid." }, ctx()));
    expect(reply.preview.lines?.[0]).toBe(CONNECTOR_COPY.subjectLine(`Re: ${subject}`));
    // A draft sends nothing: its card is as it was.
    expect(ok(await prepareCall("draft_email", { to: ["olivia@proof.test"], subject, body: "x" }, ctx())).preview.lines?.[0]).toBe(CONNECTOR_COPY.toLine("olivia@proof.test"));
  });

  it("counts a Guest and an agent account as outside the workspace, read as the rest of the app reads them (review of step 4)", async () => {
    vi.stubEnv("ACCESS_V2_TABLES", "true");
    cdb.users.push(
      // A client added as a Guest; an agent account here; one through a second membership.
      { id: "u-client", email: "client@proof.test", organizationId: "org1", deletedAt: null, status: "ACTIVE", ...legacyLevelRow("EMPLOYEE"), orgRole: "GUEST" },
      { id: "u-bot", email: "bot@proof.test", organizationId: "org1", deletedAt: null, status: "ACTIVE", ...legacyLevelRow("AGENT") },
      { id: "u-bot2", email: "bot2@proof.test", organizationId: "org2", deletedAt: null, status: "ACTIVE" },
    );
    cdb.memberships.push({ userId: "u-bot2", organizationId: "org1", role: "AGENT" });
    const r = ok(await prepareCall("send_email", { to: ["olivia@proof.test", "client@proof.test", "bot@proof.test", "bot2@proof.test"], subject: "Hi", body: "x" }, ctx()));
    // Before: "Everyone on it is in this workspace."
    expect(r.preview.lines).toContain(CONNECTOR_COPY.outsideLine(3));
    // The stored Guest role narrows a Member only while the access tables are read, as everywhere else.
    vi.stubEnv("ACCESS_V2_TABLES", "");
    expect(ok(await prepareCall("send_email", { to: ["olivia@proof.test", "client@proof.test"], subject: "Hi", body: "x" }, ctx())).preview.lines).toContain(CONNECTOR_COPY.outsideLine(0));
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
    // One Gmail read, only that the conversation is still there, after the approval's one refresh (review of step 3).
    expect(gmailCalls().map((u) => u.searchParams.get("format"))).toEqual(["minimal"]);
    expect(calls.map((u) => u.pathname)).toEqual(["/token", "/gmail/v1/users/me/threads/t1"]);
    // At the approval nothing new of the conversation is read, so nothing taints.
    expect(approved).not.toHaveProperty("readGoogle");
  });

  it("says its first preparation read Gmail, so the turn asks before every later write (review of step 3)", async () => {
    const r = ok(await prepareCall("reply_email", { threadId: "t1", body: "Paid today." }, ctx()));
    // Before: no mark, and the turn's later writes ran without a card.
    expect(r.readGoogle).toBe(true);
    // Refused after the read (too many people on the conversation), it still says so.
    threadMessages = [threadMessage("m2", { From: "Boss <boss@ext.test>", To: "max@mail.test", Cc: Array.from({ length: 25 }, (_, i) => `p${i}@ext.test`).join(", "), Subject: "Invoice due" })];
    const many = await prepareCall("reply_email", { threadId: "t1", body: "Paid.", replyAll: true }, ctx());
    expect(many).toEqual({ ok: false, error: CONNECTOR_COPY.tooManyRecipients, readGoogle: true });
    // A send reads nothing of Gmail.
    expect(ok(await prepareCall("send_email", { to: ["olivia@proof.test"], subject: "Hi", body: "x" }, ctx()))).not.toHaveProperty("readGoogle");
  });

  it("keeps a conversation's ids whole and bounded, the newest kept, so the card can always be sent (review of step 3)", async () => {
    const many = Array.from({ length: 2000 }, (_, i) => `<id${i}@ext.test>`).join(" ");
    threadMessages = [threadMessage("m2", { From: "Boss <boss@ext.test>", To: "max@mail.test", Subject: "Invoice due", "Message-ID": "<m2@ext.test>", References: `${many} <${"x".repeat(400)}@ext.test>` })];
    const r = ok(await prepareCall("reply_email", { threadId: "t1", body: "Paid." }, ctx()));
    const refs = String(r.input.references);
    // Before: 30 KB stored, which the approval refused with a sentence that said nothing of why.
    expect(refs.length).toBeLessThanOrEqual(2000);
    expect(refs.endsWith("<id1999@ext.test> <m2@ext.test>")).toBe(true);
    expect(refs).not.toContain("x".repeat(400));
    expect(r.input.inReplyTo).toBe("<m2@ext.test>");
    // An id longer than a header line's room is never In-Reply-To.
    threadMessages = [threadMessage("m2", { From: "Boss <boss@ext.test>", To: "max@mail.test", Subject: "Invoice due", "Message-ID": `<${"y".repeat(400)}@ext.test>` })];
    const long = ok(await prepareCall("reply_email", { threadId: "t1", body: "Paid." }, ctx()));
    expect(long.input).toMatchObject({ inReplyTo: null, references: null });
    // A card stored before the bound is held to it at its approval.
    const approved = ok(await prepareCall("reply_email", { ...r.input, references: `${many} <m2@ext.test>` }, ctx({ trigger: "APPROVAL" })));
    expect(String(approved.input.references).length).toBeLessThanOrEqual(2000);
  });

  it("at its approval waits, never fails, when the grant was revoked or Google did not answer before anything was sent (review of step 3)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = ok(await prepareCall("reply_email", { threadId: "t1", body: "Paid today." }, ctx()));
    // Found by the approval's own refresh: before, the send began and the card failed for good.
    tokenReply = { status: 400, json: { error: "invalid_grant" } };
    expect(await prepareCall("reply_email", first.input, ctx({ trigger: "APPROVAL" }))).toEqual({ ok: false, error: CONNECTOR_COPY.needsReconnect, held: "connection_needed" });
    expect(gmailCalls().filter((u) => u.searchParams.get("format") === "minimal")).toEqual([]);
    // Marked so: the next approval meets it before Google, and still waits.
    expect(await prepareCall("send_email", { to: ["olivia@proof.test"], subject: "Hi", body: "x", account: ACCOUNT }, ctx({ trigger: "APPROVAL" }))).toEqual({
      ok: false,
      error: CONNECTOR_COPY.needsReconnect,
      held: "connection_needed",
    });
    // Google down for the conversation's check.
    cdb.connections[0].status = "active";
    tokenReply = { status: 200, json: { access_token: "fresh-access-token", expires_in: 3600 } };
    threadStatus = 503;
    expect(await prepareCall("reply_email", first.input, ctx({ trigger: "APPROVAL" }))).toEqual({ ok: false, error: CONNECTOR_COPY.googleUnavailable, held: "retry_later" });
    // A conversation that is gone ends it: approving again cannot help.
    threadStatus = 404;
    expect(await prepareCall("reply_email", first.input, ctx({ trigger: "APPROVAL" }))).toEqual({ ok: false, error: CONNECTOR_COPY.threadNotFound });
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

// ── Google Calendar (step 4) ─────────────────────────────────────────

describe("the calendar's cards (step 4)", () => {
  const SELF = { email: ACCOUNT.email, self: true, responseStatus: "accepted" };
  let events: Record<string, Record<string, unknown>> = {};
  const calEvent = (id: string, o: Record<string, unknown> = {}) => ({
    id,
    etag: `"${id}-1"`,
    status: "confirmed",
    summary: "Team sync",
    start: { dateTime: "2026-10-13T10:00:00Z" },
    end: { dateTime: "2026-10-13T11:00:00Z" },
    organizer: { email: ACCOUNT.email, self: true },
    ...o,
  });
  const calendarCalls = () => calls.filter((u) => u.pathname.startsWith("/calendar/"));
  /** The zone reads: the list of the primary calendar's events, asked for its zone alone (review of step 4). */
  const zoneReads = () => calls.filter((u) => u.pathname === "/calendar/v3/calendars/primary/events");
  /** What that read answers: the zone of the person's Google Calendar. */
  let calendarList: Record<string, unknown> = {};
  const C = CONNECTOR_COPY;

  beforeEach(() => {
    calendarList = { timeZone: "America/New_York" };
    vi.stubEnv("GOOGLE_AGENT_PRODUCTS", "gmail,calendar");
    cdb.policy.set("org1", ["gmail", "calendar"]);
    cdb.connections[0].products = ["gmail", "calendar"];
    events = {
      // Max organizes it; Mia (here through a second membership) and an outsider are on it.
      "e-team": calEvent("e-team", {
        attendees: [{ ...SELF, organizer: true }, { email: "mia@proof.test", responseStatus: "accepted" }, { email: "outsider@ext.test", responseStatus: "needsAction" }],
      }),
      "e-solo": calEvent("e-solo", { summary: "Focus block" }),
      "e-boss": calEvent("e-boss", { organizer: { email: "boss@ext.test", displayName: "Boss" }, attendees: [{ email: "boss@ext.test", organizer: true, responseStatus: "accepted" }, SELF] }),
      "e-invite": calEvent("e-invite", {
        summary: "Board review",
        start: { dateTime: "2026-10-14T09:00:00Z" },
        end: { dateTime: "2026-10-14T10:00:00Z" },
        organizer: { email: "boss@ext.test", displayName: "Boss" },
        attendees: [{ email: "boss@ext.test", organizer: true, responseStatus: "accepted" }, { ...SELF, responseStatus: "needsAction" }],
      }),
      "e-weekly": calEvent("e-weekly", { recurrence: ["RRULE:FREQ=WEEKLY"] }),
      "e-weekly_20261013": calEvent("e-weekly_20261013", { recurringEventId: "e-weekly", attendees: [{ ...SELF, organizer: true }, { email: "mia@proof.test", responseStatus: "accepted" }] }),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (raw: string) => {
        const url = new URL(String(raw));
        calls.push(url);
        if (url.pathname === "/token") return new Response(JSON.stringify(tokenReply.json), { status: tokenReply.status });
        if (url.pathname === "/calendar/v3/calendars/primary/events") return new Response(JSON.stringify(calendarList), { status: 200 });
        const m = /^\/calendar\/v3\/calendars\/primary\/events\/(.+)$/.exec(url.pathname);
        const ev = m ? events[decodeURIComponent(m[1])] : undefined;
        if (ev) return new Response(JSON.stringify(ev), { status: 200, headers: { etag: String(ev.etag) } });
        return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
      }),
    );
  });

  it("create_event with one outsider invited is IRREVERSIBLE, says Google emails them, and counts the outsider (Decision 8)", async () => {
    const r = ok(
      await prepareCall(
        "create_event",
        { title: "Plan the offsite", start: "2026-10-13T15:00", end: "2026-10-13T16:00", attendees: ["outsider@ext.test", "Olivia@Proof.test", "olivia@proof.test", ACCOUNT.email] },
        ctx({ zone: "Asia/Kolkata" }),
      ),
    );
    expect(r.risk).toBe("IRREVERSIBLE");
    // The person themselves is never invited; 15:00 in Kolkata is fixed as 09:30 UTC.
    expect(r.input).toMatchObject({
      title: "Plan the offsite",
      attendees: ["outsider@ext.test", "olivia@proof.test"],
      account: ACCOUNT,
      times: { kind: "time", start: "2026-10-13T09:30:00.000Z", end: "2026-10-13T10:30:00.000Z", zone: "Asia/Kolkata" },
    });
    expect(r.preview).toMatchObject({
      title: 'Create event "Plan the offsite"',
      lines: [
        C.whenLine("Tue 13 Oct, 15:00 to 16:00, Kolkata time"),
        C.invitesLine("outsider@ext.test, olivia@proof.test"),
        C.googleEmailsInvites,
        C.outsideLine(1),
        C.calendarOf(ACCOUNT.email),
      ],
      target: { label: C.calendarTarget },
      // The title is the one field the person may change (Decision 14).
      editable: { field: "title", label: EDIT_FIELD_LABELS.title, maxLength: 200 },
    });
    // Never "don't ask again" for a call that tells anyone (Decision 8).
    expect(r.preview).not.toHaveProperty("alwaysKey");
    // A new event reads nothing of anyone's: no Google call, nothing tainted.
    expect(calendarCalls()).toEqual([]);
    expect(r).not.toHaveProperty("readGoogle");
    // Nobody else on it: the person's own work.
    const solo = ok(await prepareCall("create_event", { title: "Focus", start: "2026-10-13", end: "2026-10-13" }, ctx()));
    expect(solo.risk).toBe("INTERNAL");
    expect(solo.input.times).toEqual({ kind: "day", start: "2026-10-13", end: "2026-10-13" });
    expect(solo.preview.lines).toEqual([C.whenLine("Tue 13 Oct, all day"), C.onlyYourCalendar, C.calendarOf(ACCOUNT.email)]);
    expect(solo.preview.alwaysKey).toBe("create_event");
    // An end before the start, or a day beside a time, is refused in words.
    expect(await prepareCall("create_event", { title: "x", start: "2026-10-13T16:00", end: "2026-10-13T15:00" }, ctx())).toEqual({ ok: false, error: C.endBeforeStart });
    expect(await prepareCall("create_event", { title: "x", start: "2026-10-13", end: "2026-10-13T15:00" }, ctx())).toEqual({ ok: false, error: C.badTime });
  });

  it("refuses to change or cancel an event someone else organizes, after reading it (Decision 12)", async () => {
    expect(await prepareCall("update_event", { eventId: "e-boss", title: "Mine now" }, ctx())).toEqual({ ok: false, error: C.notOrganizer, readGoogle: true });
    expect(await prepareCall("cancel_event", { eventId: "e-boss" }, ctx())).toEqual({ ok: false, error: C.notOrganizer, readGoogle: true });
    // An event that is not there reads nothing of anyone's.
    expect(await prepareCall("cancel_event", { eventId: "e-gone" }, ctx())).toEqual({ ok: false, error: C.eventNotFound });
  });

  // Review round 1 of Phase 3: an eventId of ".." from a planted email was
  // sent as a path fetch resolves (the calendar itself), and a 403 there
  // marked the person's whole connection broken.
  it("refuses an event id Google could never have given before any address is built, and a 404 on one the model wrote breaks nothing", async () => {
    for (const eventId of ["..", ".", "e/../x", "e%2e%2e", "Team.Sync", "e team"]) {
      for (const tool of ["update_event", "cancel_event", "respond_to_invite"] as const) {
        const r = await prepareCall(tool, { eventId, title: "x", response: "accepted" }, ctx());
        expect(r).toMatchObject({ ok: false });
        expect(r).not.toHaveProperty("readGoogle");
      }
    }
    expect(calendarCalls()).toEqual([]);
    // Shaped as Google shapes them, but not there: not found, and the connection is as it was.
    expect(await prepareCall("cancel_event", { eventId: "7cbh8rpc10lrc0ckih9tafss99" }, ctx())).toEqual({ ok: false, error: C.eventNotFound });
    expect(cdb.connections[0]).toMatchObject({ status: "active", statusReason: null });
    expect(cdb.notifications).toEqual([]);
  });

  it("holds a card to the event's etag: unchanged it prepares again, changed at the approval it ends with eventChanged (Decisions 12 and 15)", async () => {
    const first = ok(await prepareCall("cancel_event", { eventId: "e-team" }, ctx()));
    expect(first.input).toMatchObject({ eventId: "e-team", etag: '"e-team-1"', notify: 2, account: ACCOUNT });
    expect(ok(await prepareCall("cancel_event", first.input, ctx({ trigger: "APPROVAL" }))).input).toMatchObject({ etag: '"e-team-1"', notify: 2 });
    events["e-team"] = { ...events["e-team"], etag: '"e-team-2"' };
    const changed = await prepareCall("cancel_event", first.input, ctx({ trigger: "APPROVAL" }));
    // Fails without the etag check: the approval would run against an event someone changed since.
    expect(changed).toMatchObject({ ok: false, error: C.eventChanged });
    expect(changed).not.toHaveProperty("held");
  });

  it("respond_to_invite is IRREVERSIBLE whatever is on the event, and keeps only the person's own address on it (Decision 8; review of step 4)", async () => {
    const r = ok(await prepareCall("respond_to_invite", { eventId: "e-invite", response: "accepted" }, ctx()));
    expect(r.risk).toBe("IRREVERSIBLE");
    expect(r.readGoogle).toBe(true);
    expect(r.input).toEqual({ eventId: "e-invite", response: "accepted", etag: '"e-invite-1"', attendeeEmail: ACCOUNT.email, account: ACCOUNT });
    // Before: the event's whole list, every guest's address, name and note, stored on the card.
    expect(r.input).not.toHaveProperty("eventAttendees");
    expect(JSON.stringify(r.input)).not.toContain("boss@ext.test");
    expect(r.preview).toMatchObject({ title: 'Accept "Board review"', lines: [C.whenLine("Wed 14 Oct, 09:00 to 10:00, UTC"), C.organizerSees("Boss"), C.calendarOf(ACCOUNT.email)] });
    expect(r.preview).not.toHaveProperty("alwaysKey");
    // The person's own event has no invite to answer; one they are not on, nothing either.
    expect(await prepareCall("respond_to_invite", { eventId: "e-solo", response: "declined" }, ctx())).toEqual({ ok: false, error: C.ownEvent, readGoogle: true });
    events["e-boss"] = { ...events["e-boss"], attendees: [{ email: "boss@ext.test", organizer: true }] };
    expect(await prepareCall("respond_to_invite", { eventId: "e-boss", response: "declined" }, ctx())).toEqual({ ok: false, error: C.notInvited, readGoogle: true });
  });

  it("cancels an event others are on only on a card that says who is told; the person's own goes at once, from the bin", async () => {
    const team = ok(await prepareCall("cancel_event", { eventId: "e-team" }, ctx()));
    expect(team.risk).toBe("IRREVERSIBLE");
    expect(team.preview.title).toBe('Cancel event "Team sync"');
    // Who is told, by address (review of step 4: before, only how many).
    expect(team.preview.lines).toEqual([
      C.whenLine("Tue 13 Oct, 10:00 to 11:00, UTC"),
      C.tellsCancelled(2),
      C.toldLine("mia@proof.test, outsider@ext.test"),
      C.outsideLine(1),
      C.calendarOf(ACCOUNT.email),
    ]);
    const solo = ok(await prepareCall("cancel_event", { eventId: "e-solo" }, ctx()));
    expect(solo.risk).toBe("INTERNAL");
    expect(solo.input.notify).toBe(0);
    expect(solo.preview.lines).toEqual([C.whenLine("Tue 13 Oct, 10:00 to 11:00, UTC"), C.restoreFromBin, C.calendarOf(ACCOUNT.email)]);
  });

  it("changes one time of a repeating event, says so, and refuses the whole series", async () => {
    // A planted "cancel my weekly sync" would otherwise end every time of it, for everyone.
    expect(await prepareCall("cancel_event", { eventId: "e-weekly" }, ctx())).toEqual({ ok: false, error: C.wholeSeries, readGoogle: true });
    const one = ok(await prepareCall("cancel_event", { eventId: "e-weekly_20261013" }, ctx()));
    expect(one.preview.lines).toContain(C.oneTimeOnly);
    expect(one.risk).toBe("IRREVERSIBLE");
  });

  it("update_event moves an event keeping its length, fixes the moment, and at the approval keeps it whatever the zone is now", async () => {
    const r = ok(
      await prepareCall(
        "update_event",
        { eventId: "e-team", start: "2026-10-15T10:00", addAttendees: ["olivia@proof.test", "MIA@proof.test"], removeAttendees: ["outsider@ext.test", ACCOUNT.email] },
        ctx({ zone: "Asia/Kolkata" }),
      ),
    );
    expect(r.readGoogle).toBe(true);
    expect(r.risk).toBe("IRREVERSIBLE");
    // 10:00 in Kolkata is 04:30 UTC; the hour the event lasted is kept.
    expect(r.input.times).toEqual({ kind: "time", start: "2026-10-15T04:30:00.000Z", end: "2026-10-15T05:30:00.000Z", zone: "Asia/Kolkata" });
    // Mia is on it already, and the person is never taken off their own event.
    expect(r.input).toMatchObject({ addAttendees: ["olivia@proof.test"], removeAttendees: ["outsider@ext.test"], notify: 3 });
    // Only who it adds and takes off: the list is built at the approval (review of step 4).
    expect(r.input).not.toHaveProperty("eventAttendees");
    expect(r.preview.lines).toEqual([
      C.whenLine("Tue 13 Oct, 15:30 to 16:30, Kolkata time"),
      changeLine(EVENT_CHANGE_LABELS.time, "Thu 15 Oct, 10:00 to 11:00, Kolkata time"),
      changeLine(EVENT_CHANGE_LABELS.adds, "olivia@proof.test"),
      changeLine(EVENT_CHANGE_LABELS.removes, "outsider@ext.test"),
      // Mia, the outsider taken off, and Olivia are told, each named.
      C.tellsPeople(3),
      C.toldLine("mia@proof.test, outsider@ext.test, olivia@proof.test"),
      C.outsideLine(1),
      C.calendarOf(ACCOUNT.email),
    ]);
    // The person moved to New York since: the approval runs the moment the card showed, not 10:00 there.
    const approved = ok(await prepareCall("update_event", r.input, ctx({ trigger: "APPROVAL", zone: "America/New_York" })));
    expect(approved.input.times).toEqual(r.input.times);
    expect(approved.input).toMatchObject({ etag: '"e-team-1"', notify: 3, addAttendees: ["olivia@proof.test"], removeAttendees: ["outsider@ext.test"] });
    expect(approved.input).not.toHaveProperty("eventAttendees");
  });

  it("update_event of the person's own event with nobody on it is INTERNAL, and a change that changes nothing is refused", async () => {
    const r = ok(await prepareCall("update_event", { eventId: "e-solo", title: "Deep work", location: "Room 4" }, ctx()));
    expect(r.risk).toBe("INTERNAL");
    expect(r.input).toMatchObject({ title: "Deep work", location: "Room 4", notify: 0 });
    expect(r.input).not.toHaveProperty("eventAttendees");
    expect(r.preview.lines).toContain(C.onlyYourCalendar);
    expect(await prepareCall("update_event", { eventId: "e-solo", title: "Focus block" }, ctx())).toEqual({ ok: false, error: C.nothingToChangeEvent, readGoogle: true });
  });

  // ── Review of step 4 ──

  /** Whether every character of `text` is on the card: in its title or whole on one of its lines. */
  const onCard = (p: Ok, text: string) => [p.preview.title, ...(p.preview.lines ?? [])].some((l) => l.includes(text));
  // 200 characters each, the most a title and a place may be; the tail is past the title line's cut.
  const LONG_TITLE = `Quarterly planning ${"q".repeat(100)} and the words past the cut ${"t".repeat(53)}`;
  const LONG_PLACE = `Head office ${"p".repeat(120)} the room past the cut ${"r".repeat(45)}`;

  it("shows every word an invitation sends, its whole title and place, and none is cut (review of step 4)", async () => {
    expect(LONG_TITLE).toHaveLength(200);
    expect(LONG_PLACE).toHaveLength(200);
    const r = ok(await prepareCall("create_event", { title: LONG_TITLE, location: LONG_PLACE, start: "2026-10-13T15:00", end: "2026-10-13T16:00", attendees: ["outsider@ext.test"] }, ctx()));
    expect(r.risk).toBe("IRREVERSIBLE");
    // Before: only the first 79 characters of each, while Approve sent all 200.
    expect(r.preview.title).not.toContain("past the cut");
    expect(onCard(r, LONG_TITLE)).toBe(true);
    expect(onCard(r, LONG_PLACE)).toBe(true);
    expect(r.preview.lines?.[0]).toBe(changeLine(EVENT_CHANGE_LABELS.title, LONG_TITLE));
    expect(r.preview.lines).toContain(changeLine(EVENT_CHANGE_LABELS.place, LONG_PLACE));
    // A change others are on, the same: its new title and place whole, and the event's own title.
    events["e-team"] = { ...events["e-team"], summary: LONG_TITLE };
    const change = ok(await prepareCall("update_event", { eventId: "e-team", title: `${LONG_TITLE.slice(0, 199)}!`, location: LONG_PLACE }, ctx()));
    expect(change.risk).toBe("IRREVERSIBLE");
    expect(onCard(change, `${LONG_TITLE.slice(0, 199)}!`)).toBe(true);
    expect(onCard(change, LONG_PLACE)).toBe(true);
    expect(change.preview.lines).toContain(C.eventTitleLine(LONG_TITLE));
    // A cancel and an answer name the event's whole title too.
    expect(onCard(ok(await prepareCall("cancel_event", { eventId: "e-team" }, ctx())), LONG_TITLE)).toBe(true);
    events["e-invite"] = { ...events["e-invite"], summary: LONG_TITLE };
    expect(onCard(ok(await prepareCall("respond_to_invite", { eventId: "e-invite", response: "declined" }, ctx())), LONG_TITLE)).toBe(true);
  });

  it("names who a change or a cancel tells, cut only between whole addresses, with rooms apart and in no count of people (review of step 4)", async () => {
    const people = Array.from({ length: 25 }, (_, i) => ({ email: `colleague.number${i}@finance.acme.test`, responseStatus: "accepted" }));
    events["e-big"] = calEvent("e-big", {
      attendees: [{ ...SELF, organizer: true }, ...people, { email: "c_room4@resource.calendar.google.com", displayName: "Room 4", resource: true, responseStatus: "accepted" }],
    });
    const r = ok(await prepareCall("cancel_event", { eventId: "e-big" }, ctx()));
    // The 25 people and the room are told; the room is no person and nobody's inbox outside.
    expect(r.input.notify).toBe(26);
    const lines = r.preview.lines ?? [];
    expect(lines).toContain(C.tellsCancelled(25));
    expect(lines).toContain(C.outsideLine(25));
    expect(lines).toContain(C.roomsLine("Room 4 <c_room4@resource.calendar.google.com>"));
    const told = lines.find((l) => l.startsWith("Told: "));
    if (!told) throw new Error("expected who is told");
    // Every address shown is whole; the rest are counted.
    const shown = told.slice("Told: ".length).replace(/ and \d+ more address(es)?$/, "").split(", ");
    for (const a of shown) expect(people.map((p) => p.email)).toContain(a);
    expect(told).toBe(C.toldLine(C.moreAddresses(shown.join(", "), 25 - shown.length)));
    expect(told).not.toContain("resource.calendar");
    // A list Google cut short says so.
    events["e-big"] = { ...events["e-big"], attendeesOmitted: true };
    expect(ok(await prepareCall("cancel_event", { eventId: "e-big" }, ctx())).preview.lines).toContain(C.othersUnlisted);
  });

  it("answers an invite whose guest list Google hides, with the person's own entry alone (review of step 4)", async () => {
    // A company all-hands: Google lists only the person, and says it left the rest out.
    events["e-allhands"] = calEvent("e-allhands", { summary: "All hands", organizer: { email: "ceo@proof.test", displayName: "CEO" }, attendeesOmitted: true, attendees: [{ ...SELF, responseStatus: "needsAction" }] });
    const r = ok(await prepareCall("respond_to_invite", { eventId: "e-allhands", response: "accepted" }, ctx()));
    // Before: refused, with a sentence about changing who is invited.
    expect(r.risk).toBe("IRREVERSIBLE");
    expect(r.input).toEqual({ eventId: "e-allhands", response: "accepted", etag: '"e-allhands-1"', attendeeEmail: ACCOUNT.email, account: ACCOUNT });
    expect(r.preview.lines).toContain(C.organizerSees("CEO"));
  });

  it("keys an invitation so a second identical one points at the first card, and a new event with nobody invited has no key (review of step 4)", async () => {
    const asked = { title: "Plan", start: "2026-10-13T15:00", end: "2026-10-13T16:00" };
    const one = ok(await prepareCall("create_event", { ...asked, attendees: ["mia@proof.test", "Olivia@Proof.test"] }, ctx()));
    const two = ok(await prepareCall("create_event", { ...asked, attendees: ["olivia@proof.test", "mia@proof.test"] }, ctx()));
    expect(typeof one.input.dedupeKey).toBe("string");
    expect(two.input.dedupeKey).toBe(one.input.dedupeKey);
    expect(ok(await prepareCall("create_event", { ...asked, title: "Plan 2", attendees: ["mia@proof.test"] }, ctx())).input.dedupeKey).not.toBe(one.input.dedupeKey);
    expect(ok(await prepareCall("create_event", asked, ctx())).input).not.toHaveProperty("dedupeKey");
  });

  it("reads days and times in the zone of the person's Google Calendar when they never chose one, and asks them to set one when neither says (review of step 4)", async () => {
    const asked = { title: "Focus", start: "2026-10-13T15:00", end: "2026-10-13T16:00" };
    // Max, in New York, never saved a zone; the workspace's (UTC here) is not his.
    const r = ok(await prepareCall("create_event", asked, ctx({ zone: "UTC", saved: null })));
    // Before: 15:00 UTC, 11:00 in New York, added with no card.
    expect(r.input.times).toEqual({ kind: "time", start: "2026-10-13T19:00:00.000Z", end: "2026-10-13T20:00:00.000Z", zone: "America/New_York" });
    expect(r.preview.lines?.[0]).toBe(C.whenLine("Tue 13 Oct, 15:00 to 16:00, New York time"));
    // One read, asking Google for the zone alone; nothing of it is kept but the times it fixed.
    expect(zoneReads()).toHaveLength(1);
    expect(zoneReads()[0].searchParams.get("fields")).toBe("timeZone");
    expect(Object.keys(r.input).sort()).toEqual(["account", "attendees", "end", "start", "times", "title"]);
    // A zone the person chose wins, and nothing is read for it.
    calls = [];
    expect(ok(await prepareCall("create_event", asked, ctx({ zone: "Asia/Kolkata", saved: "Asia/Kolkata" }))).input.times).toMatchObject({ zone: "Asia/Kolkata" });
    expect(zoneReads()).toEqual([]);
    // Neither: the person is asked to set one.
    calendarList = {};
    expect(await prepareCall("create_event", asked, ctx({ saved: null }))).toEqual({ ok: false, error: C.noTimeZone });
  });

  it("moves an event with no length, and says why when an event's own times can't be read (review of step 4)", async () => {
    events["e-mark"] = calEvent("e-mark", { start: { dateTime: "2026-10-13T10:00:00Z" }, end: { dateTime: "2026-10-13T10:00:00Z" } });
    const moved = ok(await prepareCall("update_event", { eventId: "e-mark", start: "2026-10-14T09:00" }, ctx()));
    // Before: refused as a bad time, though the time was written right.
    expect(moved.input.times).toEqual({ kind: "time", start: "2026-10-14T09:00:00.000Z", end: "2026-10-14T09:00:00.000Z", zone: "UTC" });
    expect(ok(await prepareCall("update_event", moved.input, ctx({ trigger: "APPROVAL" }))).input.times).toEqual(moved.input.times);
    events["e-odd"] = { ...calEvent("e-odd"), start: {}, end: {} };
    expect(await prepareCall("update_event", { eventId: "e-odd", start: "2026-10-14T09:00" }, ctx())).toEqual({ ok: false, error: C.eventTimesUnknown, readGoogle: true });
  });

  it("at its approval leaves the card waiting, agent_paused, when the teammate was paused or removed meanwhile, never failed (review of step 4)", async () => {
    const first = ok(await prepareCall("create_event", { title: "Plan", start: "2026-10-13T15:00", end: "2026-10-13T16:00", attendees: ["mia@proof.test"] }, ctx()));
    const mail = ok(await prepareCall("send_email", { to: ["olivia@proof.test"], subject: "Hi", body: "x" }, ctx()));
    cdb.agents[0].status = "DISABLED";
    // Before: no held, so the approval failed the card for good though nothing was sent.
    expect(await prepareCall("create_event", first.input, ctx({ trigger: "APPROVAL" }))).toEqual({ ok: false, error: C.teammateOff, held: "agent_paused" });
    expect(await prepareCall("send_email", mail.input, ctx({ trigger: "APPROVAL" }))).toEqual({ ok: false, error: C.teammateOff, held: "agent_paused" });
    // In a turn nothing is held: only an approval can wait.
    expect(await prepareCall("create_event", { title: "Plan", start: "2026-10-13T15:00", end: "2026-10-13T16:00" }, ctx())).toEqual({ ok: false, error: C.teammateOff });
  });
});

// What a Google connector write would do, decided by the server before
// anything is proposed and again at its approval
// (docs/plans/ai-teammates-phase3.md step 3; previews.ts prepareCall calls
// prepareConnector).
//
// THE CARD IS WHAT RUNS. Every recipient is one plain address (never a name,
// a list or an encoded word), lower case and once; at most 20 in all; the
// subject is one line with no header of its own hidden in it; the body is
// cleaned as every outward text is (teammate-tools.ts cleanOutwardText). The
// card shows exactly that, who it goes to, who it comes from, and how many
// are not in this workspace, and the stored input is exactly that.
//
// FINGERPRINTS (Decision 15). The first preparation stores the Google
// account the connection is now (its OpenID sub and address); an approval
// keeps the stored one and refuses when the connection is another account
// now. A reply's recipients, subject and headers are read from the
// conversation when it is proposed and stored; an approval uses the stored
// ones only (one read checks the conversation still exists), so someone who
// joined the thread since is never added.
//
// ACCESS IS READ NOW, AS THE HANDLER READS IT (connector-access.ts
// openConnector), at the first preparation and again at the approval.
//
// A REPLY'S FIRST PREPARATION READS GMAIL (review of step 3): the
// conversation's last sender, subject and headers. Its answer says so
// (readGoogle), and the executor asks before every later write of the turn,
// as after search_email (Decision 9). The card the person reads quotes the
// subject; what the model reads names none (connector-rules.ts connectorTitle).
//
// AT AN APPROVAL, WHAT CAN STILL BE MENDED WAITS (review of step 3). A send or
// a reply gets a fresh access token here, before anything is sent, so a grant
// revoked at Google is found while the card can wait. A connection to make or
// mend, or Google not answering, answers `held`: the approval leaves the card
// PENDING with a sentence that says it can be approved again, never FAILED.
//
// Server-only: reads prisma and Google.

import type { LiveConnection } from "@/lib/connectors/connections";
import type { GoogleConfig } from "@/lib/connectors/google/config";
import { freshAccess, googleCall } from "@/lib/connectors/google/http";
import { decodeHeaderWords, dedupeKey, headerSafe, isEmailAddress, parseAddressList } from "@/lib/connectors/google/gmail-mime";
import { headerOf } from "@/lib/connectors/google/gmail-parse";
import { CONNECTOR_LIMITS as L } from "@/lib/connectors/products";
import { prisma } from "@/lib/prisma";
import { clampText } from "./clamp";
import { openConnector } from "./connector-access";
import { googleFailureSentence, heldForFailure, heldForRefusal, type HeldCode } from "./connector-rules";
import type { Found, PrepareContext } from "./previews";
import { ACTION_VERB, CONNECTOR_COPY, quotedTitle } from "./teammate-copy";
import { CONNECTOR_INPUT } from "./connector-tools";
import { badInput, cleanOutwardText } from "./teammate-tools";
import type { ConnectorToolName } from "./tool-names";

/** A refusal; at an approval, `held` when nothing was sent and the card can wait. */
type Refused = { error: string; held?: HeldCode };

/** A Google failure as a refusal: its sentence, and at an approval whether the card waits. */
function refusedBy(f: Parameters<typeof googleFailureSentence>[0], o: { notFound: string; tool: ConnectorToolName; approval: boolean }): Refused {
  const error = googleFailureSentence(f, { product: "gmail", notFound: o.notFound, tool: o.tool });
  const held = o.approval ? heldForFailure(f.failure) : null;
  return held ? { error, held } : { error };
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The longest a subject runs on a card's title line (previews.ts SUBJECT_MAX). */
const SUBJECT_MAX = 80;

function short(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > SUBJECT_MAX ? `${clampText(t, SUBJECT_MAX - 1).trimEnd()}…` : t;
}

/**
 * The recipients as a card shows and a write sends them: each one plain
 * address, lower case, once (an address in both To and Cc stays in To), at
 * least one To, at most 20 in all. `drop` is the person's own account on a
 * reply: they are not sent their own answer.
 */
export function checkedRecipients(toRaw: readonly string[], ccRaw: readonly string[], drop: string | null = null): { to: string[]; cc: string[] } | Refused {
  const seen = new Set<string>(drop ? [drop.toLowerCase()] : []);
  const pick = (list: readonly string[]): string[] | Refused => {
    const out: string[] = [];
    for (const raw of list) {
      const a = String(raw ?? "").trim();
      if (!isEmailAddress(a)) return { error: CONNECTOR_COPY.badRecipient(clampText(headerSafe(a), 254)) };
      const lower = a.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push(lower);
    }
    return out;
  };
  const to = pick(toRaw);
  if (!Array.isArray(to)) return to;
  const cc = pick(ccRaw);
  if (!Array.isArray(cc)) return cc;
  if (to.length === 0) return { error: CONNECTOR_COPY.noRecipients };
  if (to.length + cc.length > L.recipientsMax) return { error: CONNECTOR_COPY.tooManyRecipients };
  return { to, cc };
}

/** How many of these addresses are not live people of this workspace (an anchored member, or a member through a second membership): one query. */
export async function outsideCount(organizationId: string, emails: readonly string[]): Promise<number> {
  const wanted = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (wanted.length === 0) return 0;
  const rows = await prisma.$queryRaw<Array<{ email: string }>>`
    SELECT lower(u."email") AS "email" FROM "User" u
     WHERE lower(u."email") = ANY(${wanted}::text[]) AND u."deletedAt" IS NULL AND u."status" <> 'INACTIVE'
       AND (u."organizationId" = ${organizationId}
            OR EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = u."id" AND m."organizationId" = ${organizationId}))`;
  const inside = new Set(rows.map((r) => String(r.email).toLowerCase()));
  return wanted.filter((e) => !inside.has(e)).length;
}

/**
 * The subject and the body as they leave the chat: the subject on one line,
 * both cleaned (cleanOutwardText). An email keeps its @ signs, so a body with
 * nothing left says what happened to it (review of step 3).
 */
function cleanText(subject: string, body: string): { subject: string; body: string } | Refused {
  const s = headerSafe(cleanOutwardText(subject, { talk: false, max: L.subjectMax }));
  const b = cleanOutwardText(body, { talk: false, max: L.bodyMax });
  if (!b) return { error: CONNECTOR_COPY.emptyBody };
  return { subject: s, body: b };
}

/**
 * The account a card names: the connection's now at the first preparation;
 * at its approval the stored one, which must be the account connected now
 * (by its sub: an address can be renamed, an account cannot become another).
 */
function accountFor(raw: Record<string, unknown>, connection: LiveConnection, approval: boolean): { sub: string; email: string } | Refused {
  if (!approval) return { sub: connection.accountSub, email: connection.accountEmail };
  const stored = rec(raw.account);
  const sub = str(stored.sub);
  if (!sub) return { error: CONNECTOR_COPY.accountUnknown };
  if (sub !== connection.accountSub) return { error: CONNECTOR_COPY.accountChanged(str(stored.email) || sub, connection.accountEmail) };
  return { sub, email: connection.accountEmail };
}

function gmailUrl(cfg: GoogleConfig, path: string, params: Array<[string, string]> = []): string {
  const q = new URLSearchParams(params).toString();
  return `${cfg.gmailBase}/users/me/${path}${q ? `?${q}` : ""}`;
}

/** The headers a reply reads of its conversation's last message. */
const REPLY_HEADERS: Array<[string, string]> = [
  ["format", "metadata"],
  ...["Message-ID", "References", "From", "Reply-To", "To", "Cc", "Subject"].map((h): [string, string] => ["metadataHeaders", h]),
];

/** What a reply goes to and carries, fixed when it is proposed (Decision 15). */
interface ReplyFacts {
  threadId: string;
  to: string[];
  cc: string[];
  subject: string;
  inReplyTo: string | null;
  references: string | null;
}

/**
 * The longest message id a reply carries. A header line may be at most 998
 * characters (RFC 5322 2.1.1) and no real id comes near this; a longer one is
 * left out rather than sent on a line Gmail refuses.
 */
const MESSAGE_ID_MAX = 250;

/**
 * The most characters of References a reply keeps: the newest ids, in their
 * order. A long thread, or a sender who writes a 25 KB References header,
 * otherwise stored a card that the approval could never send, and refused it
 * with a sentence that said nothing of why (review of step 3). Gmail threads
 * the reply by its threadId; the newest ids are what a mail client reads.
 */
const REFERENCES_MAX = 2000;

/** The ids a reply answers and refers to, bounded as above: whole ids only, the newest kept. */
export function replyIds(referencesHeader: string, messageIdHeader: string): { inReplyTo: string | null; references: string | null } {
  const fits = (id: string) => id.length > 0 && id.length <= MESSAGE_ID_MAX;
  const messageId = headerSafe(messageIdHeader);
  const own = fits(messageId) && !/\s/.test(messageId) ? messageId : null;
  const ids = [...headerSafe(referencesHeader).split(/\s+/).filter(fits), ...(own ? [own] : [])];
  const kept: string[] = [];
  let size = 0;
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const add = ids[i].length + (kept.length > 0 ? 1 : 0);
    if (size + add > REFERENCES_MAX) break;
    kept.unshift(ids[i]);
    size += add;
  }
  return { inReplyTo: own, references: kept.length > 0 ? kept.join(" ") : null };
}

/**
 * A reply's facts from its conversation now: the last message that is not a
 * draft; to its Reply-To, else its From; with replyAll also its To and Cc;
 * never the person's own account. When the last message is the person's
 * own, the reply goes where it went (its To, and with replyAll its Cc), as
 * Gmail's own Reply does. `readGoogle` once Gmail answered with the
 * conversation, whatever follows: the turn has read other people's words.
 */
async function replyFactsNow(
  conn: LiveConnection,
  cfg: GoogleConfig,
  input: { threadId?: string; messageId?: string; replyAll?: boolean },
): Promise<(ReplyFacts & { readGoogle: true }) | (Refused & { readGoogle?: true })> {
  let threadId = input.threadId ?? "";
  if (!threadId) {
    const m = await googleCall<unknown>(conn, cfg, { method: "GET", url: gmailUrl(cfg, `messages/${encodeURIComponent(input.messageId ?? "")}`, [["format", "minimal"]]), write: false });
    if (!m.ok) return refusedBy(m, { notFound: CONNECTOR_COPY.emailNotFound, tool: "reply_email", approval: false });
    threadId = str(rec(m.data).threadId);
    if (!threadId) return { error: CONNECTOR_COPY.emailNotFound };
  }
  const t = await googleCall<unknown>(conn, cfg, { method: "GET", url: gmailUrl(cfg, `threads/${encodeURIComponent(threadId)}`, REPLY_HEADERS), write: false });
  if (!t.ok) return refusedBy(t, { notFound: CONNECTOR_COPY.threadNotFound, tool: "reply_email", approval: false });
  const list = rec(t.data).messages;
  const sent = (Array.isArray(list) ? list : []).map(rec).filter((m) => !(Array.isArray(m.labelIds) && m.labelIds.includes("DRAFT")));
  const last = sent[sent.length - 1];
  if (!last) return { error: CONNECTOR_COPY.threadNotFound, readGoogle: true };
  const h = (name: string) => headerOf(last.payload, name) ?? "";
  const emails = (header: string) => parseAddressList(header).map((a) => a.email);
  const self = conn.accountEmail.toLowerCase();
  const fromSelf = emails(h("From")).some((e) => e.toLowerCase() === self);
  const to = fromSelf ? emails(h("To")) : emails(h("Reply-To")).length > 0 ? emails(h("Reply-To")) : emails(h("From"));
  const cc = input.replyAll ? (fromSelf ? emails(h("Cc")) : [...emails(h("To")), ...emails(h("Cc"))]) : [];
  const subjectWas = headerSafe(decodeHeaderWords(h("Subject")));
  const subject = /^re:/i.test(subjectWas) ? subjectWas : `Re: ${subjectWas}`.trim();
  return { threadId, to, cc, subject, ...replyIds(h("References"), h("Message-ID")), readGoogle: true };
}

/**
 * A reply's stored facts, at its approval: what the card showed, never worked
 * out again. Its ids are held to the same bounds as a new card's (replyIds),
 * so a card stored before them can still be sent.
 */
function replyFactsStored(raw: Record<string, unknown>): ReplyFacts | Refused {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);
  const to = list(raw.to);
  const cc = list(raw.cc) ?? [];
  const threadId = str(raw.threadId);
  if (!threadId) return { error: CONNECTOR_COPY.threadNotFound };
  if (!to || to.length === 0) return { error: CONNECTOR_COPY.noRecipients };
  return { threadId, to, cc, subject: str(raw.subject), inReplyTo: replyIds("", str(raw.inReplyTo)).inReplyTo, references: replyIds(str(raw.references), "").references };
}

/**
 * Prepare one connector write for the person (previews.ts prepareCall's
 * connector cases; see the file header). The calendar's writes answer
 * CONNECTOR_COPY.notYet until step 4; a read never reaches here.
 */
export async function prepareConnector(tool: ConnectorToolName, raw: Record<string, unknown>, ctx: PrepareContext): Promise<(Found & { readGoogle?: true }) | (Refused & { readGoogle?: true })> {
  if (tool !== "draft_email" && tool !== "send_email" && tool !== "reply_email") return { error: CONNECTOR_COPY.notYet };
  const approval = ctx.teammate.trigger === "APPROVAL";
  const parsed = CONNECTOR_INPUT[tool].safeParse(raw);
  if (!parsed.success) return badInput(parsed.error);

  const opened = await openConnector({ person: ctx.person, agentId: ctx.teammate.agentId, product: "gmail", forApproval: approval });
  if (!opened.ok) {
    const held = approval ? heldForRefusal(opened.reason) : null;
    return held ? { error: opened.error, held } : { error: opened.error };
  }
  const { connection, cfg } = opened;
  const account = accountFor(raw, connection, approval);
  if ("error" in account) return account;
  // A send or a reply is about to go: its one refresh now, while the card
  // can still wait (see the file header). A draft sends nothing.
  if (approval && tool !== "draft_email") {
    const fresh = await freshAccess(connection, cfg);
    if (!fresh.ok) return refusedBy(fresh, { notFound: CONNECTOR_COPY.threadNotFound, tool, approval });
  }

  // Who it goes to, and in which conversation. Once a reply read its
  // conversation, every answer from here says so (readGoogle).
  let read = false;
  const withRead = <T extends object>(v: T): T & { readGoogle?: true } => (read ? { ...v, readGoogle: true as const } : v);
  let facts: ReplyFacts | null = null;
  let toRaw: readonly string[];
  let ccRaw: readonly string[];
  let subjectRaw: string;
  if (tool === "reply_email") {
    const r = parsed.data as { threadId?: string; messageId?: string; replyAll?: boolean };
    const got = approval ? replyFactsStored(raw) : await replyFactsNow(connection, cfg, r);
    read = "readGoogle" in got && got.readGoogle === true;
    if ("error" in got) return withRead({ error: got.error, ...(got.held ? { held: got.held } : {}) });
    if (approval) {
      // The conversation must still be there; nothing else of it is read again.
      const still = await googleCall<unknown>(connection, cfg, { method: "GET", url: gmailUrl(cfg, `threads/${encodeURIComponent(got.threadId)}`, [["format", "minimal"]]), write: false });
      if (!still.ok) return refusedBy(still, { notFound: CONNECTOR_COPY.threadNotFound, tool, approval });
    }
    facts = { threadId: got.threadId, to: got.to, cc: got.cc, subject: got.subject, inReplyTo: got.inReplyTo, references: got.references };
    toRaw = got.to;
    ccRaw = got.cc;
    subjectRaw = got.subject;
  } else {
    const d = parsed.data as { to: string[]; cc?: string[]; subject: string };
    toRaw = d.to;
    ccRaw = d.cc ?? [];
    subjectRaw = d.subject;
  }
  const people = checkedRecipients(toRaw, ccRaw, tool === "reply_email" ? connection.accountEmail : null);
  if ("error" in people) return withRead(people);
  const text = cleanText(subjectRaw, (parsed.data as { body: string }).body);
  if ("error" in text) return withRead(text);

  const threadId = facts?.threadId ?? (tool === "draft_email" ? ((parsed.data as { threadId?: string }).threadId ?? null) : null);
  const input: Record<string, unknown> = {
    to: people.to,
    cc: people.cc,
    subject: text.subject,
    body: text.body,
    ...(threadId ? { threadId } : {}),
    ...(facts ? { replyAll: (parsed.data as { replyAll?: boolean }).replyAll === true, inReplyTo: facts.inReplyTo, references: facts.references } : {}),
    account,
  };
  // The same email waiting twice points at the first card (Decision 23).
  if (tool !== "draft_email") input.dedupeKey = dedupeKey({ to: people.to, cc: people.cc, subject: text.subject, body: text.body, threadId });

  const lines = [CONNECTOR_COPY.toLine(people.to.join(", "))];
  if (people.cc.length > 0) lines.push(CONNECTOR_COPY.ccLine(people.cc.join(", ")));
  lines.push(CONNECTOR_COPY.fromLine(account.email));
  if (tool === "draft_email") {
    lines.push(CONNECTOR_COPY.draftNothingSent, CONNECTOR_COPY.noAttachments);
    return {
      input,
      risk: "INTERNAL",
      preview: { title: quotedTitle(ACTION_VERB.draft_email ?? "", short(text.subject)), body: text.body, lines, target: { label: CONNECTOR_COPY.draftsTarget } },
    };
  }
  lines.push(CONNECTOR_COPY.outsideLine(await outsideCount(ctx.person.organizationId, [...people.to, ...people.cc])), CONNECTOR_COPY.cantUnsend, CONNECTOR_COPY.noAttachments);
  if (tool === "reply_email") lines.push(CONNECTOR_COPY.sameThread);
  return withRead({
    input,
    risk: "IRREVERSIBLE" as const,
    preview: {
      // The person's card quotes the subject; the model and the history read
      // connectorTitle instead (executor.ts, review of step 3).
      title: quotedTitle(ACTION_VERB[tool] ?? "", short(text.subject)),
      body: text.body,
      lines,
      // No address: the sweep's line for a send it can't confirm reads "Check
      // your Sent folder in Gmail before asking again." (unconfirmedLine).
      target: { label: CONNECTOR_COPY.sentFolderTarget },
    },
  });
}

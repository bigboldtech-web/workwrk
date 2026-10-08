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
// Server-only: reads prisma and Google.

import type { LiveConnection } from "@/lib/connectors/connections";
import type { GoogleConfig } from "@/lib/connectors/google/config";
import { googleCall } from "@/lib/connectors/google/http";
import { decodeHeaderWords, dedupeKey, headerSafe, isEmailAddress, parseAddressList } from "@/lib/connectors/google/gmail-mime";
import { headerOf } from "@/lib/connectors/google/gmail-parse";
import { CONNECTOR_LIMITS as L } from "@/lib/connectors/products";
import { prisma } from "@/lib/prisma";
import { clampText } from "./clamp";
import { openConnector } from "./connector-access";
import { googleFailureSentence } from "./connector-rules";
import type { Found, PrepareContext } from "./previews";
import { ACTION_VERB, CONNECTOR_COPY, TEAMMATE_TOOL_ERRORS as ERR, quotedTitle } from "./teammate-copy";
import { CONNECTOR_INPUT } from "./connector-tools";
import { badInput, cleanOutwardText } from "./teammate-tools";
import type { ConnectorToolName } from "./tool-names";

type Refused = { error: string };

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

/** The subject and the body as they leave the chat: the subject on one line, both cleaned (cleanOutwardText). */
function cleanText(subject: string, body: string): { subject: string; body: string } | Refused {
  const s = headerSafe(cleanOutwardText(subject, { talk: false, max: L.subjectMax }));
  const b = cleanOutwardText(body, { talk: false, max: L.bodyMax });
  if (!b) return { error: ERR.emptyText };
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
 * A reply's facts from its conversation now: the last message that is not a
 * draft; to its Reply-To, else its From; with replyAll also its To and Cc;
 * never the person's own account. When the last message is the person's
 * own, the reply goes where it went (its To, and with replyAll its Cc), as
 * Gmail's own Reply does.
 */
async function replyFactsNow(
  conn: LiveConnection,
  cfg: GoogleConfig,
  input: { threadId?: string; messageId?: string; replyAll?: boolean },
): Promise<ReplyFacts | Refused> {
  let threadId = input.threadId ?? "";
  if (!threadId) {
    const m = await googleCall<unknown>(conn, cfg, { method: "GET", url: gmailUrl(cfg, `messages/${encodeURIComponent(input.messageId ?? "")}`, [["format", "minimal"]]), write: false });
    if (!m.ok) return { error: googleFailureSentence(m, { product: "gmail", notFound: CONNECTOR_COPY.emailNotFound }) };
    threadId = str(rec(m.data).threadId);
    if (!threadId) return { error: CONNECTOR_COPY.emailNotFound };
  }
  const t = await googleCall<unknown>(conn, cfg, { method: "GET", url: gmailUrl(cfg, `threads/${encodeURIComponent(threadId)}`, REPLY_HEADERS), write: false });
  if (!t.ok) return { error: googleFailureSentence(t, { product: "gmail", notFound: CONNECTOR_COPY.threadNotFound }) };
  const list = rec(t.data).messages;
  const sent = (Array.isArray(list) ? list : []).map(rec).filter((m) => !(Array.isArray(m.labelIds) && m.labelIds.includes("DRAFT")));
  const last = sent[sent.length - 1];
  if (!last) return { error: CONNECTOR_COPY.threadNotFound };
  const h = (name: string) => headerOf(last.payload, name) ?? "";
  const emails = (header: string) => parseAddressList(header).map((a) => a.email);
  const self = conn.accountEmail.toLowerCase();
  const fromSelf = emails(h("From")).some((e) => e.toLowerCase() === self);
  const to = fromSelf ? emails(h("To")) : emails(h("Reply-To")).length > 0 ? emails(h("Reply-To")) : emails(h("From"));
  const cc = input.replyAll ? (fromSelf ? emails(h("Cc")) : [...emails(h("To")), ...emails(h("Cc"))]) : [];
  const subjectWas = headerSafe(decodeHeaderWords(h("Subject")));
  const subject = /^re:/i.test(subjectWas) ? subjectWas : `Re: ${subjectWas}`.trim();
  const messageId = headerSafe(h("Message-ID"));
  const references = [headerSafe(h("References")), messageId].filter(Boolean).join(" ").trim();
  return { threadId, to, cc, subject, inReplyTo: messageId || null, references: references || null };
}

/** A reply's stored facts, at its approval: what the card showed, never worked out again. */
function replyFactsStored(raw: Record<string, unknown>): ReplyFacts | Refused {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);
  const to = list(raw.to);
  const cc = list(raw.cc) ?? [];
  const threadId = str(raw.threadId);
  if (!threadId) return { error: CONNECTOR_COPY.threadNotFound };
  if (!to || to.length === 0) return { error: CONNECTOR_COPY.noRecipients };
  const opt = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { threadId, to, cc, subject: str(raw.subject), inReplyTo: opt(raw.inReplyTo), references: opt(raw.references) };
}

/**
 * Prepare one connector write for the person (previews.ts prepareCall's
 * connector cases; see the file header). The calendar's writes answer
 * CONNECTOR_COPY.notYet until step 4; a read never reaches here.
 */
export async function prepareConnector(tool: ConnectorToolName, raw: Record<string, unknown>, ctx: PrepareContext): Promise<Found | { error: string }> {
  if (tool !== "draft_email" && tool !== "send_email" && tool !== "reply_email") return { error: CONNECTOR_COPY.notYet };
  const approval = ctx.teammate.trigger === "APPROVAL";
  const parsed = CONNECTOR_INPUT[tool].safeParse(raw);
  if (!parsed.success) return badInput(parsed.error);

  const opened = await openConnector({ person: ctx.person, agentId: ctx.teammate.agentId, product: "gmail", forApproval: approval });
  if (!opened.ok) return { error: opened.error };
  const { connection, cfg } = opened;
  const account = accountFor(raw, connection, approval);
  if ("error" in account) return account;

  // Who it goes to, and in which conversation.
  let facts: ReplyFacts | null = null;
  let toRaw: readonly string[];
  let ccRaw: readonly string[];
  let subjectRaw: string;
  if (tool === "reply_email") {
    const r = parsed.data as { threadId?: string; messageId?: string; replyAll?: boolean };
    const got = approval ? replyFactsStored(raw) : await replyFactsNow(connection, cfg, r);
    if ("error" in got) return got;
    if (approval) {
      // The conversation must still be there; nothing else of it is read again.
      const still = await googleCall<unknown>(connection, cfg, { method: "GET", url: gmailUrl(cfg, `threads/${encodeURIComponent(got.threadId)}`, [["format", "minimal"]]), write: false });
      if (!still.ok) return { error: googleFailureSentence(still, { product: "gmail", notFound: CONNECTOR_COPY.threadNotFound }) };
    }
    facts = got;
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
  if ("error" in people) return people;
  const text = cleanText(subjectRaw, (parsed.data as { body: string }).body);
  if ("error" in text) return text;

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
  return {
    input,
    risk: "IRREVERSIBLE",
    preview: {
      title: quotedTitle(ACTION_VERB[tool] ?? "", short(text.subject)),
      body: text.body,
      lines,
      // No address: the sweep's line for a send it can't confirm reads "Check
      // your Sent folder in Gmail before asking again." (unconfirmedLine).
      target: { label: CONNECTOR_COPY.sentFolderTarget },
    },
  };
}

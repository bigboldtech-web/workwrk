// The contract mailers and Inbox writers (spec-process section 2
// `/agreements/[id]`, `/sign/[token]`): one place that emails a party its
// signing link (Send, Resend, the next party in a signing order) and one
// that tells the sender what a party did (contract.signed, contract.declined,
// contract.completed, the three Inbox kinds registered in inbox-kinds.ts).
// Server-only.

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { documentSignTemplate } from "@/lib/email-templates";
import { absoluteUrl } from "@/lib/app-url";

export interface PartyForMail {
  id: string;
  name: string;
  email: string;
  token: string;
  userId: string | null;
}

export function signLinkFor(token: string): string {
  // One helper for every outbound absolute link, so a signing request never
  // goes out pointing at a host the recipient cannot open (src/lib/app-url.ts).
  return absoluteUrl(`/sign/${token}`);
}

/** Email one party its signing link. A party with no email is skipped (the link is shared by hand). */
export async function mailSigningLink(opts: { orgId: string; agreementId: string; title: string; party: PartyForMail; message?: string | null; reminder?: boolean }): Promise<boolean> {
  const { orgId, title, party, message, reminder } = opts;
  if (!party.email || !party.email.trim()) return false;
  const { subject, html } = documentSignTemplate({ documentTitle: title, signerName: party.name, signLink: signLinkFor(party.token) });
  const note = message && message.trim() ? `<p style="white-space:pre-wrap">${escapeHtml(message.trim())}</p>` : "";
  try {
    await sendEmail({
      to: party.email,
      subject: reminder ? `Reminder: ${subject}` : subject,
      html: note ? html.replace("<h1>Document to sign</h1>", `<h1>Document to sign</h1>${note}`) : html,
      template: "document-sign",
      variables: { documentTitle: title },
      organizationId: orgId,
      userId: party.userId || undefined,
      category: "agreement",
    });
    // An internal party also gets an Inbox row so the link is one click away.
    if (party.userId) {
      await prisma.notification.create({
        data: { userId: party.userId, type: "contract.sent", title: reminder ? "Reminder: contract to sign" : "Contract to sign", message: `"${title}" is waiting for your signature.`, link: `/sign/${party.token}` },
      });
    }
    return true;
  } catch (e) {
    console.error("[contract] signing email failed", e);
    return false;
  }
}

/** Tell the sender (the contract's creator) what a party did. */
export async function notifySender(opts: { agreementId: string; createdById: string | null; kind: "contract.signed" | "contract.declined" | "contract.completed"; title: string; partyName: string; reason?: string | null }): Promise<void> {
  if (!opts.createdById) return;
  const label = opts.kind === "contract.signed" ? `${opts.partyName} signed "${opts.title}".`
    : opts.kind === "contract.declined" ? `${opts.partyName} declined to sign "${opts.title}".${opts.reason ? ` Reason: ${opts.reason}` : ""}`
    : `Everyone has signed "${opts.title}".`;
  await prisma.notification.create({
    data: {
      userId: opts.createdById,
      type: opts.kind,
      title: opts.kind === "contract.signed" ? "Contract signed" : opts.kind === "contract.declined" ? "Contract declined" : "Contract completed",
      message: label,
      link: `/agreements/${opts.agreementId}`,
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

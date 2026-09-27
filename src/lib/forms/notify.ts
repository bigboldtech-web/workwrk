// "Tell these people about each new response" (the form builder's Settings
// tab, Notifications card): one in-app notification per person on the form's
// notify list, written by the one submit route. Never the person who answered,
// only people still in the form's org, and only people who may read the
// form's responses (node-access R9: a notification never points at answers
// its reader's own Responses tab would refuse). The link is the Work door, so
// each reader is placed under their own access. Server only.

import { prisma } from "@/lib/prisma";
import { addressHref } from "@/lib/nav/object-href";
import { usersWhoCanReadResponses } from "@/lib/access/node-access";
import { answerText, isQuestion, type FormField } from "./fields";

export /** One notification per person on the form's notify list (never the person
 *  who answered, and only people still in the form's org). */
async function notifyNewResponse(
  form: { id: string; name: string; organizationId: string },
  fields: FormField[],
  data: Record<string, unknown>,
  userIds: string[],
  responderId: string,
) {
  const [inOrg, responder] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds.filter((u) => u !== responderId) }, organizationId: form.organizationId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: responderId }, select: { firstName: true, lastName: true, email: true } }),
  ]);
  const readers = await usersWhoCanReadResponses(form.organizationId, form.id, inOrg.map((r) => r.id));
  const recipients = inOrg.filter((r) => readers.has(r.id));
  if (recipients.length === 0) return;
  const who = responder ? `${responder.firstName ?? ""} ${responder.lastName ?? ""}`.trim() || responder.email || "Someone" : "Someone";
  const first = fields.find((f) => isQuestion(f) && answerText(f, data[f.id]));
  const preview = first ? `${first.label || "Answer"}: ${answerText(first, data[first.id]).slice(0, 120)}` : "";
  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      userId: r.id,
      type: "form.response",
      title: `New response to ${form.name || "Untitled form"}`,
      message: preview ? `${who} answered. ${preview}` : `${who} answered.`,
      link: `${addressHref("form", form.id, { scope: "work" })}?tab=responses`,
    })),
  });
}


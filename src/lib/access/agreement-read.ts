// Who may open a contract (an Agreement), as its page answers (GET
// /api/agreements/[id]): the manager tier (isManager) opens every one;
// anyone else opens only the ones they are a party to, by their user id or by
// the email on their account. The task Connection trail and the link list
// read this one rule, so neither names, counts or quotes a link to a
// contract its page would refuse.

import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { legacyIsManagerLevel } from "./legacy-levels";

type ReaderSession = { user?: { id?: string; accessLevel?: string | null } | null } | null | undefined;

/** The Agreement filter for the contracts this person may open ({} for the manager tier, nothing without a user). */
export async function agreementReadWhere(session: ReaderSession): Promise<Prisma.AgreementWhereInput> {
  const userId = session?.user?.id;
  if (!userId) return { id: { in: [] } };
  if (legacyIsManagerLevel(session?.user?.accessLevel)) return {};
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const email = me?.email?.trim();
  return {
    parties: { some: { OR: [{ userId }, ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : [])] } },
  };
}

/* eslint-disable no-restricted-syntax --
   The Staff console reads OTHER people's stored org role in a customer
   company (who holds Owner access, who may be promoted). The access engine
   answers what one viewer may do; it has no "who holds this role in company
   X" query, so this reads AccessLevel and maps it with the same rule as
   lib/access/org-role.ts (ownerIdsOf). No permission decision is made here:
   every route is gated on requirePlatformAdminApi. */
// One company as the Staff console shows it (spec-admin-backoffice 2.3):
// facts, plan and billing, modules, Owners, counts and the last five staff
// changes. Server only. Read by GET /api/admin/companies/[id].
//
// Counts only. No task, document, message, file or setting of the customer's
// is ever read out here beyond the Enterprise add-on flags; the one personal
// data this returns is the Owners' names and emails, which the spec allows as
// the real support path (ask an Owner).

import { prisma } from "@/lib/prisma";
import { MODULES } from "@/lib/modules";
import { PLAN_LIMITS } from "@/lib/plan-limits-data";
import { deletionSchedule } from "@/lib/admin/company-patch-rules";
import { consoleTrialEnd, trialEndRefusal } from "@/lib/admin/trial-end";
import {
  LIVE_PERSON,
  ownerIdsOf,
  seatsAreUnlimited,
  subscriptionSource,
  type OwnerCandidate,
} from "@/lib/admin/companies-list";

export interface CompanyPerson {
  id: string;
  name: string;
  email: string;
  /** The person's org role here: "OWNER" | "ADMIN" | "MEMBER". */
  role: "OWNER" | "ADMIN" | "MEMBER";
}

export interface StaffActionBrief {
  id: string;
  createdAt: Date;
  who: string;
  summary: string;
}

function personName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  const n = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return n || u.email;
}

/**
 * Everyone who can sign in to this workspace, with their org role here:
 * people anchored in it (User.accessLevel is their live role) and people
 * who belong by membership while working elsewhere (the membership's role).
 * Deleted and deactivated people are left out.
 */
export async function companyPeople(orgId: string, opts: { take?: number; q?: string } = {}): Promise<CompanyPerson[]> {
  const q = opts.q?.trim();
  const match = q
    ? {
        OR: [
          { firstName: { contains: q, mode: "insensitive" as const } },
          { lastName: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const take = opts.take ?? 500;
  const [anchored, members] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: orgId, ...LIVE_PERSON, ...match },
      select: { id: true, firstName: true, lastName: true, email: true, accessLevel: true, createdAt: true },
      orderBy: [{ firstName: "asc" }, { id: "asc" }],
      take,
    }),
    prisma.organizationMembership.findMany({
      where: { organizationId: orgId, user: { ...LIVE_PERSON, organizationId: { not: orgId }, ...match } },
      select: { role: true, user: { select: { id: true, firstName: true, lastName: true, email: true, createdAt: true } } },
      take,
    }),
  ]);
  const candidates: (OwnerCandidate & { name: string; email: string })[] = [
    ...anchored.map((u) => ({ id: u.id, level: u.accessLevel, createdAt: u.createdAt, name: personName(u), email: u.email })),
    ...members.map((m) => ({ id: m.user.id, level: m.role, createdAt: m.user.createdAt, name: personName(m.user), email: m.user.email })),
  ];
  // Owner-by-earliest-Admin is decided over the WHOLE admin set, so a search
  // must not change who counts as an Owner: ask for the admins separately.
  const owners = new Set(q ? await ownerIdsFor(orgId) : ownerIdsOf(candidates));
  return candidates.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    role: owners.has(c.id) ? "OWNER" : c.level === "COMPANY_ADMIN" || c.level === "SUPER_ADMIN" ? "ADMIN" : "MEMBER",
  }));
}

/** The ids of this workspace's live Owners. */
export async function ownerIdsFor(orgId: string): Promise<string[]> {
  const [anchored, members] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: orgId, ...LIVE_PERSON, accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
      select: { id: true, accessLevel: true, createdAt: true },
    }),
    prisma.organizationMembership.findMany({
      where: {
        organizationId: orgId,
        role: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] },
        user: { ...LIVE_PERSON, organizationId: { not: orgId } },
      },
      select: { role: true, user: { select: { id: true, createdAt: true } } },
    }),
  ]);
  return ownerIdsOf([
    ...anchored.map((u) => ({ id: u.id, level: u.accessLevel, createdAt: u.createdAt })),
    ...members.map((m) => ({ id: m.user.id, level: m.role, createdAt: m.user.createdAt })),
  ]);
}

/** Staff display names by email: PlatformAdmin name first, then the User row, else the email. */
export async function staffNames(emails: readonly string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(emails.filter(Boolean))];
  const out = new Map<string, string>();
  if (uniq.length === 0) return out;
  const [admins, users] = await Promise.all([
    prisma.platformAdmin.findMany({ where: { email: { in: uniq } }, select: { email: true, name: true } }),
    prisma.user.findMany({
      where: { email: { in: uniq, mode: "insensitive" }, deletedAt: null },
      select: { email: true, firstName: true, lastName: true },
    }),
  ]);
  for (const u of users) {
    const n = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
    if (n) out.set(u.email.toLowerCase(), n);
  }
  for (const a of admins) if (a.name) out.set(a.email.toLowerCase(), a.name);
  return out;
}

export async function loadCompanyDetail(id: string) {
  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      domain: true,
      plan: true,
      status: true,
      settings: true,
      createdAt: true,
      trialEndsAt: true,
      subscription: {
        select: {
          plan: true,
          status: true,
          billingMode: true,
          seats: true,
          stripeSubscriptionId: true,
          stripeCurrentPeriodEnd: true,
          trialEndsAt: true,
          canceledAt: true,
          updatedAt: true,
        },
      },
      productInstallations: { select: { status: true, product: { select: { slug: true } } } },
      _count: {
        select: {
          users: { where: { deletedAt: null } },
          spaces: { where: { archivedAt: null } },
          boards: { where: { archivedAt: null } },
          items: { where: { archivedAt: null } },
          docs: true,
          sops: true,
          kras: true,
          kpis: true,
          reviewCycles: true,
          dataTables: true,
          conversations: { where: { type: "CHANNEL", archivedAt: null } },
        },
      },
    },
  });
  if (!org) return null;

  const [owners, products, code, actions] = await Promise.all([
    ownerIdsFor(id).then(async (ids) =>
      ids.length === 0
        ? []
        : prisma.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, firstName: true, lastName: true, email: true },
            orderBy: [{ firstName: "asc" }, { id: "asc" }],
          }),
    ),
    prisma.product.findMany({ where: { slug: { in: MODULES.map((m) => m.productSlug) } }, select: { slug: true } }),
    prisma.appsumoCode.findFirst({
      where: { redeemedByOrg: id },
      orderBy: { redeemedAt: "desc" },
      select: { code: true, tier: true, refundedAt: true },
    }),
    prisma.staffAction.findMany({
      where: { targetCompanyId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
      select: { id: true, createdAt: true, actorEmail: true, summary: true },
    }),
  ]);

  const names = await staffNames(actions.map((a) => a.actorEmail));
  const settings = (org.settings && typeof org.settings === "object" ? org.settings : {}) as Record<string, unknown>;
  const features = (settings.features && typeof settings.features === "object" ? settings.features : {}) as Record<string, unknown>;
  const installed = new Map(org.productInstallations.map((i) => [i.product.slug, i.status]));
  const available = new Set(products.map((p) => p.slug));
  const sub = org.subscription;
  const moduleOn = (appKey: string) => {
    const m = MODULES.find((x) => x.appKey === appKey);
    return m ? installed.get(m.productSlug) === "ACTIVE" : false;
  };

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    domain: org.domain,
    plan: org.plan,
    status: org.status,
    createdAt: org.createdAt,
    // The scheduled deletion, so staff can see what a status change away
    // from Cancelled would undo: the Owner's own (Settings > Danger zone,
    // cancelledById set) or one a cancellation in this console scheduled.
    deletion: (() => {
      const d = deletionSchedule(org.settings);
      return d?.scheduledHardDeleteAt ? { scheduledFor: d.scheduledHardDeleteAt, requestedAt: d.cancelledAt, byOwner: !!d.cancelledById } : null;
    })(),
    // Only the two add-ons that do something. Custom domain is not sent: its
    // stored value is left in place, unread (spec 2.3 card 4).
    features: { byok: features.byok === true, whiteLabel: features.whiteLabel === true },
    subscription: sub
      ? {
          source: subscriptionSource(sub),
          plan: sub.plan,
          status: sub.status,
          billingMode: sub.billingMode,
          seats: seatsAreUnlimited(sub.seats) ? null : sub.seats,
          renewsAt: sub.stripeCurrentPeriodEnd,
          trialEndsAt: sub.trialEndsAt,
          canceledAt: sub.canceledAt,
          updatedAt: sub.updatedAt,
        }
      : null,
    lifetimeCode: code ? { code: code.code, tier: code.tier, refunded: Boolean(code.refundedAt) } : null,
    // When the trial ends, as staff read it (src/lib/admin/trial-end.ts):
    // Stripe's date, or the company's own self-serve date, which only staff
    // see. `editable` when that self-serve date is the one in force, or
    // could be (on Trial with nothing else deciding it); `whyNot` otherwise.
    trial: (() => {
      const facts = {
        status: org.status as string,
        trialEndsAt: org.trialEndsAt,
        subscription: sub ? { stripeSubscriptionId: sub.stripeSubscriptionId, billingMode: sub.billingMode as string, trialEndsAt: sub.trialEndsAt } : null,
      };
      const end = consoleTrialEnd(facts);
      const whyNot = trialEndRefusal(facts);
      return { endsAt: end?.at ?? null, source: end?.source ?? null, editable: whyNot === null, whyNot };
    })(),
    modules: MODULES.map((m) => ({
      key: m.appKey,
      label: m.label,
      competesWith: m.competesWith,
      blurb: m.blurb,
      on: installed.get(m.productSlug) === "ACTIVE",
      available: available.has(m.productSlug),
    })),
    people: org._count.users,
    owners: owners.map((u) => ({ id: u.id, name: personName(u), email: u.email })),
    counts: {
      people: org._count.users,
      spaces: org._count.spaces,
      lists: org._count.boards,
      tasks: org._count.items,
      docs: org._count.docs,
      sops: org._count.sops,
      kras: org._count.kras,
      kpis: org._count.kpis,
      reviews: org._count.reviewCycles,
      // A dash on the page where the module is off: the count of a switched
      // off module is not what they use.
      tables: moduleOn("tables") ? org._count.dataTables : null,
      talkChannels: moduleOn("chat") ? org._count.conversations : null,
    },
    /** For the module-off confirm, whatever the switch shows. */
    moduleUsage: { chat: org._count.conversations, tables: org._count.dataTables },
    planLimits: Object.fromEntries(Object.entries(PLAN_LIMITS).map(([k, v]) => [k, v.users])) as Record<string, number>,
    staffActions: actions.map<StaffActionBrief>((a) => ({
      id: a.id,
      createdAt: a.createdAt,
      who: names.get(a.actorEmail.toLowerCase()) ?? a.actorEmail,
      summary: a.summary,
    })),
  };
}

export type CompanyDetail = NonNullable<Awaited<ReturnType<typeof loadCompanyDetail>>>;

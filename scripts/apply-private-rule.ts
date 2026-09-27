/**
 * apply-private-rule.ts: choose one workspace's rule for Private items (the
 * one access model, 2026-09-24, decisions A2 and A8).
 *
 * THE TWO RULES. Under "strict", an item marked Private inside a shared
 * container is reached only by the people it names (A2): a grant on the
 * Folder or the Space above it stops at it. Under "legacy", the default for
 * every workspace that existed before this release, each person keeps at
 * least the reach they had before it (the legacy floor, src/lib/access/
 * legacy-floor.ts), so nothing that works today stops working on deploy
 * (A8). The rule lives in Organization.settings.accessModel.privateRule;
 * absent reads as legacy.
 *
 * DRY RUN BY DEFAULT. Without --write it prints the workspace's current
 * rule and what the strict rule would change, section by section (the same
 * C sections scripts/report-folder-overgrants.ts writes, computed by the
 * resolver's own rules), and changes nothing. Read that report's section C
 * for the people and nodes before applying the strict rule.
 *
 * WHAT --write DOES. It sets (strict, legacy) or removes (clear) the one key
 * Organization.settings.accessModel, through writeOrgSettingsKeys (one
 * UPDATE of that key; every other key of the settings column stays as the
 * database holds it), and records an access.private_rule_changed activity
 * row, in one transaction. It NEVER touches a grant row: no SpaceMember,
 * FolderMember, BoardMember, AccessGrant or doc sharing entry is read for
 * writing, changed or removed, so --rule legacy (or clear) puts every
 * person's reach back exactly as it was.
 *
 * Usage (local; the production form is in scripts/MIGRATIONS.md):
 *   DIRECT_URL= DATABASE_URL="$(grep DATABASE_URL= .env.local | cut -d'"' -f2)" \
 *     npx tsx scripts/apply-private-rule.ts --org <organizationId> --rule strict
 *   ... --write                 apply it
 *   ... --actor <email or id>   who the activity row names (default: the
 *                               workspace's first active Owner, else Admin)
 */

import { databaseLabel, scriptPrisma } from "./lib/script-prisma";
import { C_SECTIONS, countByDelta, loadOrgWorld, strictRuleChanges, subpageLosses } from "./report-folder-overgrants";
import { NODE_ACCESS_DELTAS, readPrivateRule } from "../src/lib/access/node-rules";
import { accessActivityDescription } from "../src/lib/access/access-activity";
import { writeOrgSettingsKeys } from "../src/lib/org-settings-write";

const RULES = ["strict", "legacy", "clear"] as const;
type Rule = (typeof RULES)[number];

async function main() {
  const args = process.argv.slice(2);
  const argOf = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] ?? null : null);
  const orgId = argOf("--org");
  const rule = argOf("--rule") as Rule | null;
  const write = args.includes("--write");
  const actorArg = argOf("--actor");

  if (!orgId) {
    console.error("apply-private-rule: --org <organizationId> is required (the rule is chosen one workspace at a time).");
    process.exit(2);
  }
  if (!rule || !RULES.includes(rule)) {
    console.error("apply-private-rule: --rule takes strict, legacy or clear.");
    process.exit(2);
  }

  const prisma = scriptPrisma();
  try {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, settings: true } });
    if (!org) {
      console.error(`apply-private-rule: no organization has the id ${orgId}.`);
      process.exitCode = 1;
      return;
    }
    const settings = org.settings && typeof org.settings === "object" ? (org.settings as Record<string, unknown>) : {};
    const stored = settings.accessModel;
    const current = readPrivateRule(org.settings);

    console.log(`Database: ${databaseLabel()}`);
    console.log(`Workspace: ${org.name} (${org.id})`);
    console.log(`Current rule: ${current}${stored === undefined ? " (no accessModel key: the legacy default)" : ""}`);
    if (stored !== undefined) console.log(`Stored accessModel: ${JSON.stringify(stored)}`);
    console.log(`Asked for: ${rule}${rule === "clear" ? " (remove the key: the legacy default)" : ""}`);
    console.log("");

    // What the strict rule changes against the legacy rule, whatever is stored now.
    const world = await loadOrgWorld(prisma, org);
    const counts = countByDelta([...strictRuleChanges(world), ...subpageLosses(world)]);
    console.log("What the strict rule changes in this workspace (person and node pairs):");
    for (const sec of C_SECTIONS) {
      const c = counts.get(sec.delta);
      const text = sec.delta === "unexplained" ? "not explained by a named row (should be 0)" : NODE_ACCESS_DELTAS.find((d) => d.id === sec.delta)?.text ?? "";
      console.log(`  ${sec.id} ${sec.delta}: ${c?.rows ?? 0} (${c?.people ?? 0} people, ${c?.nodes ?? 0} nodes). ${text}`);
    }
    console.log("");
    console.log("The people and nodes behind each number: npx tsx scripts/report-folder-overgrants.ts --org " + org.id);
    console.log("");

    if (!write) {
      console.log("Dry run: nothing was written. Add --write to apply.");
      return;
    }

    const actor = await findActor(prisma, org.id, actorArg);
    if (!actor) {
      console.error(
        actorArg
          ? `apply-private-rule: ${actorArg} is not an active Owner or Admin of this workspace.`
          : "apply-private-rule: this workspace has no active Owner or Admin to record as the actor; pass --actor.",
      );
      process.exitCode = 1;
      return;
    }

    const T_RULE = "access.private_rule_changed" as const;
    await prisma.$transaction(async (tx) => {
      // The same lock every doc sharing write takes, so the key write never
      // races a writer of another key in the settings column.
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${org.id} FOR UPDATE`;
      await writeOrgSettingsKeys(
        org.id,
        { accessModel: rule === "clear" ? null : { privateRule: rule, changedAt: new Date().toISOString(), changedById: actor.id } },
        tx,
      );
      await tx.activityLog.create({
        data: {
          type: T_RULE,
          actorId: actor.id,
          organizationId: org.id,
          targetType: "organization",
          targetId: org.id,
          description: accessActivityDescription(T_RULE, null),
          metadata: { rule, previousRule: current, source: "script" },
          oldValue: { privateRule: current },
          newValue: { privateRule: rule === "clear" ? "legacy" : rule },
          severity: "warning",
        },
      });
    });

    const after = await prisma.organization.findUnique({ where: { id: org.id }, select: { settings: true } });
    const afterModel = after?.settings && typeof after.settings === "object" ? (after.settings as Record<string, unknown>).accessModel : undefined;
    console.log(`Written by ${actor.label}. The rule is now ${readPrivateRule(after?.settings)}${afterModel === undefined ? " (the key is absent)" : `: ${JSON.stringify(afterModel)}`}.`);
    console.log("No grant row was touched.");
  } finally {
    await prisma.$disconnect();
  }
}

async function findActor(prisma: ReturnType<typeof scriptPrisma>, organizationId: string, actorArg: string | null): Promise<{ id: string; label: string } | null> {
  const admins = await prisma.user.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { not: "INACTIVE" },
      accessLevel: { in: ["SUPER_ADMIN", "COMPANY_ADMIN"] },
      ...(actorArg ? { OR: [{ id: actorArg }, { email: actorArg }] } : {}),
    },
    select: { id: true, email: true, accessLevel: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const pick = admins.find((u) => u.accessLevel === "SUPER_ADMIN") ?? admins[0];
  return pick ? { id: pick.id, label: pick.email } : null;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

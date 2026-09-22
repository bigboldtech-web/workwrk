// Phase 4 (Time and Talk) data script: channel visibility after the
// Conversation.restricted / findable columns land.
//
// WHY IT EXISTS WHEN THE SQL ALREADY DID THE WORK. ADD COLUMN with a DEFAULT
// writes that default into every existing row, so 2026-09-22-time-and-talk.sql
// already leaves restricted = false everywhere and findable = true on every
// channel, which is exactly what spec-talk.md section 4 step 4 asks for. This
// script is the REPORT half of that: it prints, per organization, what the
// database actually holds so the founder can read the outcome instead of
// trusting a DDL default, and its --write is the same statement again, which
// is a no-op on a database the SQL has already touched. Running it on a
// database where the SQL has NOT run fails loudly rather than silently.
//
// THE RULE, from the spec: "findable = true on every public channel,
// restricted = false everywhere. No data moves; DMs and groups untouched."
// A DM or a group is not something anyone browses for, so findable is false
// on those two types; that is statement 8 of the SQL file and it is asserted
// here rather than re-argued.
//
// THIS SCRIPT NO LONGER WRITES, AND THAT IS THE POINT.
//
// It used to carry a --write half that ran three unconditional updateMany
// statements: findable = true on every channel, restricted = false on every
// conversation, findable = false on every DM and group. On the day the SQL
// lands those are no-ops, which is what made them look safe. A week later
// they are not: an admin who has hidden a channel from Browse, or made one
// private, has their choice silently reversed, and running this in production
// three months after adoption would publish every private channel in every
// organization. There is no createdAt guard that can tell "still at the DDL
// default" from "set back to the default on purpose", because the values are
// the same value.
//
// The DDL already does the backfill (ADD COLUMN ... DEFAULT writes the default
// into every existing row), so the write half was never needed. What is
// genuinely useful is the REPORT: per organization, what the database holds,
// so the founder reads the outcome instead of trusting a default. That is all
// this script does now, and it takes no flags that change anything.
//
// Reads only. Never writes, never deletes, never mutates. Idempotent by
// construction.
//
// Usage:
//   node scripts/backfill-channel-visibility.mjs            # report

import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function line(s) { process.stdout.write(`${s}\n`); }

async function main() {
  line("channel visibility report (read only)");
  line("");
  if (process.argv.includes("--write")) {
    line("--write is gone on purpose. Re-running the three updateMany statements");
    line("it used to carry would un-hide every hidden channel and publish every");
    line("private one. The SQL file's column defaults are the backfill; this is");
    line("the report. Nothing was written.");
    line("");
  }

  let rows;
  try {
    rows = await prisma.conversation.findMany({
      select: { id: true, organizationId: true, type: true, name: true, restricted: true, findable: true },
    });
  } catch (e) {
    line("Could not read Conversation.restricted / findable.");
    line("Apply prisma/sql/2026-09-22-time-and-talk.sql first.");
    line(String(e?.message ?? e));
    await prisma.$disconnect();
    process.exit(1);
  }

  const byOrg = new Map();
  for (const c of rows) {
    const b = byOrg.get(c.organizationId) ?? { channels: 0, findableChannels: 0, restricted: 0, dms: 0, groups: 0 };
    if (c.type === "CHANNEL") { b.channels += 1; if (c.findable) b.findableChannels += 1; }
    if (c.type === "DM") b.dms += 1;
    if (c.type === "GROUP") b.groups += 1;
    if (c.restricted) b.restricted += 1;
    byOrg.set(c.organizationId, b);
  }

  line("Per organization");
  line("org                                  channels  findable  restricted  dms  groups");
  for (const [orgId, b] of byOrg) {
    line(
      `${orgId.padEnd(36)} ${String(b.channels).padStart(8)} ${String(b.findableChannels).padStart(9)} ` +
      `${String(b.restricted).padStart(11)} ${String(b.dms).padStart(4)} ${String(b.groups).padStart(7)}`,
    );
  }
  line("");

  const channelsNotFindable = rows.filter((c) => c.type === "CHANNEL" && !c.findable);
  const anyRestricted = rows.filter((c) => c.restricted);
  const dmOrGroupFindable = rows.filter((c) => c.type !== "CHANNEL" && c.findable);

  // These three numbers are a picture, not a plan. A channel that is not
  // findable and a conversation that is restricted are both legitimate
  // admin choices, and nothing here is going to change them back.
  line(`Channels hidden from Browse:   ${channelsNotFindable.length}`);
  line(`Conversations marked private:  ${anyRestricted.length}`);
  line(`DMs or groups marked findable: ${dmOrGroupFindable.length}`);
  line("");
  if (dmOrGroupFindable.length > 0) {
    line("A findable DM or group is the one row shape the product does not");
    line("expect: Browse only lists channels, so it is invisible rather than");
    line("leaking. Report it before changing it by hand.");
  } else {
    line("No DM or group is marked findable, which is what the SQL's defaults set.");
  }
  line("");
  line("Read only. This script writes nothing.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

// DRY RUN ONLY. Reports every List field whose stored key is one the app
// reserves (src/lib/field-keys.ts). It reads Board.schema and Item.metadata
// and writes NOTHING: no schema, no task, no view is changed.
//
//   npx tsx scripts/report-reserved-field-keys.ts
//
// Why a report and not a fix. Since field-keys.ts, a new field never gets a
// reserved key, and every List surface reads an older one by source (the
// table's "owner" field is the column "field:owner", never the Assignee
// column), so those Lists keep working with no data change. Renaming a stored
// key would have to move its value on every task, in every view setting,
// template and form mapping at once, and a partial rename loses data.
//
// One class the renderers cannot separate, and this report exists for it: a
// HOME List field keyed like one of the task's OWN metadata keys
// ("description", "checklist", "watchers" ...). There the field and the task
// body share ONE stored value, so there is nothing to read apart. Those rows
// are marked SHARED SLOT with how many tasks hold a value there; each needs a
// person to decide what the value is before anybody changes anything.
//
// Reads .env.local first, so a run on a laptop reads the local database and
// never a remote one by accident.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AXIS_IDS,
  RULE_FIELD_IDS,
  TABLE_COLUMN_IDS,
  TASK_METADATA_KEYS,
  TASK_STRIP_IDS,
  isReservedFieldKey,
} from "../src/lib/field-keys";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connStr }) });

type Field = { key?: unknown; label?: unknown; type?: unknown };

function surfacesFor(key: string): string[] {
  const out: string[] = [];
  if ((TABLE_COLUMN_IDS as readonly string[]).includes(key)) out.push("table column");
  if ((RULE_FIELD_IDS as readonly string[]).includes(key)) out.push("filter and colour rules");
  if ((AXIS_IDS as readonly string[]).includes(key)) out.push("chart and pivot axis");
  if ((TASK_STRIP_IDS as readonly string[]).includes(key)) out.push("task field strip");
  if (TASK_METADATA_KEYS.includes(key)) out.push("task metadata");
  if (out.length === 0) out.push("reserved prefix or name");
  return out;
}

async function main() {
  const boards = await prisma.board.findMany({
    select: {
      id: true,
      name: true,
      archivedAt: true,
      organizationId: true,
      schema: true,
      space: { select: { name: true } },
    },
  });

  let clashing = 0;
  let sharedSlot = 0;
  for (const b of boards) {
    const raw = (b.schema as { fields?: unknown } | null)?.fields;
    const fields: Field[] = Array.isArray(raw) ? (raw as Field[]) : [];
    for (const f of fields) {
      if (typeof f.key !== "string" || !isReservedFieldKey(f.key)) continue;
      clashing++;
      const key = f.key;
      const surfaces = surfacesFor(key);
      let note = "read by source since field-keys.ts; no data change needed";
      if (TASK_METADATA_KEYS.includes(key)) {
        // How many of this List's own tasks hold a value in the shared slot.
        const items = await prisma.item.findMany({ where: { boardId: b.id }, select: { metadata: true } });
        const holding = items.filter((it) => {
          const md = it.metadata as Record<string, unknown> | null;
          return !!md && Object.prototype.hasOwnProperty.call(md, key) && md[key] !== null && md[key] !== "";
        }).length;
        sharedSlot++;
        note = `SHARED SLOT with the task's own metadata.${key}: ${holding} of ${items.length} task(s) hold a value; needs a person's decision`;
      }
      console.log(JSON.stringify({
        organizationId: b.organizationId,
        space: b.space?.name ?? null,
        listId: b.id,
        list: b.name,
        archived: !!b.archivedAt,
        fieldKey: key,
        label: typeof f.label === "string" ? f.label : null,
        type: typeof f.type === "string" ? f.type : null,
        clashesWith: surfaces,
        note,
      }));
    }
  }

  console.log(`\nLists scanned: ${boards.length}`);
  console.log(`Fields with a reserved key: ${clashing}`);
  console.log(`Of those, sharing a slot with the task's own metadata: ${sharedSlot}`);
  console.log("Dry run: nothing was written.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

// Batch 7's promises that live in routes, pages and SQL, held to the source
// so a regression fails here:
//
//   off is today   every new door renders, and every new field is sent, only
//                  while ACCESS_V2_TABLES is on; the old surfaces stay the
//                  writers with it off
//   one store each the object writers write the store each object's gates
//                  already read, never AccessGrant (nothing reads those rows)
//   one at a time  every write locks the object's row in a transaction
//   additive SQL   ToolShare.role is one nullable column, in the manifest

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const ADAPTERS = ["sop-folder", "tool", "goal", "team"] as const;

describe("the object writers", () => {
  for (const name of ADAPTERS) {
    const src = read(`src/lib/access/object-share/${name}.ts`);

    it(`${name}: never writes or reads AccessGrant`, () => {
      expect(src).not.toMatch(/accessGrant|AccessGrant"/);
    });

    it(`${name}: locks the object's row inside a transaction before every write`, () => {
      expect(src).toMatch(/prisma\.\$transaction\(async \(tx\) => \{\n\s+const .+ = await actorGate\(tx, ctx, id\);/);
      expect(src).toMatch(/FOR UPDATE`;/);
      // Set and remove both check the role the dialog showed (409 when it moved).
      expect(src.match(/throw new GrantError\("conflict"\)/g)?.length).toBe(2);
    });

    it(`${name}: logs one access activity row per write`, () => {
      expect(src).toMatch(/await objectActivity\(tx, ctx, KIND, id, "access\.revoked"/);
    });
  }

  it("dispatches all four kinds", () => {
    const index = read("src/lib/access/object-share/index.ts");
    expect(index).toMatch(/const ADAPTERS: Readonly<Record<ObjectShareKind, Adapter>> = \{/);
    for (const k of ["sop_folder", "tool", "goal", "team"]) expect(index).toMatch(new RegExp(`\\n  ${k}: \\{ panel: `));
  });

  it("rides one flag", () => {
    expect(read("src/lib/access/object-share/common.ts")).toMatch(/export function objectShareOn\(\): boolean \{\n\s+return accessV2Tables\(\);\n\}/);
    expect(read("src/app/api/boot/route.ts")).toMatch(/objectShare: accessV2Tables\(\),/);
  });
});

describe("the doors render only while the flag is on", () => {
  it("SOP folders keep their own dialog with it off", () => {
    const manager = read("src/components/settings/sop-folders-tags-manager.tsx");
    expect(manager).toMatch(/\{boot\.org\.objectShare \? \(\n\s+<ShareDialog[\s\S]+?\) : \(\n\s+<SopFolderShareDialog /);
    const sop = read("src/components/sops/sop-share-dialog.tsx");
    expect(sop).toMatch(/if \(!open \|\| !sop\.folderId \|\| !objectShare\) return;/);
    expect(sop).toMatch(/if \(!open \|\| !sop\.folderId \|\| objectShare\) return;/);
  });

  it("the Tools drawer keeps its own Who has access section with it off", () => {
    const page = read("src/app/(dashboard)/tools/page.tsx");
    expect(page).toMatch(/\{manage && !objectShare \? \(\n\s+<ShareSection /);
    expect(page).toMatch(/\{objectShare && tool \? \(\n\s+<ShareDialog/);
    expect(page).toMatch(/if \(objectShare\) setShareFor\(\{ id: t\.id, name: t\.name \}\); else setParams\(\{ tool: t\.id, share: "1" \}\);/);
  });

  it("the goal page and the Teams tab add their door only with it on", () => {
    expect(read("src/app/(dashboard)/okrs/[id]/page.tsx")).toMatch(/\{accessV2Tables\(\) \? <GoalShareDoor /);
    const teams = read("src/app/(dashboard)/settings/members/teams-tab.tsx");
    expect(teams).toMatch(/\{boot\.org\.objectShare && \(canEdit \|\| isLead\) && !renaming \? \(/);
    expect(teams).toMatch(/\{boot\.org\.objectShare \? \(\n\s+<ShareDialog/);
  });
});

describe("the tool routes read a share's role only with the flag on", () => {
  it("in every route that decides by it", () => {
    expect(read("src/app/api/tools/[id]/route.ts")).toMatch(/toolShareRole\(row, accessV2Tables\(\)\)/);
    expect(read("src/app/api/tools/[id]/share/route.ts")).toMatch(/canShareTool\(v, tool, toolShareRole\(share, accessV2Tables\(\)\)\)/);
    expect(read("src/app/api/tools/route.ts")).toMatch(/const rolesOn = accessV2Tables\(\);\n\s+const myRole = new Map\(mine\.map\(\(s\) => \[s\.toolId, toolShareRole\(s, rolesOn\)\]\)\);/);
  });

  it("and sends the new fields only then, so the JSON is today's with it off", () => {
    const one = read("src/app/api/tools/[id]/route.ts");
    expect(one).toMatch(/\.\.\.\(rolesOn \? \{ canEdit: canEditTool\(v, tool, share\), role: toolViewerRole\(v, tool, share\) \} : \{\}\),/);
    expect(one).toMatch(/\.\.\.\(rolesOn \? \{ role: toolShareRole\(\{ role \}, true\) \} : \{\}\)/);
    expect(read("src/app/api/tools/route.ts")).toMatch(/\.\.\.\(rolesOn \? \{ canEdit: canEditTool\(v, t, share\) \} : \{\}\),/);
  });

  it("keeps the bulk bar at the tool admins' own rule", () => {
    expect(read("src/app/api/tools/bulk/route.ts")).toMatch(/const mine = tools\.filter\(\(t\) => canManageTool\(v, t\)\);/);
  });
});

describe("requests on the four kinds", () => {
  it("are granted through the object writers only with the flag on", () => {
    const one = read("src/app/api/access-requests/[id]/route.ts");
    expect(one).toMatch(/const objectKind = !node && objectShareOn\(\) \? requestObjectKind\(request\.objectType\) : null;/);
    expect(one).toMatch(/if \(objectKind\) return grantObject\(/);
    // Claimed before the write, released when the writer refuses, a raise only.
    const grant = one.slice(one.indexOf("async function grantObject("));
    expect(grant).toMatch(/if \(!\(await claim\(request\.id, "APPROVED", deciderId\)\)\) return closedNow\(request\.id\);[\s\S]+setObjectGrant\(octx, kind, request\.objectId, \{ userId: request\.requesterId, role, mode: "raise" \}\)[\s\S]+await release\(request\.id, deciderId\);/);
    const list = read("src/app/api/access-requests/route.ts");
    expect(list).toMatch(/const objectsOn = objectShareOn\(\);/);
    expect(list).toMatch(/const objectKind = !node && objectsOn \? requestObjectKind\(r\.objectType\) : null;/);
  });
});

describe("the schema change", () => {
  it("is one nullable column with a guarded CHECK, applied by the deploy", () => {
    const sql = read("prisma/sql/2026-10-04-tool-share-role.sql");
    const statements = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
    expect(statements).toMatch(/ALTER TABLE "ToolShare" ADD COLUMN IF NOT EXISTS "role" TEXT;/);
    expect(statements).toMatch(/IF NOT EXISTS \(\n\s+SELECT 1 FROM pg_constraint WHERE conname = 'ToolShare_role_check'\n\s+\) THEN/);
    expect(statements).toMatch(/CHECK \("role" IS NULL OR "role" IN \('EDIT', 'FULL'\)\)/);
    expect(statements).not.toMatch(/DROP|DELETE|UPDATE "ToolShare"|ALTER COLUMN/);
    expect(read("scripts/deploy-migrations.mjs")).toMatch(/\n  "2026-10-04-tool-share-role\.sql",\n\];/);
    expect(read("prisma/schema.prisma")).toMatch(/model ToolShare \{[\s\S]+?\n  role     String\?\n/);
  });
});

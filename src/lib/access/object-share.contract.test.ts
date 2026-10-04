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
    // Sent only while on, so the boot JSON is today's with it off.
    expect(read("src/app/api/boot/route.ts")).toMatch(/\.\.\.\(accessV2Tables\(\) \? \{ objectShare: true \} : \{\}\),/);
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

describe("review round 1", () => {
  it("names a tool, an SOP folder or a team on the requests card only with the flag on", () => {
    const target = read("src/lib/access/access-request-target.ts");
    for (const [kind, model] of [["tool", "tool"], ["sop_folder", "sOPFolder"], ["team", "team"]]) {
      expect(target).toMatch(new RegExp(`case "${kind}":\\n\\s+return accessV2Tables\\(\\) \\? \\(await prisma\\.${model}\\.findFirst`));
    }
  });

  it("leaves the live activity feed's targets as they were (no team or SOP folder entry)", () => {
    const targets = read("src/lib/activity-targets.ts");
    expect(targets).not.toMatch(/\n  team: \{/);
    expect(targets).not.toMatch(/\n  sop_folder: \{/);
  });

  it("opens each object through exactly the door its own pages and routes keep", () => {
    const index = read("src/lib/access/object-share/index.ts");
    // Tools: the app row, always.
    expect(index).toMatch(/if \(kind === "tool"\) return !\("error" in \(await requireApp\("tools"\)\)\);/);
    // Goals: the goal page's rule: never a Guest or INACTIVE account; a hidden or floored app only in engine mode.
    expect(index).toMatch(/if \(!decision\.discoverable\) return false;\n\s+return settingsGateMode\(\{ resolver: accessV2Resolver\(\), logOnly: settingsGateLogOnly\(\) \}\) !== "engine";/);
    // SOP folders and teams: no app row (no SOP surface reads one; Members is the team door).
    expect(index).not.toMatch(/requireApp\("sops"\)|key: "sops"/);
    expect(index).toMatch(/export async function objectAccessPanel[^{]+\{\n\s+if \(!\(await appOpen\(kind\)\)\) return null;/);
    expect(index).toMatch(/export async function checkObjectAccess[^{]+\{\n\s+if \(!\(await appOpen\(kind\)\)\) return "not_found";/);
  });

  it("refuses a session the database no longer backs", () => {
    const common = read("src/lib/access/object-share/common.ts");
    expect(common).toMatch(/if \(!row \|\| row\.deletedAt \|\| RULE_1_DENIED_STATUSES\.has\(String\(row\.status\)\)\) return null;/);
    expect(common).toMatch(/if \(typeof u\.tokenVersion === "number" && u\.tokenVersion !== row\.tokenVersion\) return null;/);
  });

  for (const name of ADAPTERS) {
    it(`${name}: a repeated removal is a no change, never a conflict`, () => {
      const src = read(`src/lib/access/object-share/${name}.ts`);
      const remove = src.slice(src.indexOf("export async function remove"));
      expect(remove.indexOf("noChange: true")).toBeGreaterThan(-1);
      expect(remove.indexOf("noChange: true")).toBeLessThan(remove.indexOf('throw new GrantError("conflict")'));
    });
  }

  it("never lets an Agent share a goal, and a team lead changes members only through the door they can open", () => {
    const goal = read("src/lib/access/object-share/goal.ts");
    expect(goal).toMatch(/const canManage = me\.edit && !ctx\.isAgent;/);
    expect(goal).toMatch(/if \(!me\.edit \|\| ctx\.isAgent\) throw new GrantError\("forbidden"\);/);
    expect(goal).toMatch(/if \(!me\.edit \|\| ctx\.isAgent\) return "forbidden";/);
    expect(read("src/app/(dashboard)/okrs/[id]/page.tsx")).toMatch(/canShare=\{canEditGoal && viewer\.accessLevel !== "AGENT"\}/);
    const team = read("src/lib/access/object-share/team.ts");
    expect(team).toMatch(/return mine === "FULL" && door \? "VIEW" : null;/);
  });

  it("refreshes the goal's Contributors row after the dialog changes it, without remounting it", () => {
    const page = read("src/app/(dashboard)/okrs/[id]/page.tsx");
    expect(page).toMatch(/<OkrAudience okrId=\{okr\.id\} canEdit/);
    expect(read("src/app/(dashboard)/okrs/[id]/goal-page-bits.tsx")).toMatch(/window\.dispatchEvent\(new CustomEvent\(GOAL_AUDIENCE_CHANGED, \{ detail: okrId \}\)\);/);
    expect(read("src/components/okrs/okr-audience.tsx")).toMatch(/window\.addEventListener\(GOAL_AUDIENCE_CHANGED, onChanged\);/);
  });
});

describe("review round 2", () => {
  it("asks another person's Members door from their own facts, never the viewer's session", () => {
    const team = read("src/lib/access/object-share/team.ts");
    expect(team.match(/membersDoorFor\(ctx\.organizationId, /g)?.length).toBe(3);
    // opensMembers is only ever the viewer's own door.
    const calls = team.match(/opensMembers\(([^)]*)\)/g) ?? [];
    expect(calls.filter((c) => c !== "opensMembers(ctx.session)" && c !== "opensMembers(session: ObjectShareCtx[\"session\"])")).toEqual([]);
  });

  it("shows who holds a tool share only to the people who manage it", () => {
    const tool = read("src/lib/access/object-share/tool.ts");
    // The maker by id too (a demoted maker may hold a share), and never their role history.
    expect(tool).toMatch(/if \(!canManage\) \{\n\s+shown = direct\.filter\(\(d\) => d\.source === "Owner" \|\| d\.person\.id === ctx\.userId \|\| d\.person\.id === tool\.addedBy\);/);
    expect(tool).toMatch(/d\.person\.id === tool\.addedBy && d\.person\.id !== ctx\.userId && d\.note \? \{ \.\.\.d, note: "Added this tool\." \} : d/);
    expect(tool).toMatch(/direct: shown,/);
  });

  it("offers a request's grant only while the object's app is open to the decider", () => {
    const list = read("src/app/api/access-requests/route.ts");
    expect(list).toMatch(/grantable: node !== null \|\| \(objectKind !== null && !appOff && !cannotGrant && !roleBlocked\),/);
    expect(read("src/components/settings/access-requests-card.tsx")).toMatch(/\) : req\.appOff \? \(/);
  });
});

describe("review round 3", () => {
  it("probes the decider's Tools door without logging a denial", () => {
    const index = read("src/lib/access/object-share/index.ts");
    const probe = index.slice(index.indexOf("export async function objectAppOpen"));
    expect(probe).toMatch(/\(await can\(viewer, "view", \{ type: "app", key: "tools" \}\)\)\.allowed/);
    expect(probe.slice(0, probe.indexOf("\n}\n"))).not.toMatch(/requireApp/);
  });

  it("asks the described person's own app door in rows, Check access and notices", () => {
    const tool = read("src/lib/access/object-share/tool.ts");
    expect(tool).toMatch(/const door = await appDoorFor\(ctx\.organizationId, userId, "tool"\);\n\s+if \(door !== "open"\) return \{ userId, name, role: "none", sentence: DOOR_SENTENCE\.tool\[door\] \};/);
    expect(tool).toMatch(/if \(out\.how !== "none" && panel && \(await appOpenFor\(ctx\.organizationId, body\.userId, "tool"\)\)\) \{/);
    expect(tool).toMatch(/const closedTo = async \(userId: string\) => limited && \(await appDoorFor\(ctx\.organizationId, userId, "tool"\)\) === "closed";/);
    const goal = read("src/lib/access/object-share/goal.ts");
    expect(goal).toMatch(/const door = await appDoorFor\(ctx\.organizationId, userId, "goal"\);\n\s+if \(door !== "open"\) return \{ userId, name: f\.name, role: "none", sentence: DOOR_SENTENCE\.goal\[door\] \};/);
    expect(goal).toMatch(/if \(panel && \(await appOpenFor\(ctx\.organizationId, body\.userId, "goal"\)\)\) await notifyObjectGrantee/);
  });

  it("tells an Agent the role it works at, and never of a raise that changes nothing for it", () => {
    for (const name of ["tool", "sop-folder"]) {
      const src = read(`src/lib/access/object-share/${name}.ts`);
      expect(src).toMatch(/const works = \(r: PanelRole \| null\) => \(r && target\.accessLevel === "AGENT" && r === "FULL" \? "EDIT" : r\);/);
      expect(src).toMatch(/"worksAt" in out \? out\.worksAt : role/);
    }
  });

  it("shows an Owner's or Admin's reach on an SOP folder for every Admin row, and after a removal", () => {
    const sop = read("src/lib/access/object-share/sop-folder.ts");
    expect(sop).toMatch(/if \(\(self && ctx\.orgAdmin\) \|\| \(active && ADMIN_LEVELS\.has\(String\(r\.user\.accessLevel\)\)\)\) alsoVia = \{ role: "FULL", via: \{ type: "org_admin"/);
    expect(sop).toMatch(/const stillReaches = "admin" in out && out\.admin\n\s+\? \{ role: "FULL" as PanelRole, via: \{ type: "org_admin" as const/);
  });

  it("offers only the request answers that give more than the person holds", () => {
    const list = read("src/app/api/access-requests/route.ts");
    expect(list).toMatch(/grants = objectRequestGrants\(objectKind, r\.role as RequestRole\)\.filter\(\(g\) => PANEL_ROLE_RANK\[objectGrantRole\(objectKind, g\.role\)\] > heldRank\);\n\s+if \(grants\.length === 0\) continue;/);
  });
});

describe("review round 4", () => {
  it("says what a removed person keeps only while their app lets them in", () => {
    const tool = read("src/lib/access/object-share/tool.ts");
    expect(tool).toMatch(/const keeps = out\.still && \(await appDoorFor\(ctx\.organizationId, input\.userId, "tool"\)\) === "open";/);
    const goal = read("src/lib/access/object-share/goal.ts");
    expect(goal).toMatch(/const stillReaches = reach && \(await appOpenFor\(ctx\.organizationId, input\.userId, "goal"\)\) \? reach : null;/);
  });

  it("qualifies a goal's rules when the Goals app is limited, and its creator note by their door", () => {
    const goal = read("src/lib/access/object-share/goal.ts");
    expect(goal).toMatch(/if \(limited\) notes\.push\("The Goals app is limited in Settings, Apps, so anyone it keeps out can't open this goal, whatever the lines above say\."\);/);
    expect(goal).toMatch(/if \(creator && !\(await closedTo\(creator\.id\)\) && \(await canSeeGoal\(/);
  });

  it("offers a request's grant only to a decider who may share the object", () => {
    const list = read("src/app/api/access-requests/route.ts");
    expect(list).toMatch(/const cannotGrant = objectKind && !appOff \? !\(await shares\(objectKind, r\.objectId\)\) : false;/);
    expect(list).toMatch(/grantable: node !== null \|\| \(objectKind !== null && !appOff && !cannotGrant && !roleBlocked\),/);
    expect(read("src/components/settings/access-requests-card.tsx")).toMatch(/\) : req\.cannotGrant \? \(/);
  });

  it("gives a team lead no one-word role menu, and an Agent's removal toast its working role", () => {
    expect(read("src/lib/access/object-share/team.ts")).toMatch(/editable: withinGrant && maxGrant === "FULL",/);
    expect(read("src/lib/access/object-share/sop-folder.ts")).toMatch(/out\.agent && out\.above\.role === "FULL" \? "EDIT" : out\.above\.role/);
  });
});

describe("review round 5", () => {
  for (const [name, table] of [["team", "TeamMember"], ["goal", "GoalAssignee"], ["sop-folder", "SOPFolderAccess"], ["tool", "ToolShare"]] as const) {
    it(`${name}: reads the person's own row under a lock before judging and writing it`, () => {
      const src = read(`src/lib/access/object-share/${name}.ts`);
      const locks = src.match(new RegExp(`FROM "${table}" WHERE [^\`]+ FOR UPDATE\``, "g")) ?? [];
      expect(locks.length).toBeGreaterThanOrEqual(2);
    });
  }

  it("shows an SOP folder's other people only to those who manage it", () => {
    const sop = read("src/lib/access/object-share/sop-folder.ts");
    expect(sop).toMatch(/if \(!canManage\) \{\n\s+shownDirect = direct\.filter\(\(d\) => d\.person\.id === ctx\.userId\);\n\s+shownInherited = inherited\.filter\(\(e\) => e\.person\.id === ctx\.userId\);\n\s+shownMore = \[\];/);
    expect(sop).toMatch(/direct: shownDirect,\n\s+inherited: shownInherited,\n\s+inheritedMore: shownMore,/);
  });

  it("credits a deactivated account with nothing", () => {
    const sop = read("src/lib/access/object-share/sop-folder.ts");
    expect(sop).toMatch(/if \(RULE_1_DENIED_STATUSES\.has\(String\(person\.status\)\)\) return \{ userId, name, role: "none", sentence: "No access\. Their account is deactivated\." \};/);
    expect(sop).toMatch(/above: active \? roleFrom\(rest, chain, 1, input\.userId\) : null,/);
    expect(read("src/lib/access/object-share/team.ts")).toMatch(/Their account is deactivated, so they change nothing\./);
    expect(read("src/lib/access/object-share/goal.ts")).toMatch(/const creator = found && personOf\(found\)\.active \? found : null;/);
    expect(read("src/lib/access/object-share/tool.ts")).toMatch(/if \(!closed && entry\.person\.active && canManageTool\(/);
  });

  it("leaves an answered request off the card whoever decides, and refreshes the SOP page's role", () => {
    const list = read("src/app/api/access-requests/route.ts");
    expect(list.indexOf("const held = await objectHeldRole(")).toBeLessThan(list.indexOf("const appOff = objectKind ?"));
    expect(read("src/components/sops/sop-share-dialog.tsx")).toMatch(/onChanged=\{\(\) => onFolderChanged\?\.\(\)\}/);
    expect(read("src/components/sops/sop-editor-page.tsx")).toMatch(/onFolderChanged=\{\(\) => void refreshAccess\(\)\}/);
  });
});

describe("review round 6", () => {
  it("counts the direct rows a non-manager is not shown, and finds their own row past any cut", () => {
    const sop = read("src/lib/access/object-share/sop-folder.ts");
    expect(sop).toMatch(/if \(shownInherited\.length === 0\) shownInherited = \[\.\.\.groups\.values\(\)\]\.flat\(\)\.filter\(\(e\) => e\.person\.id === ctx\.userId\);/);
    expect(sop).toMatch(/hiddenDirect = direct\.length - shownDirect\.length;/);
    expect(sop).toMatch(/\.\.\.\(hiddenDirect > 0 \? \{ hiddenDirect \} : \{\}\),/);
    const list = read("src/components/access/who-has-access.tsx");
    expect(list).toMatch(/return hiddenLine \?\? <p className="m-0 text-sm text-ink-2">Nobody has been added here directly\.<\/p>;/);
  });
});

describe("review round 7", () => {
  it("tells a checker who may not read member types only what the goal or tool names", () => {
    const goal = read("src/lib/access/object-share/goal.ts");
    expect(goal).toMatch(/if \(!ctx\.orgAdmin && !isOrgWideAlignment\(ctx\.session\)\) \{\n\s+const named = goal\.ownerId === userId \? "owner" : f\.ownRow \? "row" : f\.group \? "group" : null;/);
    const tool = read("src/lib/access/object-share/tool.ts");
    expect(tool).toMatch(/if \(!ctx\.orgAdmin && !TOOL_ADMIN_LEVELS\.has\(ctx\.accessLevel\) && userId !== tool\.addedBy && share === null\) \{/);
  });

  it("caveats a kept Can edit on an SOP folder, and lists a request no share can answer", () => {
    const sop = read("src/lib/access/object-share/sop-folder.ts");
    expect(sop).toMatch(/stillReaches\.via = \{ type: "rule", text: `\$\{place\}, though their workspace role can't save SOPs` \};/);
    expect(sop).toMatch(/export async function sopFolderEditBlocked\(/);
    const list = read("src/app/api/access-requests/route.ts");
    expect(list).toMatch(/if \(objectKind && !roleBlocked\) \{/);
    expect(list).toMatch(/if \(appOff \|\| cannotGrant \|\| roleBlocked\) grants = undefined;/);
    expect(read("src/components/settings/access-requests-card.tsx")).toMatch(/\{req\.roleBlocked \? \(/);
  });
});

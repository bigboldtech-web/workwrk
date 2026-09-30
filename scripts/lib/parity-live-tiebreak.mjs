// The live tie-break for the legacy section of scripts/access-parity-job.mjs
// (Phase 8 stage E).
//
// The legacy section compares the engine against the Phase 0 transcription
// (parity.ts), which was "today's answer" when it was written. Since the one
// node-access resolver shipped (88e0f3a7), 23 of the 24 helpers no longer run
// the transcription: they answer through node-access (space.ts, board.ts,
// folder.ts, doc-access.ts, access.ts) or item-gate. So for an unexpected
// mismatch on one of those helpers, the question that matters is whether the
// engine disagrees with what the helper ANSWERS TODAY. This module calls the
// real helper, with the step-1 delegation forced off so it is the live
// resolver and never the engine, and reports:
//
//   superseded   the live helper agrees with the engine; the transcription is
//                stale history (node-parity.ts TRANSCRIPTION_SUPERSEDED)
//   unexpected   the live helper disagrees with the engine: a real difference
//
// folderVisibleTo still runs the transcription and is never tie-broken.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function tieBreak({ root, cases, unexpected }) {
  const imp = (p) => import(pathToFileURL(join(root, p)).href);
  const [space, board, folder, docAccess, access, itemGate] = await Promise.all([
    imp("src/lib/space.ts"),
    imp("src/lib/board.ts"),
    imp("src/lib/folder.ts"),
    imp("src/lib/doc-access.ts"),
    imp("src/lib/access.ts"),
    imp("src/lib/item-gate.ts"),
  ]);
  const saved = process.env.ACCESS_V2_RESOLVER;
  process.env.ACCESS_V2_RESOLVER = "false";
  const superseded = [];
  const still = [];
  try {
    for (const m of unexpected) {
      const c = cases.find((x) => x.id === m.caseId);
      if (!c) {
        still.push(m);
        continue;
      }
      const [, objectId] = c.id.split(":");
      const u = c.input.userId;
      const lvl = c.input.accessLevel ?? undefined;
      const ctx = { userId: u, organizationId: c.input.organizationId, accessLevel: lvl };
      let live;
      switch (c.helper) {
        case "getSpaceForReader":
          live = { kind: "boolean", value: !!(await space.getSpaceForReader(objectId, u, lvl)) };
          break;
        case "canEditSpace":
        case "canEditSpace@create_child":
          live = { kind: "boolean", value: await space.canEditSpace(objectId, u, lvl) };
          break;
        case "canContributeSpace":
          live = { kind: "boolean", value: await space.canContributeSpace(objectId, u, lvl) };
          break;
        case "getBoardForReader":
          live = { kind: "boolean", value: !!(await board.getBoardForReader(objectId, u, lvl)) };
          break;
        case "canReadBoard":
          live = { kind: "boolean", value: await board.canReadBoard(objectId, u, lvl) };
          break;
        case "canEditBoard":
          live = { kind: "boolean", value: await board.canEditBoard(objectId, u, lvl) };
          break;
        case "canContributeBoard":
          live = { kind: "boolean", value: await board.canContributeBoard(objectId, u, lvl) };
          break;
        case "folderReadable":
          live = { kind: "boolean", value: await folder.folderReadable(objectId, u, lvl) };
          break;
        case "docAccessible":
          live = { kind: "boolean", value: await docAccess.docAccessible({ id: objectId }, u, lvl) };
          break;
        case "resolveSpace":
        case "resolveFolder":
        case "resolveBoard":
        case "resolveDoc":
        case "resolveItem": {
          const type = { resolveSpace: "space", resolveFolder: "folder", resolveBoard: "board", resolveDoc: "doc", resolveItem: "item" }[c.helper];
          const d = await access.resolveAccess(ctx, { type, id: objectId });
          live = { kind: "permission", value: d.permission };
          break;
        }
        case "itemRead":
        case "itemWrite": {
          const g = await itemGate.gateItem(objectId, { ...ctx, accessLevel: lvl ?? "EMPLOYEE", userName: null }, c.helper === "itemRead" ? "view" : "edit");
          live = { kind: "boolean", value: !("error" in g) };
          break;
        }
        default:
          live = null;
      }
      if (live && live.kind === m.engine.kind && live.value === m.engine.value) superseded.push({ ...m, live });
      else still.push({ ...m, live });
    }
  } finally {
    if (saved === undefined) delete process.env.ACCESS_V2_RESOLVER;
    else process.env.ACCESS_V2_RESOLVER = saved;
  }
  return { superseded, still };
}

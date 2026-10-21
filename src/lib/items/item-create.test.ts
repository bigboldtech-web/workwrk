// POST /api/boards/[id]/items as a function of who is acting
// (docs/plans/mcp-server.md step 3 test "the extractions: answers equal the
// routes'"). The route reads the session and the body and hands both to
// createItemAs, the body moved verbatim: for the same caller and body the
// two answer the same, status and body, and hand the writer, the Inbox
// notice and the automation event the same things. Fails on the code before
// step 3: there was no createItemAs.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as unknown,
  readable: true,
  contribute: true,
  unknown: [] as string[],
  created: [] as unknown[],
  notices: [] as unknown[],
  events: [] as unknown[],
  failWrite: false,
}));

vi.mock("next-auth", () => ({ getServerSession: async () => h.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { board: { findUnique: async () => ({ schema: { fields: [] } }) }, item: { findFirst: async () => null } } }));
vi.mock("@/lib/board", () => ({
  getBoardForReader: async (id: string) => (h.readable ? { id, organizationId: "org" } : null),
  canContributeBoard: async () => h.contribute,
  canReadBoard: async () => true,
}));
vi.mock("@/lib/board-items", async () => ({
  PRIORITY_OPTIONS: (await import("@/lib/board-items-shared")).PRIORITY_OPTIONS,
  createBoardItem: async (input: Record<string, unknown>, opts: Record<string, unknown>) => {
    h.created.push({ input, opts: { ...opts, listDefaults: { sentKeys: [...((opts.listDefaults as { sentKeys: Set<string> }).sentKeys)], sentMetadataKeys: [...((opts.listDefaults as { sentMetadataKeys: Set<string> }).sentMetadataKeys)] } } });
    if (h.failWrite) throw new Error("That task could not be saved.");
    return { id: "it-1", title: input.title, boardId: input.boardId, status: "TO_DO", ownerId: (input.assigneeIds as string[] | undefined)?.[0] ?? null, priority: null, dueAt: null, createdAt: new Date(0) };
  },
  getBoardItemRow: async (id: string) => ({ id, enriched: true }),
  listBoardItems: async () => [],
}));
vi.mock("@/lib/notify-item", () => ({ notifyItemAssigned: async (a: unknown) => void h.notices.push(a) }));
vi.mock("@/services/webhookDispatcher", () => ({ dispatchEvent: async (e: unknown) => void h.events.push(e) }));
vi.mock("@/lib/assignable", () => ({ unknownUserIds: async (ids: string[]) => ids.filter((i) => h.unknown.includes(i)) }));
vi.mock("@/lib/list-connect-server", () => ({ validateConnectWrites: async () => ({ ok: true, values: {}, keys: [] }) }));
vi.mock("@/lib/list-links-server", () => ({ linkedListsOf: async () => ({ links: [] }) }));

import { POST } from "@/app/api/boards/[id]/items/route";
import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { createItemAs } from "./item-create";

const C = { userId: "u-max", ...legacyLevelRow("EMPLOYEE"), organizationId: "org" };

async function viaRoute(body: unknown) {
  const req = new Request("https://app.workwrk.com/api/boards/b1/items", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  return read(await POST(req, { params: Promise.resolve({ id: "b1" }) }));
}
async function viaFunction(body: unknown) {
  return read(await createItemAs(C, "b1", typeof body === "string" ? null : body));
}
async function read(res: Response | undefined) {
  if (!res) throw new Error("no answer");
  return { status: res.status, body: await res.json() };
}

/** The route's and the function's answers, and what each handed the writer, the notice and the event. */
async function both(body: unknown) {
  const out = [];
  for (const run of [viaRoute, viaFunction]) {
    h.created = [];
    h.notices = [];
    h.events = [];
    out.push({ answer: await run(body), created: h.created, notices: h.notices, events: h.events });
  }
  return out;
}

beforeEach(() => {
  h.session = { user: { id: "u-max", ...legacyLevelRow("EMPLOYEE"), organizationId: "org" } };
  h.readable = true;
  h.contribute = true;
  h.unknown = [];
  h.failWrite = false;
});

describe("createItemAs answers as the route does", () => {
  it("for a task made with the List's defaults, a task for someone, and a subtask", async () => {
    for (const body of [{ title: "Ship it" }, { title: "For Olivia", assigneeIds: ["u-olivia"], dueAt: "2026-10-23T00:00:00.000Z", priority: "HIGH" }, { title: "Part", parentItemId: "t1", metadata: { description: "x" } }]) {
      const [route, fn] = await both(body);
      expect(route.answer.status, JSON.stringify(body)).toBe(201);
      expect(fn).toEqual(route);
    }
  });

  it("for every refusal: no List, no right to add, a bad body, a reserved key, an unknown person, a failed write", async () => {
    const cases: Array<[() => void, unknown, number]> = [
      [() => (h.readable = false), { title: "x" }, 404],
      [() => (h.contribute = false), { title: "x" }, 403],
      [() => undefined, { title: "" }, 400],
      [() => undefined, "not json", 400],
      [() => undefined, { title: "x", metadata: { $hidden: 1 } }, 400],
      [() => (h.unknown = ["ghost"]), { title: "x", assigneeIds: ["ghost"] }, 400],
      [() => (h.failWrite = true), { title: "x" }, 400],
    ];
    for (const [setUp, body, status] of cases) {
      setUp();
      const [route, fn] = await both(body);
      expect(route.answer.status, JSON.stringify(body)).toBe(status);
      expect(fn.answer, JSON.stringify(body)).toEqual(route.answer);
      h.readable = true;
      h.contribute = true;
      h.unknown = [];
      h.failWrite = false;
    }
  });

  it("guard: the route still answers 401 with no session", async () => {
    h.session = null;
    expect((await viaRoute({ title: "x" })).status).toBe(401);
  });
});

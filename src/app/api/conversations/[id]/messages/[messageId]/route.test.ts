import { beforeEach, describe, expect, it, vi } from "vitest";

// An edit makes a message the person's own words. An AI update (Batch 8)
// already stopped saying "AI update" once edited; a post an AI teammate made
// for the person (kind agent_post) kept its "via {teammate}" label on words
// the person rewrote. Both kinds change in the edit's own transaction, in
// one statement. These run the handler between the mocked gate and the
// mocked database, and read the statement it sends.

const db = {
  findFirst: vi.fn(),
  update: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationMessage: {
      findFirst: (...a: unknown[]) => db.findFirst(...a),
      update: (...a: unknown[]) => db.update(...a),
    },
    $executeRaw: (...a: unknown[]) => db.executeRaw(...a),
    $transaction: (...a: unknown[]) => db.transaction(...a),
  },
}));
vi.mock("@/lib/talk-gate", () => ({
  requireConversation: vi.fn(async () => ({ error: null, ctx: { viewer: { userId: "u1", organizationId: "org1" } } })),
}));
vi.mock("@/lib/api-helpers", async () => {
  const { NextResponse } = await import("next/server");
  return {
    jsonSuccess: (data: unknown, status = 200) => NextResponse.json(data, { status }),
    jsonError: (error: string, status = 400) => NextResponse.json({ error }, { status }),
  };
});

import { NextRequest } from "next/server";
import { PATCH } from "./route";

function edit(body: unknown) {
  return PATCH(
    new NextRequest("http://x/api/conversations/c1/messages/m1", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ id: "c1", messageId: "m1" }) },
  );
}

/** The tagged-template arguments of the last raw call, as one line of SQL with its values. */
function lastRaw(): { sql: string; values: unknown[] } {
  const [strings, ...values] = db.executeRaw.mock.calls.at(-1) as [TemplateStringsArray, ...unknown[]];
  return { sql: strings.join("?").replace(/\s+/g, " ").trim(), values };
}

beforeEach(() => {
  for (const f of Object.values(db)) f.mockReset();
  db.findFirst.mockResolvedValue({ id: "m1", deletedAt: null, parentId: null });
  db.executeRaw.mockReturnValue("kind-statement");
  db.update.mockReturnValue("edit-statement");
  db.transaction.mockResolvedValue([1, { id: "m1", body: "My own words", metadata: { kind: "agent_post_edited" }, author: { id: "u1", firstName: "Max", lastName: "Chen", avatar: null } }]);
});

describe("PATCH /api/conversations/[id]/messages/[messageId]", () => {
  it("makes an edited AI teammate's post the person's own, as it does an AI update", async () => {
    const res = await edit({ body: "My own words" });
    expect(res.status).toBe(200);
    const { sql, values } = lastRaw();
    expect(sql).toBe(
      `UPDATE "ConversationMessage" SET "metadata" = jsonb_set("metadata", '{kind}', CASE "metadata" ->> 'kind' WHEN 'ai_update' THEN '"ai_update_edited"'::jsonb ELSE '"agent_post_edited"'::jsonb END) WHERE "id" = ? AND "metadata" ->> 'kind' IN ('ai_update', 'agent_post')`,
    );
    expect(values).toEqual(["m1"]);
  });
  it("changes the kind in the edit's own transaction, before the words", async () => {
    await edit({ body: "My own words" });
    expect(db.transaction).toHaveBeenCalledWith(["kind-statement", "edit-statement"]);
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "m1" }, data: expect.objectContaining({ body: "My own words" }) }));
  });
  it("changes nothing for an edit it refuses", async () => {
    expect((await edit({ body: "   " })).status).toBe(400);
    db.findFirst.mockResolvedValue(null);
    expect((await edit({ body: "My own words" })).status).toBe(404);
    expect(db.executeRaw).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

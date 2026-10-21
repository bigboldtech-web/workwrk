// The world the write-tool suites share, and one tools/call through the
// registry (runTool), for the vitest suites (never imported by the app).
// The mocks themselves are write-test-world.ts's; each suite declares them.

import { legacyLevelRow } from "@/lib/access/test-fixtures";
import { seed, seedWorld, testDb as db, useMcpEnv as offerMcp } from "@/lib/oauth/oauth-test-db";
import { hashSecret } from "@/lib/oauth/tokens";
import type { McpContext } from "./auth";
import { resetDedupe } from "./dedupe";
import { resetWriteBursts } from "./limits";
import { runTool, type RequestMeta } from "./registry";
import { grant, resetWorld } from "./write-test-world";

export const NOW = new Date("2026-10-21T12:00:00Z");
export const APP = "an app on this computer";

export const MAX = { userId: "u-max", organizationId: "org-a", ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", name: "Max Member", firstName: "Max", email: "max@acme.test", timezone: "Europe/Berlin" };
export const OLIVIA = { userId: "u-olivia", organizationId: "org-a", ...legacyLevelRow("EMPLOYEE"), orgRole: "MEMBER", name: "Olivia Owner", firstName: "Olivia", email: "olivia@acme.test", timezone: "UTC" };

export type Person = typeof MAX;

export function ctxFor(p: Person, scopes: Array<"mcp:read" | "mcp:write"> = ["mcp:read", "mcp:write"]): McpContext {
  return {
    grant: {
      id: `gr-${p.userId}`, clientId: "wkc_x", organizationId: p.organizationId, userId: p.userId, appName: APP, redirectHost: "localhost",
      familyId: "f", tokenVersion: 3, authorizedAt: new Date(NOW.getTime() - 3_600_000), endsBy: new Date(NOW.getTime() + 86_400_000), revokedAt: null,
      scopes, lastUsedAt: null,
    },
    client: { id: "wkc_x", name: "", disabledAt: null },
    person: p as unknown as McpContext["person"],
    blocked: null,
    scopes,
  };
}

export type Result = { content: Array<{ text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

/** One tools/call as Max (or `as`), at NOW (or `at`). */
export async function call(name: string, args: Record<string, unknown> = {}, o: { as?: Person; at?: Date; scopes?: Array<"mcp:read" | "mcp:write">; meta?: RequestMeta } = {}): Promise<Result> {
  return (await runTool(ctxFor(o.as ?? MAX, o.scopes), "2025-06-18", name, args, o.at ?? NOW, o.meta ?? {})) as Result;
}

export const data = (r: Result) => {
  if (r.isError) throw new Error(`expected data, got: ${r.content[0].text}`);
  return r.structuredContent as Record<string, unknown>;
};

/** A refusal's words, from its data block. */
export function reason(r: Result): string {
  if (!r.isError) throw new Error("expected a refusal");
  const parts = r.content[0].text.split("\n\n");
  if (parts.length < 2) return parts[0];
  return JSON.parse(parts[1].replace(/^<workwrk_data>|<\/workwrk_data>$/g, "")).reason as string;
}

/**
 * Acme as every write suite starts it: Max can edit the Launch List and the
 * Proof Space and can only view Viewing; Secret is not his; both people have
 * a Personal list; the workspace has the tag "urgent"; the task t1 on Launch
 * holds a description; Olivia has a note.
 */
export function seedWriteWorld(): void {
  offerMcp();
  seedWorld(db, hashSecret);
  resetWorld();
  resetDedupe();
  resetWriteBursts();
  seed(db, "user", { id: "u-olivia", email: "olivia@acme.test", firstName: "Olivia", lastName: "Owner", organizationId: "org-a", ...legacyLevelRow("EMPLOYEE") });
  seed(db, "space", { id: "s-proof", organizationId: "org-a", name: "Proof Space", slug: "proof-space", archivedAt: null });
  const board = (row: Record<string, unknown>) =>
    seed(db, "board", { spaceId: null, folderId: null, productSlug: null, ownerId: null, itemType: "studio-item", settings: {}, statuses: null, schema: { fields: [] }, archivedAt: null, organizationId: "org-a", ...row });
  board({ id: "b-launch", name: "Launch", slug: "launch", spaceId: "s-proof" });
  board({ id: "b-view", name: "Viewing", slug: "viewing", spaceId: "s-proof" });
  board({ id: "b-secret", name: "Secret", slug: "secret", spaceId: "s-proof" });
  board({ id: "b-pmax", name: "Personal list", slug: "personal-u-max", productSlug: "personal-list", ownerId: "u-max" });
  board({ id: "b-poli", name: "Personal list", slug: "personal-u-olivia", productSlug: "personal-list", ownerId: "u-olivia" });
  grant("u-max", "list:b-launch", "EDIT");
  grant("u-max", "list:b-view", "VIEW");
  grant("u-max", "list:b-pmax", "FULL");
  grant("u-max", "space:s-proof", "EDIT");
  grant("u-olivia", "list:b-poli", "FULL");
  grant("u-olivia", "list:b-launch", "EDIT");
  seed(db, "tag", { id: "tag-urgent", organizationId: "org-a", name: "urgent", type: "CUSTOM", archived: false });
  seed(db, "tag", { id: "tag-old", organizationId: "org-a", name: "old", type: "CUSTOM", archived: true });
  const item = (row: Record<string, unknown>) =>
    seed(db, "item", { organizationId: "org-a", itemType: "studio-item", status: "TO_DO", priority: null, dueAt: null, startAt: null, ownerId: null, assigneeIds: [], parentItemId: null, archivedAt: null, metadata: {}, createdAt: NOW, updatedAt: NOW, ...row });
  item({ id: "t1", boardId: "b-launch", title: "Ship it", metadata: { description: "The plan." } });
  item({ id: "t-mine", boardId: "b-pmax", title: "My own", ownerId: "u-max", assigneeIds: ["u-max"] });
  item({ id: "t-meet", boardId: "b-launch", title: "A meeting", itemType: "meeting" });
  seed(db, "doc", { id: "d-root", organizationId: "org-a", title: "Handbook", entityType: null, entityId: null, parentId: null, archivedAt: null, content: { blocks: [] }, updatedAt: NOW, version: 1 });
  grant("u-max", "doc:d-root", "EDIT");
  seed(db, "doc", { id: "n-oli", organizationId: "org-a", title: "Olivia's note", entityType: "NOTEPAD", entityId: "u-olivia", parentId: null, archivedAt: null, content: { blocks: [] }, updatedAt: NOW });
}

/** Every activity row written so far. */
export function activityRows(): Array<Record<string, unknown>> {
  return db.rows.itemActivity ?? [];
}

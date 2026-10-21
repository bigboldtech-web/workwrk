// "Via <app> (MCP)": which connected AI app a change came through
// (docs/plans/mcp-server.md Decision 14, section 7).
//
// Every MCP tool call runs inside runAsMcp (registry.ts), an
// AsyncLocalStorage context that carries the connection's app label. The
// task activity writers (item-thread.ts, the only place an ItemActivity row
// is written) read it through mcpVia() and stamp the row's meta with
// { via: { kind: "mcp", app } }, so the Activity tab can say
// "Max Member changed the status ... via Claude (MCP)"
// (item-activity-describe.ts).
//
// The words are read back by viaAppOf (item-activity-describe.ts, pure, as
// the Activity tab is a client component).
//
// THE CONTEXT NEVER REACHES WORK THAT IS NOT THE CALL'S OWN:
//   - another request: AsyncLocalStorage follows one async chain, so a
//     request served at the same moment, or between two awaits of this one,
//     sees no context;
//   - an automation the call sets off: dispatchEvent
//     (src/services/webhookDispatcher.ts) starts the automation engine
//     inside exitMcpVia, so an automation's own writes are the
//     automation's, never labelled with the app whose change set it off.
//
// Only the app's label goes on a row (the one the person saw on the consent
// page, frozen as grant.appName): never the grant or client id, since every
// reader of the task reads the row.
//
// Server-only (node:async_hooks).

import { AsyncLocalStorage } from "node:async_hooks";

/** The connection a tool call runs for. */
export interface McpVia {
  /** The label the person consented to ("Claude", "an app on this computer"). */
  app: string;
  clientId: string;
  grantId: string;
}

/** What an activity row carries in meta.via. */
export interface McpViaMeta {
  kind: "mcp";
  app: string;
}

const store = new AsyncLocalStorage<McpVia>();

/** Run one tool call with every activity row it writes marked as through this app. */
export function runAsMcp<T>(via: McpVia, fn: () => Promise<T>): Promise<T> {
  return store.run({ ...via }, fn);
}

/** The connection the running code acts for, or null outside a tool call. */
export function mcpVia(): McpVia | null {
  return store.getStore() ?? null;
}

/** Run `fn`, and everything it starts, outside any tool call's context (the automations dispatchEvent sets off). */
export function exitMcpVia<T>(fn: () => T): T {
  return store.exit(fn);
}

/**
 * An activity row's meta, marked as through the running call's app when
 * there is one. Outside a call it is the very object given (so every
 * existing write is unchanged). A meta that already says how it was made
 * (Fill with AI's via "ai") keeps its own word.
 */
export function stampVia<T extends Record<string, unknown>>(meta: T): T | (T & { via: McpViaMeta }) {
  const via = mcpVia();
  if (!via || meta.via !== undefined) return meta;
  return { ...meta, via: { kind: "mcp", app: via.app } };
}

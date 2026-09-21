// /library: retired. Its four tabs were four other pages under one roof.
//
// A belt-and-braces twin of the `next.config.ts` redirect rows, for the same
// reason as /docs/trash: `redirects()` is read once at server start, so a
// config-only redirect is silently absent on any process that predates the
// edit and cannot be curled until the next restart. This file is in the app's
// module graph, so it answers under hot reload.
//
// It is a route handler and not a page because `permanentRedirect` inside a
// streaming page renders the shell first and emits the redirect as a client
// meta tag: a blank frame, a 200, and no Location header.
//
// THE TAB MAP, and every destination it preserves (spec-docs-knowledge
// section 0). The page listed the same rows as four other pages:
//   ?tab=notes       the same Doc rows as /docs
//   ?tab=whiteboards the same Whiteboard rows as /canvas
//   ?tab=files       the same FileEntry rows as /files
//   ?tab=tables      the same DataTable rows as /tables, and this was the one
//                    copy that never checked the spreadsheets module; /tables
//                    gates it at its own hub layout, so the tab gains the gate
//                    it should always have had.
// Anything else, including no tab at all, lands on /docs.
//
// The `library` catalog KEY is NOT deleted with the page: access
// (access-model-spec section 5.2.1) gates /files on it, so removing the entry
// would remove the gate. Only the page, the sidebar and the rail row go.

import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

const TAB_TARGET: Record<string, string> = {
  notes: "/docs",
  whiteboards: "/canvas",
  files: "/files",
  tables: "/tables",
};

export async function GET(req: Request) {
  const tab = new URL(req.url).searchParams.get("tab") ?? "";
  permanentRedirect(TAB_TARGET[tab.toLowerCase()] ?? "/docs");
}

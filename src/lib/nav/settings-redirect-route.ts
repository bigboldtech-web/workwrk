// The route-handler twin of a settings redirect (settings-architecture 8.4).
//
// next.config.ts carries every row of SETTINGS_REDIRECTS and answers them in
// production before routing. The config is read once at server start, so a
// route handler at the old path is the same rule inside the module graph: it
// takes effect under hot reload and emits a real 308 with a Location header
// before anything paints (the pattern src/app/(dashboard)/tasks/backlog/
// route.ts writes out in full). Both read ONE table, so they cannot disagree.
//
// The query is preserved; a target hash (#modules) stays on the Location.

import { NextResponse, type NextRequest } from "next/server";
import { settingsRedirectFor, settingsRedirectTarget } from "@/lib/settings-registry";

export function settingsRedirectGET(source: string) {
  return function GET(req: NextRequest) {
    const search = req.nextUrl.search;
    const row = settingsRedirectFor(source, search);
    const target = row ? settingsRedirectTarget(row, search) : "/settings";
    return NextResponse.redirect(new URL(target, req.nextUrl.origin), 308);
  };
}

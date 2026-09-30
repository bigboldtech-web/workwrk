// /imports moved into Workspace settings > Data > Import (Phase 8 Stage D):
// a 308 to its new tab, query preserved. Twin of the next.config.ts row; see
// src/lib/nav/settings-redirect-route.ts for why both exist.
import { settingsRedirectGET } from "@/lib/nav/settings-redirect-route";

export const dynamic = "force-dynamic";
export const GET = settingsRedirectGET("/imports");

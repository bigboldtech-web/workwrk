// /settings/defaults moved (settings-architecture 8.4): a 308 to its new page, query
// preserved. Twin of the next.config.ts row; see
// src/lib/nav/settings-redirect-route.ts for why both exist.
import { settingsRedirectGET } from "@/lib/nav/settings-redirect-route";

export const dynamic = "force-dynamic";
export const GET = settingsRedirectGET("/settings/defaults");

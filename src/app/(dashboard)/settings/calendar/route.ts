// /settings/calendar: 308 to /account/connections (Phase 4, spec-planner
// section 0 row 4; settings-architecture 7.1 row 1.16). The stub that lived
// here is gone; the per-person Google Calendar connect and the ICS feed are
// at /account/connections. Twin of the next.config.ts row; see
// src/lib/nav/settings-redirect-route.ts for why both exist.
import { settingsRedirectGET } from "@/lib/nav/settings-redirect-route";

export const dynamic = "force-dynamic";
export const GET = settingsRedirectGET("/settings/calendar");

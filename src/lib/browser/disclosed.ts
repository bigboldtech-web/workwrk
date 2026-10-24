// The one browser provider production may run (docs/plans/browser-host.md
// Decision 14): the one the public pages name.
//
// The privacy page (src/app/(marketing)/privacy/page.tsx, sections 3, 4 and
// 7), the cookie page (src/app/(marketing)/cookies/page.tsx, section 4) and
// Settings, Apps & modules (teammate-copy.ts BROWSER_POLICY_COPY introMore,
// behind the card's Show more, and regionLine, the switch's hint) say AI
// teammates' browsers run on WorkwrK's own servers. In
// production config.ts browserConfig() is null for any other provider, so
// no browser starts where the pages do not say it runs; browserReleaseConfig()
// still releases whatever this deployment's provider is.
//
// src/components/marketing/iconic/iconic.test.ts holds this constant to
// "workwrk" while the pages say "WorkwrK's own". Running Browserbase in
// production is a deliberate change of this constant and of those pages, in
// one commit.
//
// Pure: a constant, safe on the client.

import type { BrowserProviderName } from "./types";

export const DISCLOSED_PRODUCTION_PROVIDER: BrowserProviderName = "workwrk";

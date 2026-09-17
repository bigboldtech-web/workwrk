import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Comms Hub was briefly shipped under /chat before the Room rename —
  // stored notification links and bookmarks keep working.
  async redirects() {
    return [
      { source: "/chat", destination: "/tlk", permanent: false },
      { source: "/chat/:id", destination: "/tlk/:id", permanent: false },
      { source: "/room", destination: "/tlk", permanent: false },
      { source: "/room/:id", destination: "/tlk/:id", permanent: false },
      { source: "/dashboards", destination: "/today", permanent: false },
      { source: "/dashboards/:id", destination: "/today", permanent: false },
      // Whiteboards were renamed to Canvas — keep old links/bookmarks working.
      { source: "/whiteboards", destination: "/canvas", permanent: false },
      { source: "/whiteboards/:id", destination: "/canvas/:id", permanent: false },
      // Settings chassis (docs/plans/ui-refresh/settings-architecture.md 8.4).
      // Only the rows whose target exists today, shows the same content AND
      // admits the same people; the rest land when their target page ships
      // (the registry in src/lib/settings-registry.ts lists every alias).
      // Deliberately NOT here yet: /settings/hierarchy -> /organization. The
      // old page is ungated and renders for every member, while /organization
      // sits behind requireManagerPage() and bounces non-managers to their
      // own profile, so the redirect would change who may open the content.
      // It ships with the access gate step.
      // Bare /account had no page (a 404 inside the takeover).
      { source: "/account", destination: "/account/profile", permanent: true },
    ];
  },
  /* config options here */
};

export default withNextIntl(nextConfig);

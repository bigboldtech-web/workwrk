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
    ];
  },
  /* config options here */
};

export default withNextIntl(nextConfig);

// The rewrite target src/proxy.ts uses for an unknown path on the marketing
// host under the hard host split (spec-shell 2.5): it throws notFound() so
// the (marketing) group's not-found.tsx renders inside the marketing layout
// while the browser keeps the path the visitor typed. It is also where the
// proxy sends /admin on a customer host. Nothing links here.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Not found · WorkwrK",
  robots: { index: false, follow: false },
};

export default function MarketingNotFoundRoute() {
  notFound();
}

// White-first marketing shell. The Topbar + Footer wrap every page in
// /(marketing) — individual pages should NOT re-render them or they'll
// show twice. Pages just render their content and the shell does the rest.

import { MarketingTopbar } from "@/components/landing/marketing-topbar";
import { MarketingFooter } from "@/components/landing/marketing-footer";
import { ConsentBanner } from "@/components/layout/consent-banner";
import { ConsentProvider } from "@/components/layout/consent-provider";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white text-slate-900 min-h-screen antialiased selection:bg-violet-200 selection:text-violet-900">
      <MarketingTopbar />
      <main>{children}</main>
      <MarketingFooter />
      <ConsentProvider>
        <ConsentBanner />
      </ConsentProvider>
    </div>
  );
}

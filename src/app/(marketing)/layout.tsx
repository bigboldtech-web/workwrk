import { MarketingTopbar } from "@/components/landing/marketing-topbar";
import { MarketingFooter } from "@/components/landing/marketing-footer";

// White-first marketing shell. The home page (/) is the v2 landing
// which brings its own immersive layout — Topbar and Footer here
// give every other marketing page (pricing, features, etc.) the
// same nav chrome without each page re-implementing it.
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white text-slate-900 min-h-screen antialiased">
      <MarketingTopbar />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}

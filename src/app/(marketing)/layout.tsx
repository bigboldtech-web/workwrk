import { MarketingNav } from "@/components/marketing/nav";
import { MarketingFooter } from "@/components/marketing/footer";
import "./marketing.css";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="marketing-page relative min-h-screen bg-[#0A0A0F] font-[family-name:var(--font-outfit)]">
      <MarketingNav />
      <main className="relative z-[1]">{children}</main>
      <MarketingFooter />
    </div>
  );
}

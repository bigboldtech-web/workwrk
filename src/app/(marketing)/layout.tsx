import { BentoRoot } from "@/components/bento/bento-root";
import { ScrollProgress } from "@/components/bento/scroll-progress";
import { BentoNav } from "@/components/bento/bento-nav";
import { BentoFooter } from "@/components/bento/bento-footer";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <BentoRoot>
      <ScrollProgress />
      <BentoNav />
      <main>{children}</main>
      <BentoFooter />
    </BentoRoot>
  );
}

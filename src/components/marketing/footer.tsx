import Link from "next/link";
import { FadeIn, StaggerContainer, StaggerItem } from "@/components/marketing/motion";

const platformLinks = [
  { href: "/features#people", label: "People Management" },
  { href: "/features#kpi", label: "KRA & KPI Engine" },
  { href: "/features#reviews", label: "Performance Reviews" },
  { href: "/features#sops", label: "SOP Playbook" },
  { href: "/features#tasks", label: "Task Management" },
  { href: "/features#kudos", label: "Recognition & Kudos" },
];

const solutionLinks = [
  { href: "/features#scores", label: "Performance Scoring" },
  { href: "/features#ai", label: "AI Intelligence" },
  { href: "/features#analytics", label: "Analytics & Reports" },
  { href: "/features#integrations", label: "Integrations" },
];

const industryLinks = [
  { href: "/industries", label: "Professional Services" },
  { href: "/industries", label: "Retail & D2C" },
  { href: "/industries", label: "Manufacturing" },
  { href: "/industries", label: "Healthcare" },
  { href: "/industries", label: "IT & SaaS" },
];

const companyLinks = [
  { href: "/about", label: "About" },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
  { href: "/help-center", label: "Documentation" },
];

const legalLinks = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/cookies", label: "Cookie Policy" },
  { href: "/do-not-sell", label: "Do Not Sell or Share My Info" },
];

function FooterColumn({ title, links: items }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h4 className="mb-4 font-[family-name:var(--font-syne)] text-xs font-bold uppercase tracking-widest text-foreground">
        {title}
      </h4>
      <ul className="flex flex-col gap-2.5">
        {items.map((link) => (
          <li key={link.label}>
            <Link
              href={link.href}
              className="text-sm text-muted transition-colors duration-200 hover:text-foreground"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-background" aria-label="Site footer">
      <div className="mx-auto max-w-[1200px] px-6 pb-10 pt-16">
        {/* Grid */}
        <FadeIn>
          <StaggerContainer className="mb-12 grid grid-cols-2 gap-10 md:grid-cols-3 lg:grid-cols-5" stagger={0.08}>
            {/* Brand */}
            <StaggerItem className="col-span-2 md:col-span-3 lg:col-span-1">
              <div className="mb-3 flex flex-col items-center lg:items-center">
                <Link href="/" className="mkt-logo mb-1 inline-block">
                  workwrk<span style={{ opacity: 0.5 }}>.</span>
                </Link>
                <p className="text-[11px] font-medium tracking-wide text-muted" style={{ fontFamily: "var(--font-mono)" }}>great teams aren&apos;t guesswork</p>
              </div>
              <p className="max-w-[260px] text-sm leading-relaxed text-muted">
                The business operating system that unifies people, performance,
                processes, and AI intelligence.
              </p>
            </StaggerItem>

            <StaggerItem>
              <FooterColumn title="Platform" links={platformLinks} />
            </StaggerItem>
            <StaggerItem>
              <FooterColumn title="Solutions" links={solutionLinks} />
            </StaggerItem>
            <StaggerItem>
              <FooterColumn title="Industries" links={industryLinks} />
            </StaggerItem>
            <StaggerItem>
              <FooterColumn title="Company" links={companyLinks} />
            </StaggerItem>
          </StaggerContainer>
        </FadeIn>

        {/* Legal row */}
        <FadeIn delay={0.2}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6">
            {legalLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-xs text-muted transition-colors hover:text-foreground"
              >
                {l.label}
              </Link>
            ))}
            <span className="text-xs text-muted">
              DPO:{" "}
              <a
                href="mailto:dpo@workwrk.com"
                className="underline hover:text-foreground"
              >
                dpo@workwrk.com
              </a>
            </span>
          </div>
        </FadeIn>

        {/* Bottom bar */}
        <FadeIn delay={0.3}>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
            <p className="text-xs text-muted">
              © 2026 WorkwrK. All rights reserved.
            </p>
            <div className="flex gap-6">
              <a href="#" className="text-xs text-muted transition-colors duration-200 hover:text-foreground">
                Twitter
              </a>
              <a href="#" className="text-xs text-muted transition-colors duration-200 hover:text-foreground">
                LinkedIn
              </a>
              <a href="#" className="text-xs text-muted transition-colors duration-200 hover:text-foreground">
                YouTube
              </a>
            </div>
          </div>
        </FadeIn>
      </div>
    </footer>
  );
}

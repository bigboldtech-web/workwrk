import Link from "next/link";

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
];

function FooterColumn({ title, links: items }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h4 className="mb-4 font-[family-name:var(--font-syne)] text-xs font-bold uppercase tracking-widest text-[#E8E8F0]">
        {title}
      </h4>
      <ul className="flex flex-col gap-2.5">
        {items.map((link) => (
          <li key={link.label}>
            <Link
              href={link.href}
              className="text-sm text-[#8888A0] transition-colors hover:text-[#E8E8F0]"
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
    <footer className="border-t border-[#2A2A3A] bg-[#0A0A0F]" aria-label="Site footer">
      <div className="mx-auto max-w-[1200px] px-6 pb-10 pt-16">
        {/* Grid */}
        <div className="mb-12 grid grid-cols-2 gap-10 md:grid-cols-3 lg:grid-cols-5">
          {/* Brand */}
          <div className="col-span-2 md:col-span-3 lg:col-span-1">
            <Link href="/" className="mkt-logo mb-4 inline-block">
              theywrk<span style={{ opacity: 0.5 }}>.</span>
            </Link>
            <p className="max-w-[260px] text-sm leading-relaxed text-[#8888A0]">
              The business operating system that unifies people, performance,
              processes, and AI intelligence.
            </p>
          </div>

          <FooterColumn title="Platform" links={platformLinks} />
          <FooterColumn title="Solutions" links={solutionLinks} />
          <FooterColumn title="Industries" links={industryLinks} />
          <FooterColumn title="Company" links={companyLinks} />
        </div>

        {/* Bottom bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#2A2A3A] pt-6">
          <p className="text-xs text-[#8888A0]">
            © 2026 TheywrK. All rights reserved.
          </p>
          <div className="flex gap-6">
            <a href="#" className="text-xs text-[#8888A0] transition-colors hover:text-[#E8E8F0]">
              Twitter
            </a>
            <a href="#" className="text-xs text-[#8888A0] transition-colors hover:text-[#E8E8F0]">
              LinkedIn
            </a>
            <a href="#" className="text-xs text-[#8888A0] transition-colors hover:text-[#E8E8F0]">
              YouTube
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

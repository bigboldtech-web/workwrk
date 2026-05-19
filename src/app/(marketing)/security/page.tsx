import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Lock, Globe, Database, Key, FileText, ServerCog, Eye } from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H2,
  H3,
  Button,
  CTABand,
  FAQ,
  FeatureCard,
  GradientText,
  HUES,
  type Hue,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Security — WorkwrK",
  description: "SOC 2 Type II, ISO 27001, GDPR + DPDP compliant. SSO + SCIM, audit log, encryption end-to-end, EU/India/US data residency. Built for the security review.",
  alternates: { canonical: "https://workwrk.com/security" },
};

const CERTS: readonly { name: string; hue: Hue }[] = [
  { name: "SOC 2 Type II", hue: "violet"  },
  { name: "ISO 27001",      hue: "emerald" },
  { name: "GDPR",           hue: "sky"     },
  { name: "DPDP (India)",   hue: "amber"   },
  { name: "HIPAA-ready",    hue: "rose"    },
  { name: "PCI-DSS",        hue: "fuchsia" },
];

const PILLARS: readonly { hue: Hue; icon: typeof Lock; title: string; body: string }[] = [
  { hue: "violet",  icon: Lock,       title: "Encryption end-to-end", body: "AES-256 at rest. TLS 1.3 in transit. Customer-managed keys (CMK) on Scale via AWS KMS." },
  { hue: "emerald", icon: Key,        title: "SSO + SCIM",              body: "SAML SSO with Okta, Azure AD, Google, OneLogin, Auth0. SCIM auto-provisioning + deprovisioning." },
  { hue: "amber",   icon: Globe,      title: "Data residency",          body: "EU, India, or US. Pinned at workspace creation; honored for storage, AI, and backups." },
  { hue: "fuchsia", icon: Eye,        title: "Audit log",                body: "Every read, write, export, share — logged with user, time, IP, device. Tamper-evident; exportable to your SIEM." },
  { hue: "sky",     icon: ServerCog,  title: "Infrastructure",           body: "AWS-hosted across 3 regions. Multi-AZ. 99.95% uptime SLA on Scale. Pen-tested annually by Cure53." },
  { hue: "indigo",  icon: ShieldCheck,title: "Bug bounty",               body: "HackerOne private program. Critical findings paid up to $20,000. Public PGP for vuln disclosure." },
];

export default function SecurityPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="rose" className="mb-5">Security</Eyebrow>
            <H1>
              Built for the <br />
              <GradientText hue="rose">security review.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              SOC 2 Type II + ISO 27001 + GDPR + DPDP. Encryption end-to-end.
              SSO + SCIM. Audit log on everything. Pen-tested annually. Designed
              to pass your CISO&apos;s review on the first pass.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="mailto:security@workwrk.com" variant="secondary" hue="rose" size="lg" rightIcon={<ArrowRight size={15} />}>
                Request SOC 2 report
              </Button>
              <Button href="https://trust.workwrk.com" variant="outline" size="lg">View trust portal</Button>
            </div>
          </div>

          <div className="mt-12 grid grid-cols-3 lg:grid-cols-6 gap-3">
            {CERTS.map((c) => {
              const t = HUES[c.hue];
              return (
                <div key={c.name} className={`p-4 rounded-xl border ${t.border} ${t.bgTint} text-center`}>
                  <ShieldCheck size={20} className={`mx-auto ${t.text}`} />
                  <p className={`mt-2 text-xs font-bold ${t.textStrong}`}>{c.name}</p>
                </div>
              );
            })}
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue="violet" className="mb-4">Six pillars</Eyebrow>
            <H2>How we keep <GradientText hue="violet">your data safe</GradientText>.</H2>
          </div>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {PILLARS.map((p) => (
              <FeatureCard key={p.title} hue={p.hue} icon={p.icon} title={p.title} body={p.body} />
            ))}
          </div>
        </Container>
      </Section>

      <Section variant="tint" py="lg">
        <Container>
          <div className="grid lg:grid-cols-[1fr_1.4fr] gap-12 items-start">
            <div>
              <Eyebrow hue="emerald" className="mb-4">Vulnerability disclosure</Eyebrow>
              <H2>Found a bug?</H2>
              <p className="mt-5 text-slate-600 text-lg leading-relaxed">
                We run a private HackerOne program. Critical findings paid up to $20,000.
                Public PGP key for direct reports. Acknowledged within 24h, triaged within 72h.
              </p>
              <div className="mt-7 space-y-2 text-sm">
                <p><span className="font-bold text-slate-900">Email:</span> <Link href="mailto:security@workwrk.com" className="text-emerald-700 underline underline-offset-2">security@workwrk.com</Link></p>
                <p><span className="font-bold text-slate-900">PGP key:</span> <Link href="/security.asc" className="text-emerald-700 underline underline-offset-2">/security.asc</Link></p>
                <p><span className="font-bold text-slate-900">HackerOne:</span> Private program (invite via email)</p>
              </div>
            </div>
            <div className="p-7 bg-white border border-slate-200 rounded-2xl">
              <H3>Bounty tiers</H3>
              <ul className="mt-5 divide-y divide-slate-100">
                {[
                  ["Critical", "$10,000 – $20,000", "RCE, auth bypass, mass data exposure"],
                  ["High",     "$3,000 – $7,500",    "Privilege escalation, IDOR, stored XSS"],
                  ["Medium",   "$750 – $2,500",      "Reflected XSS, CSRF on sensitive actions"],
                  ["Low",      "$150 – $500",         "Self-XSS, minor leaks, edge config issues"],
                ].map(([sev, amt, eg]) => (
                  <li key={sev} className="py-4 grid grid-cols-3 gap-3 items-center">
                    <p className="text-sm font-bold text-slate-900">{sev}</p>
                    <p className="text-sm text-emerald-700 font-bold">{amt}</p>
                    <p className="text-xs text-slate-500">{eg}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </Section>

      <FAQ
        hue="rose"
        eyebrow="Security FAQ"
        title="Common security questions."
        items={[
          { q: "Can I sign a BAA / DPA / MSA?",         a: "Yes — Standard DPA available on Growth+. HIPAA BAA, custom MSAs, and SOC 2 ToA available on Scale. Request via security@workwrk.com." },
          { q: "How long do you retain customer data?", a: "Live for the contract duration. 30 days after termination unless you request earlier deletion. Backups retained 90 days then purged." },
          { q: "Sub-processors?",                        a: "AWS (infra), Stripe (billing), Sentry (errors), Datadog (monitoring), Anthropic (AI). Full list and DPAs at /security/subprocessors. 30-day notice for additions." },
          { q: "Can I run workwrk in my own AWS / GCP?",  a: "Yes — VPC deployment available on Scale ($50k+/yr add-on). Fully isolated from our multi-tenant infra; you control keys, network, and access." },
          { q: "Penetration testing?",                    a: "Annual pen tests by Cure53. Letter of attestation available; full report on Scale with NDA." },
          { q: "Incident response?",                       a: "PagerDuty-rotated 24/7. SLA: critical breach notification within 4 hours to all affected customers. Public post-mortems within 30 days." },
        ]}
      />

      <CTABand
        hue="rose"
        title={<>Bringing workwrk through <GradientText hue="indigo">security review</GradientText>?</>}
        body="Ask for our SOC 2 report, ISO 27001 cert, and DPA template — usually one email."
        primary={{ label: "Email security@workwrk.com", href: "mailto:security@workwrk.com" }}
        secondary={{ label: "Trust portal",             href: "https://trust.workwrk.com" }}
      />
    </>
  );
}

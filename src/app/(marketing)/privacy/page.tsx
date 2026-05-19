import type { Metadata } from "next";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  GradientText,
  CTABand,
} from "@/components/marketing/primitives";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — WorkwrK",
  description: "How WorkwrK collects, uses, and protects your information. GDPR + DPDP + CCPA compliant. Plain English where possible; legal precision where required.",
  alternates: { canonical: "https://workwrk.com/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="violet" className="mb-5">Privacy</Eyebrow>
            <H1>Privacy Policy.</H1>
            <p className="mt-5 text-base text-slate-600">
              Last updated: <span className="font-semibold text-slate-900">May 18, 2026</span>
            </p>
            <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-2xl">
              Plain English where possible. Legal precision where required. We&apos;ll
              tell you exactly what we collect, why we collect it, and what you can do about it.
            </p>
          </div>
        </Container>
      </Section>

      <LegalPage
        hue="violet"
        sections={[
          { id: "tldr", title: "TL;DR (the human version)", body: (
            <>
              <p>We collect the data you give us to run your workspace and the technical data needed to keep it secure. We do not sell your data. We do not train AI models on your data. We honor every regional regulation we operate under (GDPR, DPDP, CCPA, LGPD).</p>
              <p>If you want a deep read, the full policy is below. If you have a question, email <a href="mailto:privacy@workwrk.com" className="text-violet-700 underline underline-offset-2">privacy@workwrk.com</a> &mdash; a human responds within 5 business days.</p>
            </>
          )},
          { id: "what", title: "1. Information we collect", body: (
            <>
              <p><strong>Account data.</strong> Name, email, role, organization. Voluntarily provided when you sign up or are invited.</p>
              <p><strong>Workspace data.</strong> Everything you put into workwrk &mdash; people, KPIs, OKRs, SOPs, tasks, kudos. Stored encrypted at rest, scoped to your workspace.</p>
              <p><strong>Usage telemetry.</strong> Pages visited, features used, errors hit. Aggregated and used to improve the product. No content from your records.</p>
              <p><strong>Technical data.</strong> IP, user agent, device type, session timestamps. Used for security, auth, and incident response.</p>
            </>
          )},
          { id: "use", title: "2. How we use it", body: (
            <>
              <p>We use your data only to (a) run your workspace, (b) keep it secure, (c) bill you, and (d) improve the product through aggregate analytics. We do not use your workspace content for advertising or generic-purpose AI training.</p>
            </>
          )},
          { id: "ai", title: "3. AI features & your data", body: (
            <>
              <p>workwrk uses AI for search, triage, and summarization. We use third-party model providers (currently Anthropic Claude) under strict zero-retention agreements. Your data is sent only when you trigger an AI action, never used to train foundation models, and is not retained by the provider.</p>
              <p>Per-workspace embeddings are stored encrypted, scoped to your workspace, and deleted when you leave.</p>
            </>
          )},
          { id: "share", title: "4. Who we share with (sub-processors)", body: (
            <>
              <p>We use a small set of trusted sub-processors: AWS (infrastructure), Stripe (billing), Anthropic (AI), Datadog (monitoring), Sentry (errors), Postmark (transactional email). Full list and DPAs at <a href="/security#subprocessors" className="text-violet-700 underline underline-offset-2">/security#subprocessors</a>.</p>
              <p>We provide 30 days&apos; notice before adding new sub-processors to enterprise customers.</p>
            </>
          )},
          { id: "rights", title: "5. Your rights", body: (
            <>
              <p>Under GDPR, DPDP, CCPA, and LGPD you have the right to access, correct, delete, port, and object to processing of your personal data. You can exercise these rights directly in-product (Settings &rarr; Privacy) or by emailing <a href="mailto:privacy@workwrk.com" className="text-violet-700 underline underline-offset-2">privacy@workwrk.com</a>.</p>
              <p>Workspace admins can export and delete all workspace data without contacting us.</p>
            </>
          )},
          { id: "retention", title: "6. Retention", body: (
            <>
              <p>Account data is retained for the life of your subscription. After termination, we retain workspace data for 30 days (in case you reactivate), then permanently delete. Backups are purged 90 days after deletion.</p>
              <p>Billing data is retained for 7 years per accounting requirements.</p>
            </>
          )},
          { id: "regions", title: "7. Where your data lives", body: (
            <>
              <p>You choose your data residency: <strong>US</strong> (us-east-1), <strong>EU</strong> (eu-west-1, Ireland), or <strong>India</strong> (ap-south-1, Mumbai). Pinned at workspace creation. Honored for storage, AI retrieval, and backups.</p>
            </>
          )},
          { id: "contact", title: "8. Contact + DPO", body: (
            <>
              <p>Privacy questions: <a href="mailto:privacy@workwrk.com" className="text-violet-700 underline underline-offset-2">privacy@workwrk.com</a></p>
              <p>EU Data Protection Officer: <a href="mailto:dpo@workwrk.com" className="text-violet-700 underline underline-offset-2">dpo@workwrk.com</a></p>
              <p>Mailing address: WorkwrK Technologies, WeWork ETV, Bellandur, Bengaluru 560103, India.</p>
            </>
          )},
        ]}
      />

      <CTABand hue="violet" />
    </>
  );
}

import type { Metadata } from "next";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  CTABand,
} from "@/components/marketing/primitives";
import { LegalPage } from "@/components/marketing/legal";

export const metadata: Metadata = {
  title: "Terms of Service — WorkwrK",
  description: "The terms under which you use WorkwrK. Plain English where possible; legal language where required.",
  alternates: { canonical: "https://workwrk.com/terms" },
};

export default function TermsPage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="sky" className="mb-5">Legal</Eyebrow>
            <H1>Terms of Service.</H1>
            <p className="mt-5 text-base text-slate-600">
              Last updated: <span className="font-semibold text-slate-900">May 18, 2026</span>
            </p>
            <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-2xl">
              By using WorkwrK (&ldquo;the Service&rdquo;), you agree to these terms.
              We&apos;ve kept them as short and human as a 2026-era SaaS contract
              can reasonably be.
            </p>
          </div>
        </Container>
      </Section>

      <LegalPage
        hue="sky"
        sections={[
          { id: "accept", title: "1. Acceptance", body: (
            <p>By creating an account, accessing, or using WorkwrK, you accept these Terms on behalf of yourself and (if applicable) your organization. If you don&apos;t agree, please don&apos;t use the Service.</p>
          )},
          { id: "service", title: "2. The Service", body: (
            <>
              <p>WorkwrK Technologies provides a SaaS business operating system. We may add, remove, or change features. We&apos;ll give you reasonable notice for material changes; for minor changes, we ship-and-update.</p>
              <p>The Service is provided &quot;as-is&quot; with an industry-standard SLA (99.9% on Growth, 99.95% on Scale) and reasonable security measures (see <a href="/security" className="text-sky-700 underline underline-offset-2">/security</a>).</p>
            </>
          )},
          { id: "account", title: "3. Your account", body: (
            <>
              <p>You&apos;re responsible for keeping your credentials safe and for activity under your account. Tell us at <a href="mailto:security@workwrk.com" className="text-sky-700 underline underline-offset-2">security@workwrk.com</a> immediately if you suspect compromise.</p>
              <p>You must be 18+ to create an account. If you create a workspace for an organization, you confirm you have authority to bind that organization.</p>
            </>
          )},
          { id: "content", title: "4. Your content", body: (
            <>
              <p>You own everything you put into WorkwrK. We claim no IP rights to your data &mdash; you grant us only the license needed to operate the Service (host, process, back up, transmit). That license terminates when you delete your data.</p>
              <p>You&apos;re responsible for your content. Don&apos;t use the Service for anything illegal, harassing, or harmful.</p>
            </>
          )},
          { id: "billing", title: "5. Billing & payment", body: (
            <>
              <p>Paid plans are billed monthly or annually as selected. New seats are pro-rated. Removed seats free up immediately and credit your next invoice.</p>
              <p>If payment fails, we&apos;ll retry. After 14 days the workspace is suspended; after 60 days it&apos;s deleted (with 30 days&apos; notice).</p>
              <p>Annual subscriptions don&apos;t auto-renew without consent.</p>
            </>
          )},
          { id: "ip", title: "6. Our IP", body: (
            <p>We own WorkwrK&apos;s name, logos, software, and documentation. You&apos;re granted a non-exclusive, non-transferable license to use the Service. You can&apos;t reverse-engineer, resell, or rebrand the Service without our written permission.</p>
          )},
          { id: "warranty", title: "7. Warranties & disclaimers", body: (
            <>
              <p>We provide the Service with reasonable care and skill. Except as required by law, the Service is provided &quot;as is&quot; without warranties of merchantability, fitness for a particular purpose, or non-infringement.</p>
              <p>No software is bug-free, including ours. Critical bugs are triaged within 24 hours of report.</p>
            </>
          )},
          { id: "liability", title: "8. Liability cap", body: (
            <p>To the maximum extent permitted by law, our aggregate liability under these Terms is limited to the fees paid to us by you in the 12 months preceding the claim. We are not liable for indirect, consequential, or punitive damages, including lost profits.</p>
          )},
          { id: "termination", title: "9. Termination", body: (
            <>
              <p>You can cancel anytime from Settings &rarr; Billing. We can suspend or terminate accounts that violate these Terms, with notice where possible.</p>
              <p>On termination: live data is preserved for 30 days for reactivation; backups purged 90 days after.</p>
            </>
          )},
          { id: "law", title: "10. Governing law", body: (
            <>
              <p>For customers outside India: these Terms are governed by the laws of Singapore. Disputes are resolved by binding arbitration under SIAC rules in Singapore.</p>
              <p>For customers in India: governed by Indian law, courts of Bengaluru have exclusive jurisdiction.</p>
            </>
          )},
          { id: "contact", title: "11. Contact", body: (
            <p>Questions: <a href="mailto:legal@workwrk.com" className="text-sky-700 underline underline-offset-2">legal@workwrk.com</a>. Mailing address: WorkwrK Technologies, WeWork ETV, Bellandur, Bengaluru 560103, India.</p>
          )},
        ]}
      />

      <CTABand hue="sky" />
    </>
  );
}

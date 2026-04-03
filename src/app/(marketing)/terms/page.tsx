import type { Metadata } from "next";
import { FadeIn } from "@/components/marketing/motion";

export const metadata: Metadata = {
  title: "Terms of Service — WorkwrK",
  description:
    "Terms of Service for WorkwrK, the unified business operating system. Read our terms governing the use of our platform, subscription plans, data ownership, and more.",
  openGraph: {
    title: "Terms of Service — WorkwrK",
    description:
      "Terms of Service for WorkwrK, the unified business operating system.",
    url: "https://workwrk.com/terms",
    siteName: "WorkwrK",
    type: "website",
  },
};

export default function TermsPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative pb-16 pt-36">
        <div className="hero-glow" />
        <div className="hero-grid" />
        <div className="relative z-10 mx-auto max-w-[1200px] px-6 text-center">
          <FadeIn>
            <p className="mkt-label">Legal</p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h1 className="mkt-title mx-auto mb-6 max-w-[800px] text-[clamp(2.2rem,5vw,3.5rem)]">
              Terms of Service
            </h1>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="mx-auto mb-4 max-w-[560px] text-lg text-[#8888A0]">
              Effective Date: March 28, 2026
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Content */}
      <section className="pb-28">
        <div className="mx-auto max-w-[800px] px-6">
          <FadeIn>
            <div className="prose-custom">
              <p>
                These Terms of Service (&quot;Terms&quot;) constitute a legally
                binding agreement between you (&quot;Customer,&quot;
                &quot;you,&quot; or &quot;your&quot;) and WorkwrK
                (&quot;Company,&quot; &quot;we,&quot; &quot;us,&quot; or
                &quot;our&quot;), governing your access to and use of the
                WorkwrK platform, including all associated services, features,
                content, and applications (collectively, the
                &quot;Service&quot;). By accessing or using the Service, you
                agree to be bound by these Terms. If you do not agree, you must
                not use the Service.
              </p>

              <h2>1. Acceptance of Terms</h2>
              <p>
                By creating an account, accessing, or using the Service in any
                manner, you acknowledge that you have read, understood, and
                agree to be bound by these Terms and our Privacy Policy. If you
                are using the Service on behalf of an organization, you
                represent and warrant that you have the authority to bind that
                organization to these Terms, and &quot;you&quot; and
                &quot;your&quot; shall refer to that organization.
              </p>
              <p>
                You must be at least 18 years of age to use the Service. By
                agreeing to these Terms, you represent and warrant that you are
                at least 18 years old and have the legal capacity to enter into
                a binding agreement.
              </p>

              <h2>2. Description of Service</h2>
              <p>
                WorkwrK is a unified business operating system designed for
                growing businesses. The platform consolidates multiple
                operational functions into a single integrated solution,
                replacing disconnected tools with one cohesive system. The
                Service includes the following core modules:
              </p>
              <ul>
                <li>
                  <strong>People Management</strong> — Centralized employee
                  directory, org charts, role management, and team structures.
                </li>
                <li>
                  <strong>KPI Tracking</strong> — Define, assign, and
                  auto-score key performance indicators with real-time progress
                  monitoring.
                </li>
                <li>
                  <strong>Task Management</strong> — Structured task creation,
                  assignment, deadlines, and completion tracking across teams.
                </li>
                <li>
                  <strong>SOPs &amp; Playbooks</strong> — Standard operating
                  procedures with version control, acknowledgment tracking, and
                  compliance monitoring.
                </li>
                <li>
                  <strong>Performance Reviews</strong> — Configurable review
                  cycles with multi-source feedback, composite scoring, and
                  historical tracking.
                </li>
                <li>
                  <strong>Recognition &amp; Rewards</strong> — Peer-to-peer
                  recognition, manager shout-outs, and reward programs to
                  reinforce positive behaviors.
                </li>
                <li>
                  <strong>AI Intelligence Layer</strong> — AI-powered insights,
                  recommendations, anomaly detection, and predictive analytics
                  across all modules.
                </li>
                <li>
                  <strong>Analytics &amp; Reporting</strong> — Cross-module
                  dashboards, custom reports, and data visualizations for
                  informed decision-making.
                </li>
                <li>
                  <strong>Attendance &amp; Leave</strong> — Leave management,
                  attendance tracking, and absence analytics.
                </li>
                <li>
                  <strong>Surveys &amp; Feedback</strong> — Pulse surveys,
                  engagement tracking, and anonymous feedback channels.
                </li>
                <li>
                  <strong>Goals &amp; OKRs</strong> — Objective and key result
                  alignment from company level to individual contributors.
                </li>
                <li>
                  <strong>Integrations &amp; API</strong> — Connect with
                  existing tools via pre-built integrations and a developer API.
                </li>
              </ul>
              <p>
                We reserve the right to modify, update, or discontinue any
                feature or module of the Service at any time, with reasonable
                notice to active subscribers where practicable.
              </p>

              <h2>3. Account Registration &amp; Security</h2>
              <p>
                To use the Service, you must create an account by providing
                accurate, current, and complete information. You agree to update
                your account information promptly to keep it accurate and
                complete at all times.
              </p>
              <p>
                You are solely responsible for maintaining the confidentiality
                of your account credentials, including your password and any
                API keys. You agree to notify us immediately at{" "}
                <strong>legal@workwrk.com</strong> if you become aware of any
                unauthorized access to or use of your account.
              </p>
              <p>
                You are responsible for all activities that occur under your
                account, whether or not authorized by you. We shall not be
                liable for any loss or damage arising from your failure to
                safeguard your account credentials.
              </p>
              <p>
                Each account is intended for use by a single organization. You
                may not share your account credentials with individuals outside
                your organization or allow third parties to access the Service
                through your account without our prior written consent.
              </p>

              <h2>4. Subscription Plans &amp; Billing</h2>
              <p>
                The Service is offered under the following subscription plans,
                billed in Indian Rupees (INR):
              </p>
              <ul>
                <li>
                  <strong>Starter</strong> — Designed for small teams getting
                  started with structured operations. Includes core modules
                  with essential features.
                </li>
                <li>
                  <strong>Growth</strong> — For scaling businesses that need
                  advanced analytics, performance reviews, and expanded module
                  access.
                </li>
                <li>
                  <strong>Scale</strong> — Full platform access with AI
                  intelligence, advanced integrations, priority support, and
                  custom configurations.
                </li>
                <li>
                  <strong>Enterprise</strong> — Custom pricing for large
                  organizations requiring dedicated infrastructure, custom SLAs,
                  SSO, advanced security, and a dedicated account manager.
                </li>
              </ul>
              <p>
                Subscription fees are billed in advance on a monthly or annual
                basis, depending on the billing cycle you select at the time of
                purchase. Annual plans are billed as a single upfront payment
                for the full year.
              </p>
              <p>
                All fees are exclusive of applicable taxes, including GST,
                which will be added to your invoice as required by law. You are
                responsible for providing accurate billing and tax information.
              </p>
              <p>
                We reserve the right to change our pricing at any time. Any
                pricing changes will take effect at the start of your next
                billing cycle following at least 30 days&apos; prior written
                notice. Continued use of the Service after a price change
                constitutes your acceptance of the new pricing.
              </p>
              <p>
                Unless otherwise stated, subscription fees are
                non-refundable. If you cancel your subscription, you will
                retain access to the Service until the end of your current
                billing period. No prorated refunds will be issued for partial
                billing periods.
              </p>

              <h2>5. Free Trial</h2>
              <p>
                We offer a 14-day free trial of the Service to new customers.
                During the trial period, you will have access to the full
                feature set of the Service as determined by us.
              </p>
              <p>
                At the end of the 14-day trial, your account will be
                automatically downgraded unless you select a paid subscription
                plan and provide valid payment information. Any data entered
                during the trial period will be retained for a reasonable
                period to allow you to subscribe, after which it may be
                permanently deleted.
              </p>
              <p>
                We reserve the right to modify, limit, or discontinue the free
                trial offering at any time without prior notice. Each
                organization is entitled to one free trial only.
              </p>

              <h2>6. Data Ownership</h2>
              <p>
                <strong>You own your data.</strong> All data, content, and
                information that you or your authorized users upload, submit, or
                generate through the Service (&quot;Customer Data&quot;) remains
                your sole and exclusive property. These Terms do not grant us
                any ownership rights in your Customer Data.
              </p>
              <p>
                You grant us a limited, non-exclusive, worldwide license to
                access, use, process, and store your Customer Data solely for
                the purpose of providing, maintaining, and improving the
                Service. This license terminates when you delete your Customer
                Data or when your account is terminated, subject to any
                retention periods required by applicable law or outlined in
                these Terms.
              </p>
              <p>
                Upon termination of your account, you may request an export of
                your Customer Data in a standard machine-readable format. We
                will make such data available for export for a period of 30
                days following termination, after which we may permanently
                delete your Customer Data from our systems, except as required
                by law.
              </p>

              <h2>7. Data Processing &amp; Storage</h2>
              <p>
                We process and store Customer Data in accordance with our
                Privacy Policy and applicable data protection laws, including
                the Information Technology Act, 2000 and the Digital Personal
                Data Protection Act, 2023 (as applicable).
              </p>
              <p>
                Customer Data is stored on secure, industry-standard cloud
                infrastructure. We implement appropriate technical and
                organizational measures to protect your data against
                unauthorized access, alteration, disclosure, or destruction,
                including encryption at rest and in transit, access controls,
                and regular security audits.
              </p>
              <p>
                We do not sell, rent, or trade your Customer Data to third
                parties. We may use anonymized, aggregated data that does not
                identify any individual or organization for the purpose of
                improving the Service, conducting research, and generating
                industry benchmarks.
              </p>
              <p>
                We may engage third-party service providers (sub-processors)
                to assist in delivering the Service. These sub-processors are
                bound by contractual obligations to protect the
                confidentiality and security of Customer Data and are
                prohibited from using it for any purpose other than fulfilling
                their obligations to us.
              </p>

              <h2>8. Acceptable Use Policy</h2>
              <p>You agree not to use the Service to:</p>
              <ul>
                <li>
                  Violate any applicable local, state, national, or
                  international law or regulation.
                </li>
                <li>
                  Upload, transmit, or store any content that is unlawful,
                  harmful, threatening, abusive, defamatory, obscene, or
                  otherwise objectionable.
                </li>
                <li>
                  Attempt to gain unauthorized access to any part of the
                  Service, other accounts, computer systems, or networks
                  connected to the Service.
                </li>
                <li>
                  Interfere with or disrupt the integrity, performance, or
                  availability of the Service or its underlying infrastructure.
                </li>
                <li>
                  Reverse engineer, decompile, disassemble, or otherwise
                  attempt to derive the source code of the Service.
                </li>
                <li>
                  Use the Service to send unsolicited communications, spam, or
                  bulk messages.
                </li>
                <li>
                  Use automated scripts, bots, or other means to access the
                  Service in a manner that exceeds reasonable usage or imposes
                  an unreasonable load on our infrastructure.
                </li>
                <li>
                  Resell, sublicense, or redistribute access to the Service
                  without our prior written consent.
                </li>
                <li>
                  Use the Service in any manner that could damage, disable, or
                  impair the Service or interfere with any other party&apos;s
                  use of the Service.
                </li>
              </ul>
              <p>
                We reserve the right to suspend or terminate your account if
                we determine, in our sole discretion, that you have violated
                this Acceptable Use Policy.
              </p>

              <h2>9. Intellectual Property</h2>
              <p>
                The Service, including all software, code, design, text,
                graphics, logos, trademarks, and other content provided by
                WorkwrK (collectively, &quot;Company Materials&quot;), is owned
                by or licensed to us and is protected by copyright, trademark,
                patent, trade secret, and other intellectual property laws.
              </p>
              <p>
                Subject to your compliance with these Terms, we grant you a
                limited, non-exclusive, non-transferable, revocable license to
                access and use the Service solely for your internal business
                purposes during the term of your subscription.
              </p>
              <p>
                You may not copy, modify, distribute, sell, lease, or create
                derivative works based on the Company Materials without our
                prior written consent. All rights not expressly granted herein
                are reserved by WorkwrK.
              </p>
              <p>
                Any feedback, suggestions, or ideas you provide regarding the
                Service (&quot;Feedback&quot;) may be used by us without
                restriction or obligation to you. You hereby assign to us all
                rights, title, and interest in and to such Feedback.
              </p>

              <h2>10. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by applicable law, WorkwrK and
                its directors, officers, employees, agents, and affiliates
                shall not be liable for any indirect, incidental, special,
                consequential, or punitive damages, including but not limited
                to loss of profits, revenue, data, business opportunities, or
                goodwill, arising out of or in connection with your use of or
                inability to use the Service, regardless of the theory of
                liability (whether in contract, tort, negligence, strict
                liability, or otherwise) and even if we have been advised of
                the possibility of such damages.
              </p>
              <p>
                Our total cumulative liability to you for all claims arising
                out of or relating to these Terms or the Service shall not
                exceed the total fees paid by you to WorkwrK during the twelve
                (12) months immediately preceding the event giving rise to the
                claim.
              </p>
              <p>
                The Service is provided on an &quot;as is&quot; and &quot;as
                available&quot; basis. We make no warranties or
                representations, express or implied, regarding the Service,
                including but not limited to implied warranties of
                merchantability, fitness for a particular purpose,
                non-infringement, or that the Service will be uninterrupted,
                error-free, or secure.
              </p>

              <h2>11. Termination</h2>
              <p>
                You may terminate your account at any time by contacting us
                or through the account settings in the Service. Termination
                will take effect at the end of your current billing period.
              </p>
              <p>
                We may suspend or terminate your access to the Service
                immediately, without prior notice or liability, if:
              </p>
              <ul>
                <li>You breach any provision of these Terms.</li>
                <li>
                  You fail to pay applicable fees when due and do not cure
                  such failure within 15 days of receiving written notice.
                </li>
                <li>
                  We are required to do so by law or a governmental authority.
                </li>
                <li>
                  We reasonably believe that your use of the Service poses a
                  security risk or may cause harm to other users, us, or third
                  parties.
                </li>
              </ul>
              <p>
                Upon termination, your right to access and use the Service
                will cease immediately. Sections of these Terms that by their
                nature should survive termination shall survive, including but
                not limited to Sections 6 (Data Ownership), 9 (Intellectual
                Property), 10 (Limitation of Liability), and 13 (Governing
                Law).
              </p>

              <h2>12. Changes to Terms</h2>
              <p>
                We reserve the right to update or modify these Terms at any
                time. When we make material changes, we will notify you by
                posting the updated Terms on our website and updating the
                &quot;Effective Date&quot; at the top of this page. For
                material changes, we will also provide notice via email to the
                address associated with your account at least 30 days before
                the changes take effect.
              </p>
              <p>
                Your continued use of the Service after the updated Terms
                become effective constitutes your acceptance of the revised
                Terms. If you do not agree to the updated Terms, you must stop
                using the Service and terminate your account before the
                changes take effect.
              </p>

              <h2>13. Governing Law &amp; Dispute Resolution</h2>
              <p>
                These Terms shall be governed by and construed in accordance
                with the laws of India, without regard to its conflict of law
                principles.
              </p>
              <p>
                Any dispute, controversy, or claim arising out of or relating
                to these Terms, or the breach, termination, or invalidity
                thereof, shall first be attempted to be resolved through good
                faith negotiation between the parties for a period of 30 days.
                If the dispute cannot be resolved through negotiation, it shall
                be submitted to binding arbitration in accordance with the
                Arbitration and Conciliation Act, 1996 (as amended). The seat
                of arbitration shall be Bengaluru, India, and the proceedings
                shall be conducted in English.
              </p>
              <p>
                Subject to the arbitration provisions above, the courts of
                Bengaluru, Karnataka, India shall have exclusive jurisdiction
                over any matters arising out of or relating to these Terms.
              </p>

              <h2>14. Contact Information</h2>
              <p>
                If you have any questions, concerns, or requests regarding
                these Terms of Service, please contact us at:
              </p>
              <p>
                <strong>WorkwrK</strong>
                <br />
                Email:{" "}
                <a
                  href="mailto:legal@workwrk.com"
                  className="text-[#A29BFE] underline underline-offset-4 hover:text-[#6C5CE7]"
                >
                  legal@workwrk.com
                </a>
                <br />
                Website:{" "}
                <a
                  href="https://workwrk.com"
                  className="text-[#A29BFE] underline underline-offset-4 hover:text-[#6C5CE7]"
                >
                  https://workwrk.com
                </a>
              </p>
            </div>
          </FadeIn>
        </div>
      </section>
    </>
  );
}

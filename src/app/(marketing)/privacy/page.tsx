import type { Metadata } from "next";
import { FadeIn } from "@/components/marketing/motion";

export const metadata: Metadata = {
  title: "Privacy Policy — WorkwrK",
  description:
    "Privacy Policy for WorkwrK, the unified business operating system. Learn how we collect, use, store, and protect your personal and organizational data.",
  openGraph: {
    title: "Privacy Policy — WorkwrK",
    description:
      "Privacy Policy for WorkwrK, the unified business operating system.",
    url: "https://workwrk.com/privacy",
    siteName: "WorkwrK",
    type: "website",
  },
};

export default function PrivacyPage() {
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
              Privacy Policy
            </h1>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="mx-auto mb-4 max-w-[560px] text-lg text-muted">
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
                This Privacy Policy (&quot;Policy&quot;) describes how WorkwrK
                (&quot;Company,&quot; &quot;we,&quot; &quot;us,&quot; or
                &quot;our&quot;) collects, uses, stores, shares, and protects
                your personal information when you access or use the WorkwrK
                platform, including all associated services, features, content,
                and applications (collectively, the &quot;Service&quot;). By
                accessing or using the Service, you consent to the practices
                described in this Policy. If you do not agree with this Policy,
                please do not use the Service.
              </p>

              <h2>1. Information We Collect</h2>
              <p>
                We collect different categories of information depending on how
                you interact with the Service:
              </p>

              <h3>Account Information</h3>
              <p>
                When you create an account, we collect your name, email address,
                phone number, job title, and authentication credentials. If you
                sign up on behalf of an organization, we also collect your
                company name, business address, and billing details.
              </p>

              <h3>Organization Data</h3>
              <p>
                Through your use of the Service, you and your authorized users
                may upload or generate organizational data including employee
                records, team structures, performance reviews, KPI definitions
                and scores, task assignments, standard operating procedures,
                attendance records, survey responses, goals, and other
                operational content (&quot;Customer Data&quot;). You retain full
                ownership of all Customer Data as outlined in our Terms of
                Service.
              </p>

              <h3>Usage Data</h3>
              <p>
                We automatically collect information about how you interact with
                the Service, including pages visited, features used, actions
                taken, timestamps, session duration, click patterns, and search
                queries. This data helps us understand how the Service is used
                and identify opportunities for improvement.
              </p>

              <h3>Device &amp; Technical Information</h3>
              <p>
                We collect technical information from the devices you use to
                access the Service, including IP address, browser type and
                version, operating system, device type, screen resolution,
                language preferences, and referring URLs. This information is
                used for security monitoring, troubleshooting, and optimizing
                the Service for different devices and environments.
              </p>

              <h2>2. How We Use Your Information</h2>
              <p>
                We use the information we collect for the following purposes:
              </p>
              <ul>
                <li>
                  <strong>Service Delivery</strong> — To provide, operate, and
                  maintain the Service, including processing your requests,
                  managing your account, and delivering the core functionality
                  of each module (People Management, KPI Tracking, Task
                  Management, Performance Reviews, and all other features).
                </li>
                <li>
                  <strong>Analytics &amp; Improvement</strong> — To analyze
                  usage patterns, diagnose technical issues, measure feature
                  adoption, and improve the performance, reliability, and user
                  experience of the Service. We may use anonymized, aggregated
                  data to generate industry benchmarks and insights.
                </li>
                <li>
                  <strong>Customer Support</strong> — To respond to your
                  inquiries, troubleshoot issues, provide technical assistance,
                  and deliver onboarding guidance. Support interactions may be
                  logged to improve the quality of our assistance.
                </li>
                <li>
                  <strong>Communication</strong> — To send you transactional
                  notifications (such as account confirmations, billing
                  receipts, security alerts, and system updates), as well as
                  product announcements and feature updates. You can opt out of
                  non-essential communications at any time through your account
                  settings.
                </li>
                <li>
                  <strong>Security &amp; Fraud Prevention</strong> — To detect,
                  prevent, and respond to security incidents, unauthorized
                  access attempts, and fraudulent activity.
                </li>
                <li>
                  <strong>Legal Compliance</strong> — To comply with applicable
                  laws, regulations, legal processes, and enforceable
                  governmental requests.
                </li>
              </ul>

              <h2>3. Data Storage &amp; Security</h2>
              <p>
                We take the security of your data seriously and implement
                industry-standard technical and organizational measures to
                protect it:
              </p>
              <ul>
                <li>
                  <strong>Encryption at Rest</strong> — All Customer Data and
                  personal information stored in our databases is encrypted
                  using AES-256 encryption, one of the strongest block cipher
                  standards available.
                </li>
                <li>
                  <strong>Encryption in Transit</strong> — All data transmitted
                  between your device and our servers is protected using TLS
                  1.2 or higher, ensuring that your information cannot be
                  intercepted during transmission.
                </li>
                <li>
                  <strong>Secure Infrastructure</strong> — The Service is hosted
                  on enterprise-grade cloud infrastructure with SOC 2 Type II
                  compliance, redundant storage, automated backups, and
                  24/7 infrastructure monitoring. Access to production systems
                  is restricted to authorized personnel through multi-factor
                  authentication and role-based access controls.
                </li>
                <li>
                  <strong>Regular Audits</strong> — We conduct periodic security
                  assessments, penetration testing, and code reviews to
                  identify and remediate vulnerabilities.
                </li>
              </ul>
              <p>
                While we strive to protect your information using commercially
                reasonable measures, no method of electronic transmission or
                storage is 100% secure. We cannot guarantee absolute security,
                but we are committed to promptly notifying affected users in the
                event of a data breach in accordance with applicable law.
              </p>

              <h2>4. Data Sharing</h2>
              <p>
                <strong>We do not sell your personal data.</strong> We do not
                sell, rent, or trade your personal information or Customer Data
                to third parties for their marketing or advertising purposes.
              </p>
              <p>
                We may share your information with the following categories of
                third-party service providers (sub-processors) who assist us in
                operating the Service:
              </p>
              <ul>
                <li>
                  <strong>Payment Processors</strong> — To process subscription
                  payments and manage billing. Payment processors receive only
                  the information necessary to complete transactions and are
                  PCI DSS compliant.
                </li>
                <li>
                  <strong>Email &amp; Communication Providers</strong> — To
                  deliver transactional emails, notifications, and support
                  communications on our behalf.
                </li>
                <li>
                  <strong>Cloud Hosting &amp; Infrastructure</strong> — To
                  store and process data on secure, compliant cloud
                  infrastructure.
                </li>
              </ul>
              <p>
                All third-party service providers are bound by contractual
                obligations to maintain the confidentiality and security of your
                data and are prohibited from using it for any purpose other than
                fulfilling their services to us. We conduct due diligence on all
                sub-processors and maintain an up-to-date list of providers
                available upon request.
              </p>
              <p>
                We may also disclose your information if required to do so by
                law, regulation, legal process, or governmental request, or if
                we believe in good faith that disclosure is necessary to protect
                our rights, your safety, or the safety of others.
              </p>

              <h2>5. Data Retention</h2>
              <p>
                We retain your information according to the following schedule:
              </p>
              <ul>
                <li>
                  <strong>Active Accounts</strong> — Your personal information
                  and Customer Data are retained for as long as your account
                  remains active and you maintain a valid subscription. We will
                  continue to store and process your data as necessary to
                  provide the Service.
                </li>
                <li>
                  <strong>After Account Termination</strong> — Upon termination
                  of your account, we retain your Customer Data for 30 days to
                  allow you to request a data export or reactivate your
                  account. After this 30-day window, your Customer Data will
                  be permanently deleted from our active systems.
                </li>
                <li>
                  <strong>Backups</strong> — Residual copies of your data may
                  persist in encrypted backup systems for up to 90 days
                  following deletion from active systems, after which they are
                  automatically purged. Backup data is not accessible for
                  operational use and is retained solely for disaster recovery
                  purposes.
                </li>
              </ul>
              <p>
                Certain information may be retained beyond these periods where
                required by applicable law, regulation, or legitimate legal
                obligations (such as tax, accounting, or audit requirements).
              </p>

              <h2>6. Your Rights</h2>
              <p>
                Depending on your jurisdiction, you may have the following
                rights regarding your personal information:
              </p>
              <ul>
                <li>
                  <strong>Right of Access</strong> — You may request a copy of
                  the personal information we hold about you, including the
                  categories of data collected, the purposes of processing, and
                  any third parties with whom it has been shared.
                </li>
                <li>
                  <strong>Right to Correction</strong> — You may request that we
                  correct any inaccurate or incomplete personal information we
                  hold about you. You can also update most of your information
                  directly through your account settings.
                </li>
                <li>
                  <strong>Right to Deletion</strong> — You may request that we
                  delete your personal information and Customer Data, subject to
                  our retention obligations and any legal requirements that may
                  prevent immediate deletion.
                </li>
                <li>
                  <strong>Right to Data Export</strong> — You may request an
                  export of your Customer Data in a standard, machine-readable
                  format (such as CSV or JSON) at any time during your active
                  subscription or within 30 days of account termination.
                </li>
                <li>
                  <strong>Right to Restrict Processing</strong> — You may
                  request that we limit the processing of your personal
                  information in certain circumstances, such as while we verify
                  the accuracy of your data or evaluate an objection to
                  processing.
                </li>
              </ul>
              <p>
                To exercise any of these rights, please contact us at{" "}
                <a
                  href="mailto:privacy@workwrk.com"
                  className="text-[#d4ff2e] underline underline-offset-4 hover:text-[#d4ff2e]"
                >
                  privacy@workwrk.com
                </a>
                . We will respond to your request within 30 days, or as
                required by applicable law. We may need to verify your identity
                before processing your request.
              </p>

              <h2>7. Cookies &amp; Tracking</h2>
              <p>
                We use <strong>essential cookies only</strong>. These cookies
                are strictly necessary for the operation of the Service and
                enable core functionality such as user authentication, session
                management, security protections, and preference storage. The
                Service cannot function properly without these cookies.
              </p>
              <p>
                <strong>
                  We do not use third-party advertising trackers.
                </strong>{" "}
                We do not embed third-party ad networks, social media tracking
                pixels, or cross-site tracking technologies in the Service.
                Your activity on WorkwrK is not tracked by external advertisers
                or data brokers.
              </p>
              <p>
                You can configure your browser to block or delete cookies, but
                doing so may impair your ability to use certain features of the
                Service. By continuing to use the Service, you consent to our
                use of essential cookies as described above.
              </p>

              <h2>8. Children&apos;s Privacy</h2>
              <p>
                The Service is designed for use by businesses and professionals
                and is not intended for individuals under the age of 18. We do
                not knowingly collect personal information from anyone under 18
                years of age.
              </p>
              <p>
                If we become aware that we have inadvertently collected personal
                information from a person under 18, we will take prompt steps
                to delete that information from our systems. If you believe
                that a child under 18 has provided us with personal
                information, please contact us immediately at{" "}
                <a
                  href="mailto:privacy@workwrk.com"
                  className="text-[#d4ff2e] underline underline-offset-4 hover:text-[#d4ff2e]"
                >
                  privacy@workwrk.com
                </a>
                .
              </p>

              <h2>9. International Data Transfers</h2>
              <p>
                WorkwrK operates from India, and your data may be processed and
                stored in India or in other jurisdictions where our cloud
                infrastructure providers maintain data centers. If you access
                the Service from outside India, your information may be
                transferred to, stored in, and processed in a jurisdiction with
                data protection laws that differ from those in your country of
                residence.
              </p>
              <p>
                Where we transfer personal data across borders, we implement
                appropriate safeguards to ensure that your information receives
                an adequate level of protection, including contractual
                obligations with our sub-processors, compliance with applicable
                data transfer frameworks, and adherence to the data protection
                requirements of relevant jurisdictions.
              </p>
              <p>
                By using the Service, you consent to the transfer of your
                information to India and other jurisdictions as described in
                this Policy. If you have concerns about international data
                transfers, please contact us before using the Service.
              </p>

              <h2>10. Changes to This Privacy Policy</h2>
              <p>
                We reserve the right to update or modify this Privacy Policy at
                any time. When we make changes, we will revise the
                &quot;Effective Date&quot; at the top of this page and post the
                updated Policy on our website.
              </p>
              <p>
                For material changes that significantly affect how we collect,
                use, or share your personal information, we will provide
                prominent notice through the Service or via email to the
                address associated with your account at least 30 days before
                the changes take effect.
              </p>
              <p>
                Your continued use of the Service after the updated Policy
                becomes effective constitutes your acceptance of the revised
                terms. If you do not agree with the changes, you must stop
                using the Service and terminate your account before the updated
                Policy takes effect.
              </p>

              <h2>11. Contact Us</h2>
              <p>
                If you have any questions, concerns, or requests regarding this
                Privacy Policy or our data practices, please contact us at:
              </p>
              <p>
                <strong>WorkwrK</strong>
                <br />
                Email:{" "}
                <a
                  href="mailto:privacy@workwrk.com"
                  className="text-[#d4ff2e] underline underline-offset-4 hover:text-[#d4ff2e]"
                >
                  privacy@workwrk.com
                </a>
                <br />
                Website:{" "}
                <a
                  href="https://workwrk.com"
                  className="text-[#d4ff2e] underline underline-offset-4 hover:text-[#d4ff2e]"
                >
                  https://workwrk.com
                </a>
              </p>
              <p>
                For data protection inquiries specific to the Digital Personal
                Data Protection Act, 2023 or other applicable privacy
                regulations, please direct your correspondence to our Data
                Protection Officer at{" "}
                <a
                  href="mailto:privacy@workwrk.com"
                  className="text-[#d4ff2e] underline underline-offset-4 hover:text-[#d4ff2e]"
                >
                  privacy@workwrk.com
                </a>
                .
              </p>
            </div>
          </FadeIn>
        </div>
      </section>
    </>
  );
}

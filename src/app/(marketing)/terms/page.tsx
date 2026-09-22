import Link from "next/link";
import type { Metadata } from "next";

import { LEGAL_COPY } from "@/components/marketing/iconic/copy";
import { LegalDoc } from "@/components/marketing/iconic/legal-doc";
import { mailboxes } from "@/components/marketing/config";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

const TERMS_DESCRIPTION =
  "The terms under which you use WorkwrK. Plain English where possible; legal language where required.";

export const metadata: Metadata = {
  title: "Terms of service",
  description: TERMS_DESCRIPTION,
  alternates: { canonical: "https://workwrk.com/terms" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Terms of service", description: TERMS_DESCRIPTION },
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: TERMS_DESCRIPTION },
};

// /terms, on the iconic sheet, and TWO PARAGRAPHS CHANGED as well as the
// chrome. Both were commitments this repo cannot evidence, on the page a
// procurement team quotes back:
//
//   Section 5 said "New seats are pro-rated. Removed seats free up
//   immediately and credit your next invoice", and "Annual subscriptions
//   don't auto-renew without consent". Billing runs through a payment
//   processor's portal (src/app/api/billing/portal); nothing in this repo
//   sets a proration behaviour, issues a credit, or suppresses a renewal,
//   and the same three claims were removed from /pricing in its own truth
//   pass for the same reason. What is here now says what the product
//   actually gives you, which is the portal and the ability to change or
//   cancel in it.
//
//   Section 5 also carried a dunning schedule: suspended after 14 days,
//   deleted after 60, with 30 days' notice. The 14 and the 60 appear nowhere
//   else in this repo or on this site. The retention numbers that DO appear
//   in two places, 30 days live and 90 days of backups, are in section 9 and
//   in the privacy policy, and they stay.
//
// Everything else is the text that was already here, including the two
// paragraphs a previous pass gated: no uptime percentage, and no support
// response time, because flags.uptimeSla is false and no status page is
// published.
export default function TermsPage() {
  return (
    <LegalDoc
      eyebrow={LEGAL_COPY.terms.eyebrow}
      title={LEGAL_COPY.terms.h1}
      updated={LEGAL_COPY.terms.updated}
      lede={LEGAL_COPY.terms.sub}
      sections={[
        {
          id: "accept",
          title: "1. Acceptance",
          body: (
            <p>
              By creating an account, accessing, or using WorkwrK, you accept these terms on behalf of yourself and, if
              applicable, your organization. If you do not agree, please do not use the service.
            </p>
          ),
        },
        {
          id: "service",
          title: "2. The service",
          body: (
            <>
              <p>
                WorkwrK Technologies provides a software as a service business operating system. We may add, remove, or
                change features. We will give you reasonable notice for material changes; for minor changes, we ship and
                update.
              </p>
              {/* No uptime percentage here. flags.uptimeSla is false because
                  no status page is published yet, and /security says in its
                  own words that no number is claimed. Terms is the page a
                  procurement team quotes back as a commitment, so it must
                  not be the one place on the site that sells an SLA. */}
              <p>
                The service is provided as is. We take reasonable security measures, described at{" "}
                <Link href="/security">/security</Link>. We do not currently offer a contractual uptime commitment. When
                we publish a status page and an SLA, the number will appear here and on /security, and not before.
              </p>
            </>
          ),
        },
        {
          id: "account",
          title: "3. Your account",
          body: (
            <>
              <p>
                You are responsible for keeping your credentials safe and for activity under your account. Tell us at{" "}
                <a href={`mailto:${mailboxes.security}`}>{mailboxes.security}</a> immediately if you suspect compromise.
              </p>
              <p>
                You must be 18 or over to create an account. If you create a workspace for an organization, you confirm
                you have authority to bind that organization.
              </p>
            </>
          ),
        },
        {
          id: "content",
          title: "4. Your content",
          body: (
            <>
              <p>
                You own everything you put into WorkwrK. We claim no intellectual property rights to your data. You
                grant us only the licence needed to operate the service: host, process, back up, transmit. That licence
                terminates when you delete your data.
              </p>
              <p>
                You are responsible for your content. Do not use the service for anything illegal, harassing, or
                harmful.
              </p>
            </>
          ),
        },
        {
          id: "billing",
          title: "5. Billing and payment",
          body: (
            <>
              {/* See the note at the top of this file. The proration, the
                  credit and the renewal consent were three commitments with
                  nothing behind them in this repo. */}
              <p>
                Paid plans are billed monthly or annually as selected, through our payment processor. Changing your
                plan, changing your seat count, updating a card and cancelling are all done from Settings, Billing,
                which opens that processor&apos;s portal.
              </p>
              <p>
                If a payment fails we will retry and contact you. A workspace is suspended before anything is deleted,
                and section 9 says what happens to the data after that.
              </p>
            </>
          ),
        },
        {
          id: "ip",
          title: "6. Our intellectual property",
          body: (
            <p>
              We own WorkwrK&apos;s name, logos, software, and documentation. You are granted a non-exclusive,
              non-transferable licence to use the service. You may not reverse engineer, resell, or rebrand the service
              without our written permission.
            </p>
          ),
        },
        {
          id: "warranty",
          title: "7. Warranties and disclaimers",
          body: (
            <>
              <p>
                We provide the service with reasonable care and skill. Except as required by law, the service is
                provided as is, without warranties of merchantability, fitness for a particular purpose, or non
                infringement.
              </p>
              {/* No support-response time. Same gate as the SLA above. */}
              <p>
                No software is free of bugs, including ours. We triage reported bugs by severity and we do not promise a
                fixed response time.
              </p>
            </>
          ),
        },
        {
          id: "liability",
          title: "8. Liability cap",
          body: (
            <p>
              To the maximum extent permitted by law, our aggregate liability under these terms is limited to the fees
              paid to us by you in the 12 months preceding the claim. We are not liable for indirect, consequential, or
              punitive damages, including lost profits.
            </p>
          ),
        },
        {
          id: "termination",
          title: "9. Termination",
          body: (
            <>
              <p>
                You can cancel at any time from Settings, Billing. We can suspend or terminate accounts that violate
                these terms, with notice where possible.
              </p>
              <p>
                On termination: live data is preserved for 30 days so you can reactivate, and backups are purged 90 days
                after deletion.
              </p>
            </>
          ),
        },
        {
          id: "law",
          title: "10. Governing law",
          body: (
            <>
              <p>
                For customers outside India: these terms are governed by the laws of Singapore. Disputes are resolved by
                binding arbitration under SIAC rules in Singapore.
              </p>
              <p>For customers in India: governed by Indian law, courts of Bengaluru have exclusive jurisdiction.</p>
            </>
          ),
        },
        {
          // legal@ was one of four addresses the legal pages handed out
          // inline while config.ts declared two, and it appears nowhere else
          // in this repo. Terms questions go to the general mailbox, which
          // is declared and read.
          id: "contact",
          title: "11. Contact",
          body: (
            <p>
              Questions: <a href={`mailto:${mailboxes.general}`}>{mailboxes.general}</a>. Mailing address: WorkwrK
              Technologies, WeWork ETV, Bellandur, Bengaluru 560103, India.
            </p>
          ),
        },
      ]}
    />
  );
}

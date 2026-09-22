import type { Metadata } from "next";

import { LEGAL_COPY } from "@/components/marketing/iconic/copy";
import { LegalDoc } from "@/components/marketing/iconic/legal-doc";
import { mailboxes } from "@/components/marketing/config";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

// /privacy, on the iconic sheet. The chrome changed; not one sentence of the
// policy did, and that is deliberate.
//
// THIS PAGE HAS ALREADY BEEN THROUGH A TRUTH GATE, and what it caught is the
// reason the gate exists. The version before it asserted, on the one document
// where an untrue sentence is a legal exposure rather than a marketing one:
//
//   "We honor every regional regulation we operate under (GDPR, DPDP, CCPA,
//   LGPD)" while flags.gdpr and flags.dpdp are false and /compare's own
//   facts row reads "Certifications: None held yet."
//
//   Six named sub-processors (AWS infrastructure across three regions,
//   Stripe billing, Datadog monitoring, Sentry errors, Postmark email) for a
//   deployment that runs on a single self-hosted server, linked to
//   /security#subprocessors, an anchor that does not exist.
//
//   "You can exercise these rights directly in-product (Settings >
//   Privacy)", and there is no privacy page under the product's settings.
//
//   "strict zero-retention agreements" with a named model provider, "Stored
//   encrypted at rest", a five business day response commitment, and an "EU
//   Data Protection Officer", which is an appointment under Article 37.
//
// What is here says what the deployment does and names what it does not
// hold. Where a commitment needs the founder rather than a copy edit, the
// sentence asks the reader to ask before they sign up, which is the same
// move /security's residency paragraph makes.
//
// The restyle removed three things and no words: the violet hue, the sticky
// table of contents, and the sales button this document used to end on.
const PRIVACY_DESCRIPTION =
  "What WorkwrK collects, why, where it lives, and what you can ask us to do with it. Plain English where possible; legal precision where required.";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: PRIVACY_DESCRIPTION,
  alternates: { canonical: "https://workwrk.com/privacy" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "Privacy policy", description: PRIVACY_DESCRIPTION },
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: PRIVACY_DESCRIPTION },
};

export default function PrivacyPage() {
  return (
    <LegalDoc
      eyebrow={LEGAL_COPY.privacy.eyebrow}
      title={LEGAL_COPY.privacy.h1}
      updated={LEGAL_COPY.privacy.updated}
      lede={LEGAL_COPY.privacy.sub}
      sections={[
        {
          id: "tldr",
          title: "The short version",
          body: (
            <>
              <p>
                We collect the data you give us to run your workspace and the technical data needed to keep it secure.
                We do not sell your data. We do not train AI models on your data.
              </p>
              {/* The blanket compliance sentence is gone. It read "We honor
                  every regional regulation we operate under (GDPR, DPDP,
                  CCPA, LGPD)", while flags.gdpr and flags.dpdp are false and
                  /compare answers "Certifications: None held yet" one click
                  away. Section 5 below still describes the rights a person
                  can exercise, because the rights are real and we honour
                  them on request; what is not claimed is a compliance
                  posture nobody has assessed. */}
              <p>
                We hold no third party privacy certification or audit yet. If a specific regime applies to you, ask us
                what we do about it before you sign up rather than after: the answer will be what is written on this
                page.
              </p>
              <p>
                If you want a deep read, the full policy is below. If you have a question, email{" "}
                <a href={`mailto:${mailboxes.privacy}`}>{mailboxes.privacy}</a>.
              </p>
            </>
          ),
        },
        {
          id: "what",
          title: "1. Information we collect",
          body: (
            <>
              <p>
                <strong>Account data.</strong> Name, email, role, organization. Voluntarily provided when you sign up or
                are invited.
              </p>
              {/* "Stored encrypted at rest" is a control claim, and the one
                  storage control this repo can evidence is the scoping:
                  every query is organisation scoped. Disk level encryption
                  is a property of the deployment, not of the code, so it is
                  not asserted here. */}
              <p>
                <strong>Workspace data.</strong> Everything you put into workwrk: people, KPIs, OKRs, SOPs, tasks,
                kudos. Scoped to your workspace, and reachable only by people you have given access to it.
              </p>
              {/* THE TELEMETRY PARAGRAPH IS GONE, and it was a false
                  disclosure in the over-stating direction, which /cookies
                  argues is the kind a regulator reads first. It claimed
                  "Pages visited, features used, errors hit", aggregated for
                  product improvement. No such pipeline exists: there is no
                  analytics vendor in package.json, no error reporter, and no
                  page-view or feature-usage write anywhere under src/lib or
                  src/app/api. The site's own instrumentation module says as
                  much in its header. /cookies, one click away, renders
                  "Nothing on this site measures you", and the two documents
                  may not disagree about the same fact. */}
              <p>
                <strong>Technical data.</strong> IP, user agent, device type, session timestamps. Used for security,
                auth, and incident response.
              </p>
              {/* Filed separately from technical data because it has a
                  different purpose and a different lawful basis: security and
                  incident response is not what a consent record is for, and
                  /cookies discloses the same row. It is written for anonymous
                  visitors too, keyed to a random token rather than an
                  account, which is the part a reader would not otherwise
                  guess. */}
              <p>
                <strong>Consent records.</strong> When you answer the cookie banner we store your answer with the time,
                your country and region, your IP address and your user agent, as proof of the choice. It is kept whether
                or not you have an account.
              </p>
            </>
          ),
        },
        {
          id: "use",
          title: "2. How we use it",
          // Purpose (d) used to be "improve the product through aggregate
          // analytics", which was the second half of the telemetry claim cut
          // from section 1: there is no analytics pipeline to aggregate
          // anything from. A purpose you have no mechanism for is a purpose
          // you are not entitled to reserve.
          body: (
            <p>
              We use your data only to (a) run your workspace, (b) keep it secure and (c) bill you. We do not use your
              workspace content for advertising or generic-purpose AI training, and we run no product analytics over
              it.
            </p>
          ),
        },
        {
          id: "ai",
          title: "3. AI features and your data",
          body: (
            <>
              {/* "strict zero-retention agreements" describes a contract,
                  and what a third party retains is that third party's
                  commitment rather than ours to repeat. What we can state is
                  what OUR code does: it sends on an action, not on a
                  schedule, and it sends nothing on its own. */}
              <p>
                workwrk uses AI for search, triage, and summarization, through a third party model provider. Your
                workspace content is sent to that provider only when you trigger an AI action. We do not send it on a
                schedule, in the background, or for training, and we do not use your workspace content to train anything
                of our own.
              </p>
              <p>
                Which provider we use, and what their own retention terms say, is a question we will answer in writing
                before you sign up.
              </p>
              {/* THE EMBEDDINGS SENTENCE IS GONE. It read as a protective
                  commitment, which is why it survived the last rewrite, but
                  it told a reader the product builds per-workspace vector
                  embeddings of their content. It does not: there is no vector
                  column, no embedding table in prisma/schema.prisma and no
                  embedding model call in src/lib. The one grep hit for the
                  word is a code comment using it as an English verb. A
                  promise about a data structure that does not exist is still
                  a description of a data structure that does not exist. */}
            </>
          ),
        },
        {
          id: "share",
          title: "4. Who we share with",
          body: (
            <>
              {/* The six named sub-processors were a list for a different
                  deployment. This runs on one self-hosted server, and
                  /security's rewrite deleted the AWS claim as a fabrication.
                  Naming the real ones is a factual exercise nobody has done
                  against the running deployment, and a wrong name in a
                  sub-processor list is worse than no list, so this asks
                  rather than asserts. It is the one paragraph on the page
                  that should become a table the day someone writes the
                  deployment's inventory down. */}
              <p>
                We use a small number of sub-processors to run the service: a hosting provider, a payment processor, a
                transactional email provider and a model provider for the AI features. We will give you the current
                list, by name, in writing, before you sign up or at any point after.
              </p>
              <p>
                Email <a href={`mailto:${mailboxes.privacy}`}>{mailboxes.privacy}</a> and ask for the sub-processor
                list. We will also tell you when it changes.
              </p>
            </>
          ),
        },
        {
          id: "rights",
          title: "5. Your rights",
          body: (
            <>
              {/* "directly in-product (Settings > Privacy)" pointed at a
                  settings page that does not exist. The export and delete
                  sentence below is true: an administrator has both. */}
              <p>
                You can ask us to give you a copy of your personal data, correct it, delete it, or stop a particular use
                of it. Email <a href={`mailto:${mailboxes.privacy}`}>{mailboxes.privacy}</a> and say which. We will not
                ask you to justify the request.
              </p>
              <p>
                Two of these you do not need us for: a workspace administrator can export all workspace data and can
                delete it, from inside the product, without contacting anyone.
              </p>
            </>
          ),
        },
        {
          id: "retention",
          title: "6. Retention",
          body: (
            <>
              <p>
                Account data is retained for the life of your subscription. After termination, we retain workspace data
                for 30 days (in case you reactivate), then permanently delete. Backups are purged 90 days after
                deletion.
              </p>
              <p>Billing data is retained for 7 years per accounting requirements.</p>
            </>
          ),
        },
        {
          id: "regions",
          title: "7. Where your data lives",
          body: (
            /* This section used to offer a choice of three storage regions,
               pinned at workspace creation and honoured for storage,
               retrieval and backups. There is one deployment and no such
               choice exists, which made a privacy policy, of all documents,
               the place the site over-promised hardest. */
            <p>
              There is one deployment, and you do not choose a region for it. If where your data is stored is a
              requirement for you, ask us before you sign up rather than after.
            </p>
          ),
        },
        {
          id: "contact",
          title: "8. Contact",
          body: (
            <>
              {/* The "EU Data Protection Officer" line is gone. A DPO is an
                  appointment under Article 37 with a named person behind it,
                  not a mailbox alias, and dpo@ appeared nowhere in this repo
                  except on this page. */}
              <p>
                Privacy questions: <a href={`mailto:${mailboxes.privacy}`}>{mailboxes.privacy}</a>
              </p>
              <p>Mailing address: WorkwrK Technologies, WeWork ETV, Bellandur, Bengaluru 560103, India.</p>
            </>
          ),
        },
      ]}
    />
  );
}

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
                <strong>Consent records.</strong> When you dismiss the cookie notice we keep a record that it was shown,
                under the random id the wwrk_consent cookie holds, with the time, your IP address and your user agent, and
                your country and region when the request carries them. It is kept whether or not you have an account.
              </p>
              {/* The demo form (/api/demo-request) emails what it collects
                  to the sales mailbox and stores nothing in the product; a
                  prospect who never signs up was told nothing about it. */}
              <p>
                <strong>Demo and contact requests.</strong> When you ask for a demo or write to us, we receive what you
                send: for a demo, your name, work email, company, team size, industry and what you want to see. It goes
                by email to our sales mailbox and is used only to answer you; it is not stored in the product. Email{" "}
                <a href={`mailto:${mailboxes.privacy}`}>{mailboxes.privacy}</a> and we delete it.
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
                  what OUR code does. It sends when a person triggers an AI
                  action, and on a schedule ONLY for the features a workspace
                  sets up to run on one: scheduled agents and the scheduled
                  AI updates in Talk (Batch 8, off until a workspace turns
                  them on). The earlier "never on a schedule" sentence stopped
                  being true when scheduled agents shipped. The AI switch is
                  Settings > Data, "AI features for everyone". */}
              <p>
                workwrk uses AI for search, triage, and summarization, through a third party model provider. Your
                workspace content is sent to that provider when someone in your workspace triggers an AI action, and on a
                schedule only for AI features your workspace sets up to run on one, such as scheduled agents, the routines
                people set up for their AI teammates, and scheduled AI updates in Talk. We do not send it for training, and
                we do not use your workspace content to train anything of our own. An Owner or Admin can turn AI features
                off for the whole workspace.
              </p>
              {/* AI teammates (docs/plans/ai-teammates.md): a teammate acts as
                  the person using it, through the same checks their own
                  requests pass (src/lib/agents/acting.ts); memories are per
                  person, listed and deletable in the Memory tab; a routine
                  belongs to one person and runs on their schedule; anything
                  other people will see waits on an approval card unless the
                  person chose Don't ask (invitations always ask). */}
              <p>
                AI teammates work as the person using them and can see and change only what that person can. What a teammate
                is asked to remember is kept for that person, who can see and delete it in the teammate&apos;s Memory tab, and a
                routine runs only on the schedule its person set. Anything other people would see, such as a post in Talk or a
                comment on a shared task, waits for that person&apos;s approval unless they chose otherwise.
              </p>
              {/* Connecting Google to AI teammates (docs/plans/ai-teammates-phase3.md,
                  Decisions 6, 8, 9 and 16). Only the person connects, their own
                  account, in one workspace, and it is used only in their own
                  chats, continues and routines, never in a Talk answer, an
                  automation or another teammate's ask (Decision 13). A teammate
                  someone else may change uses it only after the person allows
                  it, and again after anyone changes the teammate (6). Sending,
                  replying, answering an invitation and inviting anyone always
                  wait on a card, with no "Don't ask" (8), and after a teammate
                  reads Google in an answer everything else it does in that
                  answer waits too (9). A read's call record keeps only a count;
                  a card keeps what the person approves; tokens are sealed, and
                  ending a connection deletes them and queues a revoke at Google
                  unless the same Google account is still connected elsewhere in
                  WorkwrK (16, 19). The audit log names who connected, never
                  their Google address, which is why this says nothing about
                  Admins seeing counts only. The third paragraph is Google's
                  Limited Use disclosure, which its verification checks for.
                  Review of step 5 added what the code also reads and keeps:
                  at an approval, a reply reads its conversation again and a
                  change, cancel or answer reads its event again under its
                  etag (connector-previews.ts); find_free_time reads the
                  free/busy of up to five live members of the workspace through
                  the person's account (Decision 11); an answer is kept in the
                  run's output too (engine.ts, AgentRun.output.text), which
                  only its person reads (run-query.ts agentRunsWhere). */}
              <p>
                If an Owner or Admin turns it on for your workspace, you can connect your own Google account to your AI
                teammates, for Gmail, Google Calendar or both. Only you can connect it, and it is used only in your own chats
                and routines with the teammates you allow, never when a teammate answers in Talk, for an automation or for
                another teammate. A teammate reads your email or calendar only when it uses one of those tools in an answer,
                and again when you approve what it asked, to check that the email conversation is still there or that the
                event has not changed since it asked. It never opens attachments. To find a time to meet, it can also read,
                through your account, when up to five colleagues in your workspace are busy, never what they are doing.
                Nobody else in your workspace can use your connection or read what a teammate read for you. Sending an
                email, replying, answering an invitation or inviting anyone always waits for your approval. What a teammate
                reads in your email or calendar is sent to our model provider to answer you; we do not send it for training,
                and we do not use it to train any model.
              </p>
              <p>
                We keep your Google tokens encrypted, with the address of the Google account you connected, which only you
                are shown. Of what a teammate reads, we keep only a count of what it found, and what it wrote back to you,
                which stays in your chat with it and in your run history, as every teammate answer does. A request it asks
                you to approve keeps what it would send or change, such as who an email goes to and every word of it, as
                every teammate request does. When you disconnect, when you leave or are
                deactivated in the workspace, and when the workspace is deleted, we delete the tokens and, unless the same
                Google account is still connected elsewhere in WorkwrK, ask Google to remove WorkwrK&apos;s access. You can
                disconnect at any time in your settings, under Calendar &amp; connections.
              </p>
              <p>
                WorkwrK&apos;s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
                <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
                including the Limited Use requirements. We do not use data from Google Workspace APIs to develop, improve or
                train generalized AI or machine learning models.
              </p>
              {/* The computer for AI teammates (docs/plans/ai-teammates-phase4.md,
                  Decisions 6, 9, 11, 12, 16 to 19 and 23, step 5). The browser
                  is the person's alone, for one teammate, in their own
                  one-teammate chat (21), at the browser provider, fresh each
                  time with no saved context and recording off, released when
                  close_browser runs, Stop is pressed, 5 idle minutes pass or
                  its time cap comes (6, 7); the session, live view, steps and
                  pictures routes read by the viewer's own id, so an Owner or
                  Admin sees usage and never a browser (29, 30). Growth and
                  above, and never a trial whatever its plan (4): the sentence
                  names the plan a workspace needs. It opens only a host the
                  teammate's and the workspace's lists both allow, never a
                  private or internal one (9, 10), and once a page was read
                  only a link a page showed (11). Reads run at once;
                  click, type_text and select_option always ask on their own
                  card, with a picture of the page where one could be taken
                  (12). The model reads a page's visible words, redacted and
                  clipped, and never a picture (16, 17). Typing is refused
                  into a field the driver classes as a password, a one-time
                  code, a card number or code or expiry, or a bank account
                  (18); field values never leave the browser, only whether a
                  field is filled (page-reader.ts); while the person has the
                  browser every browser tool is locked and the model hears
                  only { done } (19). No downloads, uploads or PDFs (20), and
                  no stored sign-in profiles (8). Steps keep kind, host,
                  outcome, code and time for 30 days, the sweep deletes them
                  after; pictures are sealed files outside the database and
                  the backups, 24 hours; page text is never kept; a card keeps
                  what it would do; chat and run records keep the host and
                  counts (23); the audit rows name hosts, kinds and roles,
                  never typed text, an element's words or a path (24).
                  Made truer than the spec's words, each after reading the
                  code: "What a page shows" became the words a page shows,
                  never a picture (16); "never types a password" became the
                  fields it recognises, since the refusal is by the field's
                  class (18); "never sees what you type" gained "in a page's
                  fields", since after a take over it may read the page, which
                  can show back what was typed once it was sent;
                  "told only that you finished" became whether, since Give it
                  back is told too (19); "nothing you sign in to is kept"
                  became no sign-in, since the steps and the audit keep the
                  site you signed in on; the steps say how each went, which
                  the row keeps; and the answer, which can quote a page, stays
                  in the chat and the run history as every answer does.
                  Where it runs (docs/plans/browser-host.md Decisions 2, 10
                  and 14, section 9.5): on WorkwrK's own browser server, a
                  machine apart from the app and the database, the only
                  provider production may run (src/lib/browser/disclosed.ts).
                  What that server keeps, which the second paragraph says
                  (Decision 10, made exact in the review of the spec's step
                  4, and again in its final review, privacy M2 and the lows):
                  no copy of a page, a picture or an input once the browser
                  closes (it holds a page's newest picture in memory only
                  while someone watches, to show a viewer who joins), and
                  while it runs, Chrome's own cache, cookies and site storage
                  sit on its container's memory-only disk (a tmpfs), which
                  goes with it, so "never stores" became "keeps no copy once
                  it closes"; its counts; each session's ids, its tag and
                  row, and its times, in memory for an hour after it ends
                  (6.1); its system log of events (journald, with rsyslog
                  masked; one journal file a day, each deleted once its
                  newest line is 14 days old, so at most 15 days), naming no
                  session (the bridges' names carry no id) and holding no
                  address and no content;
                  and the addresses of the people who watch or use a
                  browser, in memory, for its rate limits (3.1). That list
                  is scoped to the browsers and the people who use them,
                  and the addresses to those people, because the server's
                  SSH log keeps the addresses that reach its own port 22. */}
              <p>
                If an Owner or Admin turns it on for your workspace, which needs the Growth plan or above, an AI teammate can
                use a web browser for you, in your own chats with it. The browser runs on a server WorkwrK runs for these
                browsers alone, apart from the servers that hold your workspace, for that one chat and is never shared: nobody else, an Owner or Admin included, can watch it, use it or reach what you sign
                in to in it, and it is closed and deleted when the teammate finishes, after a few idle minutes, or at its time
                limit. A teammate opens only the sites your workspace and that teammate allow, and never private or internal
                addresses. It opens and reads pages at once; every click, every word it types and every choice waits for your
                approval on a card that shows the page. The words a page shows are sent to our model provider to answer you,
                never a picture of the page; we do not send them for training, and we do not use them to train any model. A
                teammate never types into a field it recognises as one for a password, a one-time code or a card number, and
                never sees what you type in a page&apos;s fields: to sign in or pay, you take over the browser yourself while
                the teammate sees nothing, and it is told only whether you finished, then may read the page as you left it.
                It cannot download or upload files, and no sign-in you make in it is kept after the browser closes.
              </p>
              <p>
                For you alone, we keep a list of the steps a teammate took in the browser, the kind of step, the site, how it
                went and when, for 30 days. Pictures of pages shown on its cards and in your chat are kept encrypted for 24
                hours, for you alone, and are not in our backups. We never keep the text of the pages it read; what it wrote
                back to you, and which sites it used, stay in your chat with it and in your run history, as every teammate
                answer does. A request it asks you to approve keeps what it would do, such as the words it would type, as
                every teammate request does. Once the browser closes, that server keeps no copy of the pages it opened, the
                picture of it you watched or what you typed when you took it over. While the browser runs, its own cache,
                cookies and site storage sit on a disk kept only in memory, for that browser alone, and are gone when it
                closes. About the browsers and the people who use them, the server keeps only these: counts, such as how
                many browsers are running; the codes that name each browser and when it ran, until an hour after it closes; a
                system log of events, such as a browser starting or closing or a view of one opening, which holds none of
                those codes, no network address and nothing from a page, for at most 15 days; and, in its memory alone, the
                network addresses of the people who watch or use a browser, to limit how often each may try. Owners and Admins
                see in the audit log which sites a teammate opened for you and what kind of steps it took, never what it read
                or typed.
              </p>
              {/* Teaching AI teammates by showing (docs/plans/ai-teammates-phase5.md,
                  Decisions 6, 7, 9, 10, 14, 15, 18, 19, 22, 24 and 25, step
                  5). Off in production until the founder sets
                  BROWSER_SKILLS_OFFERED (Decision 1, Founder actions 2 and
                  3), and off in every workspace until an Owner or Admin turns
                  on its switch (2), so the paragraph opens with that "if", as
                  the computer's does. A recording is a take over with the
                  recorder on (6): the model runs nothing and hears nothing
                  while it lasts, and after it only whether the person
                  finished. The recorder keeps only the person's own trusted
                  input in the main frame (7), and a step keeps its site and
                  its host and first path part (stepPage), the start page's
                  origin and path with no query (recordableAddress), a
                  control's role and kind and, within rule 1 to 6, the words a
                  person sees on it, a field's or a list's visible label; never
                  a typed character, a chosen option, a field's value, a
                  link's address or a frame's contents; a form or page holding
                  a password, code, card or bank field, or focus in a frame
                  from another site, folds into a step the person does
                  themselves. Pictures are Phase 4's sealed files, 24 hours,
                  the person's alone (9). A skill is one person's, for one
                  teammate, read by their own id on every route (10, 25); the
                  review keeps or removes each step's words (forgetName) and
                  sets each typing or choice to ask each time or a fixed value
                  (11); only a ready skill runs (10). A run starts only from
                  the person's message or Run (15), every click and every link
                  that acts is its own card (18), and a fill card shows every
                  word and says a site may save or send a field at once (19).
                  A skill's routine runs no model and no browser (22). The
                  audit rows carry hosts and counts only, and are the person's
                  and the Owners' and Admins' alone (24); Owners and Admins
                  see the workspace's count of skills and of the people who
                  keep them, and delete every skill unseen (14, 25).
                  Made truer than the spec's words, each after reading the
                  code: "We never keep what you type" became "The steps never
                  keep", and the picture's sentence says it can show what was
                  typed or chosen, since a picture shows the screen (review of
                  step 5, M1); "we keep the pages you visit" became which pages, by
                  their site and the start of their address, since a step
                  keeps its host and first path part and never a page's text;
                  "the words on the buttons and links" gained "and other
                  controls", since a tab, a box or a menu item keeps its words
                  too; "never keep what you type" gained "while you do it",
                  since the review keeps the words the person chooses to type
                  each time; "only then" became "only once you save them",
                  since a draft never runs; "the request says so" became the
                  request that fills in fields for a skill, since that card
                  always says it and a lone choice's card does not; a sentence
                  says the skills' names and steps go to the model provider,
                  as pages do (block 2's list and use_skill's answer, both
                  inside data blocks, Decision 16); "never uses it when you
                  are not there" became "only when you ask in your own chat
                  with it, never by itself", since a run the person started
                  carries on reading pages whether they watch or not; and the
                  audit line names every row it writes (changed and a routine
                  made too) and the counts Owners and Admins see. */}
              <p>
                If an Owner or Admin also turns on teaching by showing, you can show an AI teammate how to do a job by doing it
                once in its browser. While you do it, we keep which pages you visit, by their site and the start of their
                address, the words on the buttons, links and other controls you click, and which fields and lists you use. The
                steps never keep what you type in a field or which option you choose while you do it, nothing about a field we
                recognise as a password, code or card field, and nothing inside a box from another site, such as most card
                forms: those become steps you do yourself each time. The words on a button or link can name a person or a
                record; you see every one when you review the steps, and can remove it. A picture of each page you visit,
                which can show what is on it, what you typed or chose included, is kept for you alone for 24 hours. Your teammate sees nothing while you record.
                You then review the steps and choose for each field whether it asks you each time or types the same words you
                give it; only once you save them can it use the skill. It follows a skill as a guide, reading each page as it
                is at the time, and still asks before every click, every word it types and every choice; some sites save or
                send what is in a field as soon as it is filled in, and a request that fills in fields for a skill says so.
                The names of your skills and what each is for, and a skill&apos;s steps while it follows one, are sent to our
                model provider to answer you, as pages are, and never for training. A skill is yours alone, for that one
                teammate: nobody else, an Owner or Admin included, can see it, use it or copy it, and a teammate uses it only
                when you ask in your own chat with it, never by itself, since a skill&apos;s routine only reminds you. Owners
                and Admins see in the audit log when you recorded, saved, changed or deleted a skill or made a routine from
                one, with its number of steps and its sites, never its name or its steps, and how many skills the workspace
                keeps and by how many people; they can delete every skill in the workspace without seeing any.
              </p>
              {/* "Which provider" became "Which providers" in step 5 of
                  docs/plans/ai-teammates-phase4.md: this section now names a
                  browser provider beside the model provider. Since
                  docs/plans/browser-host.md the browsers run on WorkwrK's own
                  server, and the providers are the model provider and the
                  hosting companies; the plural still holds. */}
              <p>
                Which providers we use, and what their own retention terms say, is a question we will answer in writing
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
                  deployment's inventory down. AI teammates' browsers run on
                  WorkwrK's own browser server (docs/plans/browser-host.md
                  section 9.5), so no browser provider is a sub-processor: the
                  hosting company that rents that server is, named by kind
                  only, as the others are. Founder action 6 of that spec signs
                  its DPA and adds it, the server's location and what runs
                  there to the list sent on request. */}
              <p>
                We use a small number of sub-processors to run the service: hosting providers for our servers, among them
                the one where AI teammates&apos; browsers run when a workspace turns them on, a payment processor, a
                transactional email provider and a model provider for the AI features. We will give you the current list, by
                name, in writing, before you sign up or at any point after.
              </p>
              {/* What the browsers reach by themselves (browser host final
                  review, privacy M4): the container's resolvers are
                  Cloudflare and Quad9 (services/browser-host/lib/ranges.mjs
                  CONTAINER_DNS, 1.1.1.1 and 9.9.9.9), so they see the names
                  of the sites a browser opens; Chrome's own Safe Browsing
                  checks and component updates go to Google; and the managed
                  policy turns off password leak checks, autofill, sync,
                  metrics and sign-in. Every request leaves from the browser
                  server's own address: a person's device reaches only
                  WorkwrK's own server when they watch. Named here, beside
                  the hosting company, by name rather than by kind, since
                  they are fixed in the host's code, not a deployment choice;
                  section 7 says they may answer from outside the region. */}
              <p>
                When a workspace turns them on, AI teammates&apos; browsers also reach three other companies, from
                WorkwrK&apos;s browser server and never from your device. To find each site it opens, a browser asks
                Cloudflare (1.1.1.1) and Quad9 (9.9.9.9), which see the names of those sites. Chrome, the browser they run,
                checks the pages it opens with Google Safe Browsing and fetches its own updates and settings from Google. We
                turn off Chrome&apos;s password leak checks, autofill, sync, usage reports and sign-in.
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
                Two of these you do not need us for: a workspace administrator can export the workspace&apos;s people,
                tasks, Docs, SOPs, Tables, Goals and review cycles, and can delete the workspace, from inside the
                product, without contacting anyone. Files and attachments, images inside Docs, canvases, forms, chat,
                Doc comments and review answers are not in the export yet; ask us for a copy of those.
              </p>
            </>
          ),
        },
        {
          id: "retention",
          title: "6. Retention",
          body: (
            <>
              {/* Batch 14: a workspace closed by WorkwrK staff is now deleted
                  on the same 30 day schedule as one its Owner deletes
                  (src/lib/admin/company-patch.ts); the hard delete frees the
                  files the workspace provably stored (src/lib/company-files.ts)
                  and says plainly which older uploads it cannot tell apart;
                  the nightly backup keeps at most 90 days
                  (scripts/backup/backup.sh BACKUP_KEEP_DAYS). The closure date
                  is the first full day the staff closure's schedule is live
                  (Batch 14 deploys on 6 October 2026), named outright so it
                  never moves with "Last updated"; LAUNCH-CHECKLIST.md names
                  the same date for the closures made before it. */}
              <p>
                Account data is retained for the life of your subscription. After termination, when you delete the
                workspace, or when we close it (from 7 October 2026), we retain workspace data
                for 30 days (in case you reactivate), then permanently delete it, with the files it stored. Some files
                uploaded before 6 October 2026 were not recorded against
                the workspace they were for, so the deletion cannot tell them apart and keeps them: email{" "}
                <a href={`mailto:${mailboxes.privacy}`}>{mailboxes.privacy}</a> and we delete them by hand. Backups keep a
                copy for at most 90 days, so a deleted workspace is gone from them within 90 days of its deletion.
              </p>
              {/* Google for AI teammates (docs/plans/ai-teammates-phase3.md,
                  Decisions 16 and 19): ending a connection deletes it and
                  queues its revoke in one transaction; the queue row holds the
                  sealed token alone until Google confirms, and is dropped after
                  its last try or seven days. Review of step 5: the nightly
                  backups (scripts/backup/backup.sh, each file encrypted, at
                  most 90 days) hold those rows, sealed, like every other row.
                  Review round 3 of Phase 3: deleting one's account
                  (src/app/api/me/delete) now blanks the words of the
                  person's teammate chats, of the requests they were asked to
                  approve and of their runs' output, so "stays" ends there.
                  Review round 5 of Phase 3: the account goes at once and the
                  words in batches after it, the request's own pass, then the
                  teammates cron every ten minutes
                  (src/lib/agents/erasure-sweep.ts), so a very long history
                  can take a while; "within a day" leaves the cron room to
                  catch up. Review round 6 of Phase 3: the worst case is
                  longer than a day. Each erasure goes on from where it
                  stopped and shares each tick's 20 seconds with the others,
                  and one more whole pass runs two hours after the request,
                  so a history of about a million rows, or many erasures at
                  once, takes up to a few days (one unfinished after three
                  days alerts ops). */}
              <p>
                Google connection tokens are deleted when you disconnect or leave, as above; if Google has not yet confirmed
                that WorkwrK&apos;s access is removed, one encrypted token is kept until it does, for at most seven days. Our
                encrypted backups hold the encrypted tokens too, for at most 90 days, as above. What a teammate wrote back to
                you stays in your chat with it and in your run history, and its requests stay as every teammate request does,
                until you delete your account, which erases their words at once for most histories, or within a few days for a very long one.
              </p>
              {/* The computer for AI teammates (docs/plans/ai-teammates-phase4.md
                  Decision 23, step 5): the teammates cron's browser sweep
                  (src/lib/browser/sessions.ts sweepBrowserSessions) deletes
                  steps older than 30 days and pictures past their 24 hours
                  (src/lib/browser/shots.ts, which refuses one past its time
                  before the sweep comes). The steps are rows, so the nightly
                  database dump holds them like every other row, for at most
                  90 days; the pictures are sealed files in BROWSER_SHOTS_DIR,
                  which browser/config.ts refuses anywhere inside the app's
                  folder, and scripts/backup/backup.sh copies only the
                  database and the app's two upload folders. That backups
                  sentence is beyond the spec's, which named only the 30 days
                  and the 24 hours. */}
              <p>
                A teammate&apos;s browser steps are deleted 30 days after they were taken, and pictures of pages 24 hours after
                they were taken. Our encrypted backups hold the steps, as they hold every other record, for at most 90 days,
                and never the pictures.
              </p>
              {/* Teaching AI teammates by showing (docs/plans/ai-teammates-phase5.md
                  Decision 14, step 5): a skill goes when its person deletes
                  it (manage.ts deleteOwnSkill), with Delete every skill
                  (deleteEverySkill), with the account's erasure (the erasure
                  sweep's part "browser") and with the workspace (its key
                  cascades). orphanedAt is set when its person leaves or is
                  deactivated, or its teammate is removed, and the sweep
                  deletes it 30 days later only after checking again that it
                  is still unusable (orphans.ts); a return clears it. A
                  removed teammate's skills stay in its drawer and in My
                  account's Your data card (review of step 3, M2). The
                  skills are rows, so the nightly dump holds them for at most
                  90 days (scripts/backup/backup.sh); the pictures are Phase
                  4's sealed files, never in it. Made truer than the spec's
                  words: "If you leave the workspace" gained "or are
                  deactivated", the return that keeps a skill is said for the
                  person as well as the teammate, and the place a removed
                  teammate's skills stay names the account's list too. */}
              <p>
                A skill is kept until you delete it, an Owner or Admin deletes every skill in the workspace, or your account
                or the workspace is erased. If you leave the workspace or are deactivated, or its teammate is removed, the
                skill is deleted 30 days later, unless you or the teammate come back before then; until then a removed
                teammate&apos;s skills stay listed for you to delete, in its settings and in your account. Our encrypted
                backups hold a skill, as they hold every other record, for at most 90 days after it is deleted. Pictures taken
                while you record are deleted after 24 hours, as other pictures of pages, and are never in our backups.
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
            <>
              <p>
                There is one deployment, and you do not choose a region for it. If where your data is stored is a
                requirement for you, ask us before you sign up rather than after.
              </p>
              {/* The computer for AI teammates (docs/plans/ai-teammates-phase4.md
                  Decision 25, step 5): one region per deployment,
                  BROWSER_REGION, chosen under the provider's DPA. The settings
                  section shows it (teammate-browser-section.tsx regionLine)
                  only to Owners and Admins, so the sentence names them rather
                  than saying Settings shows it to everyone. Our own browser
                  server's region (docs/plans/browser-host.md section 9.5 and
                  Founder action 1): where that server is rented, which the
                  host checks every create against (3.2), so the region line
                  is never false. The lookups and Google's checks leave it
                  (browser host final review, privacy M4): Cloudflare, Quad9
                  and Google answer from wherever their own networks do, so
                  the second sentence says so rather than let "one region"
                  read as everything a browser sends. */}
              <p>
                An AI teammate&apos;s browser runs on WorkwrK&apos;s own server, in one region for this deployment, which
                Owners and Admins see in Settings, Apps &amp; modules. The names of the sites it looks up, and Chrome&apos;s
                checks and updates with Google, go to the companies section 4 names, which may answer from outside that
                region.
              </p>
            </>
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

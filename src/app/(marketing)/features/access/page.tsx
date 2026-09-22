// /features/access, rewritten against the product (access-model-spec step 5).
//
// What it used to say, and why every line of it had to go: "RBAC + SAML SSO
// + SCIM provisioning + per-record scoped sharing + audit log + per-region
// data residency", a capability card naming Okta, Azure AD, Google
// Workspace, OneLogin and Auth0, a second card offering EU, India or US
// data residency, and an FAQ answering "What compliance certs do you hold?"
// with "SOC 2 Type II, ISO 27001, GDPR + DPDP (India). HIPAA available for
// Scale customers". Every one of those answers to a flag in flags.ts and
// every one of those flags is false, so the page contradicted /security,
// which says in as many words that no third party certification is held.
//
// One deliberate deviation from the spec, recorded rather than hidden:
// access-model-spec step 5 asks this page to "describe four roles", and the
// four roles (Owner, Admin, Member, Guest) are the model that spec BUILDS.
// The shipped model is the AccessLevel ladder in src/lib/access-levels.ts
// (C-Level, VP, Director, Manager, Team Lead, HR, Employee, Agent, over
// Company Admin and Super Admin) plus the additive object grants. A
// marketing page describing the roles a customer will get after a migration
// is the same class of claim as a certification nobody holds, so this page
// describes the ladder that runs today and will be rewritten to the four
// roles the week they ship.
//
// THE DEVIATION HAS TO BE KEPT IN ONE DIRECTION, and it was not.
//
// The page argued the four-role model was premature in its header and then
// described the invite dialog as offering "one of the four roles", with the
// marketing-lite surface drawing a chip reading "Member". Member is not a
// value of the shipped enum, so the one public page about access taught a
// vocabulary the product does not answer to, in the picture, while the prose
// declined to teach it. The surface now shows a level the ladder really has,
// and the ladder's own names are written into the capability card below, so
// a reader of this page learns the words they will meet on their first
// invite screen. The day the four roles ship, this comment, that card and
// the surface change together.

import type { Metadata } from "next";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "Access and roles",
  description:
    "Who can see what, at every level: the workspace ladder, additive sharing on a Space, Folder, List or Doc, and a security activity log. No certification is claimed here that we do not hold.",
  alternates: { canonical: "https://workwrk.com/features/access" },
  openGraph: {
    images: [OG_DEFAULT_IMAGE],
    title: "Access and roles",
    description:
      "The workspace ladder, additive sharing at every level, and a security activity log. What we hold, and what we do not.",
  },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "The workspace ladder, additive sharing at every level, and a security activity log. What we hold, and what we do not." },
};

export default function AccessFeaturePage() {
  return (
    <FeatureSubPage
      slug="access"
      hubSlug="settings"
      eyebrow="Across every block"
      title="Who can see what, decided once."
      lede="A task, a doc, a table and a channel all answer the same question the same way."
      capabilities={[
        { title: "The workspace ladder",
          body: "Every person holds one workspace level: Company Admin, then C-Level, VP, Director, Manager, Team Lead, HR, Employee or Agent. The level decides the settings pages and the people data; it never decides one object at a time.",
        },
        { title: "Additive grants",
          body: "A Space, a Folder, a List, a Board or a Doc can be shared directly. A grant adds reach and never takes it away, so sharing a folder does not require handing over the Space around it.",
        },
        { title: "Member can write",
          body: "Contributing and managing are separate. A member of a Space or a List can create and edit the work in it without being able to rename, move or delete the container.",
        },
        { title: "Security activity log",
          body: "Sign-ins, password changes, sign-out-everywhere and the sessions holding your account, on your own account page. An org-wide audit view sits behind the manager gate.",
        },
        { title: "Sign-in hardening",
          body: "Brute force lockout, hashed reset tokens, a password policy, idle session expiry, a real sign-out that invalidates the token, and two step verification at login.",
        },
        { title: "What we do not claim",
          body: "No certification, no SSO or directory provisioning, and no choice of storage region. When any of those ship they will be named on the security page with their evidence, and not before.",
        },
      ]}
      workflowTitle="How a permission is actually decided."
      workflowSteps={[
        "Start from the person's workspace level",
        "Add every grant they hold on the object, and on the containers above it",
        "Take the strongest of those, because a grant only ever adds",
        "Assigning someone a task grants them the task, so work is never invisible to the person doing it",
      ]}
      surfaceKey="invite-modal"
      surfaceCrumb="Members"
      surfaceLabel="The invite dialog: a person added to the workspace with a level on the ladder chosen for them."
      relatedSlugs={["people", "sops"]}
      faq={[
        {
          q: "What certifications do you hold?",
          a: "None. We hold no third party security certification today. When one exists it will be named on the security page with its report, and not before.",
        },
        {
          q: "Can I require multi factor authentication?",
          a: "Yes. Two step verification at login is enforced for the workspace, and sign-in hardening (lockout, password policy, idle expiry, real sign-out) is on for every account.",
        },
        {
          q: "Do you support single sign-on or directory provisioning?",
          a: "Not yet. There is no identity provider connection and no automatic provisioning, so a person is invited and removed by an admin.",
        },
        {
          q: "Can I choose where the data is stored?",
          a: "No. There is one deployment and you do not get to pick its region. Say so in your security review rather than finding out later.",
        },
      ]}
    />
  );
}

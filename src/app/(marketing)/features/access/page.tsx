import type { Metadata } from "next";
import { ShieldCheck, Key, FileText, Users, Lock, Layers } from "lucide-react";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Access & Roles — WorkwrK",
  description: "Role-based permissions, SAML SSO, SCIM provisioning, scoped sharing, full audit log. Built for security teams who actually have to defend the platform.",
  alternates: { canonical: "https://workwrk.com/features/access" },
};

export default function AccessFeaturePage() {
  return (
    <FeatureSubPage
      hubSlug="people"
      hue="violet"
      eyebrow="People hub · Access & Roles"
      title={<>Access controls <GradientText hue="violet">your CISO will sign off on.</GradientText></>}
      lede="RBAC + SAML SSO + SCIM provisioning + per-record scoped sharing + audit log + per-region data residency. Built for the security review, not the sales pitch."
      capabilities={[
        { icon: ShieldCheck, title: "Role-based access", body: "Predefined roles (Admin, Manager, IC, Guest) + unlimited custom roles. Granular per-hub, per-action permissions." },
        { icon: Key,         title: "SAML SSO + SCIM",   body: "Okta, Azure AD, Google Workspace, OneLogin, Auth0. SCIM provisioning auto-deactivates departing users." },
        { icon: Lock,        title: "Scoped sharing",    body: "Share a record (a person, an SOP, a KPI) with specific people for a set time. Auto-expire support." },
        { icon: FileText,    title: "Audit log",         body: "Every read, write, export, share — logged with user, timestamp, IP, device. Searchable; exportable; tamper-evident." },
        { icon: Layers,      title: "Data residency",    body: "EU, India, or US data residency. Pinned at workspace creation; honored end-to-end for storage, AI, and backups." },
        { icon: Users,       title: "Guest accounts",    body: "Free guest accounts for contractors, board members, external auditors. Scoped read-only access; never count toward seat billing." },
      ]}
      relatedSlugs={["people", "sops"]}
      faq={[
        { q: "What compliance certs do you hold?",       a: "SOC 2 Type II, ISO 27001, GDPR + DPDP (India). HIPAA available for Scale customers in regulated industries." },
        { q: "Can I require MFA?",                         a: "Yes — workspace-level enforcement, optional per-role override, hardware-key support via WebAuthn." },
        { q: "How long is the audit log retained?",       a: "12 months on Growth, configurable up to 7 years on Scale. Exports to your SIEM via webhook." },
      ]}
    />
  );
}

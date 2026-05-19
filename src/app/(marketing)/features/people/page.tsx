import type { Metadata } from "next";
import { Users, Network, FileText, ShieldCheck, MapPin, Award } from "lucide-react";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "People — WorkwrK",
  description: "Org chart, profiles, roles, and history. The source of truth for who's who. A profile is a 360-degree dossier — performance, comp, kudos, history.",
  alternates: { canonical: "https://workwrk.com/features/people" },
};

export default function PeopleFeaturePage() {
  return (
    <FeatureSubPage
      hubSlug="people"
      hue="violet"
      eyebrow="People hub · People"
      title={<>One <GradientText hue="violet">profile</GradientText> for every person.</>}
      lede="Org chart, roles, locations, comp band, performance history, kudos count — the 360° dossier that replaces five HR tabs and the BambooHR upsell page."
      capabilities={[
        { icon: Network,    title: "Live org chart",     body: "Tree, list, or map view. Restructure by drag. Reports-to changes propagate through everything." },
        { icon: Users,      title: "Role + multi-role",  body: "Many people wear two hats. workwrk supports it: KRAs, KPIs, comp bands stack by role." },
        { icon: FileText,   title: "Profile = dossier",  body: "Performance, comp, history, kudos, manager notes, certifications, documents. All on one page." },
        { icon: MapPin,     title: "Multi-location",     body: "Locations are first-class. Per-location dashboards, per-location KPIs, per-location SOPs." },
        { icon: Award,      title: "Recognition count",  body: "Kudos received counted on the profile. Public, optional leaderboard. Real social proof." },
        { icon: ShieldCheck,title: "Scoped sharing",      body: "Managers see their reports; reports see themselves; HR sees everyone. Audit log for every access." },
      ]}
      relatedSlugs={["access", "reviews", "kudos", "kras"]}
      faq={[
        { q: "How does this differ from BambooHR?",        a: "BambooHR is HR admin. workwrk People is the operational source-of-truth: roles, KPIs, perf, kudos, history. Together with the rest of workwrk, replaces an HRMS for most teams." },
        { q: "Can I bulk-import employees?",                a: "CSV import + native integrations with BambooHR, Workday, Rippling, Justworks for migration. Re-syncs supported." },
        { q: "What about contractors and external folks?",  a: "Free guest accounts for contractors, external auditors, board members. Only paid users count toward your seat count." },
      ]}
    />
  );
}

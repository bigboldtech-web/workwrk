// /features/people, rewritten against the product. The old page compared
// itself to three named HR products and promised native connections to
// four more, all under a flag that is false.

import type { Metadata } from "next";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { OG_DEFAULT_IMAGE, OG_DEFAULT_TWITTER_IMAGE } from "@/components/marketing/og";

export const metadata: Metadata = {
  title: "People",
  description:
    "Directory, org chart, roles, departments and offices, with each person's result areas, goals and review history on one page.",
  alternates: { canonical: "https://workwrk.com/features/people" },
  openGraph: { images: [OG_DEFAULT_IMAGE], title: "People", description: "Directory, org chart, roles and history." },
  // The root layout's twitter:description still reads "Replaces 15 tools",
  // which collides with the fourteen this site counts everywhere else.
  twitter: { images: [OG_DEFAULT_TWITTER_IMAGE], card: "summary_large_image", description: "Directory, org chart, roles and history." },
};

export default function PeopleFeaturePage() {
  return (
    <FeatureSubPage
      slug="people"
      hubSlug="teams"
      eyebrow="Teams"
      title="Every seat, and what it owns."
      lede="The chart, the roles and what each seat is accountable for, and payroll, benefits, leave and attendance are not ours."
      capabilities={[
        { title: "Directory", body: "Every person with their role, department, office and manager, searchable and filterable." },
        { title: "Org chart", body: "The reporting line as a chart, including dotted lines, edited in place rather than redrawn in a slide." },
        { title: "Roles", body: "A role definition page carrying the result areas, the processes it owns and the boundaries it escalates past." },
        { title: "Departments and offices", body: "Structure that filters everything else: a goal, a review cycle, a directory view." },
        { title: "History on the person", body: "Their result areas, their goals, their review cycles and their recognitions, on one page rather than five." },
        { title: "Access follows the chart", body: "A manager sees their own line. Change the chart and the reach changes with it, instead of somebody remembering to." },
      ]}
      surfaceKey="role-page"
      surfaceCrumb="Directory"
      surfaceLabel="The Teams block: a role definition page showing who holds the role, what it owns and where it escalates."
      relatedSlugs={["kras", "reviews", "access"]}
      faq={[
        { q: "Is this a payroll or HRMS system?", a: "No. Payroll, benefits, leave and attendance are not in this product, and we would rather say that than sell a module that does not exist." },
        { q: "How do people get in?", a: "By invitation from an admin, or by CSV. There is no directory provisioning and no single sign-on." },
        { q: "Can I export the directory?", a: "Yes, to CSV, along with the other exports on the data page." },
      ]}
    />
  );
}

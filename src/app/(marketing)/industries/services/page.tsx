import type { Metadata } from "next";
import { Briefcase, DollarSign, Clock, Users, BarChart3, FileText } from "lucide-react";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "WorkwrK for Professional Services",
  description: "Projects, billables, capacity, client portals — the operating system for agencies, consulting firms, and professional services teams.",
  alternates: { canonical: "https://workwrk.com/industries/services" },
};

export default function ServicesIndustryPage() {
  return (
    <IndustrySubPage
      hue="pink"
      eyebrow="Professional Services"
      title={<>Projects, billables, <GradientText hue="pink">capacity — solved.</GradientText></>}
      lede="Agencies, consulting firms, IT services — billable utilization, project P&L, capacity by role. The operating system Harvest + Asana + Lattice can't be when they live in different tabs."
      pains={[
        "Utilization is calculated weekly in a spreadsheet that the finance team distrusts.",
        "Project margin is only knowable two months after the project ends.",
        "Resource planning is a calendar, not a system. New work breaks the calendar.",
        "Promotion conversations rely on subjective recall instead of utilization + perf data.",
      ]}
      capabilities={[
        { icon: Briefcase, title: "Project P&L",          body: "Per-project revenue, cost, margin — calculated daily. Drill into hours, expenses, vendor spend." },
        { icon: Clock,     title: "Billable utilization", body: "Auto-calculated from timesheets, tied to KPI engine. Per-person, per-role, per-team views." },
        { icon: Users,     title: "Capacity planning",    body: "Who's free, who's loaded, who's about to roll off. Drag-and-drop to staff new projects." },
        { icon: DollarSign,title: "Comp tied to perf",     body: "Utilization + project margin + client kudos → composite perf → comp recommendations." },
        { icon: BarChart3, title: "Pipeline + delivery",   body: "Sales pipeline and delivery capacity in one platform. Win a deal → capacity check auto-flags." },
        { icon: FileText,  title: "Client portals",        body: "Scoped portals for client stakeholders. They see their projects, their KPIs, their invoices — and nothing else." },
      ]}
      kpis={["Billable utilization", "Project margin %", "Realization rate", "Bench %", "Pipeline coverage", "Client NPS", "Time-to-staff", "Effective hourly rate"]}
      faq={[
        { q: "Does it replace Harvest / Toggl?",         a: "Timesheets are first-class in workwrk. Migrations from Harvest and Toggl are common; most teams cut them in the first 90 days." },
        { q: "Multi-currency for global clients?",        a: "Yes — per-project currency, FX-aware margin reporting, consolidated to your base currency at the close of period." },
        { q: "Client-facing reporting?",                   a: "Scoped client portals on Growth+. Branded white-label portals on Scale." },
      ]}
    />
  );
}

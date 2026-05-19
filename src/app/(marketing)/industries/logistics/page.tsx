import type { Metadata } from "next";
import { Truck, MapPin, Clock, Users, Route, ShieldCheck } from "lucide-react";
import { IndustrySubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "WorkwrK for Logistics & Fleet",
  description: "Routes, hubs, drivers, daily SLAs — managed as KPIs. SOPs for hub ops, driver onboarding, fleet KPIs that managers actually use.",
  alternates: { canonical: "https://workwrk.com/industries/logistics" },
};

export default function LogisticsIndustryPage() {
  return (
    <IndustrySubPage
      hue="amber"
      eyebrow="Logistics"
      title={<>Fleet, hubs, routes. <GradientText hue="amber">Operationalized.</GradientText></>}
      lede="From first-mile to last-mile, run logistics on KPIs and SOPs instead of WhatsApp groups. Per-hub dashboards, driver onboarding flows, SLA-as-a-KPI from minute one."
      pains={[
        "Daily SLAs are tracked in a sheet that someone updates at 7pm.",
        "Driver onboarding takes a week of paperwork and three hand-offs.",
        "Hub managers don't have their numbers in real time, so they don't act in real time.",
        "Compliance training expires and nobody knows until an inspector asks.",
      ]}
      capabilities={[
        { icon: Truck,       title: "Fleet + driver profiles",  body: "Every driver is a profile: licenses, training compliance, perf, kudos count, route performance." },
        { icon: Route,       title: "Route SLA → KPI",          body: "On-time %, exception rate, dwell time — tracked per route, rolled up per hub and region." },
        { icon: MapPin,      title: "Per-hub dashboards",       body: "Hub manager sees their hub; regional sees their cluster; ops director sees the network." },
        { icon: Clock,       title: "Shift-aware scheduling",   body: "Shift bidding, swap requests, attendance tied to KPIs. WhatsApp-free coordination." },
        { icon: ShieldCheck, title: "Compliance training",      body: "License/training expiry tracked. Auto-assigned refreshers. Audit-ready evidence." },
        { icon: Users,       title: "Driver onboarding",         body: "Forkable onboarding journey: docs, training, mentor pairing, first-week check-ins. Cut ramp from 2 weeks to 3 days." },
      ]}
      kpis={["On-time delivery %", "Exception rate", "Dwell time", "Route adherence", "Driver utilization", "Training compliance", "Incident rate", "Cost per stop"]}
      testimonial={{
        quote: "Hub managers stopped messaging me at 7pm with their daily numbers. The dashboards do it now.",
        author: "Karim Al-Saadi",
        role: "VP Ops",
        company: "Stratum Logistics",
      }}
      faq={[
        { q: "Do you integrate with TMS / FMS systems?",     a: "Yes — Locus, Shipsy, FarEye on Growth. Custom integrations to internal TMS available on Scale." },
        { q: "Mobile-friendly for drivers + hub staff?",      a: "PWA on Growth; full native iOS/Android with offline support on Scale." },
        { q: "What about contractors and gig drivers?",        a: "Free guest accounts. Scoped to their routes only. Don't count toward billing." },
      ]}
    />
  );
}

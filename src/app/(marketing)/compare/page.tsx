import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus, ArrowRight } from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  H1,
  H2,
  Button,
  CTABand,
  GradientText,
  HUES,
  type Hue,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Compare — WorkwrK",
  description: "WorkwrK vs. Workday, BambooHR, Rippling, Lattice, ClickUp. Honest comparisons — where we win, and where we don't.",
  alternates: { canonical: "https://workwrk.com/compare" },
};

const COMPETITORS: readonly { name: string; hue: Hue; we: string; they: string; honest: string }[] = [
  {
    name: "Workday",
    hue: "indigo",
    we: "Built for the SMB → mid-market segment Workday ignores. 8-week deployment, not 18 months. $8/user, not 'call sales'.",
    they: "Built for Fortune 500. Regulated payroll, complex multi-entity org structures, enterprise procurement.",
    honest: "Workday wins above 5,000 seats and in heavily-regulated payroll. We win everywhere else.",
  },
  {
    name: "BambooHR",
    hue: "amber",
    we: "Full operating system: KPIs, OKRs, SOPs, perf, kudos, money, growth. BambooHR is HR admin only.",
    they: "Best-in-class HR admin (payroll, leave, attendance, time tracking).",
    honest: "Need US payroll + benefits? Pair BambooHR with us, or wait for our payroll module (Q1 2027).",
  },
  {
    name: "Rippling",
    hue: "violet",
    we: "Operational layer (KPIs, perf, SOPs, kudos) Rippling doesn't have. Hub model means consolidation that EOR/PEO bundles don't deliver.",
    they: "All-in-one EOR + PEO + IT provisioning + payroll. Strong on global hiring.",
    honest: "Hiring globally and need EOR/PEO? Pair Rippling with us. Already have payroll covered? We replace far more.",
  },
  {
    name: "Lattice",
    hue: "fuchsia",
    we: "Lattice is a perf tool. We have perf + KPIs + OKRs + SOPs + people + money + culture + growth. Performance is one of seven things.",
    they: "Specialized perf reviews + 1:1s + engagement surveys.",
    honest: "Want just perf reviews? Lattice is great. Want operational data feeding into perf? That's us.",
  },
  {
    name: "ClickUp",
    hue: "pink",
    we: "ClickUp is a project management tool. We have project management as a third of one hub. Plus the rest of the business operating system.",
    they: "Strongest task / project management UX in the category. Very flexible.",
    honest: "Just need task management? ClickUp is faster to learn. Need the operating layer above it? That's us.",
  },
];

const MATRIX = [
  { label: "Org chart + roles + people",        we: true,  workday: true,  bamboo: true,  rippling: true,  lattice: false, clickup: false },
  { label: "KPI engine with composite scoring",  we: true,  workday: "Add-on", bamboo: false, rippling: false, lattice: false, clickup: false },
  { label: "OKRs with cascade",                   we: true,  workday: false, bamboo: false, rippling: false, lattice: true,  clickup: true  },
  { label: "SOPs with audit trail",               we: true,  workday: "Add-on", bamboo: false, rippling: false, lattice: false, clickup: false },
  { label: "Tasks + projects (board/list/cal)",   we: true,  workday: false, bamboo: false, rippling: false, lattice: false, clickup: true  },
  { label: "Performance reviews (360°)",           we: true,  workday: true,  bamboo: "Lite", rippling: "Lite", lattice: true,  clickup: false },
  { label: "Kudos + recognition built-in",         we: true,  workday: false, bamboo: false, rippling: false, lattice: "Lite", clickup: false },
  { label: "AI as runtime (Cmd-K, signals)",       we: true,  workday: false, bamboo: false, rippling: false, lattice: "Lite", clickup: false },
  { label: "Spend + procurement",                  we: true,  workday: true,  bamboo: false, rippling: "Lite", lattice: false, clickup: false },
  { label: "US payroll + benefits",                we: "2027",workday: true,  bamboo: true,  rippling: true,  lattice: false, clickup: false },
  { label: "INR / AED / SGD first-class",          we: true,  workday: false, bamboo: false, rippling: false, lattice: false, clickup: true  },
  { label: "Free under 5 users",                    we: true,  workday: false, bamboo: false, rippling: false, lattice: false, clickup: true  },
];

export default function ComparePage() {
  return (
    <>
      <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
        <Container>
          <div className="max-w-3xl">
            <Eyebrow hue="violet" className="mb-5">Compare</Eyebrow>
            <H1>
              How workwrk <GradientText hue="violet">stacks up.</GradientText>
            </H1>
            <p className="mt-6 text-lg lg:text-xl text-slate-600 leading-relaxed max-w-2xl">
              Honest comparisons. Where we win, where we don&apos;t. We&apos;ll tell you if
              another tool fits better — really.
            </p>
          </div>
        </Container>
      </Section>

      <Section py="lg">
        <Container>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[720px] bg-white">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left p-4 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 w-2/5">Capability</th>
                  <th className="p-4 text-center">
                    <span className="block text-xs font-bold text-violet-700">workwrk</span>
                  </th>
                  <th className="p-4 text-center text-xs font-bold text-slate-700">Workday</th>
                  <th className="p-4 text-center text-xs font-bold text-slate-700">BambooHR</th>
                  <th className="p-4 text-center text-xs font-bold text-slate-700">Rippling</th>
                  <th className="p-4 text-center text-xs font-bold text-slate-700">Lattice</th>
                  <th className="p-4 text-center text-xs font-bold text-slate-700">ClickUp</th>
                </tr>
              </thead>
              <tbody>
                {MATRIX.map((row) => (
                  <tr key={row.label} className="border-t border-slate-100">
                    <td className="p-4 text-sm text-slate-700">{row.label}</td>
                    <Cell v={row.we} highlight />
                    <Cell v={row.workday} />
                    <Cell v={row.bamboo} />
                    <Cell v={row.rippling} />
                    <Cell v={row.lattice} />
                    <Cell v={row.clickup} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      <Section variant="tint" py="lg">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow hue="fuchsia" className="mb-4">Honest takes</Eyebrow>
            <H2>Where workwrk <GradientText hue="fuchsia">wins — and doesn&apos;t.</GradientText></H2>
          </div>
          <div className="mt-10 space-y-5">
            {COMPETITORS.map((c) => {
              const t = HUES[c.hue];
              return (
                <div key={c.name} className="grid lg:grid-cols-[200px_1fr] gap-6 p-7 bg-white border border-slate-200 rounded-2xl">
                  <div>
                    <p className={`text-xs font-bold uppercase tracking-[0.16em] ${t.text}`}>vs.</p>
                    <p className="mt-1 text-2xl font-extrabold text-slate-900 tracking-tight">{c.name}</p>
                  </div>
                  <div className="space-y-3 text-sm">
                    <p><span className="font-bold text-emerald-700">Where we win.</span> <span className="text-slate-700">{c.we}</span></p>
                    <p><span className="font-bold text-slate-900">Where they win.</span> <span className="text-slate-700">{c.they}</span></p>
                    <p className="text-slate-600 italic"><span className="font-bold not-italic">Honest take.</span> {c.honest}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Container>
      </Section>

      <CTABand
        hue="violet"
        title={<>Still <GradientText hue="amber">on the fence</GradientText>?</>}
        body="Talk to us — we'll tell you honestly if another tool fits better."
        primary={{ label: "Talk to sales", href: "/demo" }}
        secondary={{ label: "Try it free",  href: "/signup" }}
      />
    </>
  );
}

function Cell({ v, highlight = false }: { v: boolean | string; highlight?: boolean }) {
  const cls = highlight ? "bg-violet-50" : "";
  return (
    <td className={`p-4 text-center ${cls}`}>
      {v === true ? (
        <Check size={16} className={`inline ${highlight ? "text-violet-700" : "text-emerald-600"}`} />
      ) : v === false ? (
        <Minus size={16} className="inline text-slate-300" />
      ) : (
        <span className={`text-[11px] font-bold ${highlight ? "text-violet-700" : "text-slate-500"}`}>{v}</span>
      )}
    </td>
  );
}

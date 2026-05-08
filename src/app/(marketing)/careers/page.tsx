// Public careers page. Lists every OPEN Job across the WorkwrK
// site itself (we eat our own dog food — these are real WorkwrK
// openings). Org-aware deployments serving career.acme.com would
// resolve org from the host header in proxy.ts and filter by it;
// for now this page surfaces the canonical workwrk.com org.

import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { ArrowRight, Briefcase, MapPin, Building } from "lucide-react";

export const metadata: Metadata = {
  title: "Careers — WorkwrK",
  description:
    "Open roles at WorkwrK. We're building the operating system that lets every business run with the rigor of a Fortune 500 — without the bureaucracy.",
};

export const dynamic = "force-dynamic";

const PUBLIC_ORG_SLUG = process.env.PUBLIC_CAREERS_ORG_SLUG ?? "workwrk";

type JobRow = {
  id: string;
  title: string;
  description: string | null;
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN" | "TEMPORARY";
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  department: { name: string } | null;
};

const TYPE_LABEL: Record<JobRow["employmentType"], string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERN: "Internship",
  TEMPORARY: "Temporary",
};

function fmtSalary(min: number | null, max: number | null, currency: string): string | null {
  if (!min && !max) return null;
  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${currency} ${n.toFixed(0)}`;
    }
  };
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  return min ? `${fmt(min)}+` : `Up to ${fmt(max!)}`;
}

export default async function CareersPage() {
  const org = await prisma.organization.findFirst({
    where: { slug: PUBLIC_ORG_SLUG },
    select: { id: true, name: true },
  });

  const jobs: JobRow[] = org
    ? (await prisma.job.findMany({
        where: { organizationId: org.id, status: "OPEN" },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          description: true,
          employmentType: true,
          location: true,
          salaryMin: true,
          salaryMax: true,
          salaryCurrency: true,
          department: { select: { name: true } },
        },
      })).map((j) => ({
        ...j,
        salaryMin: j.salaryMin ? Number(j.salaryMin) : null,
        salaryMax: j.salaryMax ? Number(j.salaryMax) : null,
      }))
    : [];

  // Group by department so the listing reads as departments → roles.
  const grouped = new Map<string, JobRow[]>();
  for (const j of jobs) {
    const k = j.department?.name ?? "General";
    const arr = grouped.get(k) ?? [];
    arr.push(j);
    grouped.set(k, arr);
  }

  return (
    <div className="bg-white">
      <section className="px-6 sm:px-8 py-16 sm:py-24 max-w-5xl mx-auto">
        <div className="text-xs uppercase tracking-widest text-emerald-700 mb-4 flex items-center gap-2">
          <Briefcase size={12} /> Careers at WorkwrK
        </div>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-slate-900">
          Build the operating system every business deserves.
        </h1>
        <p className="mt-5 text-lg text-slate-600 max-w-2xl">
          We're a small team shipping fast: people, performance, KPIs, SOPs, payroll, benefits, financials — everything an SMB needs to run with Fortune-500 rigor. Bring craft, judgment, and ownership.
        </p>
      </section>

      <section className="px-6 sm:px-8 pb-24 max-w-5xl mx-auto">
        {jobs.length === 0 ? (
          <div className="border border-slate-200 rounded-xl p-12 text-center">
            <div className="text-slate-500 text-sm">
              No open roles right now. Check back soon, or send your resume to{" "}
              <a className="text-slate-900 underline" href="mailto:hiring@workwrk.com">hiring@workwrk.com</a>.
            </div>
          </div>
        ) : (
          <div className="space-y-10">
            {Array.from(grouped.entries()).map(([dept, items]) => (
              <div key={dept}>
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-500 mb-3">
                  <Building size={12} /> {dept}
                </div>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden">
                  {items.map((j) => (
                    <Link
                      key={j.id}
                      href={`/careers/${j.id}`}
                      className="block px-5 py-4 hover:bg-slate-50 transition flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900">{j.title}</div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                          <span>{TYPE_LABEL[j.employmentType]}</span>
                          {j.location && (
                            <span className="flex items-center gap-1">
                              <MapPin size={11} /> {j.location}
                            </span>
                          )}
                          {fmtSalary(j.salaryMin, j.salaryMax, j.salaryCurrency) && (
                            <span>{fmtSalary(j.salaryMin, j.salaryMax, j.salaryCurrency)}</span>
                          )}
                        </div>
                      </div>
                      <ArrowRight size={16} className="text-slate-400 flex-shrink-0" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

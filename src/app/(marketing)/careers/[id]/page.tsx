// Public job detail page. Renders the job description + apply CTA.
// `notFound()` for jobs that don't exist or aren't OPEN — the public
// page doesn't leak DRAFT or CLOSED postings.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, MapPin, Briefcase } from "lucide-react";

export const dynamic = "force-dynamic";

const PUBLIC_ORG_SLUG = process.env.PUBLIC_CAREERS_ORG_SLUG ?? "workwrk";

type Params = { params: Promise<{ id: string }> };

async function loadJob(id: string) {
  const org = await prisma.organization.findFirst({
    where: { slug: PUBLIC_ORG_SLUG },
    select: { id: true, name: true },
  });
  if (!org) return null;
  const job = await prisma.job.findFirst({
    where: { id, organizationId: org.id, status: "OPEN" },
    include: { department: { select: { name: true } } },
  });
  return job ? { job, org } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const data = await loadJob(id);
  if (!data) return { title: "Role not found — WorkwrK" };
  return {
    title: `${data.job.title} — WorkwrK Careers`,
    description: (data.job.description ?? "Open role at WorkwrK").slice(0, 200),
  };
}

const TYPE_LABEL: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERN: "Internship",
  TEMPORARY: "Temporary",
};

export default async function JobDetailPage({ params }: Params) {
  const { id } = await params;
  const data = await loadJob(id);
  if (!data) notFound();
  const { job } = data;
  const salaryMin = job.salaryMin ? Number(job.salaryMin) : null;
  const salaryMax = job.salaryMax ? Number(job.salaryMax) : null;

  return (
    <div className="bg-white">
      <section className="px-6 sm:px-8 py-12 max-w-3xl mx-auto">
        <Link href="/careers" className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1">
          <ArrowLeft size={12} /> All roles
        </Link>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 mt-4">
          {job.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500 mt-3">
          <span className="flex items-center gap-1"><Briefcase size={12} /> {TYPE_LABEL[job.employmentType] ?? job.employmentType}</span>
          {job.location && <span className="flex items-center gap-1"><MapPin size={12} /> {job.location}</span>}
          {job.department?.name && <span>· {job.department.name}</span>}
          {(salaryMin || salaryMax) && (
            <span>
              ·{" "}
              {salaryMin && salaryMax
                ? `${job.salaryCurrency} ${salaryMin.toLocaleString()}–${salaryMax.toLocaleString()}`
                : salaryMin
                  ? `${job.salaryCurrency} ${salaryMin.toLocaleString()}+`
                  : `Up to ${job.salaryCurrency} ${salaryMax!.toLocaleString()}`}
            </span>
          )}
        </div>

        {job.description && (
          <article className="prose prose-slate max-w-none mt-8 text-slate-700 whitespace-pre-wrap">
            {job.description}
          </article>
        )}

        <div className="mt-10 border-t border-slate-200 pt-8">
          <p className="text-sm text-slate-600">
            To apply, send a short note + resume to{" "}
            <a className="text-slate-900 underline" href={`mailto:hiring@workwrk.com?subject=Application: ${encodeURIComponent(job.title)}`}>
              hiring@workwrk.com
            </a>
            . We read every email — no ATS hoops.
          </p>
        </div>
      </section>
    </div>
  );
}

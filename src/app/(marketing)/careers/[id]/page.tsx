// Public job detail page. Renders the job description + apply CTA.
// notFound() for jobs that don't exist or aren't OPEN — the public
// page doesn't leak DRAFT or CLOSED postings.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, MapPin, Briefcase, DollarSign, ArrowRight } from "lucide-react";
import {
  Section,
  Container,
  Eyebrow,
  CTABand,
  GradientText,
  HUES,
} from "@/components/marketing/primitives";

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
  CONTRACT:  "Contract",
  INTERN:    "Internship",
  TEMPORARY: "Temporary",
};

export default async function JobDetailPage({ params }: Params) {
  const { id } = await params;
  const data = await loadJob(id);
  if (!data) notFound();
  const { job } = data;
  const salaryMin = job.salaryMin ? Number(job.salaryMin) : null;
  const salaryMax = job.salaryMax ? Number(job.salaryMax) : null;
  const fHue = HUES.fuchsia;

  return (
    <>
      <Section variant="mesh" py="md" className="pt-10 lg:pt-14">
        <Container>
          <Link
            href="/careers"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition"
          >
            <ArrowLeft size={14} /> All roles
          </Link>

          <div className="mt-7 max-w-3xl">
            <Eyebrow hue="fuchsia" className="mb-5">
              Careers · {job.department?.name ?? "Team"}
            </Eyebrow>
            <h1
              className="font-extrabold tracking-[-0.03em] text-slate-900"
              style={{ fontSize: "clamp(2rem, 4.4vw, 3.4rem)", lineHeight: 1.06 }}
            >
              {job.title}
            </h1>

            <div className="mt-7 flex flex-wrap gap-2">
              <Meta icon={<Briefcase size={13} />}>{TYPE_LABEL[job.employmentType] ?? job.employmentType}</Meta>
              {job.location && <Meta icon={<MapPin size={13} />}>{job.location}</Meta>}
              {(salaryMin || salaryMax) && (
                <Meta icon={<DollarSign size={13} />}>
                  {salaryMin && salaryMax
                    ? `${job.salaryCurrency} ${salaryMin.toLocaleString()}–${salaryMax.toLocaleString()}`
                    : salaryMin
                    ? `${job.salaryCurrency} ${salaryMin.toLocaleString()}+`
                    : `Up to ${job.salaryCurrency} ${salaryMax!.toLocaleString()}`}
                </Meta>
              )}
            </div>
          </div>
        </Container>
      </Section>

      <Section py="md">
        <Container>
          <div className="max-w-3xl mx-auto grid lg:grid-cols-[1fr_280px] gap-12 items-start">
            {job.description ? (
              <article
                className="prose prose-slate max-w-none
                  prose-headings:font-extrabold prose-headings:tracking-tight prose-headings:text-slate-900
                  prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-3
                  prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-2
                  prose-p:text-[16px] prose-p:leading-[1.75] prose-p:text-slate-700
                  prose-li:text-[16px] prose-li:leading-[1.75] prose-li:text-slate-700
                  prose-strong:text-slate-900 prose-strong:font-bold
                  whitespace-pre-wrap"
              >
                {job.description}
              </article>
            ) : (
              <p className="text-slate-600">No detailed description yet. Email <a className="text-fuchsia-700 underline underline-offset-2" href="mailto:hiring@workwrk.com">hiring@workwrk.com</a> for more info.</p>
            )}

            {/* Apply card */}
            <aside className={`lg:sticky lg:top-24 lg:self-start p-6 rounded-2xl border ${fHue.border} ${fHue.bgTint}`}>
              <p className={`text-xs font-bold uppercase tracking-[0.16em] ${fHue.text}`}>Apply</p>
              <p className="mt-3 font-bold text-slate-900 leading-snug">
                Send a short note + resume.
              </p>
              <p className="mt-2 text-sm text-slate-600">
                We read every email. No ATS hoops, no take-home assignments before the first conversation.
              </p>
              <a
                href={`mailto:hiring@workwrk.com?subject=Application: ${encodeURIComponent(job.title)}`}
                className={`mt-5 inline-flex items-center justify-center w-full h-11 rounded-xl text-white font-semibold bg-gradient-to-br ${fHue.gradVia} hover:-translate-y-0.5 transition`}
              >
                Email hiring@workwrk.com <ArrowRight size={14} className="ml-1.5" />
              </a>
              <p className="mt-4 text-[11px] text-slate-500 text-center">
                Typical first response within 3 business days.
              </p>
            </aside>
          </div>
        </Container>
      </Section>

      <CTABand
        hue="fuchsia"
        title={<>Not the right <GradientText hue="amber">role for you</GradientText>?</>}
        body="Browse every open position — or send a spontaneous application."
        primary={{ label: "Back to all roles", href: "/careers" }}
        secondary={{ label: "Spontaneous apply", href: "mailto:hiring@workwrk.com" }}
      />
    </>
  );
}

function Meta({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-white px-3 h-7 rounded-full border border-slate-200">
      {icon} {children}
    </span>
  );
}

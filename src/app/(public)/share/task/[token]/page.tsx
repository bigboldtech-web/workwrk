"use client";

/* The public read-only task page: one task someone shared with a link
 * ("Anyone with the link can view", access-model toggle 10), read without
 * signing in. The frame of the public doc page (/share/doc/[token]): a 56px
 * header with the four-dot mark and the workspace name, one column, a 44px
 * footer "Shared from {org} with WorkwrK", and no way into the app.
 *
 * What it shows is what the route sends and nothing more
 * (src/app/api/public/tasks/[token]): the title, status, priority, dates,
 * the description, the checklist and the subtasks' titles and statuses;
 * when the sharer chose it, the assignees by first name and the comments.
 * The description and comments render as the task page renders them
 * (MarkdownLite: bold, italic, lists, http and mailto links, every node a
 * React element), so no HTML is ever inserted. Every non-ok answer, an unknown token
 * included, is the one sentence "This link is invalid or has been turned
 * off." This page never writes.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
// The token layer and the product stylesheet: this route is outside the
// dashboard layout, and the colours the classes below read live there.
import "@/app/(dashboard)/tokens.css";
import "@/app/(dashboard)/os.css";
import { DotsArt } from "@/components/ui/dots-art";
import { MarkdownLite } from "@/components/ui/markdown-lite";
import { LogoMark } from "@/components/brand/logo";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import { formatTaskDate, hasTimeOfDay } from "@/lib/item-date";

type StatusView = { label: string; color: string; done: boolean } | null;

type ShareData = {
  title: string;
  status: StatusView;
  priority: { label: string; color: string } | null;
  startAt: string | null;
  dueAt: string | null;
  description: string;
  checklist: Array<{ text: string; done: boolean }>;
  subtasks: Array<{ title: string; status: StatusView }>;
  assignees: string[];
  comments?: Array<{ author: string; text: string; at: string }>;
  updatedAt: string;
  org?: { name: string; logo: string | null } | null;
};

function StatusPill({ status }: { status: StatusView }) {
  if (!status) return null;
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold"
      style={{ background: `color-mix(in srgb, ${status.color} 16%, transparent)`, color: status.color }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: status.color }} aria-hidden />
      {status.label}
    </span>
  );
}

/** A start or due date as the task page writes it: the day, and the time only when one was set. */
function TaskDate({ value }: { value: string }) {
  return <span title={formatDateTitle(value)}>{formatTaskDate(value, null, { withTime: hasTimeOfDay(value, null) })}</span>;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <dt className="w-24 shrink-0 text-xs font-medium text-ink-3">{label}</dt>
      <dd className="min-w-0 text-base text-ink">{children}</dd>
    </div>
  );
}

export default function PublicTaskPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [data, setData] = useState<ShareData | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const res = await fetch(`/api/public/tasks/${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!res.ok) {
          setErr(true);
          return;
        }
        setData((await res.json()) as ShareData);
      } catch {
        setErr(true);
      }
    })();
  }, [token]);

  const orgName = data?.org?.name ?? "";
  const doneCount = data ? data.checklist.filter((c) => c.done).length : 0;

  return (
    <div className="workwrk-os os-chrome flex min-h-screen flex-col bg-raised text-ink" data-public-task>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
        <LogoMark size={28} />
        {data?.org?.logo ? <img src={data.org.logo} alt="" className="h-6 w-6 rounded-md object-cover" /> : null}
        <span className="text-row font-medium text-ink">{orgName || (data ? "Shared task" : "")}</span>
      </header>

      <main className="flex-1">
        {err ? (
          <div className="mx-auto mt-16 flex max-w-md flex-col items-center px-6 text-center">
            <DotsArt arrangement="stack" className="mb-4" />
            <p className="text-row text-ink-2">This link is invalid or has been turned off.</p>
          </div>
        ) : !data ? (
          <div className="os-prose-col flex flex-col gap-3 px-6 pt-10" aria-busy="true" aria-label="Loading">
            <span className="h-6 w-[60%] rounded bg-skeleton os-skeleton-pulse" />
            {["80%", "60%", "40%"].map((w, i) => (
              <span key={i} className="h-3.5 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />
            ))}
          </div>
        ) : (
          <article className="os-prose-col px-6 pb-16 pt-6">
            <h1 className="text-xl font-semibold text-ink [overflow-wrap:anywhere]">{data.title || "Untitled task"}</h1>
            <p className="mt-1 text-xs font-medium text-ink-2">
              Shared read-only · <span title={formatDateTitle(data.updatedAt)}>Updated {formatDate(data.updatedAt)}</span>
            </p>

            <dl className="mt-5 flex flex-col gap-2.5">
              {data.status ? (
                <Fact label="Status">
                  <StatusPill status={data.status} />
                </Fact>
              ) : null}
              {data.assignees.length > 0 ? <Fact label="Assignees">{data.assignees.join(", ")}</Fact> : null}
              {data.priority ? (
                <Fact label="Priority">
                  <span style={{ color: data.priority.color }} className="font-medium">{data.priority.label}</span>
                </Fact>
              ) : null}
              {data.startAt ? (
                <Fact label="Start">
                  <TaskDate value={data.startAt} />
                </Fact>
              ) : null}
              {data.dueAt ? (
                <Fact label="Due">
                  <TaskDate value={data.dueAt} />
                </Fact>
              ) : null}
            </dl>

            {data.description ? (
              <section className="mt-7">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Description</h2>
                <MarkdownLite source={data.description} className="text-base leading-relaxed text-ink [overflow-wrap:anywhere]" />
              </section>
            ) : null}

            {data.checklist.length > 0 ? (
              <section className="mt-7">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                  Checklist <span className="font-normal normal-case tracking-normal text-ink-3">{doneCount}/{data.checklist.length}</span>
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {data.checklist.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-base">
                      <span
                        aria-hidden
                        className={`mt-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${c.done ? "border-[var(--os-brand)] bg-[var(--os-brand)]" : "border-line"}`}
                      />
                      <span className={`min-w-0 [overflow-wrap:anywhere] ${c.done ? "text-ink-3 line-through" : "text-ink"}`}>
                        <span className="sr-only">{c.done ? "Done: " : "To do: "}</span>
                        {c.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {data.subtasks.length > 0 ? (
              <section className="mt-7">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Subtasks</h2>
                <ul className="divide-y divide-line-soft rounded-lg border border-line">
                  {data.subtasks.map((s, i) => (
                    <li key={i} className="flex items-center gap-3 px-3 py-2">
                      <span className={`min-w-0 flex-1 text-base [overflow-wrap:anywhere] ${s.status?.done ? "text-ink-3 line-through" : "text-ink"}`}>
                        {s.title}
                      </span>
                      <StatusPill status={s.status} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {data.comments && data.comments.length > 0 ? (
              <section className="mt-7">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Comments</h2>
                <ol className="flex flex-col gap-4">
                  {data.comments.map((c, i) => (
                    <li key={i} className="min-w-0">
                      <p className="text-xs text-ink-2">
                        <span className="font-semibold text-ink">{c.author}</span> · <span title={formatDateTitle(c.at)}>{formatDate(c.at)}</span>
                      </p>
                      <MarkdownLite source={c.text} className="mt-1 text-base leading-relaxed text-ink [overflow-wrap:anywhere]" />
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </article>
        )}
      </main>

      <footer className="flex h-11 shrink-0 items-center border-t border-line px-6 text-xs font-medium text-ink-2">
        <a href="https://workwrk.com" className="hover:text-ink hover:underline">
          {orgName ? `Shared from ${orgName} with WorkwrK` : "Shared with WorkwrK"}
        </a>
      </footer>
    </div>
  );
}

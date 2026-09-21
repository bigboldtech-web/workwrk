"use client";

// SopReadView (spec-process section 3): the read-mode renderer for every SOP
// kind, shared by the SOP page's Content tab, the public /share/sop page and
// Present, so the app page and the public page cannot drift.
//
//   Written        the BlockNote canvas read-only at --os-t-prose (15/24);
//                  legacy `richtext` html and `WRITTEN` body render through
//                  the same reading column
//   Step-by-step   numbered step cards (44px header row: number pill, title;
//                  body 15/24 with the step's rich text and optional image),
//                  or the branching flow when content.layout is "flow"
//   Checklist      sections as 44px group headers, steps as 44px rows with
//                  the step text and "Asks for: Email, Photo" beneath. NO
//                  checkbox in read mode: a checklist is ticked on a run
//   Recording      step cards with the screenshot (max 720, radius 8) and a
//                  numbered caption
//
// The read-only banner is never rendered here (the page owns it), which is
// what keeps the public page free of it.

import dynamic from "next/dynamic";
import type { BnDocJSON } from "@/components/docs/blocknote-canvas";
import type { Block } from "@/components/docs/block-types";
import { SkeletonLines } from "@/components/ui/skeleton";

// Client-only: @blocknote/react touches `window` inside useMemo, so a server
// render of this view (the public /share/sop page is a server component)
// answered 500 for every Written SOP and left the browser to recover. The
// canvas mounts after hydration with a skeleton in its place.
const BlockNoteCanvas = dynamic(
  () => import("@/components/docs/blocknote-canvas").then((m) => m.BlockNoteCanvas),
  { ssr: false, loading: () => <SkeletonLines lines={6} /> },
);
import { ProcessFlowBuilder, type ProcessFlow } from "@/components/process-flow-builder";
import { Chip } from "@/components/ui/chip";
import { checklistAsksFor, getSopKind, getSopLayout, type SopKind } from "@/lib/sop-kind";
import { cn } from "@/lib/utils";

export interface ReadStep {
  id?: string;
  title?: string;
  description?: string;
  image?: string;
}
export interface ReadRecordedStep {
  order?: number;
  action?: string;
  description?: string;
  url?: string;
  screenshot?: string | null;
}
export interface ReadChecklistStep {
  id: string;
  title?: string;
  description?: string;
  type?: "task" | "approval";
  inputs?: Array<{ id: string; type?: string; label?: string; required?: boolean }>;
  contentBlocks?: Array<{ id: string; type: string; content: string }>;
}
export interface ReadChecklistSection {
  id: string;
  title?: string;
  steps?: ReadChecklistStep[];
}

export type SopReadContent = {
  type?: string;
  layout?: string;
  html?: string;
  body?: string;
  bnDoc?: BnDocJSON | null;
  blocks?: Block[];
  steps?: ReadStep[] | ReadRecordedStep[];
  sections?: ReadChecklistSection[];
  flow?: ProcessFlow;
} | null;

export interface SopReadSource {
  id: string;
  sopType: "WRITTEN" | "RECORDED" | "CHECKLIST" | string;
  content: SopReadContent;
}

/** Strips scripts, styles, frames, inline handlers and javascript: URLs from stored HTML. */
export function safeHtml(html: string): string {
  return (html || "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '$1="#"');
}

/** Old steps stored plain text; new ones store rich HTML. Both render. */
export function StepText({ html, className }: { html?: string; className?: string }) {
  if (!html) return null;
  const looksLikeHtml = /<[a-z][^>]*>/i.test(html);
  if (looksLikeHtml) {
    return <div className={cn("os-prose text-prose text-ink-2 [&_p]:my-1", className)} dangerouslySetInnerHTML={{ __html: safeHtml(html) }} />;
  }
  return <p className={cn("whitespace-pre-wrap text-prose text-ink-2", className)}>{html}</p>;
}

export function SopReadEmpty({ children = "Nothing here yet." }: { children?: React.ReactNode }) {
  return <p className="py-8 text-center text-row text-ink-3">{children}</p>;
}

export function sopHasContent(kind: SopKind, content: SopReadContent): boolean {
  const c = content ?? {};
  switch (kind) {
    case "written":
      if (typeof c.html === "string") return c.html.replace(/<[^>]+>/g, "").trim().length > 0;
      if (typeof c.body === "string" && c.type === "WRITTEN") return c.body.trim().length > 0;
      return Array.isArray(c.bnDoc) ? c.bnDoc.length > 0 : Array.isArray(c.blocks) && c.blocks.some((b) => (b as { text?: string }).text?.trim());
    case "checklist":
      return (c.sections ?? []).some((s) => (s.steps?.length ?? 0) > 0);
    case "recording":
      return (c.steps?.length ?? 0) > 0;
    default:
      return getSopLayout(c) === "flow" ? (c.flow?.steps?.length ?? 0) > 0 : (c.steps?.length ?? 0) > 0;
  }
}

export function SopReadView({ sop, mode = "app", emptyAction }: {
  sop: SopReadSource;
  mode?: "app" | "public";
  /** The app page's "Start writing" link for an empty draft. */
  emptyAction?: React.ReactNode;
}) {
  const kind = getSopKind(sop.sopType, sop.content);
  const c = sop.content ?? {};
  if (!sopHasContent(kind, sop.content)) {
    return <SopReadEmpty>{mode === "app" && emptyAction ? <span className="inline-flex items-center gap-2">Nothing here yet · {emptyAction}</span> : "Nothing here yet."}</SopReadEmpty>;
  }

  if (kind === "written") {
    if (c.type === "richtext" && typeof c.html === "string") {
      return <article className="os-prose text-prose text-ink" dangerouslySetInnerHTML={{ __html: safeHtml(c.html) }} />;
    }
    if (c.type === "WRITTEN" && typeof c.body === "string") {
      return (
        <article className="os-prose text-prose text-ink">
          {c.body.split(/\n{2,}/).map((para, i) => <p key={i} className="whitespace-pre-wrap">{para}</p>)}
        </article>
      );
    }
    return (
      <div className="os-prose">
        <BlockNoteCanvas key={sop.id} initialBnDoc={c.bnDoc ?? null} legacyBlocks={c.blocks ?? []} readonly onChange={() => { /* read-only */ }} entity={{ type: "sop", id: sop.id }} />
      </div>
    );
  }

  if (kind === "checklist") return <ChecklistRead sections={c.sections ?? []} />;
  if (kind === "recording") return <RecordingRead steps={(c.steps ?? []) as ReadRecordedStep[]} />;

  if (getSopLayout(c) === "flow" && c.flow) {
    return <ProcessFlowBuilder flow={c.flow} onChange={() => { /* read-only */ }} editing={false} />;
  }
  return <StepsRead steps={(c.steps ?? []) as ReadStep[]} />;
}

export function StepsRead({ steps }: { steps: ReadStep[] }) {
  if (steps.length === 0) return <SopReadEmpty />;
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step, i) => (
        <li key={step.id ?? i} className="rounded-lg border border-line bg-raised">
          <div className="flex h-11 items-center gap-3 px-3">
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-active px-1.5 text-xs font-medium tabular-nums text-ink">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-row font-medium text-ink">{step.title || `Step ${i + 1}`}</span>
          </div>
          {step.description || step.image ? (
            <div className="flex flex-col gap-2 px-4 pb-4 ps-12">
              <StepText html={step.description} />
              {step.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={step.image} alt="" loading="lazy" className="max-h-72 max-w-full rounded-lg border border-line" />
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function ChecklistRead({ sections }: { sections: ReadChecklistSection[] }) {
  const withSteps = sections.filter((s) => (s.steps?.length ?? 0) > 0);
  if (withSteps.length === 0) return <SopReadEmpty />;
  return (
    <div className="flex flex-col gap-4">
      {sections.map((sec) => (
        <section key={sec.id} className="overflow-hidden rounded-lg border border-line bg-raised">
          <header className="flex h-11 items-center gap-2 border-b border-line bg-[var(--os-table-head-bg)] px-3">
            <span className="min-w-0 flex-1 truncate text-row font-medium text-ink">{sec.title || "Steps"}</span>
            <span className="text-xs font-medium tabular-nums text-ink-2">{sec.steps?.length ?? 0}</span>
          </header>
          {(sec.steps ?? []).length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-3">No steps in this section.</p>
          ) : (
            <ul>
              {(sec.steps ?? []).map((st, i) => {
                const asks = checklistAsksFor(st.inputs);
                return (
                  <li key={st.id} className="flex min-h-11 items-start gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0">
                    <span className="mt-0.5 w-5 shrink-0 text-xs tabular-nums text-ink-3">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-row text-ink">{st.title || "Untitled step"}</span>
                        {st.type === "approval" ? <Chip size="default" className="h-6 px-2 text-xs" disabled>Approval</Chip> : null}
                      </div>
                      {st.description ? <StepText html={st.description} className="mt-0.5 text-sm" /> : null}
                      {asks ? <p className="mt-0.5 text-sm text-ink-2">{asks}</p> : null}
                      {(st.contentBlocks ?? []).map((cb) => {
                        if (cb.type === "horizontal_line") return <hr key={cb.id} className="my-2 border-line" />;
                        if (cb.type === "text" && cb.content) return <p key={cb.id} className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{cb.content}</p>;
                        // eslint-disable-next-line @next/next/no-img-element
                        if (cb.type === "image" && cb.content) return <img key={cb.id} src={cb.content} alt="" loading="lazy" className="mt-2 max-w-full rounded-lg border border-line" />;
                        if (cb.type === "video" && cb.content) return <video key={cb.id} src={cb.content} controls preload="metadata" className="mt-2 max-w-full rounded-lg" />;
                        return null;
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function RecordingRead({ steps }: { steps: ReadRecordedStep[] }) {
  if (steps.length === 0) return <SopReadEmpty />;
  const sorted = steps.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return (
    <ol className="flex flex-col gap-3">
      {sorted.map((step, i) => (
        <li key={i} className="overflow-hidden rounded-lg border border-line bg-raised">
          {step.screenshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={step.screenshot} alt={`Step ${i + 1}`} loading="lazy" decoding="async" className="block w-full max-w-[720px] border-b border-line" />
          ) : null}
          <div className="flex items-start gap-3 px-3 py-3">
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-active px-1.5 text-xs font-medium tabular-nums text-ink">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-prose text-ink">{step.description || step.action || `Step ${i + 1}`}</p>
              {step.url ? <p className="mt-0.5 truncate text-xs text-ink-3">{step.url}</p> : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

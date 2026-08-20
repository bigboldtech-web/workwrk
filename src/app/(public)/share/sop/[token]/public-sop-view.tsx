"use client";

/* Read-only public renderer for a shared SOP. Pure presentation — it
 * receives an already-resolved, already-presigned payload from the
 * server component and never issues a write. Mirrors the content
 * branches of the authenticated detail page (blocks / richtext /
 * checklist / process-flow / recorded / simple steps) at reader
 * fidelity, without any editing chrome.
 */

import { BookCopy, CheckSquare } from "lucide-react";
import { BlockNoteCanvas, type BnDocJSON } from "@/components/docs/blocknote-canvas";
import type { Block } from "@/components/docs/block-editor";

interface SimpleStep {
  id?: string;
  title?: string;
  description?: string;
  image?: string;
}
interface RecordedStep {
  order?: number;
  description?: string;
  url?: string;
  screenshot?: string | null;
}
interface ChecklistStep {
  id: string;
  title?: string;
  description?: string;
}
interface ChecklistSection {
  id: string;
  title?: string;
  steps?: ChecklistStep[];
}
interface ProcessFlowStep {
  id: string;
  title?: string;
  description?: string;
}

type SopContent = {
  type?: string;
  html?: string;
  bnDoc?: BnDocJSON | null;
  blocks?: Block[];
  steps?: SimpleStep[] | RecordedStep[];
  sections?: ChecklistSection[];
  flow?: { steps?: ProcessFlowStep[] };
};

export interface PublicSop {
  title: string;
  description: string | null;
  sopType: "WRITTEN" | "RECORDED" | "CHECKLIST";
  version: number;
  updatedAt: string;
  content: SopContent | null;
}

// Lightweight sanitizer for read-only SOP HTML — strips scripts/styles/
// iframes, inline handlers, and javascript: URLs. Same posture as the
// authenticated detail page.
function safeHtml(html: string): string {
  return (html || "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '$1="#"');
}

function StepHtml({ html }: { html?: string }) {
  if (!html) return null;
  const looksLikeHtml = /<[a-z][^>]*>/i.test(html);
  if (looksLikeHtml) {
    return (
      <div
        className="prose prose-sm max-w-none text-[14px] text-zinc-600 mt-1 [&_p]:my-1"
        dangerouslySetInnerHTML={{ __html: safeHtml(html) }}
      />
    );
  }
  return <p className="text-[14px] text-zinc-600 mt-1 whitespace-pre-wrap">{html}</p>;
}

export function PublicSopView({ sop }: { sop: PublicSop }) {
  const content = sop.content ?? {};
  const type = content.type;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto w-full max-w-[860px] px-6 py-10">
        {/* Header */}
        <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-400">
          <BookCopy className="h-4 w-4" />
          Standard Operating Procedure · Shared read-only
        </div>
        <h1 className="mt-3 text-[26px] font-bold leading-tight text-zinc-900">{sop.title || "Untitled SOP"}</h1>
        {sop.description && (
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-500">{sop.description}</p>
        )}
        <div className="mt-3 flex items-center gap-2 text-[13px] text-zinc-400">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5">v{sop.version}</span>
          <span>Updated {new Date(sop.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span>
        </div>

        <div className="mt-8">
          {/* Rich-text (legacy html) SOPs */}
          {type === "richtext" ? (
            <article
              className="prose prose-zinc max-w-none prose-headings:font-semibold prose-headings:text-zinc-900 prose-h1:text-[24px] prose-h2:text-[20px] prose-h3:text-[16px] prose-p:text-zinc-700 prose-li:text-zinc-700 prose-strong:text-zinc-900 prose-a:text-blue-600"
              dangerouslySetInnerHTML={{ __html: safeHtml(content.html || "") }}
            />
          ) : type === "blocks" ? (
            <BlockNoteCanvas
              initialBnDoc={content.bnDoc ?? null}
              legacyBlocks={content.blocks ?? []}
              readonly
              onChange={() => { /* read-only */ }}
            />
          ) : sop.sopType === "CHECKLIST" || Array.isArray(content.sections) ? (
            <ChecklistView sections={content.sections ?? []} />
          ) : type === "process_flow" ? (
            <StepsView steps={(content.flow?.steps ?? []) as SimpleStep[]} />
          ) : type === "recorded" ? (
            <RecordedView steps={(content.steps ?? []) as RecordedStep[]} />
          ) : (
            <StepsView steps={(content.steps ?? []) as SimpleStep[]} />
          )}
        </div>

        <div className="mt-14 border-t border-zinc-100 pt-6 text-center text-[13px] text-zinc-400">
          Shared securely from WorkwrK. This is a read-only copy.
        </div>
      </div>
    </div>
  );
}

function ChecklistView({ sections }: { sections: ChecklistSection[] }) {
  if (sections.length === 0) {
    return <EmptyBody />;
  }
  return (
    <div className="space-y-6">
      {sections.map((sec) => (
        <section key={sec.id}>
          {sec.title && <h2 className="mb-2 text-[15px] font-semibold text-zinc-900">{sec.title}</h2>}
          <div className="space-y-1.5">
            {(sec.steps ?? []).map((st) => (
              <div key={st.id} className="flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
                <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300" />
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-zinc-800">{st.title || "Untitled step"}</p>
                  <StepHtml html={st.description} />
                </div>
              </div>
            ))}
            {(sec.steps ?? []).length === 0 && (
              <p className="text-[14px] text-zinc-400 italic">No steps in this section.</p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function StepsView({ steps }: { steps: SimpleStep[] }) {
  if (!steps || steps.length === 0) return <EmptyBody />;
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={step.id ?? i} className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--os-brand-soft,#E6F1FB)] text-[14px] font-bold text-[color:var(--os-brand,#0073EA)]">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-zinc-900">{step.title || `Step ${i + 1}`}</p>
            <StepHtml html={step.description} />
            {step.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={step.image} alt="" loading="lazy" className="mt-2 max-h-64 rounded-md border border-zinc-200" />
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function RecordedView({ steps }: { steps: RecordedStep[] }) {
  if (!steps || steps.length === 0) return <EmptyBody />;
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={i} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="flex items-start gap-3 p-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--os-brand-soft,#E6F1FB)] text-[14px] font-bold text-[color:var(--os-brand,#0073EA)]">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-zinc-900">{step.description || `Step ${i + 1}`}</p>
              {step.url && <p className="mt-0.5 truncate text-[13px] text-zinc-400">{step.url}</p>}
            </div>
          </div>
          {step.screenshot && (
            <div className="px-4 pb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={step.screenshot} alt={`Step ${i + 1}`} loading="lazy" className="w-full rounded-lg border border-zinc-200" />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function EmptyBody() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-200 py-12 text-center text-[14px] text-zinc-400">
      This SOP has no content to display.
    </div>
  );
}

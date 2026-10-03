// An SOP as Markdown, whichever of its four kinds it is (src/lib/sop-kind.ts):
// the workspace export writes one file per SOP from this.
//
//   written       its document: BlockNote (bnDoc), the first block editor
//                 (blocks), or stored HTML (html, body)
//   step-by-step  the numbered steps with their owner, and for a flow its
//                 decisions and where each branch goes
//   checklist     each section's steps as boxes, with what a step asks for
//   recording     the recorded actions in order, with the page each was on
//
// A step's pasted image is a data URL and stays one, so the file holds it;
// an image or a file saved by address keeps its address.
//
// Pure: the export route and the tests share it.

import { blockNoteToMarkdown, escapeText, legacyBlocksToMarkdown } from "@/lib/docs/content-markdown";
import { htmlToText } from "@/lib/html-text";
import { SOP_KIND_LABEL, SOP_STATUS_LABEL, checklistAsksFor, getSopKind, isSopStatus } from "@/lib/sop-kind";

export interface SopForMarkdown {
  title: string;
  description?: string | null;
  category?: string | null;
  status?: string | null;
  version?: number | null;
  sopType?: string | null;
  content: unknown;
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Rich text as Markdown-safe plain text, each line indented under its step. */
function textUnder(v: unknown, indent: string): string[] {
  const t = htmlToText(v);
  if (!t) return [];
  return t.split("\n").map((l) => (l ? `${indent}${escapeText(l)}` : ""));
}

function imageLine(src: string, alt: string, indent: string): string | null {
  if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(src) || /^https?:\/\//i.test(src) || src.startsWith("/")) {
    return `${indent}![${escapeText(alt)}](${src.replace(/\s+/g, "")})`;
  }
  return null;
}

export function sopToMarkdown(sop: SopForMarkdown): string {
  const out: string[] = [];
  out.push(`# ${escapeText(sop.title.trim() || "Untitled SOP")}`, "");
  const kind = getSopKind(sop.sopType ?? null, sop.content);
  const facts = [
    isSopStatus(sop.status) ? SOP_STATUS_LABEL[sop.status] : null,
    typeof sop.version === "number" ? `Version ${sop.version}` : null,
    SOP_KIND_LABEL[kind],
    sop.category?.trim() ? `Category: ${sop.category.trim()}` : null,
  ].filter((x): x is string => !!x);
  out.push(escapeText(facts.join(" · ")), "");
  const description = textUnder(sop.description, "");
  if (description.length) out.push(...description, "");

  const c = obj(sop.content) ?? {};
  let body: string[] = [];
  if (kind === "checklist") body = checklistBody(c);
  else if (kind === "recording") body = recordingBody(c);
  else if (kind === "steps") body = stepsBody(c);
  else body = writtenBody(c);
  if (body.length) out.push(...body);
  return out.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function writtenBody(c: Obj): string[] {
  if (Array.isArray(c.bnDoc) && c.bnDoc.length) return [blockNoteToMarkdown(c.bnDoc).trim()];
  if (Array.isArray(c.blocks) && c.blocks.length) return [legacyBlocksToMarkdown(c.blocks).trim()];
  const html = str(c.html) || str(c.body);
  return textUnder(html, "");
}

function stepsBody(c: Obj): string[] {
  const list = arr(c.steps).map(obj).filter((s): s is Obj => !!s);
  const flow = arr(obj(c.flow)?.steps).map(obj).filter((s): s is Obj => !!s);
  // The flow copy holds the decisions; the list copy holds the images.
  const steps = list.length ? list : flow;
  if (!steps.length) return [];
  const flowById = new Map(flow.map((s) => [str(s.id), s]));
  const numberOf = new Map(steps.map((s, i) => [str(s.id), i + 1]));
  const out: string[] = ["## Steps", ""];
  steps.forEach((s, i) => {
    const f = flowById.get(str(s.id)) ?? s;
    const decision = str(f.type) === "decision";
    out.push(`${i + 1}. ${decision ? "Decision: " : ""}**${escapeText(str(s.title).trim() || `Step ${i + 1}`)}**`);
    const owner = str(obj(s.jobTitle ?? f.jobTitle)?.title).trim();
    const who = str(f.actor).trim();
    const minutes = typeof f.durationMinutes === "number" && f.durationMinutes > 0 ? f.durationMinutes : null;
    const facts = [owner ? `Owner: ${owner}` : null, who ? `Who: ${who}` : null, minutes ? `About ${minutes} min` : null].filter(Boolean);
    if (facts.length) out.push(`   ${escapeText(facts.join(" · "))}`);
    out.push(...textUnder(s.description ?? s.body, "   "));
    const image = str(s.image);
    const img = image ? imageLine(image, `Step ${i + 1}`, "   ") : null;
    if (img) out.push(img);
    for (const b of arr(f.branches).map(obj).filter((x): x is Obj => !!x)) {
      const next = str(b.nextStepId);
      const to = next && numberOf.has(next) ? `step ${numberOf.get(next)}` : "the end";
      out.push(`   - ${escapeText(str(b.label).trim() || "Otherwise")}: go to ${to}`);
    }
    out.push("");
  });
  return out;
}

function checklistBody(c: Obj): string[] {
  const out: string[] = [];
  for (const section of arr(c.sections).map(obj).filter((s): s is Obj => !!s)) {
    const steps = arr(section.steps).map(obj).filter((s): s is Obj => !!s);
    out.push(`## ${escapeText(str(section.title).trim() || "Steps")}`, "");
    for (const s of steps) {
      out.push(`- [ ] ${escapeText(str(s.title).trim() || "Untitled step")}`);
      out.push(...textUnder(s.description, "  "));
      const asks = checklistAsksFor(arr(s.inputs).map(obj).filter((x): x is Obj => !!x).map((x) => ({ type: str(x.type), label: str(x.label) })));
      if (asks) out.push(`  ${escapeText(asks)}`);
    }
    out.push("");
  }
  return out;
}

function recordingBody(c: Obj): string[] {
  const steps = arr(c.steps)
    .map(obj)
    .filter((s): s is Obj => !!s)
    .map((s, i) => ({ s, order: typeof s.order === "number" ? s.order : i + 1 }))
    .sort((a, b) => a.order - b.order);
  if (!steps.length) return [];
  const out: string[] = ["## Recorded steps", ""];
  steps.forEach(({ s }, i) => {
    const what = htmlToText(s.description) || str(s.action) || `Step ${i + 1}`;
    out.push(`${i + 1}. ${escapeText(what)}`);
    const url = str(s.url);
    if (/^https?:\/\//i.test(url)) out.push(`   On <${url}>`);
    out.push("");
  });
  return out;
}

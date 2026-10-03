// An SOP as Markdown, whichever of its four kinds it is (src/lib/sop-kind.ts):
// the workspace export writes one file per SOP from this.
//
//   written       its document: BlockNote (bnDoc), the first block editor
//                 (blocks), or stored HTML (html, body)
//   step-by-step  the numbered steps with their owner, in the layout the
//                 SOP is shown in (a flow draws content.flow), and for a
//                 flow its decisions and where each branch goes
//   checklist     each section's steps as boxes, approval steps marked,
//                 with what a step asks for and its added text, images,
//                 videos and dividers
//   recording     the recorded actions in order, each with its screenshot
//                 and the page it was on
//
// A step's pasted image is a data URL and stays one, so the file holds it;
// an image or a file saved by address keeps its address, and so does an
// image inside a step's own text.
//
// Pure: the export route and the tests share it.

import { blockNoteToMarkdown, escapeText, legacyBlocksToMarkdown } from "@/lib/docs/content-markdown";
import { htmlToText } from "@/lib/html-text";
import { SOP_KIND_LABEL, SOP_STATUS_LABEL, checklistAsksFor, getSopKind, getSopLayout, isSopStatus } from "@/lib/sop-kind";

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

/** The images inside a step's own rich text, which the plain text leaves out. */
function imagesIn(html: unknown, alt: string, indent: string): string[] {
  if (typeof html !== "string" || !html.includes("<img")) return [];
  const out: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const line = imageLine((m[2] ?? m[3] ?? "").trim(), alt, indent);
    if (line) out.push(line);
  }
  return out;
}

/** A step's rich text as indented lines, then the images it holds. */
function stepText(html: unknown, alt: string, indent: string): string[] {
  return [...textUnder(html, indent), ...imagesIn(html, alt, indent)];
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
  // The steps in the layout the SOP is shown in: a flow draws its flow copy
  // (which holds the decisions), a list its list copy (which holds the
  // images). Each borrows from the other by id what it does not carry.
  const steps = getSopLayout(c) === "flow" && flow.length ? flow : list.length ? list : flow;
  if (!steps.length) return [];
  const flowById = new Map(flow.map((s) => [str(s.id), s]));
  const listById = new Map(list.map((s) => [str(s.id), s]));
  const numberOf = new Map(steps.map((s, i) => [str(s.id), i + 1]));
  const out: string[] = ["## Steps", ""];
  steps.forEach((s, i) => {
    const f = flowById.get(str(s.id)) ?? s;
    const l = listById.get(str(s.id)) ?? s;
    const decision = str(f.type) === "decision";
    out.push(`${i + 1}. ${decision ? "Decision: " : ""}**${escapeText(str(s.title).trim() || `Step ${i + 1}`)}**`);
    const owner = str(obj(s.jobTitle ?? f.jobTitle)?.title).trim();
    const who = str(f.actor).trim();
    const minutes = typeof f.durationMinutes === "number" && f.durationMinutes > 0 ? f.durationMinutes : null;
    const facts = [owner ? `Owner: ${owner}` : null, who ? `Who: ${who}` : null, minutes ? `About ${minutes} min` : null].filter(Boolean);
    if (facts.length) out.push(`   ${escapeText(facts.join(" · "))}`);
    out.push(...stepText(s.description ?? s.body ?? l.description ?? l.body, `Step ${i + 1}`, "   "));
    const image = str(s.image) || str(l.image);
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
      const approval = str(s.type) === "approval";
      out.push(`- [ ] ${escapeText(str(s.title).trim() || "Untitled step")}${approval ? " (Approval)" : ""}`);
      out.push(...stepText(s.description, "Step image", "  "));
      const asks = checklistAsksFor(arr(s.inputs).map(obj).filter((x): x is Obj => !!x).map((x) => ({ type: str(x.type), label: str(x.label) })));
      if (asks) out.push(`  ${escapeText(asks)}`);
      for (const b of arr(s.contentBlocks).map(obj).filter((x): x is Obj => !!x)) {
        const kind = str(b.type);
        const content = str(b.content).trim();
        if (kind === "horizontal_line") out.push("  ---");
        else if (kind === "text" && content) out.push(...content.split("\n").map((t) => (t ? `  ${escapeText(t)}` : "")));
        else if (kind === "image" && content) {
          const img = imageLine(content, "Image", "  ");
          if (img) out.push(img);
        } else if (kind === "video" && content) {
          out.push(/^(https?:\/\/|\/)/i.test(content) ? `  [Video](${content})` : "  _A video is attached to this step in WorkwrK._");
        }
      }
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
    const shot = str(s.screenshot);
    const img = shot ? imageLine(shot, `Step ${i + 1}`, "   ") : null;
    if (img) out.push(img);
    const url = str(s.url);
    if (/^https?:\/\//i.test(url)) out.push(`   On <${url}>`);
    out.push("");
  });
  return out;
}

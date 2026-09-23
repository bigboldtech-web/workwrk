"use client";

// RichBody, renders a Talk message body through the chat-markup AST
// (lib/chat-markup.ts): bold/italic/underline/strike, code spans and
// blocks, quotes, lists, safe links, plus the existing @mention
// highlighting applied inside plain text runs (never inside code).

import { useMemo } from "react";
import { parseMarkup, type BlockNode, type InlineNode } from "@/lib/chat-markup";

export function RichBody({ body, memberNames }: { body: string; memberNames: Map<string, string> }) {
  const blocks = useMemo(() => parseMarkup(body), [body]);
  const names = useMemo(
    () => [...memberNames.values()].filter(Boolean).sort((a, b) => b.length - a.length),
    [memberNames],
  );
  return <>{blocks.map((b, i) => <Block key={i} node={b} names={names} />)}</>;
}

function Block({ node, names }: { node: BlockNode; names: string[] }) {
  switch (node.t) {
    case "codeblock":
      return (
        <pre className="my-1 overflow-x-auto rounded-md border border-line bg-subtle px-3 py-2 text-sm leading-5 text-ink">
          <code>{node.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote className="my-0.5 border-l-[3px] border-line-strong pl-3 text-ink-2">
          {node.lines.map((line, i) => (
            <p key={i} className="text-base leading-6"><Inline nodes={line} names={names} /></p>
          ))}
        </blockquote>
      );
    case "ul":
      return (
        <ul className="my-0.5 list-disc pl-5">
          {node.items.map((item, i) => (
            <li key={i} className="text-base leading-6"><Inline nodes={item} names={names} /></li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol start={node.start} className="my-0.5 list-decimal pl-5">
          {node.items.map((item, i) => (
            <li key={i} className="text-base leading-6"><Inline nodes={item} names={names} /></li>
          ))}
        </ol>
      );
    default:
      return (
        <p className="whitespace-pre-wrap break-words text-base leading-6">
          <Inline nodes={node.children} names={names} />
        </p>
      );
  }
}

function Inline({ nodes, names }: { nodes: InlineNode[]; names: string[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "code":
            // Tokens only. `text-rose-600` was a raw Tailwind palette value
            // with no dark definition, so inline code sat pink and
            // low-contrast on the dark feed ground, and this renderer also
            // draws announcement bodies. spec-talk 2.2 asks for code on
            // --os-surface-hov in the mono face.
            return <code key={i} className="rounded bg-hover px-1 py-0.5 font-mono text-sm text-ink-strong">{n.text}</code>;
          case "link":
            return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2">{n.label}</a>;
          case "url":
            return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="break-all text-brand underline underline-offset-2">{n.href}</a>;
          case "bold":
            return <strong key={i} className="font-semibold"><Inline nodes={n.children} names={names} /></strong>;
          case "italic":
            return <em key={i}><Inline nodes={n.children} names={names} /></em>;
          case "underline":
            return <span key={i} className="underline underline-offset-2"><Inline nodes={n.children} names={names} /></span>;
          case "strike":
            return <s key={i}><Inline nodes={n.children} names={names} /></s>;
          default:
            return <Mentions key={i} text={n.text} names={names} />;
        }
      })}
    </>
  );
}

function Mentions({ text, names }: { text: string; names: string[] }) {
  if (names.length === 0 || !text.includes("@")) return <>{text}</>;
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = text.split(new RegExp(`(@(?:${alt}))(?![A-Za-z0-9])`, "g"));
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("@") && names.includes(part.slice(1)) ? (
          <span key={i} className="rounded bg-brand/10 px-1 py-0.5 font-medium text-brand">{part}</span>
        ) : (
          part
        ),
      )}
    </>
  );
}

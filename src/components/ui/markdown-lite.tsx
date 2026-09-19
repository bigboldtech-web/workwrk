"use client";

// Renders what src/lib/markdown-lite.ts parsed: paragraphs, bold, italic,
// bullets, numbers, safe links and @mention chips. No HTML is ever inserted —
// every node becomes a React element, so a body containing "<script>" renders
// as the characters a person typed.

import { Fragment, type ReactNode } from "react";
import { parseMarkdownLite, type BlockNode, type InlineNode } from "@/lib/markdown-lite";

function Inline({ nodes, meId, mentionIds }: { nodes: InlineNode[]; meId?: string | null; mentionIds?: Set<string> }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "bold":
            return <strong key={i} className="font-semibold">{n.value}</strong>;
          case "italic":
            return <em key={i} className="italic">{n.value}</em>;
          case "link":
            return (
              <a
                key={i}
                href={n.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-deep underline-offset-2 hover:underline"
              >
                {n.label}
              </a>
            );
          case "mention": {
            // A mention OF the viewer reads differently from a mention of
            // anyone else, which is the whole reason a person scans a thread.
            const mine = Boolean(meId && mentionIds?.has(meId));
            return (
              <span
                key={i}
                className={`rounded px-1 py-px font-medium ${mine ? "bg-brand-soft text-brand-deep" : "bg-hover text-ink"}`}
              >
                {n.label}
              </span>
            );
          }
          default:
            return <Fragment key={i}>{n.value}</Fragment>;
        }
      })}
    </>
  );
}

function Block({ block, meId, mentionIds }: { block: BlockNode; meId?: string | null; mentionIds?: Set<string> }): ReactNode {
  if (block.type === "bullets") {
    return (
      <ul className="my-1 list-disc ps-5 space-y-0.5">
        {block.items.map((item, i) => (
          <li key={i}><Inline nodes={item} meId={meId} mentionIds={mentionIds} /></li>
        ))}
      </ul>
    );
  }
  if (block.type === "numbers") {
    return (
      <ol start={block.start} className="my-1 list-decimal ps-5 space-y-0.5">
        {block.items.map((item, i) => (
          <li key={i}><Inline nodes={item} meId={meId} mentionIds={mentionIds} /></li>
        ))}
      </ol>
    );
  }
  return (
    <p className="whitespace-pre-wrap break-words">
      <Inline nodes={block.content} meId={meId} mentionIds={mentionIds} />
    </p>
  );
}

export function MarkdownLite({
  source,
  className = "",
  meId,
  mentionedUserIds,
}: {
  source: string;
  className?: string;
  /** The viewer, so a mention of them is tinted. */
  meId?: string | null;
  /** The ids the server recorded for this body. */
  mentionedUserIds?: string[];
}) {
  const blocks = parseMarkdownLite(source);
  if (blocks.length === 0) return null;
  const mentionIds = mentionedUserIds ? new Set(mentionedUserIds) : undefined;
  return (
    <div className={`text-row leading-relaxed text-ink ${className}`}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} meId={meId} mentionIds={mentionIds} />
      ))}
    </div>
  );
}

"use client";

/*
 * Mention — Notion-style inline @-mention for BlockNote.
 *
 * One inline-content type covers both flavours via the `mkind` prop:
 *   - "user": @Person pill that links to their profile
 *   - "doc":  page-reference pill that links to /docs/<id>
 *
 * Inserted from the "@" suggestion menu wired in blocknote-canvas. Content
 * mode is "none" — the pill is atomic (not editable inline), exactly like
 * Notion: you delete it as a unit.
 *
 * The stored href is canonical and is never rewritten; a click maps it into
 * the section the person is in at that moment (a doc mention opened in Work
 * stays in Work, src/lib/nav/object-href.ts).
 */

import { createReactInlineContentSpec } from "@blocknote/react";
import { useRouter } from "next/navigation";
import { AtSign, FileText } from "lucide-react";
import { sectionHrefNow } from "@/components/layout/os/use-object-href";

export const mentionInlineSpec = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      mkind: { default: "user" as string }, // "user" | "doc"
      refId: { default: "" as string },
      label: { default: "" as string },
      href: { default: "" as string },
    },
    content: "none",
  },
  {
    render: (props) => <MentionPill {...props} />,
  },
);

function MentionPill({
  inlineContent,
}: {
  inlineContent: { props: { mkind: string; refId: string; label: string; href: string } };
}) {
  const router = useRouter();
  const { mkind, label, href } = inlineContent.props;
  const isDoc = mkind === "doc";
  return (
    <span
      className={`bn-mention bn-mention--${isDoc ? "doc" : "user"}`}
      contentEditable={false}
      role={href ? "link" : undefined}
      tabIndex={href ? 0 : undefined}
      onClick={() => { if (href) router.push(sectionHrefNow(href)); }}
      onKeyDown={(e) => {
        if (href && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); router.push(sectionHrefNow(href)); }
      }}
      title={label}
    >
      {isDoc ? <FileText className="bn-mention__icon" /> : <AtSign className="bn-mention__icon" />}
      <span className="bn-mention__label">{label || (isDoc ? "Untitled note" : "Someone")}</span>
    </span>
  );
}

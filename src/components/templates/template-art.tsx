// The 96px line drawing on a template card, one per kind.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/templates):
// "a monochrome line drawing derived from the template kind ... never the same
// generic ListChecks for every card". Before this every card in the Template
// Center drew the identical grey ListChecks in an identical grey box, so a
// grid of twelve templates carried no information at all above the name.
//
// Same language as DotsArt (design-system 5.8): --os-line-strong at 1.5px, no
// fills, no colour, on the faint --os-surface-1 sheet. Server-safe.

import type { TemplateArt } from "@/lib/templates/kinds";

const STROKE = "var(--os-line-strong)";

function Dot({ cx, cy, r = 7 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} stroke={STROKE} strokeWidth={1.5} fill="none" />;
}

function Line({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={STROKE} strokeWidth={1.5} strokeLinecap="round" fill="none" />;
}

function Box({ x, y, w, h, r = 6 }: { x: number; y: number; w: number; h: number; r?: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={r} stroke={STROKE} strokeWidth={1.5} fill="none" />;
}

function Shape({ art }: { art: TemplateArt }) {
  switch (art) {
    // A task: one dot with its line, the smallest unit of work.
    case "dot":
      return (
        <>
          <Dot cx={34} cy={48} />
          <Line x1={48} y1={48} x2={70} y2={48} />
        </>
      );
    // A list: the four-dot row.
    case "row":
      return (
        <>
          <Dot cx={24} cy={48} />
          <Dot cx={40} cy={48} />
          <Dot cx={56} cy={48} />
          <Dot cx={72} cy={48} />
        </>
      );
    // A Space: the 2x2 room.
    case "grid":
      return (
        <>
          <Dot cx={36} cy={36} />
          <Dot cx={60} cy={36} />
          <Dot cx={36} cy={60} />
          <Dot cx={60} cy={60} />
        </>
      );
    // A doc: the page stack.
    case "page":
      return (
        <>
          <Box x={30} y={24} w={38} h={48} r={5} />
          <Line x1={38} y1={38} x2={60} y2={38} />
          <Line x1={38} y1={48} x2={60} y2={48} />
          <Line x1={38} y1={58} x2={52} y2={58} />
        </>
      );
    // A canvas: the loose cluster with its connecting lines.
    case "cluster":
      return (
        <>
          <Line x1={48} y1={31} x2={30} y2={60} />
          <Line x1={48} y1={31} x2={66} y2={60} />
          <Line x1={30} y1={60} x2={66} y2={60} />
          <Dot cx={48} cy={30} />
          <Dot cx={30} cy={62} />
          <Dot cx={66} cy={62} />
        </>
      );
    // A folder: the shelf with two things on it.
    case "shelf":
      return (
        <>
          <Line x1={24} y1={64} x2={72} y2={64} />
          <Line x1={24} y1={32} x2={44} y2={32} />
          <Line x1={24} y1={32} x2={24} y2={64} />
          <Line x1={72} y1={40} x2={72} y2={64} />
          <Line x1={44} y1={32} x2={52} y2={40} />
          <Line x1={52} y1={40} x2={72} y2={40} />
          <Dot cx={40} cy={54} r={5} />
          <Dot cx={56} cy={54} r={5} />
        </>
      );
    // A saved view: three columns of a board.
    case "column":
      return (
        <>
          <Box x={22} y={28} w={16} h={40} r={4} />
          <Box x={42} y={28} w={16} h={40} r={4} />
          <Box x={62} y={28} w={16} h={40} r={4} />
        </>
      );
    // A starter kit: a row plus a page, because a kit makes several things.
    case "kit":
    default:
      return (
        <>
          <Box x={20} y={26} w={30} h={40} r={5} />
          <Line x1={26} y1={38} x2={44} y2={38} />
          <Line x1={26} y1={48} x2={44} y2={48} />
          <Dot cx={62} cy={36} r={6} />
          <Dot cx={62} cy={54} r={6} />
          <Line x1={70} y1={36} x2={78} y2={36} />
          <Line x1={70} y1={54} x2={78} y2={54} />
        </>
      );
  }
}

export function TemplateArtwork({ art, size = 96, className }: { art: TemplateArt; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      aria-hidden
      focusable="false"
      className={className}
      style={{ display: "block" }}
    >
      <rect x="8" y="8" width="80" height="80" rx="12" fill="var(--os-surface-1)" />
      <Shape art={art} />
    </svg>
  );
}

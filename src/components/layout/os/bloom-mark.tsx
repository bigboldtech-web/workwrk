"use client";

/* BloomMark — the workwrk AI signature.
 *
 * Single source of truth for the AI icon. Use it ANYWHERE the product
 * invokes AI: Ask-AI button, Brain panel avatar + model pill, agent
 * surfaces, AI-generated badges, etc.
 *
 * Visual language — a blooming flower:
 *   1. 6 outer rounded teardrop petals arranged at 60° intervals,
 *      bases overlapping at center, tips fanning outward → reads as a
 *      full, opened bloom (daisy / cherry-blossom silhouette).
 *   2. 6 smaller inner petals at 30° offset → fills the gaps between
 *      outer petals, like a younger inner ring still opening.
 *   3. Central pistil — soft white-pink radial gradient → the warm
 *      "core" of the flower.
 *   4. Bright nucleus pinpoint at dead center.
 *
 * The outer petals share a single diagonal holographic gradient
 * (pink → magenta → violet → indigo → cyan) so the bloom reads as one
 * continuous color flow. Inner petals are softer white-pink for depth.
 *
 * Gradient IDs are namespaced via useId() so multiple BloomMarks on
 * the same page never collide.
 */

import { useId } from "react";

interface Props {
  size?: number;
  className?: string;
  /** When true, the bloom slowly rotates (40s/turn). Reserve for hero
   *  surfaces (Brain greeting avatar). Skip on chip-level usage so the
   *  UI doesn't feel "alive in the corners". */
  animated?: boolean;
}

export function BloomMark({ size = 16, className, animated = false }: Props) {
  const reactId = useId();
  const id = reactId.replace(/[^a-zA-Z0-9]/g, "");
  const outerId = `bm-out-${id}`;
  const innerId = `bm-in-${id}`;
  const pistilId = `bm-pis-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`bloom-mark${animated ? " bloom-mark--spin" : ""}${
        className ? " " + className : ""
      }`}
    >
      <defs>
        {/* Holographic petal gradient — one continuous diagonal sweep
            so the whole bloom reads as one color flow. */}
        <linearGradient
          id={outerId}
          x1="4"
          y1="4"
          x2="28"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FFC4D7" />
          <stop offset="25%" stopColor="#FF8FB7" />
          <stop offset="50%" stopColor="#C57BFF" />
          <stop offset="75%" stopColor="#7E96FF" />
          <stop offset="100%" stopColor="#5BC6FF" />
        </linearGradient>
        {/* Inner petals — soft white-pink, slightly translucent */}
        <linearGradient
          id={innerId}
          x1="10"
          y1="10"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.98" />
          <stop offset="100%" stopColor="#FFE4F1" stopOpacity="0.75" />
        </linearGradient>
        {/* Central pistil — pearl glow */}
        <radialGradient
          id={pistilId}
          cx="16"
          cy="16"
          r="3.5"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="55%" stopColor="#FFE4F1" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Outer ring — 6 rounded teardrop petals, fully bloomed. Each
          petal: narrow base near center, flares wide through the
          middle, rounded soft tip at the top. */}
      <g fill={`url(#${outerId})`}>
        {[0, 60, 120, 180, 240, 300].map((rot) => (
          <path
            key={rot}
            d="M 16 14 Q 12 11 12 7 Q 12 3 16 2 Q 20 3 20 7 Q 20 11 16 14 Z"
            transform={`rotate(${rot} 16 16)`}
          />
        ))}
      </g>

      {/* Inner ring — 6 smaller petals at 30° offset, tucked between
          the outer petals. They're shorter and narrower, evoking a
          younger inner layer of the bloom still opening. */}
      <g fill={`url(#${innerId})`}>
        {[30, 90, 150, 210, 270, 330].map((rot) => (
          <path
            key={rot}
            d="M 16 14.6 Q 13.6 13 13.6 10 Q 13.6 7.5 16 7 Q 18.4 7.5 18.4 10 Q 18.4 13 16 14.6 Z"
            transform={`rotate(${rot} 16 16)`}
          />
        ))}
      </g>

      {/* Pistil — soft pearl glow at the bloom's center */}
      <circle cx="16" cy="16" r="2.6" fill={`url(#${pistilId})`} />

      {/* Bright nucleus pinpoint */}
      <circle cx="16" cy="16" r="0.95" fill="#FFFFFF" />
    </svg>
  );
}

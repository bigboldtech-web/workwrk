"use client";

// ReviewFormCard (spec-teams-performance section 3): one KRA row of a
// review: the KRA name, its weight as a neutral chip, the 1 to 5
// RatingScale and an auto-growing "What you achieved" (or, on the manager
// side, "Comments") field. Read only renders the same thing as text.

import { RatingScale } from "./rating-scale";

export function ReviewFormCard({
  kra,
  rating,
  comment,
  onChange,
  anchors,
  readOnly = false,
  commentLabel = "What you achieved",
}: {
  kra: { id: string; name: string; weight?: number | null };
  rating: number | null;
  comment: string;
  onChange?: (next: { rating: number | null; comment: string }) => void;
  anchors?: readonly string[];
  readOnly?: boolean;
  commentLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-line-soft py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-row font-medium text-ink">{kra.name}</span>
        {kra.weight ? <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-line bg-subtle px-2 text-xs font-medium text-ink-2">Weight {Math.round(kra.weight)}%</span> : null}
      </div>
      <RatingScale
        name={`kra-${kra.id}`}
        ariaLabel={`Rating for ${kra.name}`}
        value={rating}
        labels={anchors}
        readOnly={readOnly}
        onChange={(n) => onChange?.({ rating: n, comment })}
      />
      {readOnly ? (
        comment.trim() ? <p className="m-0 whitespace-pre-wrap text-row text-ink">{comment}</p> : null
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-2">{commentLabel}</span>
          <textarea
            value={comment}
            rows={3}
            maxLength={10_000}
            onChange={(e) => onChange?.({ rating, comment: e.target.value })}
            className="min-h-[76px] w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]"
          />
        </label>
      )}
    </div>
  );
}

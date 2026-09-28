// AnonymityNote (spec-teams-performance section 3): one slim line, 13/400
// ink-2 with a 16px Lock, on --os-surface-1 at radius 6. One sentence, never
// a banner or a modal. The words are fixed per mode so a promise of
// anonymity reads the same everywhere it is made. Each sentence promises
// only what the data model keeps: a survey answer is stored against its
// author (so they can read and change their own), so the survey lines say
// "never shown", never "not recorded".

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export function AnonymityNote({
  mode,
  responded = false,
  subject,
  className,
}: {
  mode: "candor" | "survey" | "peer";
  responded?: boolean;
  /** Peer mode: the person the feedback is about. */
  subject?: string;
  className?: string;
}) {
  const text =
    mode === "candor"
      ? "Your answers are anonymous. WorkwrK records that you answered, never what you answered."
      : mode === "survey"
        ? responded
          ? "Your name is never shown with your answers, not even to the people who run this survey."
          : "This survey is anonymous. Your name is never shown with your answers, not even to the people who run it."
        : `Your name is not shown to ${subject ?? "them"}. Their manager sees that you responded, never which answer is yours.`;
  return (
    <p className={cn("m-0 flex items-start gap-2 rounded-md bg-subtle px-3 py-2 text-sm text-ink-2", className)}>
      <Lock className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
      <span>{text}</span>
    </p>
  );
}

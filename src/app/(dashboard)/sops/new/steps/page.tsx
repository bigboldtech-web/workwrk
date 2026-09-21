"use client";

/* /sops/new/steps — the Step-by-step SOP create door.
 *
 * Spec: docs/plans/ui-refresh/spec-process.md section 0 (one URL per kind) and
 * section 2 (`/sops/new/steps`).
 *
 * WHY THIS FILE EXISTS NOW. Step-by-step was the one kind with no URL: it was
 * created only by `/sops/new?type=STEPS`, a picker page that POSTed a row on
 * click and then routed. Phase 3 gives every kind its own URL and 308s the
 * `?type=` forms onto them, so this route has to answer or the redirect lands
 * on the app's soft 404 (an unknown path renders a not-found page at HTTP 200,
 * which no monitor can tell from a working one).
 *
 * WHAT IT DOES TODAY, stated plainly: exactly what `/sops/new?type=STEPS` did,
 * and nothing more. It mints the same row (sopType WRITTEN, content
 * `{ type: "steps", steps: [] }` — STEPS is a presentation of WRITTEN at the
 * DB layer) and hands straight over to the step editor that already exists,
 * inline on `/sops/[id]?edit=1`. The create-on-first-change behaviour the spec
 * asks for, which is what stops abandoned "Untitled" rows, belongs with the
 * SopEditorPage rebuild in spec-process step 3; doing half of it here would
 * leave two create models for one kind.
 *
 * `router.replace`, not `push`: the create URL must not sit in the back stack,
 * or Back from the editor mints a second row.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OsPageHeader, OsPageHeaderSkeleton } from "@/components/layout/os/page-header";
import { ErrorState } from "@/components/ui/error-state";
import { LockedPage } from "@/components/access";
import { useOsToast } from "@/components/layout/os/toast";

type State = "creating" | "denied" | "failed";

export default function NewStepsSopPage() {
  const router = useRouter();
  const { toast } = useOsToast();
  const [state, setState] = useState<State>("creating");
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/sops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Untitled step-by-step SOP",
            sopType: "WRITTEN",
            content: { type: "steps", steps: [] },
          }),
        });
        if (res.status === 403) { setState("denied"); return; }
        if (!res.ok) throw new Error(`POST ${res.status}`);
        const data = await res.json();
        const sop = data.data ?? data;
        if (!sop?.id) throw new Error("no id");
        router.replace(`/sops/${encodeURIComponent(sop.id)}?edit=1`);
      } catch {
        setState("failed");
        toast("Couldn't create SOP");
      } finally {
        inFlight.current = false;
      }
    })();
  }, [router, toast, attempt]);

  if (state === "denied") {
    return (
      <LockedPage
        name="New SOP"
        sentence="Creating SOPs is limited to people who can manage SOPs."
        back={{ fallbackHref: "/sops", label: "SOPs" }}
      />
    );
  }

  if (state === "failed") {
    return (
      <>
        <OsPageHeader title="New step-by-step SOP" back={{ fallbackHref: "/sops", label: "SOPs" }} />
        <ErrorState
          what="this SOP"
          title="Couldn't create the SOP"
          onRetry={() => { setState("creating"); setAttempt((n) => n + 1); }}
        />
      </>
    );
  }

  return <OsPageHeaderSkeleton />;
}

"use client";

// The template the workspace was created with at signup
// (/signup?template=tuesday), on the setup wizard: what it added and where
// to open it, or, when it did not finish, a Try again that resumes it
// without doubling anything (POST /api/onboard/template). Renders nothing
// for a workspace made without a template. Owner and Admin only, like the
// wizard.

import { useEffect, useState } from "react";
import { AuthBanner } from "@/components/auth/auth-card";
import { Dots } from "@/components/ui/dots";

interface TemplateView {
  key: string;
  name: string;
  status: "applied" | "applying" | "failed";
  spaceSlug?: string;
  sopId?: string | null;
  kraId?: string | null;
  kpiId?: string | null;
  goalId?: string | null;
  docId?: string | null;
  jobTitles?: number;
  skipped?: string[];
  retryable?: boolean;
}

/**
 * What the template made, named from the marker's own ids: a piece that was
 * not made (a plan cap left the SOP out) is never named. Pure.
 */
export function appliedPieces(t: TemplateView): string {
  const parts = ["the Operations Space with its Onboarding List"];
  if (t.sopId) parts.push("the Client onboarding SOP");
  if ((t.jobTitles ?? 0) >= 2) parts.push("the Onboarding lead and Finance job titles");
  else if ((t.jobTitles ?? 0) === 1) parts.push("a job title");
  if (t.kraId && t.kpiId) parts.push("a KRA and KPI");
  else if (t.kraId) parts.push("a KRA");
  if (t.goalId) parts.push("a company goal");
  if (t.docId) parts.push("a playbook doc");
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * `problemsOnly` hides the success line (the wizard shows it once, on its
 * first step and its done screen) but keeps a failure and its Try again on
 * every step, so an owner who leaves early still sees it.
 */
export function SignupTemplateNote({ enabled, problemsOnly = false }: { enabled: boolean; problemsOnly?: boolean }) {
  const [tpl, setTpl] = useState<TemplateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch("/api/onboard/template", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { template?: TemplateView | null } | null) => { if (live) setTpl(d?.template ?? null); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [enabled]);

  async function retry() {
    setBusy(true);
    setRetryFailed(false);
    try {
      const r = await fetch("/api/onboard/template", { method: "POST" });
      const d = (await r.json().catch(() => null)) as { template?: TemplateView | null } | null;
      if (d?.template) setTpl(d.template);
      if (!r.ok && d?.template?.status !== "applied") setRetryFailed(true);
    } catch {
      setRetryFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!tpl) return null;
  if (tpl.status === "applied") {
    const skipped = (tpl.skipped ?? []).filter(Boolean);
    if (problemsOnly && skipped.length === 0) return null;
    return (
      <AuthBanner tone={skipped.length ? "warning" : "success"}>
        <p>
          {tpl.name} is in your workspace: {appliedPieces(tpl)}.{" "}
          {skipped.map((line) => `${line.replace(/\.?$/, ".")} `)}
          {tpl.spaceSlug ? <a className="wa-link" href={`/spaces/${tpl.spaceSlug}`}>Open the Space</a> : null}
        </p>
      </AuthBanner>
    );
  }
  if (problemsOnly && tpl.status === "applying" && !tpl.retryable) return null;
  if (tpl.status === "applying" && !tpl.retryable) {
    return (
      <AuthBanner tone="info">
        <p>{tpl.name} is still being added to your workspace.</p>
      </AuthBanner>
    );
  }
  return (
    <AuthBanner tone="warning">
      <p>
        {tpl.name} did not finish setting up{retryFailed ? ", and the retry did not finish either" : ""}. Nothing it added is lost.{" "}
        <button type="button" className="wa-link" onClick={() => void retry()} disabled={busy}>
          {busy ? <Dots variant="pending" label="Trying again" /> : "Try again"}
        </button>
      </p>
    </AuthBanner>
  );
}

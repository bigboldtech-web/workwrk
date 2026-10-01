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
  retryable?: boolean;
}

export function SignupTemplateNote({ enabled }: { enabled: boolean }) {
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
    return (
      <AuthBanner tone="success">
        <p>
          {tpl.name} is in your workspace: the Operations Space with its Onboarding List, the Client onboarding SOP, the Onboarding lead and Finance job titles, a KRA and KPI, a company goal and a playbook doc.{" "}
          {tpl.spaceSlug ? <a className="wa-link" href={`/spaces/${tpl.spaceSlug}`}>Open the Space</a> : null}
        </p>
      </AuthBanner>
    );
  }
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

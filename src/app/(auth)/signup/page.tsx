// /signup: "Start your workspace" (spec-account-auth section 2 `/signup`).
// The marketing site's every "Start free" button lands here
// (src/components/marketing/config.ts routes.signup), with ?utm_content= and
// ?template= intact. /register 308s here.
import type { Metadata } from "next";
import { AuthShell, marketingHref } from "@/components/auth/auth-shell";
import { startFreeSubline } from "@/components/marketing/data/pricing";
import { SignupForm } from "./signup-form";

// The plan line under the title. A new workspace is created on Starter
// (Organization.plan defaults to STARTER), so the line is the one sentence
// the pricing source allows "Start free" to carry, built from the seat cap
// the server enforces. It is read at build time from that source, never
// typed here, so it cannot drift from the plan.
const PLAN_LINE: string | null = startFreeSubline();

export const metadata: Metadata = { title: "Start your workspace | WorkwrK" };

export default function SignupPage() {
  return (
    <AuthShell panel="proof">
      <SignupForm planLine={PLAN_LINE} termsHref={marketingHref("/terms")} privacyHref={marketingHref("/privacy")} />
    </AuthShell>
  );
}

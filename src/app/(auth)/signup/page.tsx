// /signup: "Start your workspace" (spec-account-auth section 2 `/signup`).
// The marketing site's every "Start free" button lands here
// (src/components/marketing/config.ts routes.signup), with ?utm_content= and
// ?template= intact. /register 308s here.
import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Start your workspace | WorkwrK" };

export default function SignupPage() {
  return <RegisterForm mode="signup" />;
}

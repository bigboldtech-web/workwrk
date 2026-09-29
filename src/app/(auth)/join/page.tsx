// /join?token=X: accept an invitation (spec-account-auth section 2 `/join`).
// Every invitation email links here; the ones already sent link to
// /register?token=X, which 308s here with the token.
import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Join your team | WorkwrK" };

export default function JoinPage() {
  return <RegisterForm mode="join" />;
}

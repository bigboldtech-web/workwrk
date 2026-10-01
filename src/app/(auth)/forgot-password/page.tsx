// /forgot-password: ask for a link that sets a new password
// (spec-account-auth `/forgot-password`).
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset your password | WorkwrK" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell panel="proof">
      <ForgotForm />
    </AuthShell>
  );
}

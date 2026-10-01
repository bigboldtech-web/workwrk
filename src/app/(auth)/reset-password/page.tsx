// /reset-password?token=: set a new password from the emailed link
// (spec-account-auth `/reset-password`).
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Set a new password | WorkwrK" };

export default function ResetPasswordPage() {
  return (
    <AuthShell panel="proof">
      <ResetForm />
    </AuthShell>
  );
}

// /verify-email: confirm the address on an account, or ask for a new link
// (spec-account-auth `/verify-email`).
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyFlow } from "./verify-flow";

export const metadata: Metadata = { title: "Confirm your email | WorkwrK" };

export default function VerifyEmailPage() {
  return (
    <AuthShell panel="proof">
      <VerifyFlow />
    </AuthShell>
  );
}

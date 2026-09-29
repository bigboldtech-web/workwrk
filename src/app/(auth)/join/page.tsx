// /join?token=X: accept an invitation (spec-account-auth section 2 `/join`).
// Every invitation email links here; the ones already sent link to
// /register?token=X, which 308s here with the token. The navy panel is the
// invitation panel (the org, the inviter, the role, the message), fed by the
// same GET as the card.
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { JoinCard, JoinPanel, JoinProvider } from "./join-flow";

export const metadata: Metadata = { title: "Join your team | WorkwrK" };

export default async function JoinPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw)?.trim() || null;
  return (
    <JoinProvider token={token}>
      <AuthShell panel={<JoinPanel />}>
        <JoinCard />
      </AuthShell>
    </JoinProvider>
  );
}

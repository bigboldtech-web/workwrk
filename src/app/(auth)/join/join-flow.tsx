"use client";

// /join?token= (spec-account-auth `/join`): accept an invitation, seeing
// exactly what you are joining. One GET decides everything; the card and the
// navy invitation panel read the same state through JoinProvider.
//
// Variants (src/lib/access/join-invite.ts joinVariant):
//   A  new person, signed out: names and a password (the inviting org's rules)
//   B  the address already has an account, signed out: log in, then join
//   C  signed in as the invited address: one click, no password
//   D  signed in as somebody else: log out first; nothing is posted
// Failure screens replace the card at the same URL: invalid, used, expired
// (with "Ask for a new invitation"), already a member, workspace closed.
// After joining, a full document navigation to the `landing` the server
// returned, so the session and the shell are built for the workspace joined.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { Check, Mail } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { AuthBanner, AuthCard } from "@/components/auth/auth-card";
import { PasswordField } from "@/components/auth/password-field";
import { AuthProofPanel, InvitationFactsInline, type InvitationFacts } from "@/components/auth/proof-panel";
import { joinVariant } from "@/lib/access/join-invite";
import { parsePolicyView, passwordMeets, type PasswordPolicyView } from "@/lib/auth/password-rules";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { resetSessionExpired } from "@/lib/session-expiry";
import { formatDate } from "@/lib/format/date";

interface InviteData extends InvitationFacts {
  email: string;
  isAgent?: boolean;
  expiresAt: string;
  firstName: string | null;
  lastName: string | null;
  passwordPolicy: unknown;
  accountExists: boolean;
  alreadyInThisOrg: boolean;
  alreadyInThisOrgInactive?: boolean;
}

type Failure = { code: "invalid" | "used" | "expired" | "member" | "closed" | "network"; organizationName?: string; expiresAt?: string; inviterName?: string | null; inactive?: boolean };

type State = { kind: "loading" } | { kind: "failed"; failure: Failure } | { kind: "ready"; invite: InviteData };

interface Ctx {
  token: string | null;
  state: State;
  setState: (s: State) => void;
  reload: () => void;
}

const JoinCtx = createContext<Ctx | null>(null);

function useJoin(): Ctx {
  const c = useContext(JoinCtx);
  if (!c) throw new Error("JoinProvider missing");
  return c;
}

export function JoinProvider({ token, children }: { token: string | null; children: ReactNode }) {
  const [state, setState] = useState<State>(token ? { kind: "loading" } : { kind: "failed", failure: { code: "invalid" } });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    fetch(`/api/auth/accept-invite?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        if (!alive) return;
        if (r.ok) {
          const invite = d as unknown as InviteData;
          if (invite.alreadyInThisOrg) setState({ kind: "failed", failure: { code: "member", organizationName: invite.organizationName, inactive: invite.alreadyInThisOrgInactive } });
          else setState({ kind: "ready", invite });
          return;
        }
        const code = (typeof d.code === "string" ? d.code : "invalid") as Failure["code"];
        setState({
          kind: "failed",
          failure: {
            code: ["invalid", "used", "expired", "closed"].includes(code) ? code : "invalid",
            organizationName: typeof d.organizationName === "string" ? d.organizationName : undefined,
            expiresAt: typeof d.expiresAt === "string" ? d.expiresAt : undefined,
            inviterName: typeof d.inviterName === "string" ? d.inviterName : null,
          },
        });
      })
      .catch(() => {
        if (alive) setState({ kind: "failed", failure: { code: "network" } });
      });
    return () => {
      alive = false;
    };
  }, [token, attempt]);
  // The tab title names the workspace, as the page title does (naming-canon "Join {Org}").
  useEffect(() => {
    if (state.kind === "ready") document.title = `Join ${state.invite.organizationName} | WorkwrK`;
  }, [state]);
  const reload = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  const value = useMemo(() => ({ token, state, setState, reload }), [token, state, reload]);
  return <JoinCtx.Provider value={value}>{children}</JoinCtx.Provider>;
}

/** The navy right column: skeleton while loading, the invitation's facts when ready, the proof panel on a failure screen. */
export function JoinPanel() {
  const { state } = useJoin();
  if (state.kind === "loading") return <AuthProofPanel variant="invitation" loading />;
  if (state.kind === "failed") return <AuthProofPanel variant="proof" />;
  return <AuthProofPanel variant="invitation" invitation={state.invite} />;
}

function joinUrl(token: string | null): string {
  return token ? `/join?token=${encodeURIComponent(token)}` : "/join";
}

function loginToJoin(token: string | null): string {
  return `/login?callbackUrl=${encodeURIComponent(joinUrl(token))}`;
}

function FailureCard({ failure, token }: { failure: Failure; token: string | null }) {
  const { reload } = useJoin();
  const { status } = useSession();
  const [resend, setResend] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const org = failure.organizationName ?? "the workspace";
  const backToLogin = (
    <p>
      <Link href="/login" className="wa-link">
        Back to log in
      </Link>
    </p>
  );

  if (failure.code === "network") {
    return (
      <AuthCard title="Join a workspace">
        <AuthBanner tone="danger">
          <p>
            Can&apos;t reach WorkwrK. Check your connection.{" "}
            <button type="button" className="wa-link" onClick={reload}>
              Try again
            </button>
          </p>
        </AuthBanner>
      </AuthCard>
    );
  }
  if (failure.code === "used") {
    return (
      <AuthCard drawing title={`You have already joined ${org}`} subtitle={status === "authenticated" ? "This invitation has been used. Switch to the workspace from the workspace menu." : "This invitation has been used. Log in to open the workspace."}>
        {status === "authenticated" ? (
          <a href={WORK_HOME_HREF} className="wa-btn wa-btn--primary wa-btn--block">
            Continue to WorkwrK
          </a>
        ) : (
          <Link href="/login" className="wa-btn wa-btn--primary wa-btn--block">
            Log in
          </Link>
        )}
      </AuthCard>
    );
  }
  if (failure.code === "expired") {
    const who = failure.inviterName || "whoever invited you";
    return (
      <AuthCard
        drawing
        title={failure.expiresAt ? `This invitation expired on ${formatDate(failure.expiresAt, null, "date")}` : "This invitation has expired"}
        subtitle={`Ask ${who} to send a new one.`}
        footer={backToLogin}
      >
        {resend === "sent" ? (
          <AuthBanner tone="success">
            <p>We let {failure.inviterName || "the workspace admins"} know.</p>
          </AuthBanner>
        ) : (
          <>
            {resend === "failed" ? (
              <AuthBanner tone="danger">
                <p>That did not go through. Try again in a moment.</p>
              </AuthBanner>
            ) : null}
            <button
              type="button"
              className="wa-btn wa-btn--secondary wa-btn--block"
              data-pending={resend === "sending" || undefined}
              onClick={async () => {
                if (!token || resend === "sending") return;
                setResend("sending");
                try {
                  const r = await fetch("/api/invitations/request-resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
                  setResend(r.ok ? "sent" : "failed");
                } catch {
                  setResend("failed");
                }
              }}
            >
              {resend === "sending" ? <Dots variant="pending" label="Sending" /> : null}
              Ask for a new invitation
            </button>
          </>
        )}
      </AuthCard>
    );
  }
  if (failure.code === "member") {
    return (
      <AuthCard
        drawing
        title={`You are already in ${org}`}
        subtitle={failure.inactive ? `Your account in ${org} is switched off. Ask your workspace admin to turn it back on.` : "This invitation is not needed. Log in and you are there."}
      >
        {status === "authenticated" ? (
          <a href={WORK_HOME_HREF} className="wa-btn wa-btn--primary wa-btn--block">
            Continue to WorkwrK
          </a>
        ) : (
          <Link href={`/login?callbackUrl=${encodeURIComponent(WORK_HOME_HREF)}`} className="wa-btn wa-btn--primary wa-btn--block">
            Log in
          </Link>
        )}
      </AuthCard>
    );
  }
  if (failure.code === "closed") {
    return (
      <AuthCard drawing title={`${org} is not taking new members`} subtitle="The workspace is suspended or closed. Ask whoever invited you." footer={backToLogin} />
    );
  }
  return (
    <AuthCard
      drawing
      title="This invitation link is not valid"
      subtitle="Ask whoever invited you to send a new one."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/login" className="wa-link">
            Log in
          </Link>
        </p>
      }
    />
  );
}

function EmailStrip({ email, signedIn }: { email: string; signedIn?: boolean }) {
  return (
    <div className="wa-email-strip">
      <AuthBanner tone={signedIn ? "success" : "info"} strip icon={signedIn ? <Check size={16} aria-hidden /> : <Mail size={16} aria-hidden />}>
        <p>{signedIn ? <>You are logged in as {email}.</> : email}</p>
      </AuthBanner>
      {signedIn ? null : <p className="wa-help">This invitation is for this address.</p>}
    </div>
  );
}

export function JoinCard() {
  const { token, state, setState } = useJoin();
  const { data: session, status, update } = useSession();
  // What the person typed; until they type, the names the invitation
  // carried (a People CSV import) show, with no effect copying them in.
  const [typedFirst, setFirstName] = useState<string | null>(null);
  const [typedLast, setLastName] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forceB, setForceB] = useState(false);

  const invite = state.kind === "ready" ? state.invite : null;
  const firstName = typedFirst ?? invite?.firstName ?? "";
  const lastName = typedLast ?? invite?.lastName ?? "";

  const policy: PasswordPolicyView = useMemo(() => parsePolicyView(invite?.passwordPolicy), [invite]);

  if (state.kind === "loading" || status === "loading") {
    return (
      <div className="wa-card" aria-busy="true" aria-label="Opening your invitation">
        <div className="wa-skel" style={{ width: "60%", height: 22 }} />
        <div className="wa-skel wa-skel--tall" />
        <div className="wa-skel wa-skel--tall" />
      </div>
    );
  }
  if (state.kind === "failed") return <FailureCard failure={state.failure} token={token} />;
  if (!invite) return null;

  const org = invite.organizationName;
  const sessionEmail = status === "authenticated" ? session?.user?.email ?? null : null;
  const variant = forceB && !sessionEmail ? "B" : joinVariant({ sessionEmail, inviteEmail: invite.email, accountExists: invite.accountExists });

  async function post(body: Record<string, unknown>) {
    setLoading(true);
    setBanner(null);
    setPwError(null);
    let res: Response;
    try {
      res = await fetch("/api/auth/accept-invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }) });
    } catch {
      setLoading(false);
      setBanner("Can't reach WorkwrK. Check your connection.");
      return null;
    }
    const d = (await res.json().catch(() => ({}))) as { code?: string; error?: string; landing?: string; organizationName?: string; inactive?: boolean };
    if (res.ok) return d;
    setLoading(false);
    switch (d.code) {
      case "member":
        setState({ kind: "failed", failure: { code: "member", organizationName: org, inactive: d.inactive } });
        break;
      case "used":
      case "expired":
      case "invalid":
      case "closed":
        setState({ kind: "failed", failure: { code: d.code, organizationName: org, inviterName: invite?.inviterName ?? null, expiresAt: invite?.expiresAt } });
        break;
      case "account_exists":
        setForceB(true);
        break;
      case "password":
        setPwError(d.error ?? "Choose a stronger password.");
        break;
      default:
        setBanner(d.error || "Something went wrong. Try again.");
    }
    return null;
  }

  async function joinAsNew() {
    if (loading || !invite) return;
    if (!firstName.trim() || !lastName.trim()) {
      setNameError("Enter your first and last name.");
      return;
    }
    setNameError(null);
    if (!passwordMeets(password, policy)) {
      setPwError("Meet every rule below.");
      return;
    }
    const d = await post({ firstName: firstName.trim(), lastName: lastName.trim(), password });
    if (!d) return;
    const landing = d.landing || WORK_HOME_HREF;
    const login = await signIn("credentials", { email: invite.email, password, redirect: false }).catch(() => undefined);
    if (login?.ok && !login.error) {
      resetSessionExpired();
      window.location.assign(landing);
    } else {
      window.location.assign(`/login?callbackUrl=${encodeURIComponent(landing)}`);
    }
  }

  async function joinSignedIn() {
    if (loading) return;
    const d = await post({});
    if (!d) return;
    // The JWT re-reads the workspace it now anchors to, then a full
    // navigation rebuilds the shell for it (never a client push).
    await update().catch(() => null);
    window.location.assign(d.landing || WORK_HOME_HREF);
  }

  const errorBanner = banner ? (
    <AuthBanner tone="danger">
      <p>{banner}</p>
    </AuthBanner>
  ) : null;

  const loginFirstFooter = (
    <p>
      Already have a WorkwrK account, or not you?{" "}
      <Link href={loginToJoin(token)} className="wa-link">
        Log in
      </Link>{" "}
      first
    </p>
  );

  if (variant === "D") {
    return (
      <AuthCard
        banner={
          <AuthBanner tone="warning" strip>
            <p>
              You are logged in as <strong>{sessionEmail}</strong>. This invitation is for a different address.
            </p>
          </AuthBanner>
        }
        title={`Join ${org}`}
        subtitle={`This invitation is for ${invite.email}`}
        footer={
          <p>
            <a href={WORK_HOME_HREF} className="wa-link">
              Stay logged in as {sessionEmail}
            </a>
          </p>
        }
      >
        <button type="button" className="wa-btn wa-btn--primary wa-btn--block" onClick={() => void signOut({ callbackUrl: joinUrl(token) })}>
          Log out and join as {invite.email}
        </button>
      </AuthCard>
    );
  }

  if (variant === "C") {
    return (
      <AuthCard
        title={`Join ${org}`}
        subtitle={`You are joining as ${invite.email}`}
        footer={
          <p>
            Not you?{" "}
            <button type="button" className="wa-link" onClick={() => void signOut({ callbackUrl: joinUrl(token) })}>
              Log out and use a different account
            </button>
          </p>
        }
      >
        <InvitationFactsInline invitation={invite} />
        <EmailStrip email={invite.email} signedIn />
        <p className="wa-text">Joining adds {org} to your workspaces. You can switch between them from the workspace menu.</p>
        {errorBanner}
        <button type="button" className="wa-btn wa-btn--primary wa-btn--block" data-pending={loading || undefined} onClick={() => void joinSignedIn()}>
          {loading ? <Dots variant="pending" label="Joining" /> : null}
          Join {org}
        </button>
      </AuthCard>
    );
  }

  if (variant === "B") {
    return (
      <AuthCard
        title={`Join ${org}`}
        subtitle={`You already have an account for ${invite.email}`}
        footer={
          <p>
            Can&apos;t log in, or never made that account?{" "}
            <Link href={`/forgot-password?email=${encodeURIComponent(invite.email)}`} className="wa-link">
              Reset the password
            </Link>{" "}
            and the link goes to {invite.email}.
          </p>
        }
      >
        <InvitationFactsInline invitation={invite} />
        <EmailStrip email={invite.email} />
        <p className="wa-text">You already use WorkwrK with this address. Log in once and {org} is added to your workspaces.</p>
        <Link href={loginToJoin(token)} className="wa-btn wa-btn--primary wa-btn--block">
          Log in and join
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`Join ${org}`} subtitle={`You are joining as ${invite.email}`} footer={loginFirstFooter}>
      <form
        className="wa-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void joinAsNew();
        }}
      >
        <InvitationFactsInline invitation={invite} />
        <EmailStrip email={invite.email} />
        {errorBanner}
        <div className="wa-row2">
          <div className="wa-field">
            <label htmlFor="firstName" className="wa-label">
              First name
            </label>
            <input id="firstName" className="wa-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" autoFocus maxLength={60} aria-invalid={nameError && !firstName.trim() ? true : undefined} />
          </div>
          <div className="wa-field">
            <label htmlFor="lastName" className="wa-label">
              Last name
            </label>
            <input id="lastName" className="wa-input" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" maxLength={60} aria-invalid={nameError && !lastName.trim() ? true : undefined} />
          </div>
        </div>
        {nameError ? <p className="wa-field-error">{nameError}</p> : null}
        <PasswordField label="Password" value={password} onChange={(v) => { setPassword(v); setPwError(null); }} autoComplete="new-password" policy={policy} error={pwError} />
        <button type="submit" className="wa-btn wa-btn--primary wa-btn--block" data-pending={loading || undefined}>
          {loading ? <Dots variant="pending" label="Joining" /> : null}
          Join {org}
        </button>
      </form>
    </AuthCard>
  );
}

"use client";

// /signup: "Start your workspace" (spec-account-auth `/signup`). Creates the
// workspace and its first Owner through POST /api/auth/register, which
// seeds the defaults (seedOrgDefaults), records the Terms consent and sends
// the first verification email; then logs in with the same values and
// opens the setup wizard at /onboard. If the automatic log in fails, the
// person lands on /login?signedup=1 with the address filled in.

import { Suspense, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Dots } from "@/components/ui/dots";
import { AuthBanner, AuthCard } from "@/components/auth/auth-card";
import { PasswordField } from "@/components/auth/password-field";
import { SignedInStrip } from "@/components/auth/signed-in-strip";
import { parsePolicyView, passwordMeets, policyView, type PasswordPolicyView } from "@/lib/auth/password-rules";
import { resetSessionExpired } from "@/lib/session-expiry";

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "yandex.com", "zoho.com", "mail.com", "rediffmail.com"]);

type Errors = Partial<Record<"organizationName" | "firstName" | "lastName" | "email" | "password", string>>;

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function SignupFormInner({ planLine, termsHref, privacyHref }: SignupLinks) {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get("token");
  const template = sp.get("template");
  // The one template signup applies (src/lib/templates/tuesday-template.ts
  // SIGNUP_TEMPLATE_KEYS; the server ignores any other value). Read here as a
  // literal so the sign-up page does not ship the site's fixture.
  const withTuesday = template?.trim().toLowerCase() === "tuesday";

  // /signup never accepts an invitation (that is /join's one job): a token
  // that lands here is sent on to /join with the rest of the query.
  useEffect(() => {
    if (token) router.replace(`/join?${sp.toString()}`);
  }, [token, router, sp]);

  const [form, setForm] = useState({ organizationName: "", firstName: "", lastName: "", email: "", password: "" });
  const [policy, setPolicy] = useState<PasswordPolicyView>(policyView());
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [freeMail, setFreeMail] = useState(false);
  const [emailInUse, setEmailInUse] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/password-policy", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.policy) setPolicy(parsePolicyView(d.policy));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
    if (k === "email") setEmailInUse(false);
  }

  function validate(): Errors {
    const e: Errors = {};
    if (!form.organizationName.trim()) e.organizationName = "Enter your company name.";
    if (!form.firstName.trim()) e.firstName = "Enter your first name.";
    if (!form.lastName.trim()) e.lastName = "Enter your last name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = "Enter a valid email address.";
    if (!passwordMeets(form.password, policy)) e.password = "Meet every rule below.";
    return e;
  }

  async function submit() {
    if (loading) return;
    const e = validate();
    setErrors(e);
    setBanner(null);
    setOffline(false);
    if (Object.keys(e).length > 0) return;
    setLoading(true);
    let res: Response;
    try {
      res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: form.organizationName,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email.trim(),
          password: form.password,
          timezone: browserTimeZone(),
          ...(template ? { template } : {}),
        }),
      });
    } catch {
      setOffline(true);
      setLoading(false);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string; field?: string; code?: string };
    if (!res.ok) {
      setLoading(false);
      if (data.code === "email_in_use") {
        setEmailInUse(true);
        return;
      }
      if (res.status === 429) {
        setBanner("Too many attempts. Try again in an hour.");
        return;
      }
      if (data.field === "password" || /^Password/.test(data.error ?? "")) {
        setErrors({ password: data.error ?? "Choose a stronger password." });
        return;
      }
      setBanner(data.error || "We could not create the workspace. Try again.");
      return;
    }
    try {
      window.sessionStorage.setItem("workwrk:last-email", form.email.trim());
    } catch {
      /* the prefill is a convenience */
    }
    const login = await signIn("credentials", { email: form.email.trim(), password: form.password, redirect: false }).catch(() => undefined);
    if (login?.ok && !login.error) {
      resetSessionExpired();
      // A full navigation, so the new session is what the wizard boots with.
      window.location.assign("/onboard");
      return;
    }
    router.push("/login?signedup=1");
  }

  const bannerNode = offline ? (
    <AuthBanner tone="danger">
      <p>
        Can&apos;t reach WorkwrK. Check your connection.{" "}
        <button type="button" className="wa-link" onClick={() => void submit()}>
          Try again
        </button>
      </p>
    </AuthBanner>
  ) : banner ? (
    <AuthBanner tone="danger">
      <p>{banner}</p>
    </AuthBanner>
  ) : null;

  return (
    <AuthCard
      banner={<SignedInStrip logoutCallback="/signup" />}
      title="Start your workspace"
      subtitle={planLine ?? undefined}
      footer={
        <>
          <p>
            Already have a workspace?{" "}
            <Link href="/login" className="wa-link">
              Log in
            </Link>
          </p>
          <p>Been invited? Open the link in your invitation email.</p>
        </>
      }
    >
      <form
        className="wa-form"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit();
        }}
      >
        {bannerNode}
        <div className="wa-field">
          <label htmlFor="orgName" className="wa-label">
            Company name
          </label>
          <input id="orgName" className="wa-input" value={form.organizationName} onChange={(e) => set("organizationName", e.target.value)} placeholder="Northwind Ops" autoComplete="organization" autoFocus aria-invalid={errors.organizationName ? true : undefined} maxLength={80} />
          {errors.organizationName ? <p className="wa-field-error">{errors.organizationName}</p> : null}
        </div>
        <div className="wa-row2">
          <div className="wa-field">
            <label htmlFor="firstName" className="wa-label">
              First name
            </label>
            <input id="firstName" className="wa-input" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoComplete="given-name" aria-invalid={errors.firstName ? true : undefined} maxLength={60} />
            {errors.firstName ? <p className="wa-field-error">{errors.firstName}</p> : null}
          </div>
          <div className="wa-field">
            <label htmlFor="lastName" className="wa-label">
              Last name
            </label>
            <input id="lastName" className="wa-input" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} autoComplete="family-name" aria-invalid={errors.lastName ? true : undefined} maxLength={60} />
            {errors.lastName ? <p className="wa-field-error">{errors.lastName}</p> : null}
          </div>
        </div>
        <div className="wa-field">
          <label htmlFor="email" className="wa-label">
            Work email
          </label>
          <input
            id="email"
            className="wa-input"
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            onBlur={() => setFreeMail(FREE_MAIL.has(form.email.trim().split("@")[1]?.toLowerCase() ?? ""))}
            placeholder="priya@company.com"
            autoComplete="email"
            aria-invalid={errors.email || emailInUse ? true : undefined}
          />
          {emailInUse ? (
            <p className="wa-field-error">
              An account already uses this address.{" "}
              <Link href="/login" className="wa-link">
                Log in
              </Link>{" "}
              instead.
            </p>
          ) : errors.email ? (
            <p className="wa-field-error">{errors.email}</p>
          ) : freeMail ? (
            <p className="wa-field-note">You can use a personal address. A work address makes inviting your team easier later.</p>
          ) : null}
        </div>
        <PasswordField label="Password" value={form.password} onChange={(v) => set("password", v)} autoComplete="new-password" policy={policy} error={errors.password} />
        <p className="wa-help">
          By creating a workspace you agree to the{" "}
          <a className="wa-link" href={termsHref} target="_blank" rel="noreferrer">
            Terms
          </a>{" "}
          and the{" "}
          <a className="wa-link" href={privacyHref} target="_blank" rel="noreferrer">
            Privacy Policy
          </a>
          .
        </p>
        {withTuesday ? (
          <p className="wa-help" data-testid="signup-template-line">
            Your workspace starts with the Tuesday: client onboarding template: an Operations Space with its Onboarding List, the Client onboarding SOP, the Onboarding lead and Finance job titles, a KRA and KPI, a company goal, a playbook doc and a sample task on the List.
          </p>
        ) : null}
        <button type="submit" className="wa-btn wa-btn--primary wa-btn--block" data-pending={loading || undefined}>
          {loading ? <Dots variant="pending" label="Creating your workspace" /> : null}
          Create workspace
        </button>
      </form>
    </AuthCard>
  );
}

/**
 * What the server page hands the form: the plan line (null when it is not
 * true of the plan a new workspace is created on) and the Terms and Privacy
 * links resolved through marketingHref, the same as the AuthShell footer.
 */
interface SignupLinks {
  planLine: string | null;
  termsHref: string;
  privacyHref: string;
}

export function SignupForm(props: SignupLinks) {
  return (
    <Suspense>
      <SignupFormInner {...props} />
    </Suspense>
  );
}

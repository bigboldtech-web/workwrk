// /login. On the admin host (ADMIN_HOST) it is the staff console's sign-in:
// "Sign in to the WorkwrK staff console" and no Start your free trial link,
// since the admin host serves no sign-up (proxy.ts bounces /register back to
// /admin). Where ADMIN_HOST is unset (local development, where /admin answers
// on the app host) the staff copy follows a callback into /admin instead.

import { headers } from "next/headers";
import { LoginForm } from "./login-form";

function hostOnly(value: string): string {
  return value.replace(/:\d+$/, "").trim().toLowerCase();
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const adminHost = process.env.ADMIN_HOST?.trim();
  let staffConsole = false;
  if (adminHost) {
    const host = (await headers()).get("host") || "";
    staffConsole = hostOnly(host) === hostOnly(adminHost);
  } else {
    const raw = (await searchParams).callbackUrl;
    const callback = Array.isArray(raw) ? raw[0] : raw;
    staffConsole = typeof callback === "string" && (callback === "/admin" || callback.startsWith("/admin/") || callback.startsWith("/admin?"));
  }
  return <LoginForm staffConsole={staffConsole} />;
}

// /onboard's layout: the tab title and the light-only sign-in stylesheet.
// The session gate and the boot screen are the client frame
// (onboard-frame.tsx). The wizard names the workspace in the tab once it
// has loaded it ("Set up {Org}", naming-canon); this is the title before.

import type { Metadata } from "next";
import { OnboardFrame } from "./onboard-frame";
import "../(auth)/auth-shell.css";

export const metadata: Metadata = { title: "Set up your workspace | WorkwrK", robots: { index: false, follow: false } };

export default function OnboardLayout({ children }: { children: React.ReactNode }) {
  return <OnboardFrame>{children}</OnboardFrame>;
}

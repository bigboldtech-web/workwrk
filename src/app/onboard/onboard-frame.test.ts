// /onboard keeps the wizard through a failed session read (review of the
// longer-sessions fix, L3). next-auth reads a failed GET /api/auth/session as
// no session, with the cookie still good; the frame showed its boot screen
// for that status and unmounted the wizard, and whatever was typed with it.
// Now, as the dashboard frame does, it keeps its children until the session
// route confirms the session is gone (useConfirmedSignOut).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const st = vi.hoisted(() => ({ status: "authenticated" as "loading" | "authenticated" | "unauthenticated", gone: false }));

vi.mock("next-auth/react", () => ({ useSession: () => ({ status: st.status, data: null }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {} }) }));
vi.mock("@/hooks/use-confirmed-sign-out", () => ({ useConfirmedSignOut: () => st.status === "unauthenticated" && st.gone }));
vi.mock("@/components/layout/os/shell-context", () => ({ LayerStackProvider: ({ children }: { children: unknown }) => children }));

import { OnboardFrame } from "./onboard-frame";

const render = () => renderToStaticMarkup(createElement(OnboardFrame, null, createElement("p", null, "the wizard, half filled in")));

beforeEach(() => {
  st.status = "authenticated";
  st.gone = false;
});

describe("OnboardFrame", () => {
  it("shows the wizard for a signed-in person", () => {
    expect(render()).toContain("the wizard, half filled in");
  });

  it("keeps the wizard while a failed session read is checked", () => {
    st.status = "unauthenticated";
    expect(render()).toContain("the wizard, half filled in");
  });

  it("lets it go once the session route says the session is gone, and while the session first loads", () => {
    st.status = "unauthenticated";
    st.gone = true;
    expect(render()).not.toContain("the wizard");
    st.status = "loading";
    st.gone = false;
    const html = render();
    expect(html).not.toContain("the wizard");
    expect(html).toContain("Opening WorkwrK");
  });
});

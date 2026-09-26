import { gatePage } from "@/lib/access/gate";

// Teams > Tools: every Member (Phase 6, access 5.2.1 widens this row on
// purpose: the tools shared with them). GET /api/tools already scopes a
// Member to their shares; adding and editing tools stay the manager tier's
// (POST and PATCH /api/tools), and the page renders those controls only for
// it.
export default async function ToolsLayout({ children }: { children: React.ReactNode }) {
  await gatePage("view", { type: "app", key: "tools" }, { callbackUrl: "/tools" });
  return <>{children}</>;
}

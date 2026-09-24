// The signed-in person, if any, as the engine's Viewer. The public form routes
// answer signed-out visitors too, so a missing or broken session is null,
// never a thrown 401. Server only.

import { viewerFromSession } from "@/lib/access/viewer";
import type { ResponderViewer } from "./responder-access";

export async function optionalResponderViewer(): Promise<ResponderViewer | null> {
  const viewer = await viewerFromSession().catch(() => null);
  if (!viewer) return null;
  return { userId: viewer.userId, organizationId: viewer.organizationId, orgRole: viewer.orgRole, isAgent: viewer.isAgent };
}

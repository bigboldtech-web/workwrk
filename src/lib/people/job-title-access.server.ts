import "server-only";
import { sessionOnLegacyManagerTier } from "@/lib/page-gates";
import { viewerFromSession } from "@/lib/access/viewer";
import { jobTitleWriterByFacts } from "./job-title-access";

/** May this session create, rename or delete a job title? The legacy tier or the facts. */
export async function mayWriteJobTitles(session: unknown): Promise<boolean> {
  if (await sessionOnLegacyManagerTier(session)) return true;
  const v = await viewerFromSession();
  if (!v || v.orgRole === "GUEST") return false;
  return jobTitleWriterByFacts(v);
}

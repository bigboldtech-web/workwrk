// Who may create, rename and delete a job title (spec-teams-people
// section 1, Job titles: Owner, Admin and the People team), kept together
// with the legacy manager tier that could do it yesterday, so nobody loses
// a create path they had. The Teams "+" row "New job title", the Job
// titles page, the role page's identity card and /api/roles all ask this.
// Pure: safe in a client component. The server half is
// job-title-access.server.ts.

type ViewerFacts = { orgRole?: string | null; peopleTeam?: boolean | null };

/** The facts half (boot.viewer on the client, the engine's Viewer on the server). */
export function jobTitleWriterByFacts(v: ViewerFacts | null | undefined): boolean {
  if (!v) return false;
  return v.orgRole === "OWNER" || v.orgRole === "ADMIN" || v.peopleTeam === true;
}

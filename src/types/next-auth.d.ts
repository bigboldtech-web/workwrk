import { DefaultSession, DefaultUser } from "next-auth";
import { DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      accessLevel: string;
      organizationId: string;
      organizationName: string;
      firstName: string;
      lastName: string;
      avatar: string | null;
      /** The tokenVersion this session was issued at (read-only; see freshWorkspaceActor). */
      tokenVersion?: number;
      /** Access step 0 claims, derived from accessLevel (the mirror); the server re-reads the row. */
      orgRole?: "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
      isAgent?: boolean;
      adminScopes?: ("billing" | "security")[];
    } & DefaultSession["user"];
    /**
     * Present once the person was moved out of a suspended or closed company
     * into another workspace (lib/auth.ts, WorkspaceMove): the sentence to
     * show and the id an ack (`update({ workspaceMoveAck: at })`) must name.
     */
    workspaceMove?: { at: number; message: string };
    /**
     * Present only on a session that has ended (no `user`): why, when it is
     * worth saying (lib/auth.ts endedHintOf). "revoked" means every session
     * of the account ended (Log out everywhere, a password change, an
     * admin's action); "expired" means the idle window or the lifetime ran
     * out. A session logged out in this browser, or ended for any other
     * reason, says nothing.
     */
    ended?: "revoked" | "expired";
  }

  interface User extends DefaultUser {
    firstName: string;
    lastName: string;
    accessLevel: string;
    organizationId: string;
    organizationName: string;
    avatar: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    accessLevel: string;
    organizationId: string;
    organizationName: string;
    firstName: string;
    lastName: string;
    avatar: string | null;
    /** Access step 0 claims (Phase 8 stage E), derived from accessLevel on every read. */
    orgRole?: "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
    isAgent?: boolean;
    adminScopes?: ("billing" | "security")[];
    /** The one-shot workspace-move marker (lib/auth.ts, WorkspaceMove). */
    workspaceMove?: { from: string; status: "SUSPENDED" | "CANCELLED"; to: string; at: number };
    /** The workspace requires two step verification of this person and they have none (lib/auth/mfa-hold.ts). */
    mfaHold?: boolean;
    /** The password is past the workspace's maximum age (Security > Passwords). */
    passwordHold?: boolean;
    /** The session clock (lib/auth/session-policy.ts). */
    authAt?: number;
    seenAt?: number;
    idleMin?: number;
    maxDays?: number;
    policyEnded?: boolean;
    /**
     * "logged_out": this session's id was listed by a plain log out (lib/auth/ended-sessions.ts).
     * "unchecked": its session checks failed for 24 hours on end (lib/auth.ts, the bound).
     */
    policyEndedReason?: "idle" | "lifetime" | "signed_out" | "logged_out" | "unchecked";
    /** When the session check's revocation-critical reads last all answered (lib/auth.ts). */
    lastGoodCheckAt?: number;
    /** When the current run of failed session checks began; absent while checks succeed (lib/auth.ts). */
    uncheckedSince?: number;
    /** The session id (lib/auth/ended-sessions.ts): 16 bytes, base64url, one per sign-in. */
    sid?: string;
    /** Why the revalidation revoked this token, while it is revoked: the account, its tokenVersion, or no healthy workspace. */
    revokedBy?: "account" | "version" | "workspace";
  }
}

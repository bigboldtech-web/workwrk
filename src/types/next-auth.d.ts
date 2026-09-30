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
    } & DefaultSession["user"];
    /**
     * Present once the person was moved out of a suspended or closed company
     * into another workspace (lib/auth.ts, WorkspaceMove): the sentence to
     * show and the id an ack (`update({ workspaceMoveAck: at })`) must name.
     */
    workspaceMove?: { at: number; message: string };
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
    policyEndedReason?: "idle" | "lifetime";
  }
}

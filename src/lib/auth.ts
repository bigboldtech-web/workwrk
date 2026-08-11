import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import type { AccessLevel } from "@/generated/prisma";

// Google OAuth is only registered when the env vars are present. This
// keeps local dev painless — the app still boots with only credentials
// if you haven't set GOOGLE_CLIENT_ID yet.
/** The identity fields we mirror onto the JWT and back onto the session. */
type AuthIdentity = {
  id: string;
  accessLevel: AccessLevel;
  organizationId: string;
  organizationName: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
};

const googleEnabled =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

const providers = [
  CredentialsProvider({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) {
        throw new Error("Missing credentials");
      }

      const user = await prisma.user.findFirst({
        where: { email: credentials.email },
        include: { organization: true },
      });

      if (!user) {
        throw new Error("Invalid credentials");
      }

      const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
      if (!isValid) {
        throw new Error("Invalid credentials");
      }

      // Offboarding must actually revoke access. Someone removed from the
      // company (deletedAt) or deactivated (INACTIVE) cannot sign in —
      // checked AFTER the password compare so this never doubles as an
      // account-status oracle for an attacker guessing emails.
      // ON_LEAVE / PROBATION / PIP / NOTICE_PERIOD are still employed and
      // keep their access.
      if (user.deletedAt || user.status === "INACTIVE") {
        throw new Error("This account is no longer active. Contact your workspace admin.");
      }

      // If the user's anchored org is unusable (self-scheduled deletion or a
      // support suspension) but they belong to OTHER workspaces, move them into
      // a healthy one instead of locking them out. Deleting your *current*
      // workspace should just drop you into another — not trap you, since the
      // only person who could undo the deletion would otherwise be the one
      // person who can't sign in.
      let org = user.organization;
      if (org.status === "CANCELLED" || org.status === "SUSPENDED") {
        const alt = await prisma.organizationMembership.findFirst({
          where: { userId: user.id, organization: { status: { notIn: ["CANCELLED", "SUSPENDED"] } } },
          include: { organization: true },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        });
        if (alt) {
          await prisma.user.update({ where: { id: user.id }, data: { organizationId: alt.organizationId } });
          org = alt.organization; // sign in under the healthy workspace
        }
      }

      // No healthy workspace to fall back to — block with a clear, honest reason.
      if (org.status === "SUSPENDED") {
        throw new Error("This workspace is suspended. Please contact WorkwrK support.");
      }
      if (org.status === "CANCELLED") {
        throw new Error("This workspace is scheduled for deletion. It's recoverable for 30 days — contact WorkwrK support to restore it.");
      }

      return {
        id: user.id,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        firstName: user.firstName,
        lastName: user.lastName,
        accessLevel: user.accessLevel,
        organizationId: org.id,
        organizationName: org.name,
        avatar: user.avatar,
      };
    },
  }),
];

if (googleEnabled) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Standard scope — we only need identity + email.
      authorization: { params: { prompt: "select_account" } },
    }) as unknown as (typeof providers)[number],
  );
}

// Cross-subdomain session: when COOKIE_DOMAIN is set (e.g. ".workwrk.com" in
// production) the auth cookies are scoped to the parent domain, so a login on
// app.workwrk.com is also valid on admin.workwrk.com. Left undefined in dev /
// preview so localhost keeps working with default host-only cookies.
// NOTE: flipping this on rotates the cookie name+scope once, logging everyone
// out a single time — deploy it during a low-traffic window.
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN?.trim();
const COOKIE_SECURE = process.env.NODE_ENV === "production";
const crossSubdomainCookies: NextAuthOptions["cookies"] = COOKIE_DOMAIN
  ? {
      sessionToken: {
        name: `${COOKIE_SECURE ? "__Secure-" : ""}next-auth.session-token`,
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: COOKIE_SECURE,
          domain: COOKIE_DOMAIN,
        },
      },
      callbackUrl: {
        name: `${COOKIE_SECURE ? "__Secure-" : ""}next-auth.callback-url`,
        options: {
          sameSite: "lax",
          path: "/",
          secure: COOKIE_SECURE,
          domain: COOKIE_DOMAIN,
        },
      },
    }
  : undefined;

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  cookies: crossSubdomainCookies,
  pages: {
    signIn: "/login",
    newUser: "/welcome",
  },
  providers,
  callbacks: {
    /**
     * Google sign-in rule: only admit users whose email already exists
     * in the DB (via invitation or earlier credentials signup). We never
     * auto-create an organization from an SSO attempt — that's a
     * deliberate /register flow decision.
     */
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      const email = (profile as { email?: string } | undefined)?.email?.toLowerCase();
      if (!email) return false;
      const existing = await prisma.user.findFirst({
        where: { email, deletedAt: null },
        select: { id: true, organization: { select: { status: true } } },
      });
      if (!existing) return false;
      // Mirror the credentials path: refuse sign-in for a soft-deleted org.
      if (existing.organization.status === "CANCELLED" || existing.organization.status === "SUSPENDED") return false;
      return true;
    },

    async jwt({ token, user, account, trigger }) {
      if (user) {
        const u = user as unknown as AuthIdentity;
        token.id = u.id;
        token.accessLevel = u.accessLevel;
        token.organizationId = u.organizationId;
        token.organizationName = u.organizationName;
        token.firstName = u.firstName;
        token.lastName = u.lastName;
        token.avatar = u.avatar;
      }

      // Google flow: first-time sign-in returns only minimal identity;
      // hydrate the rest by email lookup so the rest of the app can rely
      // on accessLevel / organizationId being populated.
      if (account?.provider === "google" && !token.id && token.email) {
        const dbUser = await prisma.user.findFirst({
          where: { email: (token.email as string).toLowerCase(), deletedAt: null },
          include: { organization: true },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.accessLevel = dbUser.accessLevel;
          token.organizationId = dbUser.organizationId;
          token.organizationName = dbUser.organization.name;
          token.firstName = dbUser.firstName;
          token.lastName = dbUser.lastName;
          token.avatar = dbUser.avatar;
        }
      }

      // Offboarding revocation. A JWT lives for weeks, so removing someone
      // would otherwise leave their live session working until it expired.
      // Re-check the account against the DB at most every 5 minutes (cheap:
      // one indexed lookup per token per window) and flag a revoked token —
      // the session callback then withholds the identity, so every page gate
      // and API treats them as signed out.
      const REVALIDATE_MS = 5 * 60 * 1000;
      const lastCheck = typeof token.checkedAt === "number" ? token.checkedAt : 0;
      if (token.id && Date.now() - lastCheck > REVALIDATE_MS) {
        const account_ = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { deletedAt: true, status: true, accessLevel: true },
        });
        token.checkedAt = Date.now();
        if (!account_ || account_.deletedAt || account_.status === "INACTIVE") {
          token.revoked = true;
        } else {
          token.revoked = false;
          // Access-level changes (promotion / demotion) take effect in the
          // same window instead of waiting for a fresh sign-in.
          token.accessLevel = account_.accessLevel;
        }
      }

      // Session-update path: triggered by the org-switcher calling
      // `session.update()` after `POST /api/me/switch-org` flips the
      // user's `organizationId`. We re-fetch so the JWT picks up the
      // new org immediately rather than waiting for natural refresh.
      if (trigger === "update" && token.id) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          include: { organization: { select: { name: true } } },
        });
        if (fresh) {
          token.organizationId = fresh.organizationId;
          token.organizationName = fresh.organization.name;
          token.accessLevel = fresh.accessLevel;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Revoked (removed / deactivated) — hand back a session with no
      // identity. requireSessionUser() and every API gate check for an id,
      // so this reads as signed out everywhere without a special case.
      if (token.revoked) {
        return { ...session, user: undefined } as unknown as typeof session;
      }
      if (session.user) {
        Object.assign(session.user, {
          id: token.id,
          accessLevel: token.accessLevel,
          organizationId: token.organizationId,
          organizationName: token.organizationName,
          firstName: token.firstName,
          lastName: token.lastName,
          avatar: token.avatar,
        } satisfies Partial<AuthIdentity>);
      }
      return session;
    },
  },
};

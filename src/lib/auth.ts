import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

// Google OAuth is only registered when the env vars are present. This
// keeps local dev painless — the app still boots with only credentials
// if you haven't set GOOGLE_CLIENT_ID yet.
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

      // Block sign-in for users whose org has been soft-deleted. The
      // org admin scheduled the destruction; sign-ins during the
      // grace window would just create new audit clutter for data
      // that's about to disappear.
      if (user.organization.status === "SUSPENDED") {
        throw new Error("This workspace is suspended. Please contact WorkwrK support.");
      }
      if (user.organization.status === "CANCELLED") {
        throw new Error("This organization has been scheduled for deletion. Contact your administrator if this was a mistake.");
      }

      return {
        id: user.id,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        firstName: user.firstName,
        lastName: user.lastName,
        accessLevel: user.accessLevel,
        organizationId: user.organizationId,
        organizationName: user.organization.name,
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
        token.id = (user as any).id;
        token.accessLevel = (user as any).accessLevel;
        token.organizationId = (user as any).organizationId;
        token.organizationName = (user as any).organizationName;
        token.firstName = (user as any).firstName;
        token.lastName = (user as any).lastName;
        token.avatar = (user as any).avatar;
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
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).accessLevel = token.accessLevel;
        (session.user as any).organizationId = token.organizationId;
        (session.user as any).organizationName = token.organizationName;
        (session.user as any).firstName = token.firstName;
        (session.user as any).lastName = token.lastName;
        (session.user as any).avatar = token.avatar;
      }
      return session;
    },
  },
};

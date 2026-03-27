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
    } & DefaultSession["user"];
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
  }
}

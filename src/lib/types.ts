import { AccessLevel } from "@/generated/prisma";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      firstName: string;
      lastName: string;
      accessLevel: AccessLevel;
      organizationId: string;
      organizationName: string;
      avatar: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    accessLevel: AccessLevel;
    organizationId: string;
    organizationName: string;
    firstName: string;
    lastName: string;
    avatar: string | null;
  }
}

export type NavItem = {
  title: string;
  href: string;
  icon: string;
  badge?: number;
  children?: NavItem[];
  roles?: AccessLevel[];
};

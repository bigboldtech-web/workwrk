import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { AccessLevel } from "@/generated/prisma";

export async function getSessionOrFail() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null };
  }
  return { error: null, session };
}

export function getOrgId(session: any): string {
  return session.user.organizationId;
}

export function getUserId(session: any): string {
  return session.user.id;
}

export function hasRole(session: any, roles: AccessLevel[]): boolean {
  return roles.includes(session.user.accessLevel);
}

export function isManager(session: any): boolean {
  return hasRole(session, [
    "SUPER_ADMIN" as AccessLevel,
    "COMPANY_ADMIN" as AccessLevel,
    "C_LEVEL" as AccessLevel,
    "VP" as AccessLevel,
    "DIRECTOR" as AccessLevel,
    "MANAGER" as AccessLevel,
    "TEAM_LEAD" as AccessLevel,
    "HR" as AccessLevel,
  ]);
}

export function jsonError(message: string, status: number = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function jsonSuccess(data: any, status: number = 200) {
  return NextResponse.json(data, { status });
}

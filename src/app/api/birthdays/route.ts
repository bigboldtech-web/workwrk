import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, getUserId, jsonSuccess } from "@/lib/api-helpers";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const currentUserId = getUserId(session);
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  // Get all users with dateOfBirth set
  const users = await prisma.user.findMany({
    where: { organizationId: orgId, deletedAt: null, dateOfBirth: { not: null } },
    select: {
      id: true, firstName: true, lastName: true, avatar: true, dateOfBirth: true,
      department: { select: { name: true } },
      role: { select: { title: true } },
    },
  });

  // Get org name
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });

  // Filter for today's birthdays
  const todayBirthdays = users.filter((u) => {
    if (!u.dateOfBirth) return false;
    const dob = new Date(u.dateOfBirth);
    return dob.getMonth() + 1 === month && dob.getDate() === day;
  });

  // Check if current user has a birthday today
  const isMyBirthday = todayBirthdays.some((u) => u.id === currentUserId);

  // Upcoming birthdays (next 7 days)
  const upcoming = users.filter((u) => {
    if (!u.dateOfBirth) return false;
    const dob = new Date(u.dateOfBirth);
    const dobThisYear = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
    const diff = (dobThisYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return diff > 0 && diff <= 7;
  }).map((u) => {
    const dob = new Date(u.dateOfBirth!);
    const dobThisYear = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
    return { ...u, daysUntil: Math.ceil((dobThisYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) };
  }).sort((a, b) => a.daysUntil - b.daysUntil);

  return jsonSuccess({
    todayBirthdays,
    upcoming,
    isMyBirthday,
    companyName: org?.name || "the team",
  });
}

import { NextRequest } from "next/server";
import { getSessionOrFail, getUserId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getEmailPreferences, updateEmailPreferences } from "@/lib/email";

export async function GET() {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const prefs = await getEmailPreferences(getUserId(session));
  return jsonSuccess(prefs);
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const body = await req.json();
  const { taskNotifications, reviewNotifications, sopNotifications, kudosNotifications, dailyDigest } = body;

  const updated = await updateEmailPreferences(getUserId(session), {
    taskNotifications,
    reviewNotifications,
    sopNotifications,
    kudosNotifications,
    dailyDigest,
  });

  return jsonSuccess(updated);
}

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { sendEmail } from "@/lib/email";
import { welcomeTemplate } from "@/lib/email-templates";
import { validatePassword } from "@/lib/password-policy";
import { rateLimit, ipFromRequest } from "@/lib/rate-limit-memory";
import { isReservedStaffAddress } from "@/lib/platform-admin";
import { seedOrgDefaults, seedStarterSpace } from "@/lib/org/seed-org-defaults";
import { sendVerificationEmail, appBaseUrl } from "@/lib/auth/send-verification";
import { logAuditEvent } from "@/lib/activity";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";
import { signupTemplateKey } from "@/lib/templates/tuesday-template";
import { applySignupTemplate } from "@/lib/templates/apply-tuesday";
import { selfServeTrialEnd } from "@/lib/admin/trial-end";

// The Terms and Privacy Policy version a signup agrees to (the consent line
// on /signup). Bumped when either document changes; recorded on the
// `terms.accepted` ActivityLog row next to User.termsAcceptedAt.
const TERMS_VERSION = "2026-09";

export async function POST(req: Request) {
  try {
    // Abuse guard: a single source can't script mass org/user creation.
    const limit = rateLimit(`register:${ipFromRequest(req)}`, { max: 10, windowMs: 60 * 60 * 1000 });
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Too many sign-ups from this network. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }

    const body = await req.json();
    const { organizationName: rawOrgName, firstName: rawFirst, lastName: rawLast, email: rawEmail, password, timezone, template } = body;
    const email = typeof rawEmail === "string" ? rawEmail.trim() : rawEmail;

    // Public endpoint — probe traffic has submitted HTML payloads as org
    // names (found in prod 2026-08-27). Names are PLAIN TEXT: strip angle
    // brackets outright, collapse whitespace, cap length. React escapes on
    // render, but emails/exports/logs also carry these strings.
    const cleanName = (v: unknown, max: number) =>
      typeof v === "string" ? v.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
    const organizationName = cleanName(rawOrgName, 80);
    const firstName = cleanName(rawFirst, 60);
    const lastName = cleanName(rawLast, 60);

    if (!organizationName || !firstName || !lastName || !email || !password || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    // New org has no policy yet → the default (>=8, uppercase, number).
    const pwError = validatePassword(password);
    if (pwError) {
      return NextResponse.json({ error: pwError }, { status: 400 });
    }

    // Check if org slug already exists
    let slug = slugify(organizationName);
    const existingOrg = await prisma.organization.findUnique({ where: { slug } });
    if (existingOrg) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    // Check if user already exists in any org with this email. Case does
    // not make a second person: "Priya@Co.com" and "priya@co.com" are one
    // mailbox, and a second row for it would make log in ambiguous.
    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists", field: "email", code: "email_in_use" },
        { status: 400 }
      );
    }
    // The registrant chooses this password before proving the mailbox, so
    // a WorkwrK staff address is refused (platform-admin.ts). This endpoint is
    // public: the refusal reads exactly like the existing-account one above,
    // so it never confirms that an address is on the WorkwrK staff list.
    if (typeof email === "string" && (await isReservedStaffAddress(email))) {
      return NextResponse.json({ error: "An account with this email already exists", field: "email", code: "email_in_use" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Create organization and admin user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: organizationName,
          slug,
          status: "TRIAL",
          // When staff follow the trial up: never shown to the customer, and
          // nothing changes on it (src/lib/admin/trial-end.ts).
          trialEndsAt: selfServeTrialEnd(new Date()),
        },
      });

      const now = new Date();
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          organizationId: organization.id,
          accessLevel: "COMPANY_ADMIN",
          // The workspace's first admin is its Owner (spec 2.1, the earliest
          // COMPANY_ADMIN); the org-role mirror is written with the level.
          orgRole: "OWNER",
          termsAcceptedAt: now,
          passwordChangedAt: now,
        },
      });

      // Everything a new workspace needs to be complete the moment it
      // exists (settings-architecture 11.1): the six departments, the
      // locale, the password rules, the access toggles, retention and the
      // setup console. The wizard is an offer from here on, never a gate.
      await seedOrgDefaults(tx, { organizationId: organization.id, timezone: typeof timezone === "string" ? timezone : null, userId: user.id });

      return { organization, user };
    });

    // The General Space and its first List, through the same code the
    // Spaces API uses. Best effort: the workspace is complete without it.
    await seedStarterSpace({ organizationId: result.organization.id, userId: result.user.id });

    // The template the visitor chose on the site (/signup?template=tuesday),
    // applied ONCE, after the org defaults and the General Space, to this
    // brand new workspace only (apply-tuesday.ts claims a marker first, so a
    // repeat never doubles it). /join never reaches this route. Best effort:
    // a failure is recorded on the marker and the setup wizard offers Try
    // again; the workspace itself is already complete.
    const templateKey = signupTemplateKey(template);
    if (templateKey) {
      await applySignupTemplate({ organizationId: result.organization.id, userId: result.user.id, key: templateKey }).catch((err) => {
        console.error("[Register] signup template failed", err);
      });
    }

    logAuditEvent({
      type: "terms.accepted",
      actorId: result.user.id,
      organizationId: result.organization.id,
      description: "Agreed to the Terms and the Privacy Policy at sign-up",
      targetType: "User",
      targetId: result.user.id,
      metadata: { version: TERMS_VERSION, template: typeof template === "string" ? template.slice(0, 80) : null },
      ipAddress: ipFromRequest(req),
      userAgent: req.headers.get("user-agent"),
    }).catch(() => {});

    // The first verification email (B11: none was ever sent at signup).
    // Verification is not a gate; the account works either way.
    try {
      await sendVerificationEmail({ id: result.user.id, email, firstName, organizationId: result.organization.id });
    } catch (verifyErr) {
      console.error("[Register] Verification email failed:", verifyErr);
    }

    // Send welcome email
    try {
      const { subject, html } = welcomeTemplate({
        firstName,
        organizationName,
        loginLink: `${appBaseUrl()}${WORK_HOME_HREF}`,
        isCreator: true,
      });
      await sendEmail({
        to: email,
        subject,
        html,
        template: "welcome",
        variables: { firstName, organizationName },
        organizationId: result.organization.id,
        category: "invitation",
      });
    } catch (emailErr) {
      console.error("[Register] Welcome email failed:", emailErr);
    }

    return NextResponse.json(
      {
        message: "Account created successfully",
        organizationId: result.organization.id,
        userId: result.user.id,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}

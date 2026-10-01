import { baseLayout, emailButton } from "./base";
import { escapeHtml, safeHref } from "./escape";

interface InvitationVars {
  companyName: string;
  /** /join?token=... on the app host (spec-account-auth `/join`). */
  inviteLink: string;
  /**
   * The role in the four-role words ("Admin", "Member"), from
   * src/lib/access/labels.ts. A raw AccessLevel ("COMPANY_ADMIN") is mapped
   * to its label here so an older caller never prints an enum.
   */
  accessLevel?: string;
  /** The same thing in the four-role words, preferred over accessLevel by new callers. */
  role?: string;
  /** Who sent it, when known. */
  inviterName?: string;
  /** Optional note from the inviter, rendered as a quoted block. */
  personalMessage?: string;
  /** Days until the link expires (the invitation rows live 7 days). */
  expiresInDays?: number;
}

const LEVEL_WORDS: Record<string, string> = {
  SUPER_ADMIN: "Admin",
  COMPANY_ADMIN: "Admin",
};

function roleWords(level: string): string {
  if (LEVEL_WORDS[level]) return LEVEL_WORDS[level];
  if (/^[A-Z_]+$/.test(level)) return "Member";
  return level;
}

/**
 * "a Member" but "an Admin" / "an Owner". Worked out from the plain role word,
 * before escaping, so an entity such as "&amp;" never decides it. A role word
 * passed through as is gets the same rule, by its first letter.
 */
function articleFor(word: string): "a" | "an" {
  return /^[aeiou]/i.test(word.trim()) ? "an" : "a";
}

export function invitationTemplate(vars: InvitationVars): { subject: string; html: string } {
  const company = escapeHtml(vars.companyName);
  const roleWord = roleWords(vars.role ?? vars.accessLevel ?? "EMPLOYEE");
  const role = escapeHtml(roleWord);
  const article = articleFor(roleWord);
  const inviter = vars.inviterName?.trim() ? escapeHtml(vars.inviterName.trim()) : null;
  const days = vars.expiresInDays ?? 7;
  const messageBlock = vars.personalMessage?.trim() ? `<p class="quote">${escapeHtml(vars.personalMessage.trim())}</p>` : "";
  const href = safeHref(vars.inviteLink);
  const html = baseLayout(`
    <h1>Join ${company} on WorkwrK</h1>
    <p>${inviter ? `<span class="highlight">${inviter}</span> invited you` : "You are invited"} to join <span class="highlight">${company}</span> as ${article} <strong>${role}</strong>.</p>
    ${messageBlock}
    <p style="margin:24px 0 8px;">${emailButton(href, `Join ${company}`)}</p>
    <p class="meta">This invitation works for ${days} days. If the button does not work, paste this link into your browser:<br/><span class="url" style="word-break:break-all;">${href}</span></p>
  `);

  return {
    subject: `${vars.inviterName?.trim() ? `${vars.inviterName.trim()} invited you` : "You are invited"} to join ${vars.companyName} on WorkwrK`,
    html,
  };
}

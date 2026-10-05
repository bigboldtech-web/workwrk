// The denial family (spec-shell 1.6, access-model-spec 5.5 and 6.4,
// back-map 0): what renders AT THE SAME URL when a signed-in person may not
// open something. The rail, sidebar and bar stay; nothing here redirects.
//
//   LockedPage   an object the viewer can discover but holds no role on:
//                its name, its owner, one sentence, one primary Request
//                access (or none, for the two sanctioned app-key pages
//                /team and /team/workload), a BackButton.
//   ModuleOff    a premium module the org switched off (Talk, Tables):
//                Owners and Admins get the switch, Members "Ask an admin"
//                with the admins' avatars. Guests never reach it (404).
//   AppOff       an app the org hid or floored in Settings > Apps: Admins
//                get a link to /settings/apps, Members "Ask an admin".
//   AdminOnly    a settings page the viewer's role does not reach: one
//                sentence and a BackButton; never a 404 under /settings.
//   StrippedViewNotice  a view of a page the viewer holds but may not use
//                (planner ?calendar=team): the page renders its default
//                view and this one 13/400 line sits under the toolbar.
//
// The in-shell 404 is deliberately NOT here: it is a page (not-found.tsx)
// and it must look identical whether the object exists or not.
//
// Server-safe: no hooks. The two interactive pieces (Request access, the
// module switch) are client islands rendered as children.

import Link from "next/link";
import type { ReactNode } from "react";
import { Hash, Info, Lock, ShieldCheck } from "lucide-react";
import { DotsArt } from "@/components/ui/dots-art";
import { BackButton } from "@/components/ui/back-button";
import { cn } from "@/lib/utils";
import type { OrgAdmin } from "@/lib/access/admins";
import { RequestAccessButton } from "./request-access-button";
import { JoinChannelButton } from "./join-channel-button";
import { ModuleOffSwitch } from "./module-off-switch";
import { MODULE_FROM_PLAN } from "@/lib/modules";
import { SettingsLink } from "./settings-link";

export interface BackTarget {
  fallbackHref: string;
  label: string;
}

/* ───────────────────────────── shared block ───────────────────────────── */

/** The neutral 36px lock tile (design-system 5.14: N100 tile, N600 glyph). Server-safe. */
function LockTile() {
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-hover text-ink-2" aria-hidden>
      <Lock className="h-5 w-5" strokeWidth={1.5} />
    </span>
  );
}

/** The same tile with a shield: a staff-only surface (the Staff console gate). */
function ShieldTile() {
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-hover text-ink-2" aria-hidden>
      <ShieldCheck className="h-5 w-5" strokeWidth={1.5} />
    </span>
  );
}

/** The same tile with a "#": a public channel the viewer has not joined. */
function HashTile() {
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-hover text-ink-2" aria-hidden>
      <Hash className="h-5 w-5" strokeWidth={1.5} />
    </span>
  );
}

function DenialBlock({
  title,
  sentence,
  locked = false,
  tile,
  primary,
  back,
  children,
  className,
}: {
  title?: string;
  sentence: string;
  /** A lock tile in place of the four-dot drawing (an object or page the viewer cannot open). */
  locked?: boolean;
  /** An explicit tile, when neither the lock nor the dots is the truth. */
  tile?: ReactNode;
  primary?: ReactNode;
  back?: BackTarget;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("os-chrome mx-auto mt-16 flex max-w-md flex-col items-center px-6 pb-16 text-center", className)}>
      {tile ?? (locked ? <LockTile /> : <DotsArt arrangement="row" />)}
      {title ? <p className="m-0 mt-4 text-lg font-semibold text-ink">{title}</p> : null}
      <p className={cn("m-0 text-row text-ink-2", title ? "mt-1" : "mt-4")}>{sentence}</p>
      {children}
      {primary ? <div className="mt-5">{primary}</div> : null}
      {back ? (
        <div className="mt-4">
          <BackButton fallbackHref={back.fallbackHref} label={back.label} />
        </div>
      ) : null}
    </div>
  );
}

/** 24px initials avatars for "Ask an admin" (design-system 5.18).
 *
 *  Each avatar is a MAILTO (spec-talk 2.0: "up to five Owner and Admin
 *  avatars and mailto links"). "Ask an admin" beside four faces you cannot
 *  click is a screen that names the problem and withholds the one thing that
 *  would solve it. An admin without an email on file renders as the same
 *  circle without a link rather than as a dead one. */
function AdminAvatars({ admins }: { admins: OrgAdmin[] }) {
  if (admins.length === 0) return null;
  const face = "inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-raised bg-active text-micro font-medium text-ink";
  return (
    <span className="mt-3 inline-flex items-center gap-2 text-sm text-ink-2">
      <span className="inline-flex -space-x-1.5">
        {admins.slice(0, 5).map((a) => {
          const inner = a.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            a.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()
          );
          return a.email ? (
            <a key={a.id} href={`mailto:${a.email}`} title={`Email ${a.name}`} aria-label={`Email ${a.name}`} className={face}>
              {inner}
            </a>
          ) : (
            <span key={a.id} title={a.name} className={face}>{inner}</span>
          );
        })}
      </span>
      <span>{admins.length === 1 ? admins[0].name : `${admins[0].name} and ${admins.length - 1} more`}</span>
    </span>
  );
}

/* ───────────────────────────── LockedPage ───────────────────────────── */

export interface LockedPageProps {
  /** The object's name (a Space, a channel, a workflow). Omit on an app-key page. */
  name?: string;
  /** One plain sentence from `decision.reason`. */
  sentence: string;
  owner?: { id: string; name: string } | null;
  /**
   * The Request access primary. Absent on the two sanctioned app-key pages
   * (/team, /team/workload) where nobody can grant anything.
   */
  requestAccess?: { objectType: string; objectId: string; roles?: ("VIEW" | "EDIT" | "COMMENT")[] } | null;
  /**
   * The JOIN variant (access-model-spec 6.4, spec-talk section 1 Access): a
   * findable public channel, where self-join replaces Request access because
   * the answer is already yes and there is nobody to ask. Takes precedence
   * over `requestAccess` when both are given; a channel is never both.
   */
  joinChannelId?: string | null;
  /** "Join channel" for a public channel, "Ask an admin" for a role change. */
  primaryLabel?: string;
  /**
   * The glyph for the tile, when a padlock would be a lie. The Join variant
   * is a PUBLIC, findable channel: the padlock is the one glyph spec-talk
   * section 1 reserves for private channels, and the same channel renders
   * with a "#" in the sidebar two columns away, so a lock here said the
   * opposite of what the product said about it everywhere else.
   */
  glyph?: "lock" | "hash" | "shield";
  /** The owner's avatar beside their name (spec-talk 2.2 States). */
  ownerAvatar?: string | null;
  /** One text link so the viewer leaves with somewhere to go (Connections to Integrations). */
  elsewhere?: { href: string; label: string };
  /**
   * A ROLE denial (access 5.5 item 3, spec-ai-automation 1.4 item 5): the
   * Owners and Admins who hold the role, as mailto avatars, and an "Ask an
   * admin" primary that writes to all of them. Only when there is no object
   * to request.
   */
  admins?: OrgAdmin[];
  /**
   * Optional only for the Staff console's denial on a host with no app URL
   * configured: there a relative back link would bounce to /admin and render
   * this same page again, so no back link is better than a loop.
   */
  back?: BackTarget;
}

export function LockedPage({ name, sentence, owner, requestAccess, joinChannelId, primaryLabel, glyph, ownerAvatar, elsewhere, admins, back }: LockedPageProps) {
  const adminEmails = (admins ?? []).map((a) => a.email).filter((e): e is string => !!e);
  const primary = joinChannelId
    ? <JoinChannelButton conversationId={joinChannelId} label={primaryLabel ?? "Join channel"} />
    : requestAccess
      ? <RequestAccessButton {...requestAccess} owner={owner ?? null} label={primaryLabel} />
      : adminEmails.length
        ? (
            <a
              href={`mailto:${adminEmails.join(",")}?subject=${encodeURIComponent(name ? `Access to ${name}` : "Access")}`}
              className="os-chrome inline-flex h-9 items-center rounded-md bg-brand px-4 text-base font-medium text-white hover:bg-[var(--os-brand-hover)]"
            >
              {primaryLabel ?? "Ask an admin"}
            </a>
          )
        : undefined;
  // A Join page is an invitation, not a refusal, so it defaults to the hash.
  const kind = glyph ?? (joinChannelId ? "hash" : "lock");
  return (
    <DenialBlock
      title={name}
      sentence={sentence}
      tile={kind === "hash" ? <HashTile /> : kind === "shield" ? <ShieldTile /> : <LockTile />}
      back={back}
      primary={primary}
    >
      {owner ? (
        <span className="mt-2 inline-flex items-center gap-2 text-sm text-ink-3">
          <span className="inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-active text-micro font-medium text-ink" aria-hidden>
            {ownerAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ownerAvatar} alt="" className="h-full w-full object-cover" />
            ) : (
              owner.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()
            )}
          </span>
          Owned by {owner.name}
        </span>
      ) : null}
      {!requestAccess && !joinChannelId && admins?.length ? <AdminAvatars admins={admins} /> : null}
      {elsewhere ? (
        <Link href={elsewhere.href} className="mt-2 text-sm font-medium text-brand-deep hover:underline underline-offset-4">
          {elsewhere.label}
        </Link>
      ) : null}
    </DenialBlock>
  );
}

/* ───────────────────────────── ModuleOff ───────────────────────────── */

export interface ModuleOffProps {
  /** The module's label ("Talk", "Tables"). */
  label: string;
  productSlug: string;
  /** Owners and Admins: render the switch. */
  canEnable: boolean;
  /**
   * Starter, and the workspace never had the module (src/lib/modules.ts): it
   * is included from Growth, so the page offers the plan, not a switch the
   * server would refuse.
   */
  needsUpgrade?: boolean;
  /** Members: the admins to ask. */
  admins?: OrgAdmin[];
  /** What turning it on unlocks, when the layout knows ("3 channels"). */
  unlocks?: string;
  back: BackTarget;
}

export function ModuleOff({ label, productSlug, canEnable, needsUpgrade = false, admins = [], unlocks, back }: ModuleOffProps) {
  if (needsUpgrade) {
    return (
      <DenialBlock
        title={`${label} is included from the ${MODULE_FROM_PLAN} plan`}
        sentence={
          canEnable
            ? `Move this workspace to ${MODULE_FROM_PLAN} in Plan & billing to turn ${label} on for everyone.`
            : `Ask an Owner or Admin to move this workspace to ${MODULE_FROM_PLAN}.`
        }
        back={back}
        primary={
          canEnable ? (
            <Link
              href="/settings/billing"
              className="os-chrome inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-base font-medium text-white hover:bg-[var(--os-brand-hover)]"
            >
              See Plan &amp; billing
            </Link>
          ) : undefined
        }
      >
        {canEnable ? null : <AdminAvatars admins={admins} />}
      </DenialBlock>
    );
  }
  return (
    <DenialBlock
      title={`${label} is turned off`}
      sentence={
        canEnable
          ? `Turning it on unlocks ${unlocks ?? label} for everyone in the workspace. Nothing is deleted while a module is off.`
          : `Ask a workspace admin to turn ${label} on.`
      }
      back={back}
      primary={canEnable ? <ModuleOffSwitch label={label} productSlug={productSlug} /> : undefined}
    >
      {canEnable ? null : <AdminAvatars admins={admins} />}
    </DenialBlock>
  );
}

/* ───────────────────────────── AppOff ───────────────────────────── */

export interface AppOffProps {
  label: string;
  /** Owners and Admins: the Apps page is where the control lives. */
  isAdmin: boolean;
  admins?: OrgAdmin[];
  back: BackTarget;
  /**
   * The `ai` key's second off switch (spec-ai-automation 1.4): "AI features
   * for members" on Settings > Data turns the app off without hiding it, so
   * the sentence and the Admin's door name that page instead of Apps.
   * "floored": the app is on, but a minimum role on Apps & modules leaves
   * this person out, so the card never says "hidden" for an app others use.
   */
  reason?: "hidden" | "floored" | "ai-disabled";
}

export function AppOff({ label, isAdmin, admins = [], back, reason = "hidden" }: AppOffProps) {
  const aiOff = reason === "ai-disabled";
  const floored = reason === "floored";
  return (
    <DenialBlock
      title={aiOff ? "AI is turned off for this workspace" : floored ? `${label} is limited to some roles` : `${label} is hidden in this workspace`}
      sentence={
        aiOff
          ? isAdmin
            ? "AI features for members are off in Settings. Turn them back on from Data."
            : "Ask a workspace admin to turn AI features on."
          : floored
            ? isAdmin
              ? `${label} has a minimum role in Settings. Change it from Apps & modules.`
              : `Your workspace opens ${label} to some roles only. Ask a workspace admin if you need it.`
            : isAdmin
              ? `${label} was hidden in Settings. Turn it back on from Apps & modules.`
              : `Ask a workspace admin to turn ${label} on.`
      }
      back={back}
      primary={
        isAdmin ? (
          aiOff ? <SettingsLink href="/settings/data" label="Open Data" /> : <SettingsLink href="/settings/apps" label="Open Apps & modules" />
        ) : undefined
      }
    >
      {isAdmin ? null : <AdminAvatars admins={admins} />}
    </DenialBlock>
  );
}

/* ───────────────────────────── AdminOnly ───────────────────────────── */

export interface AdminOnlyProps {
  /** The page's registry label ("Identity & culture"). */
  page: string;
  /** "Owners" for an Owner-only page, otherwise "Owners and Admins". */
  managedBy?: "Owners" | "Owners and Admins";
  back: BackTarget;
  /** Under the sentence: the one thing a Member CAN do instead, so the card
   *  is not a dead end. */
  children?: ReactNode;
}

export function AdminOnly({ page, managedBy = "Owners and Admins", back, children }: AdminOnlyProps) {
  return (
    <DenialBlock
      title={page}
      sentence={`${page} is managed by workspace ${managedBy}.`}
      locked
      back={back}
    >
      {children}
    </DenialBlock>
  );
}

/* ───────────────────────────── Ask-an-admin strip ───────────────────────────── */

export interface AskAnAdminStripProps {
  /** The Workspace page the viewer typed (its registry label). */
  pageLabel: string;
  /** Real Owners and Admins, earliest first (listOrgAdmins). */
  admins: OrgAdmin[];
  /** Workspace pages this viewer CAN open (a reader below Admin), linked after the sentence. */
  openable?: { label: string; href: string }[];
  /** The one thing this viewer CAN do instead, outside settings (Data: "Import a CSV into a table"). */
  instead?: { label: string; href: string };
}

/**
 * "Ana, Ben and Cy" from the first three names, and "Ana, Ben, Cy and 2 more"
 * past three (pure; tested in denial-views.test.ts). The remainder is counted
 * on purpose: a workspace with four or more Owners and Admins must not read as
 * if the three named people were all of them, with a fourth face beside the
 * sentence that nobody can place. Same "and N more" wording as AdminAvatars.
 */
export function adminNamesSentence(names: string[]): string {
  const all = names.filter(Boolean);
  const n = all.slice(0, 3);
  const rest = all.length - n.length;
  if (n.length === 0) return "your workspace Owners and Admins";
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  if (rest > 0) return `${n[0]}, ${n[1]}, ${n[2]} and ${rest} more`;
  return `${n[0]}, ${n[1]} and ${n[2]}`;
}

/**
 * The second denial view under /settings (spec-settings-workspace 1.4 item
 * 2, access 5.5 item 3): a 44px brand-soft strip ABOVE the viewer's own
 * My settings > Profile, at the Workspace URL they typed. An explanation,
 * not a wall: nothing of the Workspace page is revealed beyond its label,
 * and the page under it is a destination, so it carries no BackButton.
 */
export function AskAnAdminStrip({ pageLabel, admins, openable, instead }: AskAnAdminStripProps) {
  const who = adminNamesSentence(admins.map((a) => a.name));
  const look = admins.filter((a) => a.name).length === 1 ? "looks" : "look";
  return (
    <div
      role="note"
      className="os-chrome mx-6 mt-4 flex min-h-11 items-center gap-3 rounded-lg bg-brand-soft px-4 py-2 text-base text-ink max-[900px]:mx-4"
    >
      <Info className="h-4 w-4 shrink-0 text-brand-deep" strokeWidth={1.5} aria-hidden />
      <span className="min-w-0 flex-1">
        {/* spec-settings-workspace 1.4: the page is part of Workspace
            settings, which named people look after. */}
        {pageLabel === "Workspace settings"
          ? `Workspace settings are looked after by ${who}. Ask them if you need something changed.`
          : `${pageLabel} is part of Workspace settings, which ${who} ${look} after. Ask them if you need something changed.`}
        {openable && openable.length > 0 ? (
          <>
            {" "}You can open{" "}
            {openable.map((p, i) => (
              <span key={p.href}>
                {i > 0 ? (i === openable.length - 1 ? " and " : ", ") : null}
                <Link href={p.href} className="font-medium text-brand-deep underline-offset-2 hover:underline">{p.label}</Link>
              </span>
            ))}
            .
          </>
        ) : null}
        {instead ? (
          <>
            {" "}
            <Link href={instead.href} className="font-medium text-brand-deep underline-offset-2 hover:underline">{instead.label}</Link>
          </>
        ) : null}
      </span>
      <AdminFaces admins={admins} />
    </div>
  );
}

function AdminFaces({ admins }: { admins: OrgAdmin[] }) {
  if (admins.length === 0) return null;
  const face = "inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-raised bg-active text-micro font-medium text-ink";
  // Up to five faces (spec-settings-workspace 1.4), then one "+N" face whose
  // tooltip names the rest, so the faces account for every Owner and Admin
  // the sentence counts in its "and N more".
  const hidden = admins.slice(5);
  return (
    <span className="inline-flex shrink-0 -space-x-1">
      {admins.slice(0, 5).map((a) => {
        const inner = a.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          a.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()
        );
        return a.email ? (
          <a key={a.id} href={`mailto:${a.email}`} title={`Email ${a.name}`} aria-label={`Email ${a.name}`} className={face}>
            {inner}
          </a>
        ) : (
          <span key={a.id} title={a.name} className={face}>{inner}</span>
        );
      })}
      {hidden.length > 0 ? (
        <span
          title={hidden.map((a) => a.name).filter(Boolean).join(", ")}
          aria-label={`${hidden.length} more`}
          className={face}
        >
          +{hidden.length}
        </span>
      ) : null}
    </span>
  );
}

/* ───────────────────────────── stripped view ───────────────────────────── */

/**
 * One 13/400 ink-2 line under the toolbar for this page load only, after a
 * typed URL asked for a view the viewer may not use and the page fell back
 * to its default view (consistency-report C29, access 5.5 rule 4).
 */
export function StrippedViewNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="status" className={cn("os-chrome m-0 px-6 py-2 text-sm text-ink-2", className)}>
      {children}
    </p>
  );
}

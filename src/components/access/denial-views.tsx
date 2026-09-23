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

import type { ReactNode } from "react";
import { Hash, Lock } from "lucide-react";
import { DotsArt } from "@/components/ui/dots-art";
import { BackButton } from "@/components/ui/back-button";
import { cn } from "@/lib/utils";
import type { OrgAdmin } from "@/lib/access/admins";
import { RequestAccessButton } from "./request-access-button";
import { JoinChannelButton } from "./join-channel-button";
import { ModuleOffSwitch } from "./module-off-switch";
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
  glyph?: "lock" | "hash";
  /** The owner's avatar beside their name (spec-talk 2.2 States). */
  ownerAvatar?: string | null;
  back: BackTarget;
}

export function LockedPage({ name, sentence, owner, requestAccess, joinChannelId, primaryLabel, glyph, ownerAvatar, back }: LockedPageProps) {
  const primary = joinChannelId
    ? <JoinChannelButton conversationId={joinChannelId} label={primaryLabel ?? "Join channel"} />
    : requestAccess
      ? <RequestAccessButton {...requestAccess} owner={owner ?? null} label={primaryLabel} />
      : undefined;
  // A Join page is an invitation, not a refusal, so it defaults to the hash.
  const kind = glyph ?? (joinChannelId ? "hash" : "lock");
  return (
    <DenialBlock
      title={name}
      sentence={sentence}
      tile={kind === "hash" ? <HashTile /> : <LockTile />}
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
  /** Members: the admins to ask. */
  admins?: OrgAdmin[];
  /** What turning it on unlocks, when the layout knows ("3 channels"). */
  unlocks?: string;
  back: BackTarget;
}

export function ModuleOff({ label, productSlug, canEnable, admins = [], unlocks, back }: ModuleOffProps) {
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
}

export function AppOff({ label, isAdmin, admins = [], back }: AppOffProps) {
  return (
    <DenialBlock
      title={`${label} is hidden in this workspace`}
      sentence={isAdmin ? `${label} was hidden or floored in Settings. Turn it back on from Apps & modules.` : `Ask a workspace admin to turn ${label} on.`}
      back={back}
      primary={isAdmin ? <SettingsLink href="/settings/apps" label="Open Apps & modules" /> : undefined}
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
}

export function AdminOnly({ page, managedBy = "Owners and Admins", back }: AdminOnlyProps) {
  return (
    <DenialBlock
      title={page}
      sentence={`${page} is managed by workspace ${managedBy}.`}
      locked
      back={back}
    />
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

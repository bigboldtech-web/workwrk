// Where an object opens: a pure function of the section it is opened from.
//
// THE RULE (founder, 2026-09-24): wherever you open something from, you stay
// in that section. A Doc, Table or Canvas clicked in the Work tree used to
// push /docs/<id> or /tables/<id>, and because the hub is URL-derived
// (route-hub.ts), the rail pill, the sidebar and the crumb all switched to
// the Docs or Tables hub. The person lost their place in Work every time.
//
// The fix keeps navigation URL-derived and pure, and gives every object a
// Work address as well as its canonical one:
//
//   /spaces/{slug}/{seg}/{id}   the Space-scoped Work address of a Doc, Table
//                               or Canvas whose own Space the viewer can see
//                               in the Work tree. `{slug}` is always the
//                               item's OWN Space; it is a hint here and the
//                               route's gate is the authority.
//   /work/{seg}/{id}            the Work door: id only. It renders an item
//                               with no visible Space in place, and hands a
//                               Space item on to its Space-scoped address
//                               before any editor mounts.
//   /{seg}/{id}                 canonical, unchanged and valid forever. The
//                               Docs and Tables hubs, notifications, email,
//                               search, share links and stored data use it.
//
// Every URL of all three forms resolves to its hub through ROUTE_HUB alone
// ("/spaces" and "/work" are Work rows, "/docs" and friends are not), so the
// rail, the sidebar and the crumb need nothing new.
//
// This file imports only "./route-hub" and nothing through the "@/" alias,
// so its test stays node-only like route-hub.test.ts.

import { resolveHub, type HubKey } from "./route-hub";

/** The five kinds of object that open in an editor and can be linked to. */
export type ObjectKind = "doc" | "table" | "canvas" | "sop" | "form";

/** Each kind's URL segment. Work addresses mirror the canonical ones, so an address stays readable. */
export const OBJECT_SEGMENT: Readonly<Record<ObjectKind, string>> = {
  doc: "docs",
  table: "tables",
  canvas: "canvas",
  sop: "sops",
  form: "forms",
};

/**
 * The kinds with a row in the Work tree, and so a Space-scoped address. SOPs
 * and forms get the Work door only: neither has a tree row to light, and
 * neither is governed by Space rules (the SOP centre has its own folder
 * grants, a form its own Guest rule).
 */
export const SPACE_SCOPED: ReadonlySet<ObjectKind> = new Set<ObjectKind>(["doc", "table", "canvas"]);

/** The Work door's first segment, owned by ROUTE_HUB's "/work" row. */
export const WORK_DOOR_SEGMENT = "work";

// Static children that share an object segment, so a path like /sops/new is
// never read as the SOP with id "new". /docs/trash is a redirect route.
const RESERVED: Readonly<Partial<Record<ObjectKind, ReadonlySet<string>>>> = {
  doc: new Set(["trash"]),
  sop: new Set(["new", "my-sops", "compliance", "manage"]),
};

const KIND_BY_SEGMENT: ReadonlyMap<string, ObjectKind> = new Map(
  (Object.entries(OBJECT_SEGMENT) as [ObjectKind, string][]).map(([kind, seg]) => [seg, kind]),
);

/** The address a Work route represents: Space-scoped under a slug, or the door. */
export type WorkAt = { scope: "space"; slug: string } | { scope: "work" };

/** What `openedObject` reads out of a path. */
export interface OpenedObject {
  kind: ObjectKind;
  id: string;
  scope: "canonical" | "space" | "work";
  /** The slug a Space-scoped address carries; null for the other two forms. */
  spaceSlug: string | null;
}

/**
 * The object mounted in the main area and the address it is mounted at.
 * `self` is where a link to that same object must go, so following it never
 * unmounts and remounts the editor.
 */
export interface OpenObjectRef {
  kind: ObjectKind;
  id: string;
  self: string;
}

const enc = (s: string) => encodeURIComponent(s);

function dec(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Today's URL for an object: the one its own hub opens. */
export function canonicalHref(kind: ObjectKind, id: string): string {
  return `/${OBJECT_SEGMENT[kind]}/${enc(id)}`;
}

/**
 * THE link helper. The hub a link is opened FROM decides the form:
 *   - from Work ("home"): the Space-scoped address when the caller knows the
 *     item's Space slug and the kind has a tree row, otherwise the Work door;
 *   - from any other hub: the canonical URL, exactly as before.
 * A passed slug is only a hint. The Work route's gate places the item in its
 * real Space, so a stale or wrong hint costs one client-side correction
 * before the editor mounts and never renders the item under a wrong crumb.
 */
export function objectHref(kind: ObjectKind, id: string, from: HubKey, spaceSlug?: string | null): string {
  const seg = OBJECT_SEGMENT[kind];
  if (from === "home") {
    if (spaceSlug && SPACE_SCOPED.has(kind)) return `/spaces/${enc(spaceSlug)}/${seg}/${enc(id)}`;
    return `/${WORK_DOOR_SEGMENT}/${seg}/${enc(id)}`;
  }
  return canonicalHref(kind, id);
}

/** The address a Work route stands for, rebuilt from its own params. */
export function addressHref(kind: ObjectKind, id: string, at: WorkAt): string {
  const seg = OBJECT_SEGMENT[kind];
  return at.scope === "space"
    ? `/spaces/${enc(at.slug)}/${seg}/${enc(id)}`
    : `/${WORK_DOOR_SEGMENT}/${seg}/${enc(id)}`;
}

/** Where a Trash lands outside Work: the object's own list in its own hub. */
export function closedObjectHref(kind: ObjectKind): string {
  return `/${OBJECT_SEGMENT[kind]}`;
}

/** An href split into its path and the untouched "?query#hash" tail. */
export function splitHref(href: string): { path: string; tail: string } {
  const cut = href.search(/[?#]/);
  return cut < 0 ? { path: href, tail: "" } : { path: href.slice(0, cut), tail: href.slice(cut) };
}

// The raw segments of a path, with a trailing slash dropped. An empty
// segment anywhere (a doubled slash) is not an object address.
function segmentsOf(path: string): string[] | null {
  if (!path.startsWith("/")) return null;
  let body = path.slice(1);
  if (body.endsWith("/")) body = body.slice(0, -1);
  if (body === "") return [];
  const segs = body.split("/");
  return segs.some((s) => s === "") ? null : segs;
}

function objectId(kind: ObjectKind, raw: string): string | null {
  const id = dec(raw);
  if (!id || RESERVED[kind]?.has(id)) return null;
  return id;
}

/**
 * Which object a path opens, if any: the three address forms, and nothing
 * else. The query, the hash and a trailing slash are ignored and segments
 * are percent-decoded. Static children (/docs/trash, /sops/new) and deeper
 * paths (/forms/{id}/respond) are not objects.
 */
export function openedObject(pathname: string): OpenedObject | null {
  if (typeof pathname !== "string") return null;
  const segs = segmentsOf(splitHref(pathname).path);
  if (!segs) return null;

  if (segs.length === 2) {
    const kind = KIND_BY_SEGMENT.get(segs[0]);
    if (!kind) return null;
    const id = objectId(kind, segs[1]);
    return id ? { kind, id, scope: "canonical", spaceSlug: null } : null;
  }

  if (segs.length === 3 && segs[0] === WORK_DOOR_SEGMENT) {
    const kind = KIND_BY_SEGMENT.get(segs[1]);
    if (!kind) return null;
    const id = objectId(kind, segs[2]);
    return id ? { kind, id, scope: "work", spaceSlug: null } : null;
  }

  if (segs.length === 4 && segs[0] === "spaces") {
    const kind = KIND_BY_SEGMENT.get(segs[2]);
    if (!kind || !SPACE_SCOPED.has(kind)) return null;
    const slug = dec(segs[1]);
    const id = objectId(kind, segs[3]);
    return slug && id ? { kind, id, scope: "space", spaceSlug: slug } : null;
  }

  return null;
}

// Only a same-origin, root-relative path can be an object address. Anything
// else (an absolute URL, a protocol-relative one, mailto:, a relative path,
// an empty string) is returned untouched by every mapper below.
function isRootRelative(href: unknown): href is string {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
}

/**
 * Any object href (a stored canonical one or a Work one) in the form the
 * section `from` opens, with its ?query and #hash kept. From Work a canonical
 * href becomes the door, and a Work href is kept as it is (its slug is a
 * hint worth keeping); from any other hub every form becomes canonical.
 * Non-object hrefs come back unchanged, and applying it twice changes nothing.
 */
export function sectionHref(href: string, from: HubKey): string {
  if (!isRootRelative(href)) return href;
  const { path, tail } = splitHref(href);
  const o = openedObject(path);
  if (!o) return href;
  if (from === "home") {
    return o.scope === "canonical" ? objectHref(o.kind, o.id, "home") + tail : href;
  }
  return canonicalHref(o.kind, o.id) + tail;
}

/**
 * The form Copy link puts on the clipboard. It is `sectionHref`, except that
 * from Work every object becomes the DOOR: a copied link keeps the Work
 * context, never carries a Space's slug (a name, on somebody's clipboard),
 * and is placed afresh for whoever opens it.
 */
export function shareHref(href: string, from: HubKey): string {
  if (!isRootRelative(href)) return href;
  const { path, tail } = splitHref(href);
  const o = openedObject(path);
  if (!o) return href;
  return (from === "home" ? objectHref(o.kind, o.id, "home") : canonicalHref(o.kind, o.id)) + tail;
}

/** Decoded, trailing-slash-normalised path equality; the query and hash are ignored. */
export function sameAddress(a: string, b: string): boolean {
  const norm = (h: string) => {
    const segs = segmentsOf(splitHref(h || "/").path);
    if (!segs) return null;
    const decoded = segs.map(dec);
    return decoded.some((s) => s === null) ? null : `/${decoded.join("/")}`;
  };
  const na = norm(a);
  return na !== null && na === norm(b);
}

/**
 * The call-site form of `objectHref`: the hub comes from the current path,
 * and the object already mounted in the main area answers with the address
 * it is mounted at, so its favourite, its Home row or any link to it never
 * unmounts the editor that shows it.
 */
export function objectHrefFor(
  kind: ObjectKind,
  id: string,
  pathname: string,
  open: OpenObjectRef | null,
  spaceSlug?: string | null,
): string {
  if (open && open.kind === kind && open.id === id) return open.self;
  return objectHref(kind, id, resolveHub(pathname || "/"), spaceSlug);
}

/** The call-site form of `sectionHref`, with the same open-object rule. */
export function sectionHrefFor(href: string, pathname: string, open: OpenObjectRef | null): string {
  if (!isRootRelative(href)) return href;
  const { path, tail } = splitHref(href);
  const o = openedObject(path);
  if (!o) return href;
  if (open && o.kind === open.kind && o.id === open.id) return open.self + tail;
  return sectionHref(href, resolveHub(pathname || "/"));
}

/** Everything the shell's click interceptor knows about one click. */
export interface InterceptInput {
  /** The anchor's resolved href (`a.href`), or its raw attribute. */
  href: string;
  /** window.location.origin. */
  origin: string;
  /** window.location.pathname at the moment of the click. */
  pathname: string;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  /** The anchor sits in an editable region (a link mark in a doc being edited). */
  isContentEditable: boolean;
  download: boolean;
  /** The anchor's target attribute, or null. */
  target: string | null;
  /** data-section-map="off": the anchor asked to be left alone. */
  optOut: boolean;
  open: OpenObjectRef | null;
}

export type InterceptDecision =
  | { action: "none" }
  | { action: "push"; href: string }
  | { action: "open"; href: string };

/**
 * The pure half of the shell's click interceptor. It maps a plain primary
 * click on a same-origin object link into the section it was clicked in, in
 * both directions: a canonical link clicked in Work stays in Work, and a Work
 * link clicked in the Docs hub stays in Docs. Modified clicks, middle clicks,
 * downloads, editable regions, opted-out anchors and links that already have
 * the right form are left alone, so the browser (or next/link) does exactly
 * what it did before.
 */
export function interceptDecision(input: InterceptInput): InterceptDecision {
  const none: InterceptDecision = { action: "none" };
  if (input.defaultPrevented || input.button !== 0) return none;
  if (input.metaKey || input.ctrlKey || input.shiftKey || input.altKey) return none;
  if (input.download || input.optOut || input.isContentEditable) return none;
  const target = (input.target ?? "").trim().toLowerCase();
  if (target !== "" && target !== "_self" && target !== "_blank") return none;

  let url: URL;
  try {
    url = new URL(input.href, input.origin);
  } catch {
    return none;
  }
  if (url.origin !== input.origin) return none;

  const local = url.pathname + url.search + url.hash;
  const mapped = sectionHrefFor(local, input.pathname, input.open);
  if (mapped === local) return none;
  return target === "_blank" ? { action: "open", href: mapped } : { action: "push", href: mapped };
}

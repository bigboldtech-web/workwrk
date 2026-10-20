// @ts-check
// The launcher's ten fixed operations (docs/plans/browser-host.md 5.5,
// Decision 19: the nine of its table, and drop, from the step 3 review).
// One JSON object a line, { id, op, args }, answered by
// { id, ok, result | error }. An unknown op, an unknown field or a bad value
// is refused and counted; answers hold codes, names, addresses of our own
// containers and counts only.
//
//   start     { session, viewport, timeoutSeconds }   the network and container of 5.2, started: { name, ip }
//   stop      { session }                             only what is labelled with that session: { removed }
//   list      none                                    [{ session, name, ip, running }]
//   sweep     { keep: [session] }                     what no kept session owns: { removed }
//   build     none                                    the committed Dockerfile, pulled fresh: candidate
//   promote   { tag: "candidate" }                    candidate to <yyyymmdd-hhmm> and current; old images pruned
//   drop      { tag: "candidate" }                    the candidate tag removed, after a build that changed nothing or failed
//   selftest  { image: current | candidate }          a session like start, with the reserved id: { name, ip, image }
//   probe     { image: current | candidate }          the probes: { netlink, netlinkHigh, netAdmin } exit codes
//   versions  none                                    Docker, containerd and runc
//
// No argument ever reaches an Engine body but the session id, the viewport
// and the timeout (bodies.mjs). A request carrying anything else, such as a
// port, a bind, a mount, a device or Privileged, is refused before Docker is
// asked anything.
//
// ONE AT A TIME: every operation that makes or removes a container or a
// network runs in one queue, in the order its line arrived. So a sweep never
// runs while a start is making its container, and a start never runs inside
// a sweep: the host reads its keep list when it writes the sweep's line (a
// session is in its table before its start is sent), and any start sent
// after that line waits for the sweep to finish. The build runs outside the
// queue (it touches images only), one at a time.

import { lowestFreeSubnet, isSessionIp } from "../lib/ranges.mjs";
import {
  containerCreateBody,
  IMAGE_REPO,
  IMAGE_TAGS,
  LABEL_BROWSER,
  LABEL_IMAGE,
  LABEL_PROBE,
  LABEL_SESSION,
  nameCandidates,
  networkCreateBody,
  probeCreateBody,
  PROBE_NAMES,
  SELFTEST_ASK,
  SELFTEST_SESSION,
  SESSION_ID,
} from "./bodies.mjs";
import { tarOf } from "./docker-api.mjs";

/**
 * The operations, each with the argument keys it takes (all required).
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const OPS = Object.freeze({
  start: ["session", "viewport", "timeoutSeconds"],
  stop: ["session"],
  list: [],
  sweep: ["keep"],
  build: [],
  promote: ["tag"],
  drop: ["tag"],
  selftest: ["image"],
  probe: ["image"],
  versions: [],
});

const LINE_MAX = 64 * 1024;
const NETWORK_TRIES = 5;
const NETWORK_RETRY_MS = 200;
const KEEP_MAX = 256;
const BUILD_MS = 40 * 60_000;
const PROBE_WAIT_MS = 40_000;
/** The base image the Dockerfile builds on, whose digest decides a promote (8.4). */
export const BASE_IMAGE = "debian:trixie-slim";

/** A refusal: its code is all the answer says. */
export class Refused extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const plain = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * The checked arguments of one request, or a refusal (see the header).
 * @param {string} op
 * @param {unknown} args
 */
export function checkArgs(op, args) {
  if (!Object.hasOwn(OPS, op)) throw new Refused("unknown_op");
  const keys = OPS[op];
  if (args === undefined && keys.length === 0) return {};
  if (!plain(args)) throw new Refused("bad_args");
  const extra = Object.keys(args).filter((k) => !keys.includes(k));
  if (extra.length > 0) throw new Refused("unknown_field");
  for (const k of keys) if (!Object.hasOwn(args, k)) throw new Refused(`missing_${k}`);
  /** @type {Record<string, unknown>} */
  const out = {};
  if (keys.includes("session")) {
    if (typeof args.session !== "string" || !SESSION_ID.test(args.session)) throw new Refused("bad_session");
    if (op === "start" && args.session === SELFTEST_SESSION) throw new Refused("bad_session");
    out.session = args.session;
  }
  if (keys.includes("viewport")) {
    const v = args.viewport;
    if (!plain(v) || Object.keys(v).some((k) => k !== "width" && k !== "height")) throw new Refused("bad_viewport");
    const { width, height } = v;
    if (!Number.isInteger(width) || !Number.isInteger(height) || Number(width) < 320 || Number(width) > 1920 || Number(height) < 240 || Number(height) > 1200) throw new Refused("bad_viewport");
    out.viewport = { width, height };
  }
  if (keys.includes("timeoutSeconds")) {
    const t = args.timeoutSeconds;
    if (!Number.isInteger(t) || Number(t) < 60 || Number(t) > 21600) throw new Refused("bad_timeout");
    out.timeoutSeconds = t;
  }
  if (keys.includes("keep")) {
    const keep = args.keep;
    if (!Array.isArray(keep) || keep.length > KEEP_MAX || !keep.every((s) => typeof s === "string" && SESSION_ID.test(s))) throw new Refused("bad_keep");
    out.keep = [...keep];
  }
  if (keys.includes("tag")) {
    if (args.tag !== "candidate") throw new Refused("bad_tag");
    out.tag = "candidate";
  }
  if (keys.includes("image")) {
    if (typeof args.image !== "string" || !IMAGE_TAGS.includes(args.image)) throw new Refused("bad_image");
    out.image = args.image;
  }
  return out;
}

/**
 * The yyyymmdd-hhmm stamp of a time, in UTC.
 * @param {number} ms
 */
export function stampOf(ms) {
  const d = new Date(ms);
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/**
 * The operations over an Engine.
 * @param {{
 *   engine: import("./docker-api.mjs").Engine,
 *   seccomp: string,
 *   memoryMb: number,
 *   dockerfile: Buffer,
 *   startScript: Buffer,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   log?: import("../lib/log.mjs").Log,
 * }} o
 */
export function createOps(o) {
  const now = o.now ?? (() => Date.now());
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const tally = { refused: 0, failed: 0, ops: /** @type {Record<string, number>} */ ({}) };
  /** The queue every container and network change runs in. */
  let queue = Promise.resolve();
  let building = false;

  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * One Engine call that must answer one of `ok`; anything else is a code.
   * @param {string} method
   * @param {string} path
   * @param {{ query?: Record<string, string>, body?: unknown, timeoutMs?: number, ok?: number[] }} [r]
   */
  async function call(method, path, r = {}) {
    let a;
    try {
      a = await o.engine.request(method, path, r);
    } catch {
      throw new Refused("engine_unreachable");
    }
    if (!(r.ok ?? [200, 201, 204]).includes(a.status)) throw new Refused(`engine_${a.status}`);
    return a.json;
  }

  /** @param {Record<string, string[]>} f */
  const filters = (f) => ({ filters: JSON.stringify(f) });

  /** @param {string} [label] */
  async function containers(label = `${LABEL_BROWSER}=1`) {
    const list = await call("GET", "/containers/json", { query: { all: "1", ...filters({ label: [label] }) } });
    return Array.isArray(list) ? list : [];
  }
  /** @param {string} [label] */
  async function networks(label) {
    const list = await call("GET", "/networks", label ? { query: filters({ label: [label] }) } : {});
    return Array.isArray(list) ? list : [];
  }
  /** @param {string} id */
  async function removeContainer(id) {
    await call("POST", `/containers/${encodeURIComponent(id)}/kill`, { ok: [204, 404, 409] });
    await call("DELETE", `/containers/${encodeURIComponent(id)}`, { query: { force: "1", v: "1" }, ok: [204, 404, 409] });
  }
  /**
   * A network goes once its container's endpoint has: an auto-removed
   * container may still hold it for a moment (403), so it is tried a few
   * times; one still held is left for the next sweep, never an error.
   * @param {string} id
   */
  async function removeNetwork(id) {
    for (let i = 0; i < NETWORK_TRIES; i += 1) {
      const a = await o.engine.request("DELETE", `/networks/${encodeURIComponent(id)}`).catch(() => null);
      if (a && (a.status === 204 || a.status === 404)) return true;
      await sleep(NETWORK_RETRY_MS);
    }
    return false;
  }
  /** @param {any} c */
  const sessionOf = (c) => (c && c.Labels && typeof c.Labels[LABEL_SESSION] === "string" ? c.Labels[LABEL_SESSION] : null);
  /** @param {any} c */
  const nameOf = (c) => (Array.isArray(c?.Names) && typeof c.Names[0] === "string" ? c.Names[0].replace(/^\//, "") : "");

  /** Remove everything labelled with one session. @param {string} session */
  async function stopSession(session) {
    let removed = 0;
    for (const c of await containers(`${LABEL_SESSION}=${session}`)) {
      await removeContainer(String(c.Id));
      removed += 1;
    }
    for (const n of await networks(`${LABEL_SESSION}=${session}`)) await removeNetwork(String(n.Id));
    return removed;
  }

  /**
   * The network and container of one session (5.2), started.
   * @param {string} session
   * @param {{ width: number, height: number }} viewport
   * @param {number} timeoutSeconds
   * @param {"current" | "candidate"} image
   */
  async function startSession(session, viewport, timeoutSeconds, image) {
    const allNets = await networks();
    /** @type {string[]} */
    const taken = [];
    const names = new Set();
    for (const n of allNets) {
      if (typeof n?.Name === "string") names.add(n.Name);
      for (const c of Array.isArray(n?.IPAM?.Config) ? n.IPAM.Config : []) if (typeof c?.Subnet === "string") taken.push(c.Subnet);
    }
    const every = await call("GET", "/containers/json", { query: { all: "1" } });
    for (const c of Array.isArray(every) ? every : []) names.add(nameOf(c));
    const free = lowestFreeSubnet(taken);
    if (!free || !isSessionIp(free.ip)) throw new Refused("no_subnet");
    const name = nameCandidates(session).find((n) => !names.has(n));
    if (!name) throw new Refused("no_name");
    await call("POST", "/networks/create", { body: networkCreateBody(name, free, session), ok: [201] });
    try {
      const created = await call("POST", "/containers/create", {
        query: { name },
        body: containerCreateBody(session, viewport, timeoutSeconds, { name, ip: free.ip }, { image, memoryMb: o.memoryMb, seccomp: o.seccomp }),
        ok: [201],
      });
      await call("POST", `/containers/${encodeURIComponent(String(created?.Id ?? name))}/start`, { ok: [204] });
    } catch (err) {
      // Nothing of a start that failed is left behind.
      await removeContainer(name).catch(() => undefined);
      await removeNetwork(name).catch(() => undefined);
      throw err;
    }
    return { name, ip: free.ip };
  }

  /** @param {"current" | "candidate"} image */
  async function imageCreated(image) {
    const img = await call("GET", `/images/${IMAGE_REPO}:${image}/json`);
    return typeof img?.Created === "string" ? img.Created : null;
  }

  /** @type {Record<string, (a: any) => Promise<unknown>>} */
  const handlers = {
    start: (a) => serial(() => startSession(a.session, a.viewport, a.timeoutSeconds, "current")),
    stop: (a) => serial(async () => ({ removed: await stopSession(a.session) })),
    list: async () =>
      (await containers())
        .filter((c) => sessionOf(c) && !(c.Labels && c.Labels[LABEL_PROBE]))
        .map((c) => {
          const name = nameOf(c);
          const ip = c?.NetworkSettings?.Networks?.[name]?.IPAddress;
          return { session: sessionOf(c), name, ip: typeof ip === "string" && ip ? ip : null, running: c.State === "running" };
        }),
    sweep: (a) =>
      serial(async () => {
        const keep = new Set(a.keep);
        let removed = 0;
        for (const c of await containers()) {
          const s = sessionOf(c);
          // A probe left by a run that died, or a session no kept one owns. No probe runs now: probes are queued too.
          if ((c.Labels && c.Labels[LABEL_PROBE]) || !s || !keep.has(s)) {
            await removeContainer(String(c.Id));
            removed += 1;
          }
        }
        for (const n of await networks(`${LABEL_BROWSER}=1`)) {
          const s = sessionOf(n);
          if (!s || !keep.has(s)) await removeNetwork(String(n.Id));
        }
        return { removed };
      }),
    build: async () => {
      if (building) throw new Refused("busy");
      building = true;
      try {
        // The last candidate goes first: a build that fails leaves none to promote.
        await call("DELETE", `/images/${IMAGE_REPO}:candidate`, { ok: [200, 404, 409] });
        const day = stampOf(now()).slice(0, 8);
        // The build's context: the committed Dockerfile and the image's start (container/wkb-start).
        const context = tarOf([
          { name: "Dockerfile", body: o.dockerfile },
          { name: "wkb-start", body: o.startScript, mode: 0o755 },
        ]);
        let r;
        try {
          r = await o.engine.build(
            context,
            { t: `${IMAGE_REPO}:candidate`, pull: "1", rm: "1", forcerm: "1", buildargs: JSON.stringify({ CACHE_DAY: day }), labels: JSON.stringify({ [LABEL_IMAGE]: "1" }) },
            BUILD_MS,
          );
        } catch {
          throw new Refused("engine_unreachable");
        }
        if (!r.ok) throw new Refused("build_failed");
        const created = await imageCreated("candidate");
        const base = await call("GET", `/images/${BASE_IMAGE}/json`);
        const digest = Array.isArray(base?.RepoDigests) && typeof base.RepoDigests[0] === "string" ? base.RepoDigests[0] : typeof base?.Id === "string" ? base.Id : null;
        return { created, baseDigest: digest };
      } finally {
        building = false;
      }
    },
    promote: () =>
      serial(async () => {
        const cand = await call("GET", `/images/${IMAGE_REPO}:candidate/json`);
        const id = String(cand?.Id ?? "");
        if (!id) throw new Refused("no_candidate");
        const tag = stampOf(now());
        await call("POST", `/images/${IMAGE_REPO}:candidate/tag`, { query: { repo: IMAGE_REPO, tag }, ok: [200, 201] });
        await call("POST", `/images/${IMAGE_REPO}:candidate/tag`, { query: { repo: IMAGE_REPO, tag: "current" }, ok: [200, 201] });
        await call("DELETE", `/images/${IMAGE_REPO}:candidate`, { query: { noprune: "1" }, ok: [200, 404, 409] });
        // Older than the two newest, and used by no container (Docker refuses one in use: 409).
        const imgs = await call("GET", "/images/json", { query: { all: "0", ...filters({ label: [`${LABEL_IMAGE}=1`] }) } });
        const sorted = (Array.isArray(imgs) ? imgs : []).filter((i) => typeof i?.Id === "string").sort((x, y) => Number(y.Created ?? 0) - Number(x.Created ?? 0));
        let pruned = 0;
        for (const img of sorted.slice(2)) {
          if (img.Id === id) continue;
          try {
            await call("DELETE", `/images/${encodeURIComponent(img.Id)}`, { ok: [200] });
            pruned += 1;
          } catch {
            // In use, or tagged elsewhere: kept.
          }
        }
        return { tag, pruned };
      }),
    drop: () =>
      serial(async () => {
        // Untagged, and gone when nothing else names it; a container still on it (409) keeps it for the next build.
        const a = await o.engine.request("DELETE", `/images/${IMAGE_REPO}:candidate`).catch(() => null);
        if (!a) throw new Refused("engine_unreachable");
        if (![200, 404, 409].includes(a.status)) throw new Refused(`engine_${a.status}`);
        return { dropped: a.status === 200 };
      }),
    selftest: (a) =>
      serial(async () => {
        await stopSession(SELFTEST_SESSION);
        const started = await startSession(SELFTEST_SESSION, SELFTEST_ASK.viewport, SELFTEST_ASK.timeoutSeconds, a.image);
        return { ...started, image: { created: await imageCreated(a.image) } };
      }),
    probe: (a) =>
      serial(async () => {
        /** @type {Record<string, number | null>} */
        const codes = {};
        for (const which of PROBE_NAMES) {
          for (const c of await containers(`${LABEL_PROBE}=${which}`)) await removeContainer(String(c.Id));
          const created = await call("POST", "/containers/create", { query: { name: `wkb-probe-${which.toLowerCase()}` }, body: probeCreateBody(a.image, which, { seccomp: o.seccomp }), ok: [201] });
          const id = String(created?.Id ?? "");
          try {
            await call("POST", `/containers/${encodeURIComponent(id)}/start`, { ok: [204] });
            const waited = await call("POST", `/containers/${encodeURIComponent(id)}/wait`, { query: { condition: "not-running" }, timeoutMs: PROBE_WAIT_MS, ok: [200] });
            codes[which] = Number.isInteger(waited?.StatusCode) ? waited.StatusCode : null;
          } finally {
            await removeContainer(id).catch(() => undefined);
          }
        }
        return codes;
      }),
    versions: async () => {
      const v = await call("GET", "/version");
      const comp = (/** @type {string} */ name) => {
        const c = Array.isArray(v?.Components) ? v.Components.find((/** @type {any} */ x) => x && String(x.Name).toLowerCase() === name) : null;
        return c && typeof c.Version === "string" ? c.Version : null;
      };
      return { docker: typeof v?.Version === "string" ? v.Version : null, containerd: comp("containerd"), runc: comp("runc") };
    },
  };

  /**
   * One request line, answered.
   * @param {string} line
   * @returns {Promise<Record<string, unknown>>}
   */
  async function handle(line) {
    /** @type {unknown} */
    let msg;
    try {
      if (line.length > LINE_MAX) throw new Error("long");
      msg = JSON.parse(line);
    } catch {
      tally.refused += 1;
      return { ok: false, error: "bad_request" };
    }
    const id = plain(msg) && (Number.isInteger(msg.id) || (typeof msg.id === "string" && msg.id.length <= 64)) ? msg.id : null;
    const reply = (/** @type {Record<string, unknown>} */ r) => (id === null ? r : { id, ...r });
    if (!plain(msg) || id === null) {
      tally.refused += 1;
      return reply({ ok: false, error: "bad_request" });
    }
    if (Object.keys(msg).some((k) => k !== "id" && k !== "op" && k !== "args")) {
      tally.refused += 1;
      return reply({ ok: false, error: "unknown_field" });
    }
    const op = typeof msg.op === "string" ? msg.op : "";
    /** @type {Record<string, unknown>} */
    let args;
    try {
      args = checkArgs(op, msg.args);
    } catch (err) {
      tally.refused += 1;
      o.log?.event("refused", err instanceof Refused ? err.code : "bad_args");
      return reply({ ok: false, error: err instanceof Refused ? err.code : "bad_args" });
    }
    const started = now();
    try {
      const result = await handlers[op](args);
      tally.ops[op] = (tally.ops[op] ?? 0) + 1;
      o.log?.event(op, "ok", { ms: now() - started });
      return reply({ ok: true, result });
    } catch (err) {
      tally.failed += 1;
      const code = err instanceof Refused ? err.code : "failed";
      o.log?.event(op, "failed", code, { ms: now() - started });
      return reply({ ok: false, error: code });
    }
  }

  return { handle, tally: () => ({ refused: tally.refused, failed: tally.failed, ops: { ...tally.ops } }) };
}

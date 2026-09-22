// The spine: one Tuesday (concept 4).
//
// ONE DOM, TWO READINGS, and that is the whole architecture of this file.
//
// The phone reads eight beats stacked down the page (concept 4.2), built
// first because roughly 83 percent of visits arrive on one. The desktop
// reads six stops (concept 4), pinned for five viewports, cross fading
// through one stage. Those are not two pages: the eight beats ARE the six
// stops, grouped, because every beat already declares the stop it belongs
// to. Stop 1 is the 9:02 row and the 9:03 SOP, stop 3 is the 10:30 decision
// and the 11:15 contract, and the other four stops are one beat each.
//
// So the `<ol>` below is a list of six `<li>` stops, each holding its one or
// two beat `<section>`s, and the difference between the phone and the
// desktop scene is entirely in the stylesheet and in one client island that
// writes a scroll position. Nothing is rendered twice, no heading appears
// in the page more than once, and the crawler, the screen reader and the
// visitor with JavaScript off all get the same eight headings in order.
//
// Every beat is a real `<section>` with its own heading, which is what makes
// the story readable by a crawler and by a screen reader and not only by an
// eye following a scroll.
//
// TRUTH GATES, per beat, are the reason this file reads the fixture through
// helpers rather than through fields:
//
//   narrationForBeat(beat)   prints the shipped fallback when the mechanism
//                            the beat shows is not wired yet
//   receiptLineLabel(line)   does the same for the artefact at the end
//
//   wireLabelFor(stop)       and the same for the four words drawn BETWEEN
//                            the two pictures, which is a claim as much as
//                            the sentence under them is
//
// Today every stop is closed, so all eight beats print their fallback
// narration, which is the gate doing its job rather than a bug: the page
// says what the product does, and the storyboard's fuller sentence waits
// for the mechanism. Stop 5 was the last one marked shipped, and what it
// asserted was a KPI record written by completing a task; nothing in the
// product writes one, so it closed too.
//
// The task card travels. On a phone there is no shared element transition
// to fly it between stops, so it does the honest equivalent: the same card
// is repeated under every beat with its trail so far, growing one line at a
// time, which is the same idea at a phone's reading pace.

import { Fragment } from "react";

import { PrimaryCta } from "../cta";
import { Receipt } from "../receipt/receipt";
import { workReceiptModel } from "../receipt/receipt-model";
import { DOT_ORDER } from "../dots";
import {
  DOT_HEX,
  castName,
  clockMinutes,
  narrationForBeat,
  stopByNumber,
  trailUpTo,
  tuesday,
  wireLabelFor,
  type Beat,
  type HubBlock,
  type Stop,
} from "../data/tuesday";
import { MarketingShell, MkIcon } from "../shell/marketing-shell";
import { MkSidebar, SURFACES } from "../shell/surfaces";
import { MkChip, MkStatusChip } from "../shell/primitives";
import { spineNotice, tuesdayCtaHeadline, tuesdayCtaLede } from "./content";
import { SpineProgress } from "./spine-progress.client";
import { SpinePin, type StopRef } from "./spine-pin.client";
import type { ClockMark } from "./scroll-scene";
import "./home.css";

/** The element id of a stop panel. One place, because three things scroll to it. */
export function stopElementId(n: number): string {
  return `stop-${n}`;
}

/**
 * The minutes a stop opens and closes on, read from its own clock range.
 *
 * The fixture writes a range as "2:00 to 2:30" and a single moment as
 * "9:04", so a stop that covers half an hour really does tick through it and
 * a stop at one moment holds. Nothing is retyped: both ends come from the
 * same string the beat rail prints.
 */
export function clockMarkForStop(stop: Stop): ClockMark {
  const parts = stop.clockRange.split(" to ").map((s) => s.trim());
  const from = clockMinutes(parts[0] ?? stop.clock);
  const to = clockMinutes(parts[1] ?? parts[0] ?? stop.clock);
  const safeFrom = Number.isFinite(from) ? from : 0;
  const safeTo = Number.isFinite(to) ? to : safeFrom;
  return { from: safeFrom, to: safeTo };
}

/**
 * The minutes ONE BEAT opens and closes on.
 *
 * A beat is a moment, not a span: 9:02, 9:03, 10:30. The one exception is a
 * beat that is the whole of a stop whose clock range really is a range, and
 * there is exactly one of those: stop 4 runs 2:00 to 2:30 on a single beat,
 * because "blocked, then unblocked half an hour later" is one picture and
 * the half hour passing inside it is the point.
 *
 * Driving the desktop clock from the BEAT rather than from the stop is what
 * stops it lying on stop 3: that stop spans 10:30 to 11:15, so a clock
 * interpolated across the stop reads 10:52 at the moment the 11:15 contract
 * arrives. A beat's own minute cannot drift from the picture beside it.
 */
export function clockMarkForBeat(stop: Stop, beatsInStop: Beat[], beat: Beat): ClockMark {
  if (beatsInStop.length <= 1) return clockMarkForStop(stop);
  const at = clockMinutes(beat.clock);
  const safe = Number.isFinite(at) ? at : clockMarkForStop(stop).from;
  return { from: safe, to: safe };
}

/**
 * Which surface a block shows at a given stop.
 *
 * A hub has ONE default surface, and for four of the eight blocks that is
 * the whole answer. Work is not one of them: the storyboard shows the board
 * list with the drawer open at 10:30, the same list with the status flipped
 * to blocked at 2:00, and the assembled shell at 6:02. Those are not
 * decorations, they are the sentence. A frame reading "In progress" beside
 * the words "Blocked doesn't mean stuck" is the picture contradicting the
 * claim, which is the one thing a marketing-lite surface must never do.
 *
 * The storyboard already writes the answer down, in each stop's own `left`
 * and `right` fields, so it is read from there rather than decided again
 * here. A beat may override its stop where the two moments of one stop are
 * two different pictures of the same block: stop 3's Docs is the SOP at
 * 10:30 and contract v2 at 11:15. A hub neither names falls back to its
 * own default surface, which is the answer for four of the eight blocks.
 */
export function surfaceForBlock(stop: Stop | undefined, hub: HubBlock, beat?: Beat): string {
  const override = beat?.surfaces?.[hub.id];
  if (override) return override;
  if (stop?.left.hub === hub.id) return stop.left.surface;
  if (stop?.right.hub === hub.id) return stop.right.surface;
  return hub.surface;
}

/** The trail lines a beat has collected, by the stop it belongs to. */
function trailForBeat(beat: Beat): string[] {
  return trailUpTo(beat.stop);
}

function TaskCard({ beat }: { beat: Beat }) {
  const { task } = tuesday;
  const blocked = beat.n === 6;
  const done = beat.n >= 7;
  const trail = trailForBeat(beat);
  return (
    <div className="mk-card" style={{ background: "var(--os-surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, color: "var(--os-ink)" }}>{task.title}</span>
        <MkStatusChip
          status={done ? "done" : blocked ? "blocked" : task.status}
          label={done ? "Done" : blocked ? "Blocked: finance sign off" : task.statusLabel}
        />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <MkChip>{castName(task.owner)}</MkChip>
        {task.links.map((l) => (
          <MkChip key={l.type} tone="accent">
            {l.label}
          </MkChip>
        ))}
      </div>
      <ol className="mk-trail">
        {trail.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The wire between a beat's two blocks, and the label that names what
 * travels along it.
 *
 * ONE element, two orientations. Below 1024 the blocks stack, so the wire is
 * vertical and 28px tall between them. From 1024 the blocks sit left and
 * right, so it is horizontal and fills the middle column. That is the whole
 * difference, and it is a stylesheet's job: a second wire component for the
 * desktop would be a second thing to keep true.
 *
 * It is a plain element rather than an SVG path because the only thing it
 * ever does is draw itself from one end, which is a `scale` on one axis, and
 * a scale of a 2px bar is the same picture as a stroke-dashoffset of a
 * straight line for a tenth of the code and none of the viewBox arithmetic.
 *
 * `lonely` means the block above this one is the carried-over block, which
 * the phone does not draw: the wire would then hang off nothing, so the
 * phone drops it too.
 */
function BeatWire({ label, dot, lonely = false }: { label: string; dot: string | null; lonely?: boolean }) {
  return (
    <p className="mk-wirelink" data-lonely={lonely} aria-hidden>
      <span className="mk-wirelink__line" />
      {dot ? <span className="mk-wirelink__dot" /> : null}
      <span className="mk-wirelink__label">{label}</span>
    </p>
  );
}

/**
 * The beat's blocks: the storyboard's left block and right block.
 *
 * EVERY block the beat names is in the markup, always. Which of them a given
 * width shows is a stylesheet decision, and the two readings genuinely want
 * different answers:
 *
 *   Desktop, where the two blocks sit side by side with a wire between them,
 *   wants BOTH, because the pair with the wire is the whole grammar of the
 *   scene. Stop 2 is "the SOP on the left, the board on the right"; drawn
 *   with the SOP missing it is a board with a caption.
 *
 *   The phone, where the blocks stack one above the other at reading pace,
 *   wants the carry-over named rather than drawn: beats 2 and 3 share Docs,
 *   so it rendered the same "Client onboarding v4" frame twice, one directly
 *   above the other, pixel-identical but for the clock, which reads as a
 *   duplication bug rather than as continuity.
 *
 * So the carried block is marked rather than dropped, and `home.css` hides
 * it below 1024 and the sentence above 1024. Nothing is rendered twice and
 * neither reading is built out of a different DOM.
 */
function BeatSurfaces({ beat, carried, stop }: { beat: Beat; carried: string[]; stop: Stop | undefined }) {
  const hubs = beat.hubs
    .map((id) => tuesday.hubs.find((h) => h.id === id))
    .filter((h): h is NonNullable<typeof h> => Boolean(h));
  const repeated = hubs.filter((h) => carried.includes(h.id));

  const block = (hub: (typeof hubs)[number]) => (
    <div key={hub.id} className="mk-beat__block" data-carried={carried.includes(hub.id)} data-hub={hub.id}>
      <MarketingShell
        hub={hub.id}
        breadcrumb={[hub.label]}
        clock={beat.clock}
        scale={0.74}
        width={940}
        height={400}
        sidebar={<MkSidebar hub={hub.id} />}
        label={`${beat.clock}, ${hub.label}: ${beat.headline}`}
        caption={null}
      >
        {SURFACES[surfaceForBlock(stop, hub, beat)]?.() ?? null}
      </MarketingShell>
    </div>
  );

  // THE CLOSE BREAKS THE GRAMMAR. Every other stop is a pair of frames with
  // a wire between them; stop 6 is the blocks snapping back into ONE navy
  // framed shell with the Sidekick opening over it (concept 4, stop 6). Read
  // from the stop's own `left` and `right`, which already said exactly this
  // (work/shell and ai/ask-ai) while the render used the beat's two hubs and
  // drew a seventh pair instead.
  if (stop?.n === 6) {
    return (
      <div className="mk-beat__blocks" data-blocks={1} data-close="true">
        <div className="mk-beat__block" data-hub="work">
          <MarketingShell
            hub="work"
            breadcrumb={["Work", "My work"]}
            clock={beat.clock}
            scale={0.74}
            width={940}
            height={440}
            sidebar={<MkSidebar hub="work" />}
            label={`${beat.clock}: the whole workspace, with the Ask panel open over it. ${beat.headline}`}
            caption={null}
          >
            {SURFACES.close?.() ?? null}
          </MarketingShell>
        </div>
      </div>
    );
  }

  return (
    <div className="mk-beat__blocks" data-blocks={hubs.length}>
      {repeated.length > 0 ? (
        <p className="mk-carry">
          {repeated.map((h) => h.label).join(" and ")} {repeated.length === 1 ? "carries" : "carry"} over from the last
          beat.
        </p>
      ) : null}
      {hubs.map((hub, i) => (
        <Fragment key={hub.id}>
          {i > 0 && stop ? (
            // The label goes through the gate, exactly as the narration under
            // it does. It used to be passed raw, which is how stop 4 came to
            // print "Status changed, Finance notified" above a sentence
            // saying Sam mentions Priya by hand.
            <BeatWire label={wireLabelFor(stop)} dot={stop.dot} lonely={carried.includes(hubs[i - 1].id)} />
          ) : null}
          {block(hub)}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * `headingTag` exists because /tuesday switches the section's own h2 off:
 * its page h1 already says the same thing, and two headlines for one idea is
 * rule 1 broken by restatement. With the h2 gone the beats become the
 * section's top level headings, so an h3 there is an h1 followed by an h3,
 * which is a heading level skipped and a real defect for anyone navigating
 * by headings. The level follows the structure instead of being hard coded.
 */
function BeatCard({
  beat,
  carried,
  headingTag: H = "h3",
}: { beat: Beat; carried: string[]; headingTag?: "h2" | "h3" }) {
  const stop = stopByNumber(beat.stop);
  const shipped = stop?.truthGate.shipped ?? false;
  return (
    <section
      className="mk-beat mk-reveal"
      id={`beat-${beat.n}`}
      data-beat={beat.n}
      aria-labelledby={`beat-${beat.n}-h`}
    >
      <div className="mk-beat__grid">
        <div className="mk-beat__say">
          <div className="mk-beat__words">
            <p className="mk-beat__time mk-figures">{beat.clock}</p>
            <H id={`beat-${beat.n}-h`} className="mk-title" style={{ marginTop: 10 }}>
              {beat.headline}
            </H>
            <p className="mk-lede">
              {narrationForBeat(beat)}
            </p>
          {/* The gate, said out loud on the one beat whose mechanism the
              whole argument rests on. Concept 4.4 calls stop 2 the spine
              of the argument, so when its mechanism is not live the page
              says what ships instead rather than letting the softened
              sentence pass for the full one.

              This note was itself wrong, which is the worst place on the
              site to be wrong: it read "the template carries the SOP, the
              KPI and the checklist onto the task", and a template cannot
              carry an SOP or a KPI. `enum TemplateKind` is TASK, LIST,
              SPACE, FOLDER, DOC, VIEW and WHITEBOARD; the apply route
              handles exactly those seven and nothing else; and the one
              SOP-adjacent seed is a DOC whose body tells you to go and
              create the SOP yourself afterwards. A fallback that is false
              is worse than the claim it replaced, because it is printed in
              the voice of an admission. */}
          {beat.stop === 2 && !shipped ? (
            <p className="mk-gate">
              Shipping today: Sam creates the task and links it to step 3 of the SOP and to the KPI it moves, and every
              other block reads those links. The SOP step creating the task by itself, with the owner resolved from the
              role, is in build.
            </p>
          ) : null}
          </div>
          {/* The card that travels.
              It sits in the SAME grid slot of every beat panel, so the
              panels cross fade around it and it appears to stay put while
              its trail grows one line at a time. That is the effect a
              shared element Flip produces, arrived at by not moving the
              element (concept 4). */}
          <TaskCard beat={beat} />
        </div>
        <BeatSurfaces beat={beat} carried={carried} stop={stop} />
      </div>
    </section>
  );
}

/**
 * One storyboard stop: the list item the desktop scene pins, holding the one
 * or two beats that make it up.
 *
 * `data-beats` tells the stylesheet whether this stop cross fades between
 * two beats inside itself, and `--mk-stop-dot` carries the stop's colour
 * down to the wire its beats draw.
 */
function StopPanel({
  stop,
  beats,
  carried,
  headingTag,
}: { stop: Stop; beats: Beat[]; carried: string[]; headingTag?: "h2" | "h3" }) {
  return (
    <li
      className="mk-stop"
      id={stopElementId(stop.n)}
      data-stop={stop.n}
      data-beats={beats.length}
      data-dot={stop.dot ?? "none"}
      style={
        stop.dot && stop.dot !== "all" && stop.dot !== null
          ? ({ "--mk-stop-dot": DOT_HEX[stop.dot] } as React.CSSProperties)
          : undefined
      }
    >
      {beats.map((beat, i) => (
        <BeatCard
          key={beat.n}
          beat={beat}
          carried={i === 0 ? carried : beats[i - 1].hubs}
          headingTag={headingTag}
        />
      ))}
    </li>
  );
}

/**
 * The story.
 *
 * `shareHref` is the two affordances concept 4 puts at the close: the story
 * you just read is the thing people send each other, so it names its own
 * share route. /tuesday IS that route, so it passes null and gets the replay
 * without a link to the page it already is.
 */
export function Spine({
  shareHref = "/tuesday",
  intro = true,
  labelledBy = "mk-spine",
}: { shareHref?: string | null; intro?: boolean; labelledBy?: string } = {}) {
  // With the intro on, the section has an h2 and the beats sit under it at
  // h3. With it off, the beats ARE the top level of the section.
  const BeatHeading = intro ? "h3" : "h2";

  const model = workReceiptModel();
  const stops = tuesday.stops;

  // The eight beats, grouped under the six stops they already declare, and
  // the hubs each stop inherits from the one before it so a carried over
  // block is named once rather than drawn twice.
  const beatsByStop = new Map<number, Beat[]>();
  for (const beat of tuesday.beats) {
    const list = beatsByStop.get(beat.stop);
    if (list) list.push(beat);
    else beatsByStop.set(beat.stop, [beat]);
  }
  const carriedInto = new Map<number, string[]>();
  let previous: string[] = [];
  for (const stop of stops) {
    carriedInto.set(stop.n, previous);
    const beats = beatsByStop.get(stop.n) ?? [];
    previous = beats[beats.length - 1]?.hubs ?? previous;
  }

  // What the scene needs, and nothing else: six stops, each carrying its own
  // beats with their element ids, their clock marks and the blocks they
  // light on the map. It is plain data, so the island never reads the
  // fixture and the fixture never reaches the browser.
  const stopRefs: StopRef[] = stops.map((stop) => {
    const beats = beatsByStop.get(stop.n) ?? [];
    return {
      n: stop.n,
      id: stopElementId(stop.n),
      clockRange: stop.clockRange,
      title: stop.title,
      beats: beats.map((beat) => ({
        n: beat.n,
        id: `beat-${beat.n}`,
        mark: clockMarkForBeat(stop, beats, beat),
        hubs: beat.hubs,
      })),
    };
  });

  return (
    <section className="mk-band" data-tone="tint" id="tuesday" aria-labelledby={labelledBy}>
      <div className="mk-wrap">
        {/* THE INTRO IS OPTIONAL, and the reason is that the only route that
            renders this section is /tuesday, whose own hero already says
            "One Tuesday" over the same sentence. Two sections in a row said
            the same thing in the same words, which is rule 1 broken by
            restatement rather than by clutter. The page now says it once and
            switches this off. */}
        {intro ? (
          <>
            <h2 id="mk-spine" className="mk-title-lg mk-reveal" style={{ maxWidth: "22ch" }}>
              One Tuesday. One task. One trail.
            </h2>
            <p className="mk-lede mk-reveal">
              {spineNotice()} Follow one task through one day and watch every block do one thing to it.
            </p>
            <p className="mk-note mk-reveal">
              Cast: {tuesday.cast.map((c) => `${c.name}, ${c.jobTitle}`).join(". ")}. {tuesday.client.name} is the new
              client.
            </p>
          </>
        ) : null}

        {/* Five viewports of scroll that hold one screen is hostile to
            anyone trying to get past it, so the way out is the first thing a
            keyboard reaches and it is server rendered, not added by the
            island that creates the problem. */}
        <a className="mk-skip-scene" href="#tuesday-after">
          Skip the Tuesday tour
        </a>

        <div className="mk-pin-track" data-pin="spine">
          <div className="mk-pin-sticky">
            <div className="mk-spine-stage">
              {/* The narrator. Static at the story's opening minute until the
                  scene runs, so it never reads a time the page is not at. */}
              <p className="mk-spine-clock" aria-hidden>
                <span className="mk-spine-clock__time mk-figures">{stops[0]?.clock ?? tuesday.beats[0].clock}</span>
                <span className="mk-spine-clock__day">Tuesday</span>
              </p>

              <ol className="mk-beats">
                {stops.map((stop) => (
                  <StopPanel
                    key={stop.n}
                    stop={stop}
                    beats={beatsByStop.get(stop.n) ?? []}
                    carried={carriedInto.get(stop.n) ?? []}
                    headingTag={BeatHeading}
                  />
                ))}
              </ol>

              {/* The "you are here" map: the eight blocks as a strip, with
                  the ones this stop uses lit. It is the small greyed shell
                  of the storyboard, reduced to the part that carries the
                  information at this size. */}
              <div className="mk-map" aria-hidden>
                {tuesday.hubs.map((h) => (
                  <span key={h.id} className="mk-map__item" data-hub={h.id}>
                    <MkIcon name={h.icon} size={14} />
                    <span>{h.label}</span>
                  </span>
                ))}
              </div>

              <p className="mk-spine-status" aria-live="polite" />

              <SpinePin stops={stopRefs} />
            </div>
          </div>
        </div>

        {/* The close: the task stops moving and prints its receipt. */}
        {/* No fixed width on the receipt.
            `width: 520` plus `max-width: 100%` reads like a cap and is not
            one: the grid track it sat in sized to its max-content, so 100%
            resolved to 520 and the slab hung 150px off the right of a 390
            phone. A container with a max-width caps it against the column
            instead, at every width. */}
        {/* CENTRED, not left aligned. This is the artefact the whole story
            is paying for and the one thing concept 9 expects a person to
            screenshot, and at 1440 it was a 520px slab against the left
            edge with 780px of empty page beside it, which reads as a column
            that ran out rather than as an object presented. The wordmark
            the four dots land in, and the replay and share row under it,
            centre with it, so the close is one centred group. */}
        <div
          id="tuesday-after"
          className="mk-reveal"
          style={{ marginTop: 40, display: "grid", gap: 20, justifyItems: "center", scrollMarginTop: 88 }}
        >
          <div className="mk-print" style={{ width: "100%", maxWidth: 520 }}>
            <Receipt model={model} className="mk-lift" />
          </div>
          {/* The four dots leave the receipt and land between the two k's of
              the wordmark (concept 4, stop 6).
              At rest they are simply IN the wordmark, which is where they
              live: the travel is an enhancement that runs off the scroll
              position, so a visitor with no scroll timeline, with JavaScript
              off, or with reduced motion asked for, sees the brand mark
              rather than four loose dots and a gap.

              THE GEOMETRY IS THE BRAND MARK'S, and it has to be, because
              this is the one moment on the page where the whole argument
              resolves into the logo. It was drawn as "workwr" + the dot row
              + "k", which puts the dots ON the baseline and splits the word
              in two: a reader saw "workwr • • • • k", not the wordmark. The
              real lockup (src/components/brand/logo.tsx, LogoLockup) splits
              the word at "wr" and floats the dots ABOVE that span, so they
              sit in the gap between the two k letters at any font width
              without anybody measuring a glyph. Same split, same anchor,
              same weight and tracking here, so the mark the dots land in is
              the mark the nav and the footer render.

              The dots are drawn as four spans rather than by calling
              LogoLockup because each one carries its own scroll-timeline
              landing (home.css, mk-dot-land), which a single rendered
              lockup cannot expose. Geometry copied, not invented. */}
          <span className="mk-dotfly" aria-hidden>
            work
            <span className="mk-dotfly__anchor">
              wr
              <span className="mk-dotfly__slot">
                {DOT_ORDER.map((c) => (
                  <span key={c} style={{ background: DOT_HEX[c] }} />
                ))}
              </span>
            </span>
            k
          </span>

          {/* The two affordances the close is supposed to end on (concept 4
              stop 6, and the microcopy list).

              "Replay Tuesday" is an anchor back to the top of this section
              and nothing else: the scene is scroll driven, so scrolling it
              again IS the replay, and a button that animated it on a timer
              would be a second, slower way to do what the gesture the
              visitor is already making does. It carries no "(8s)" for the
              same reason: there is no timed playback to promise.

              "Share this Tuesday" points at /tuesday, the route this story
              already renders on its own. Without it the share route existed
              with nothing on the site pointing at it from the story it
              duplicates. */}
          <p className="mk-note mk-spine-close">
            <a className="mk-focus" href="#tuesday">
              Replay Tuesday
            </a>
            {shareHref ? (
              <>
                <span aria-hidden>·</span>
                <a className="mk-focus" href={shareHref} data-cta="spine-share-tuesday">
                  Share this Tuesday
                </a>
              </>
            ) : null}
          </p>
        </div>

        <div className="mk-reveal" style={{ marginTop: 36 }}>
          <BeatHeading className="mk-title">{tuesdayCtaHeadline()}</BeatHeading>
          <p className="mk-lede">
            {tuesdayCtaLede()}
          </p>
          <div className="mk-ctarow">
            <PrimaryCta placement="spine" template />
          </div>
        </div>

        {/* Clock label in the sticky bar, and one stop reached event per
            beat. Nothing visual depends on it. */}
        <SpineProgress beats={tuesday.beats.map((b) => ({ n: b.n, clock: b.clock, id: `beat-${b.n}`, stop: b.stop }))} />
      </div>
    </section>
  );
}

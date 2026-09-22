"use client";

// The explorable map (marketing-concept.md section 5, "/how-it-connects").
//
// It is a client island for one reason: choosing a node and stepping through
// Tuesday are both selections, and a selection needs state. Everything else
// stays on the server. The twelve node descriptions, the sixteen edges and
// the eight product surfaces are all rendered upstream and handed in as
// already finished markup, so the Tuesday fixture and the graph module never
// cross into the browser bundle.
//
// ACCESSIBILITY, which drove the shape of this component.
//
//   The nodes are real <button> elements laid over the stage, not shapes
//   inside the SVG. The SVG carries the WIRES only and is aria-hidden, so
//   the picture is decoration and the twelve controls are in the tab order
//   with the site's focus ring on them.
//   The right pane is one live region that the selection writes into, so a
//   screen reader hears the change without the focus moving.
//   Follow Tuesday is Previous and Next buttons plus a step list, never an
//   autoplay. There is no timer in this file.
//
// REDUCED MOTION. There is nothing to reduce: selecting a node changes
// colours and text, and no position, size or opacity is animated anywhere in
// this component or its sheet. The resting state IS the designed state, at
// every breakpoint, which is why the page needs no static fallback.

import { useState, type ReactNode } from "react";
import {
  CONNECT_EDGES,
  CONNECT_NODES,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  edgeKey,
  edgeLine,
  edgeOther,
  edgeUpcoming,
  edgesFor,
  nodePercent,
  type ConnectNode,
  type TourStep,
} from "./connect-graph";
import { trackCta } from "../instrumentation";
import "./connect.css";

export interface MapNodeView {
  id: string;
  label: string;
  blockLabel: string;
  dotHex: string;
  what: string;
  surfaceName: string;
  /** The module page this record lives in. */
  moduleHref: string;
  moduleLabel: string;
  /** Which pre-rendered surface frame to reveal, or null when it has none. */
  surfaceKey: string | null;
}

export interface ConnectMapProps {
  nodes: MapNodeView[];
  steps: TourStep[];
  /** One frame per distinct surface, rendered on the server, keyed by surface. */
  frames: Record<string, ReactNode>;
}

type Mode = "explore" | "tour";

export function ConnectMap({ nodes, steps, frames }: ConnectMapProps) {
  const [mode, setMode] = useState<Mode>("explore");
  const [selected, setSelected] = useState<string>(nodes[0]?.id ?? "task");
  const [step, setStep] = useState<number>(0);

  const current = steps[step];
  const litNodes = mode === "tour" ? (current?.nodes ?? []) : [selected];
  const litEdges =
    mode === "tour"
      ? (current?.edges ?? [])
      : edgesFor(selected).map(edgeKey);

  const node = nodes.find((n) => n.id === selected) ?? nodes[0];

  /**
   * Which pre-rendered frame to reveal.
   *
   * In tour mode it is the first record the stop lights that HAS a surface,
   * which is what keeps the picture changing with the stop without adding a
   * second set of frames to the page: a stop's own left surface is
   * sometimes one this map never shows (board-list-blocked, the assembled
   * shell), and pre-rendering six more product frames to cover them would
   * put another 300KB of markup on a route that already carries eight.
   * Every stop lights at least one record with a surface.
   */
  const frameKey =
    mode === "tour"
      ? (litNodes.map((id) => nodes.find((n) => n.id === id)?.surfaceKey).find(Boolean) ?? null)
      : (node?.surfaceKey ?? null);

  function choose(id: string) {
    setMode("explore");
    setSelected(id);
    trackCta(`map-node-${id}`);
  }

  function goto(index: number) {
    const next = Math.min(Math.max(index, 0), steps.length - 1);
    setMode("tour");
    setStep(next);
    trackCta(`map-stop-${steps[next]?.n ?? next + 1}`);
  }

  return (
    <div className="mk-map2">
      <div className="mk-map2__bar">
        <div className="mk-map2__modes" role="group" aria-label="How to read the map">
          <button
            type="button"
            className="mk-map2__mode mk-focus"
            aria-pressed={mode === "explore"}
            onClick={() => {
              setMode("explore");
              trackCta("map-mode-explore");
            }}
          >
            Explore the records
          </button>
          <button
            type="button"
            className="mk-map2__mode mk-focus"
            aria-pressed={mode === "tour"}
            onClick={() => goto(step)}
          >
            Follow Tuesday
          </button>
        </div>
        <p className="mk-caption mk-map2__hint">
          {mode === "tour"
            ? "Six stops of one day. Previous and Next, or pick a stop."
            : "Pick a record. Its connections light up, and the pane says where each one is made."}
        </p>
      </div>

      <div className="mk-map2__grid">
        {/* The stage. The SVG is the wires and nothing else.
            The field is inset from the stage's edges because a node is
            positioned by its CENTRE: at 89 percent of the width, half of a
            104px button hangs past the frame, and the four right hand
            records were clipped out of the picture entirely. */}
        <div className="mk-map2__stage">
          <div className="mk-map2__plot">
            <div className="mk-map2__field">
            <svg
              className="mk-map2__wires"
              viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              focusable="false"
            >
              {CONNECT_EDGES.map((edge) => {
                const line = edgeLine(edge);
                if (!line) return null;
                const key = edgeKey(edge);
                return (
                  <line
                    key={key}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    className="mk-map2__wire"
                    data-lit={litEdges.includes(key) ? "" : undefined}
                  />
                );
              })}
            </svg>

            {CONNECT_NODES.map((n: ConnectNode) => {
              const view = nodes.find((v) => v.id === n.id);
              if (!view) return null;
              const pos = nodePercent(n);
              const lit = litNodes.includes(n.id);
              return (
                <button
                  key={n.id}
                  type="button"
                  className="mk-map2__node mk-focus"
                  style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                  data-lit={lit ? "" : undefined}
                  aria-pressed={mode === "explore" && selected === n.id}
                  onClick={() => choose(n.id)}
                  data-cta={`map-node-${n.id}`}
                >
                  <span className="mk-map2__dot" style={{ background: view.dotHex }} aria-hidden="true" />
                  <span className="mk-map2__nodelabel">{view.label}</span>
                  <span className="mk-map2__nodeblock">{view.blockLabel}</span>
                </button>
              );
            })}
            </div>
          </div>
        </div>

        {/* The same twelve controls, for a phone.
            A twelve node graph at 390px wide is a picture nobody can use, so
            below the stage's breakpoint the stage is display:none (which
            takes its buttons out of the tab order with it) and this list is
            the map. It carries every node, the same lit state and the same
            handler, so the right pane below reads identically either way. */}
        <ul className="mk-map2__chips" aria-label="The records on the map">
          {nodes.map((view) => (
            <li key={view.id}>
              <button
                type="button"
                className="mk-map2__chip mk-focus"
                data-lit={litNodes.includes(view.id) ? "" : undefined}
                aria-pressed={mode === "explore" && selected === view.id}
                onClick={() => choose(view.id)}
              >
                <span className="mk-map2__dot" style={{ background: view.dotHex }} aria-hidden="true" />
                {view.label}
              </button>
            </li>
          ))}
        </ul>

        {/* The right pane. One live region, two readings. */}
        <div className="mk-map2__pane" aria-live="polite">
          {mode === "tour" && current ? (
            <>
              <p className="mk-mono mk-map2__clock">{current.clock}</p>
              <h3 className="mk-title mk-map2__title">{current.title}</h3>
              <p className="mk-note">{current.narration}</p>
              <p className="mk-map2__wirelabel">
                <span className="mk-label">On the wire</span> {current.wire}
              </p>
              {!current.shipped ? (
                <p className="mk-caption mk-map2__gate">
                  This stop shows a mechanism that is still in build. The sentence above is what the product does
                  today.
                </p>
              ) : null}

              <div className="mk-map2__steps">
                <button
                  type="button"
                  className="mk-map2__step mk-focus"
                  onClick={() => goto(step - 1)}
                  disabled={step === 0}
                >
                  Previous
                </button>
                <ol className="mk-map2__ticks">
                  {steps.map((s: TourStep, i) => (
                    <li key={s.n}>
                      <button
                        type="button"
                        className="mk-map2__tick mk-focus"
                        aria-current={i === step ? "step" : undefined}
                        onClick={() => goto(i)}
                      >
                        <span className="mk-map2__ticknum">{s.n}</span>
                        <span className="mk-map2__ticktime">{s.clock}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  className="mk-map2__step mk-focus"
                  onClick={() => goto(step + 1)}
                  disabled={step === steps.length - 1}
                >
                  Next
                </button>
              </div>
            </>
          ) : node ? (
            <>
              <p className="mk-eyebrow mk-map2__block">{node.blockLabel}</p>
              <h3 className="mk-title mk-map2__title">{node.label}</h3>
              <p className="mk-note">{node.what}</p>

              <p className="mk-label mk-map2__sub">Connects to</p>
              <ul className="mk-map2__edges">
                {edgesFor(node.id).map((edge) => {
                  const otherId = edgeOther(edge, node.id);
                  const other = nodes.find((n) => n.id === otherId);
                  const upcoming = edgeUpcoming(edge);
                  return (
                    <li key={edgeKey(edge)}>
                      <button type="button" className="mk-map2__edgebtn mk-focus" onClick={() => choose(otherId)}>
                        <span className="mk-map2__dot" style={{ background: other?.dotHex }} aria-hidden="true" />
                        {other?.label ?? otherId}
                      </button>
                      <span className="mk-map2__edgetext">{edge.label}</span>
                      {upcoming ? (
                        <span className="mk-map2__edgesoon">In build: {upcoming}.</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              <p className="mk-caption mk-map2__where">
                Made on {node.surfaceName}, in{" "}
                <a className="mk-focus mk-map2__link" href={node.moduleHref} data-cta={`map-module-${node.id}`}>
                  {node.moduleLabel}
                </a>
                .
              </p>
            </>
          ) : null}
        </div>
      </div>

      {/* The surface, below the map so the stage keeps its width. Every frame
          is rendered once on the server and all but one are hidden, which is
          what keeps the pane instant with no fetch and no skeleton. */}
      {frameKey ? (
        <div className="mk-map2__frame">
          {Object.entries(frames).map(([key, frame]) => (
            <div key={key} hidden={key !== frameKey}>
              {frame}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

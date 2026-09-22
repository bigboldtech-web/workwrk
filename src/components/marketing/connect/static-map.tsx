// The connection map, lit, as a picture.
//
// marketing-concept.md section 5 closes each per category compare page on
// "the connection map lit to show what the competitor leaves
// disconnected". The compare pages ended on a flat list
// of record names and a text link out to the map on another page, so the
// argument the map exists to make was never made on the page that needs to
// make it: a reader has to picture the graph from a bulleted list.
//
// This is that graph, at rest. It shares the geometry, the wires, the dots
// and the stylesheet with the explorable map on /how-it-connects, so the
// two cannot drift, and it is a SERVER component with no state and no
// controls: the compare page is making one narrow point, and the explorable
// version has its own page, linked underneath.
//
// WHAT "LIT" MEANS HERE. The records the named category's stack does NOT
// carry are lit, with the wires between them; everything else is dimmed.
// That is the point of the section, made in the picture rather than only in
// the sentence above it.
//
// ACCESSIBILITY. The stage is decoration: it is aria-hidden in full, the
// nodes are spans rather than buttons so nothing enters the tab order, and
// the list beneath it carries every record in words. A screen reader gets
// the list, which is the same content and is the better reading of it.
// Below the stage's breakpoint the picture is display:none, as on
// /how-it-connects, and the list is the whole section.

import {
  CONNECT_EDGES,
  CONNECT_NODES,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  edgeKey,
  edgeLine,
  nodePercent,
} from "./connect-graph";
import "./connect.css";

export function StaticConnectMap({
  litNodeIds,
  dotFor,
  labelFor,
  blockFor,
  caption,
}: {
  /** The records to light. Everything else is drawn dim. */
  litNodeIds: readonly string[];
  dotFor: (nodeId: string) => string;
  labelFor: (nodeId: string) => string;
  blockFor: (nodeId: string) => string;
  /** Read out under the picture, and used as its own description. */
  caption: string;
}) {
  const lit = new Set(litNodeIds);

  return (
    <figure className="mk-map2 mk-staticmap">
      <div className="mk-map2__stage" aria-hidden="true">
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
                // A wire is lit only when BOTH ends are, so the picture
                // shows the sub graph the stack leaves out rather than a
                // spray of half lit lines into records it does carry.
                const bothLit = lit.has(edge.a) && lit.has(edge.b);
                return (
                  <line
                    key={edgeKey(edge)}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    className="mk-map2__wire"
                    data-lit={bothLit ? "" : undefined}
                  />
                );
              })}
            </svg>

            {CONNECT_NODES.map((n) => {
              const pos = nodePercent(n);
              const on = lit.has(n.id);
              return (
                <span
                  key={n.id}
                  className="mk-map2__node"
                  style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                  data-lit={on ? "" : undefined}
                  data-dim={on ? undefined : ""}
                >
                  <span className="mk-map2__dot" style={{ background: dotFor(n.id) }} />
                  <span className="mk-map2__nodelabel">{labelFor(n.id)}</span>
                  <span className="mk-map2__nodeblock">{blockFor(n.id)}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <figcaption className="mk-caption mk-staticmap__cap">{caption}</figcaption>
    </figure>
  );
}

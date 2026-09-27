// The places a BULK move may offer (the placement rule's P5, node-rules):
// exactly the destinations every selected node's own move accepts, read from
// GET /api/move/destinations for each and intersected. A bulk "Move to
// Space..." picker used to list every Space the person could read plus "No
// Space", and each pick came back as a count of failures: the move rule
// (Full access on the node and where it is now, Can edit where it goes, and
// Full access that goes with it out of every Space) refused them one by one.

export interface DestinationReply {
  root: { pickable: boolean } | null;
  spaces?: Array<{ id: string; name: string; icon: string | null; color: string | null; pickable: boolean }>;
}

export interface CommonDestinations {
  /** The org root ("No Space" or "No location"): every node may go there. */
  root: boolean;
  /** The Space roots every node may go to, in the first reply's order. */
  spaces: Array<{ id: string; name: string; icon: string | null; color: string | null }>;
}

/**
 * The intersection of the move destinations of several nodes. A missing
 * reply (a node the person cannot open any more) offers nothing at all, so
 * a pick is never refused for part of the selection.
 */
export function intersectDestinations(replies: ReadonlyArray<DestinationReply | null>): CommonDestinations {
  if (replies.length === 0 || replies.some((r) => !r)) return { root: false, spaces: [] };
  const all = replies as ReadonlyArray<DestinationReply>;
  const root = all.every((r) => r.root?.pickable === true);
  const pickableIn = (r: DestinationReply, id: string) => (r.spaces ?? []).some((s) => s.id === id && s.pickable);
  const spaces = (all[0].spaces ?? [])
    .filter((s) => s.pickable && all.every((r) => pickableIn(r, s.id)))
    .map((s) => ({ id: s.id, name: s.name, icon: s.icon, color: s.color }));
  return { root, spaces };
}

/** Ask the one endpoint for each node and intersect the answers. */
export async function commonMoveDestinations(kind: "table" | "canvas" | "doc", ids: readonly string[]): Promise<CommonDestinations> {
  const replies = await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(`/api/move/destinations?kind=${kind}&id=${encodeURIComponent(id)}`, { cache: "no-store" });
        return res.ok ? ((await res.json()) as DestinationReply) : null;
      } catch {
        return null;
      }
    }),
  );
  return intersectDestinations(replies);
}

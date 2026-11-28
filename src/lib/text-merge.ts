// A three-way merge of plain text, line by line (pen test 2026-11-28, V-33).
//
// Two people editing a task's description at once: each save sent the whole
// text, so the later one silently erased the other's paragraph. The editor now
// sends the text it started from (the base) with its own (mine); the server
// merges that with what is stored now (theirs), on the locked row.
//
// The rule is the classic diff3 one. Lines that the base, mine and theirs all
// still share are anchors; between two anchors, the side that changed wins,
// and a region both changed the same way is taken once. A region both changed
// DIFFERENTLY keeps both versions, theirs first, then mine: words a person
// typed are never dropped by a merge, and two versions of a line are easy to
// see and tidy, a vanished paragraph is not.
//
// Pure module: no imports.

/** Past this many compared lines (after the shared start and end are set aside) one LCS table is not built. */
const MAX_CELLS = 4_000_000;

/** The exact LCS pairs of a[a0..a1) and b[b0..b1), appended to `out`. The caller keeps the table small. */
function lcsInto(a: readonly string[], a0: number, a1: number, b: readonly string[], b0: number, b1: number, out: Array<[number, number]>): void {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n <= 0 || m <= 0) return;
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * w + j] = a[a0 + i] === b[b0 + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[a0 + i] === b[b0 + j]) {
      out.push([a0 + i, b0 + j]);
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i += 1;
    else j += 1;
  }
}

/**
 * Too big for one table (the step 5 review: with no inner match, a long
 * middle both sides kept was written out twice). Patience anchors instead:
 * the lines that occur exactly once on each side, kept in an order both
 * sides agree on (the longest increasing run), and each gap between two
 * anchors matched exactly when it is small enough.
 */
function patienceInto(a: readonly string[], a0: number, a1: number, b: readonly string[], b0: number, b1: number, out: Array<[number, number]>): void {
  const once = (x: readonly string[], from: number, to: number) => {
    const seen = new Map<string, number>();
    for (let i = from; i < to; i += 1) seen.set(x[i], seen.has(x[i]) ? -1 : i);
    return seen;
  };
  const inA = once(a, a0, a1);
  const inB = once(b, b0, b1);
  const pairs: Array<[number, number]> = [];
  for (const [line, i] of inA) {
    const j = inB.get(line);
    if (i >= 0 && j !== undefined && j >= 0) pairs.push([i, j]);
  }
  pairs.sort((p, q) => p[0] - q[0]);
  // Longest increasing run of the b positions (patience sorting).
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k += 1) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < pairs[k][1]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const anchors: Array<[number, number]> = [];
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) anchors.push(pairs[k]);
  anchors.reverse();
  let i = a0;
  let j = b0;
  for (const [ai, bj] of [...anchors, [a1, b1] as [number, number]]) {
    if ((ai - i) * (bj - j) <= MAX_CELLS) lcsInto(a, i, ai, b, j, bj, out);
    if (ai < a1) out.push([ai, bj]);
    i = ai + 1;
    j = bj + 1;
  }
}

/** The matched line pairs [i in a, j in b] of a longest common subsequence (or patience anchors, for a huge text), in order. */
function matchedLines(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < start; i += 1) pairs.push([i, i]);
  if ((endA - start) * (endB - start) <= MAX_CELLS) lcsInto(a, start, endA, b, start, endB, pairs);
  else patienceInto(a, start, endA, b, start, endB, pairs);
  for (let k = 0; k < a.length - endA; k += 1) pairs.push([endA + k, endB + k]);
  return pairs;
}

function sameLines(x: readonly string[], y: readonly string[]): boolean {
  return x.length === y.length && x.every((line, i) => line === y[i]);
}

/**
 * `mine` and `theirs` merged over `base`: every change either side made
 * relative to the base is kept. Where both changed the same lines in
 * different ways, theirs come first and mine after.
 */
export function mergeText(base: string, mine: string, theirs: string): string {
  if (mine === theirs || theirs === base) return mine;
  if (mine === base) return theirs;
  const O = base.split("\n");
  const A = mine.split("\n");
  const B = theirs.split("\n");
  const inA = new Int32Array(O.length).fill(-1);
  const inB = new Int32Array(O.length).fill(-1);
  for (const [o, a] of matchedLines(O, A)) inA[o] = a;
  for (const [o, b] of matchedLines(O, B)) inB[o] = b;

  const out: string[] = [];
  let o = 0;
  let a = 0;
  let b = 0;
  const region = (oEnd: number, aEnd: number, bEnd: number) => {
    const oc = O.slice(o, oEnd);
    const ac = A.slice(a, aEnd);
    const bc = B.slice(b, bEnd);
    if (sameLines(ac, oc)) out.push(...bc);
    else if (sameLines(bc, oc) || sameLines(ac, bc)) out.push(...ac);
    else out.push(...bc, ...ac);
  };
  for (let j = 0; j < O.length; j += 1) {
    // An anchor: a base line both sides kept, past everything already merged.
    if (inA[j] < a || inB[j] < b) continue;
    region(j, inA[j], inB[j]);
    out.push(O[j]);
    o = j + 1;
    a = inA[j] + 1;
    b = inB[j] + 1;
  }
  region(O.length, A.length, B.length);
  return out.join("\n");
}

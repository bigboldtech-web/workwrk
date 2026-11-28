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

/** Past this many compared lines (after the shared start and end are set aside) no inner line is matched. */
const MAX_CELLS = 4_000_000;

/** The matched line pairs [i in a, j in b] of a longest common subsequence, in order. */
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
  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && n * m <= MAX_CELLS) {
    const w = m + 1;
    const dp = new Int32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i * w + j] = a[start + i] === b[start + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        pairs.push([start + i, start + j]);
        i += 1;
        j += 1;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i += 1;
      else j += 1;
    }
  }
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

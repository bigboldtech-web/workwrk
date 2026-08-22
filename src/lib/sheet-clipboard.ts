/* Clipboard + fill-series primitives for Tables (Phase 2, docs/plans/tables.md).
 *
 * Pure module: no React, no fetch, no DOM globals beyond a guarded
 * DOMParser, so the grid, the page and a plain node process can all
 * import it.
 *
 * text/html is preferred over text/plain because Excel and Google Sheets
 * both put a real <table> on the clipboard, and a spreadsheet cell may
 * legally contain tabs and newlines. In text/plain those same characters
 * ARE the delimiters, so the plain payload is only recoverable through a
 * quoting convention the source may or may not have applied.
 */

export type Matrix = string[][];

/* ------------------------------------------------------------------ parse */

/** Text inside these is a separate line when it lands in one cell. */
const BLOCK_TAGS = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"]);
/** Markup that carries no cell text, only Excel/Office scaffolding. */
const SKIP_TAGS = new Set(["style", "script", "meta", "link", "colgroup", "col", "xml", "head", "title"]);

/** Parse clipboard payloads from Excel / Google Sheets / plain text.
 *  Never throws: worst case is a 1x1 matrix holding the raw text. */
export function parseClipboard(input: { text?: string; html?: string }): Matrix {
  const html = input.html ?? "";
  if (html.trim()) {
    const fromHtml = parseHtmlTable(html);
    if (fromHtml) return fromHtml;
  }
  return parseText(input.text ?? "");
}

function parseHtmlTable(raw: string): Matrix | null {
  // Server render and node both lack DOMParser. Fall through to the text
  // payload rather than throwing, so this module stays importable anywhere.
  if (typeof DOMParser === "undefined") return null;
  let doc: Document;
  try {
    // Excel ships a stylesheet, an <xml> island, <!--StartFragment--> and
    // conditional comments around the fragment. DOMParser never executes
    // anything, but dropping the noise keeps the walk below honest about
    // what counts as cell text.
    const cleaned = raw
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(style|script|xml)\b[\s\S]*?<\/\1\s*>/gi, "");
    doc = new DOMParser().parseFromString(cleaned, "text/html");
  } catch {
    return null;
  }
  const table = doc.querySelector("table");
  if (!table) return null;
  // Rows of a table nested inside a cell belong to that cell's text, not to
  // the outer grid.
  const trs = Array.from(table.querySelectorAll("tr")).filter((tr) => tr.closest("table") === table);
  if (trs.length === 0) return null;

  const grid: string[][] = [];
  // A merged cell keeps its value in the top-left position and blanks the
  // rest of the span. Without this, every row after a rowspan would shift
  // left and paste values into the wrong columns.
  const carry = new Map<number, { text: string; lastRow: number }>();
  for (let r = 0; r < trs.length; r++) {
    const out: string[] = [];
    let c = 0;
    const drain = () => {
      for (;;) {
        const held = carry.get(c);
        if (!held || held.lastRow < r) return;
        out[c] = held.text;
        c++;
      }
    };
    drain();
    for (const el of Array.from(trs[r].children)) {
      const tag = el.tagName.toLowerCase();
      if (tag !== "td" && tag !== "th") continue;
      const text = cellText(el);
      const colspan = spanAttr(el, "colspan");
      const rowspan = spanAttr(el, "rowspan");
      for (let k = 0; k < colspan; k++) {
        const v = k === 0 ? text : "";
        out[c] = v;
        if (rowspan > 1) carry.set(c, { text: v, lastRow: r + rowspan - 1 });
        else carry.delete(c);
        c++;
      }
      drain();
    }
    grid.push(out);
  }
  // No trailing-row trim here: unlike a text payload, <tr> boundaries are
  // explicit, so an empty last row was copied on purpose.
  return normalizeMatrix(grid);
}

function spanAttr(el: Element, name: string): number {
  const n = parseInt(el.getAttribute(name) ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 1000);
}

function cellText(el: Element): string {
  let out = "";
  let pendingBreak = false;
  const emit = (s: string) => {
    if (!s) return;
    if (pendingBreak) {
      out += "\n";
      pendingBreak = false;
    }
    out += s;
  };
  const walk = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        emit(cleanTextNode(child.nodeValue ?? ""));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const child_ = child as Element;
      const tag = child_.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (tag === "br") {
        pendingBreak = false;
        out += "\n";
        continue;
      }
      const block = BLOCK_TAGS.has(tag);
      // Break on both sides: a paragraph after loose text starts its own
      // line, and consecutive breaks collapse because emit() flushes once.
      if (block && out.length > 0) pendingBreak = true;
      walk(child_);
      if (block) pendingBreak = true;
    }
  };
  walk(el);
  // &nbsp; is how Excel and Word spell "this cell is empty". A cell that is
  // nothing but nbsp must clear its target, not write a blank-looking space.
  if (out.length > 0 && !/[^\u00a0]/.test(out)) return "";
  return out.replace(/\u00a0/g, " ");
}

/** Pretty-printed markup shows up as whitespace containing a line break;
 *  genuine cell padding is spaces and tabs. Strip only the former, so "  x"
 *  survives a paste while "\n    x\n  " does not. Newlines that came from
 *  <br> are added by the caller and never pass through here. */
function cleanTextNode(s: string): string {
  if (!s) return "";
  if (!/\S/.test(s)) return /[\r\n]/.test(s) ? "" : s;
  return s.replace(/^[^\S\r\n]*[\r\n]\s*/, "").replace(/\s*[\r\n][^\S\r\n]*$/, "");
}

function parseText(raw: string): Matrix {
  if (!raw) return [[""]];
  const tsv = parseDelimited(raw, "\t");
  if (tsv.length === 1 && tsv[0].length === 1) {
    // One cell. Only trust the quoting convention when the payload is
    // exactly what toTSV would have written for that value, otherwise a
    // quotation pasted from a document silently loses its quotes.
    const core = raw.replace(/\r\n$|[\r\n]$/, "");
    return [[toTSV([[tsv[0][0]]]) === core ? tsv[0][0] : core]];
  }
  // Deliberately NO comma splitting. Excel and Sheets both paste
  // "Doe, John" into ONE cell; splitting on commas is Text-to-Columns, an
  // explicit action. Guessing it here would write into a column the user
  // never targeted, and with no undo before Phase 4 that is unrecoverable.
  return normalizeMatrix(tsv);
}

/** Quote-aware split. A double quote only opens a field at the field's very
 *  start, inner quotes are doubled, and everything inside quotes (tabs,
 *  newlines) is literal. Ragged rows are returned as-is; normalizeMatrix
 *  pads them to the widest row. */
function parseDelimited(raw: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  while (i < raw.length) {
    const ch = raw[i];
    if (quoted) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
      i++;
      continue;
    }
    if (ch === sep) {
      endCell();
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      const crlf = ch === "\r" && raw[i + 1] === "\n";
      endRow();
      i += crlf ? 2 : 1;
      continue;
    }
    cell += ch;
    i++;
  }
  endRow();
  // A trailing line terminator closes the last row, it does not add one.
  // Only a single-cell tail can be that artifact: a genuinely blank row in a
  // multi-column copy arrives as N empty cells and is kept.
  if (rows.length > 1) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop();
  }
  return rows;
}

function normalizeMatrix(rows: string[][]): Matrix {
  if (rows.length === 0) return [[""]];
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  if (w === 0) w = 1;
  return rows.map((r) => {
    const out = r.slice(0, w);
    for (let i = 0; i < w; i++) if (typeof out[i] !== "string") out[i] = "";
    return out;
  });
}

/* -------------------------------------------------------------- serialize */

/** TSV for text/plain. Quoted exactly where parseClipboard expects quotes,
 *  so a copy out of the grid and back in is lossless. No trailing newline:
 *  it would read as an extra blank row to a stricter consumer. */
export function toTSV(m: Matrix): string {
  return normalizeMatrix(m)
    .map((row) => row.map(escapeTsvCell).join("\t"))
    .join("\n");
}

function escapeTsvCell(s: string): string {
  return /["\t\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Minimal table for text/html. A newline inside a cell becomes <br>, which
 *  is what keeps it one cell on the way back in. Excel additionally wants
 *  mso-data-placement:same-cell in a stylesheet to honour that, which this
 *  deliberately does not emit: the contract here is no styling. */
export function toHTMLTable(m: Matrix): string {
  const body = normalizeMatrix(m)
    .map((row) => `<tr>${row.map((c) => `<td>${escapeHtmlCell(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><tbody>${body}</tbody></table>`;
}

function escapeHtmlCell(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r\n|[\r\n]/g, "<br>");
}

/* --------------------------------------------------------------- fill */

const NUM_RE = /^-?\d+(\.\d+)?$/;
/** "007" is a label, not the number 7: it keeps its width and increments. */
const PADDED_RE = /^-?0\d/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TAIL_RE = /^([\s\S]*?)(\d+)$/;

/** Fill-handle series.
 *
 *  `seed` is the block the user selected, in the order it appears.
 *  Returns exactly `count` NEW values that continue the series, ordered by
 *  distance from the seed: out[0] is the cell adjacent to the seed on the
 *  fill side, out[count-1] the farthest. The seed cells are never re-emitted.
 *  With `reverse` (dragging up or left) the series steps the other way and
 *  the same ordering applies, so out[0] is the cell immediately above or
 *  left of the seed.
 *
 *  fillSeries(["1","2"], 4)        -> ["3","4","5","6"]
 *  fillSeries(["1","2"], 3, true)  -> ["0","-1","-2"]
 */
export function fillSeries(seed: string[], count: number, reverse = false): string[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return [];
  if (seed.length === 0) return new Array<string>(n).fill("");
  return (
    numericSeries(seed, n, reverse) ??
    dateSeries(seed, n, reverse) ??
    textNumberSeries(seed, n, reverse) ??
    cycle(seed, n, reverse)
  );
}

/** Copy-down: repeat the seed. Filling backwards walks the seed backwards so
 *  the pattern stays continuous across the seed boundary. */
function cycle(seed: string[], n: number, reverse: boolean): string[] {
  const len = seed.length;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(seed[reverse ? len - 1 - (i % len) : i % len]);
  return out;
}

function numericSeries(seed: string[], n: number, reverse: boolean): string[] | null {
  if (!seed.every((s) => NUM_RE.test(s) && !PADDED_RE.test(s))) return null;
  // A lone number copies. That is Sheets' drag-fill behaviour: it only
  // extends an arithmetic run once the user has given it a step to read.
  if (seed.length < 2) return cycle(seed, n, reverse);
  const vals = seed.map(Number);
  const dp = Math.max(...seed.map(decimalsOf));
  const step = round(vals[1] - vals[0], dp);
  for (let i = 2; i < vals.length; i++) {
    if (round(vals[i] - vals[i - 1], dp) !== step) return null;
  }
  const base = reverse ? vals[0] : vals[vals.length - 1];
  const dir = reverse ? -1 : 1;
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(fmtNum(round(base + dir * step * i, dp), dp));
  return out;
}

function decimalsOf(s: string): number {
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** Re-round every term: base + k*step accumulates binary error, and a fill
 *  that prints 0.30000000000000004 is a bug report. */
function round(v: number, dp: number): number {
  const f = Math.pow(10, Math.min(dp, 12));
  return Math.round(v * f) / f;
}

function fmtNum(v: number, dp: number): string {
  if (!Number.isFinite(v)) return "";
  const s = v.toFixed(Math.min(dp, 12));
  return dp > 0 ? s.replace(/\.?0+$/, "") : s;
}

type Ymd = { y: number; m: number; d: number };

function dateSeries(seed: string[], n: number, reverse: boolean): string[] | null {
  const parsed = seed.map(parseIso);
  if (parsed.some((d) => d === null)) return null;
  const v = parsed as Ymd[];
  // A lone date copies, same rule as a lone number.
  if (v.length < 2) return cycle(seed, n, reverse);

  // Month stepping beats the raw day count when the seed reads as a calendar
  // sequence: the same day every month, or every seed sitting on its month
  // end (Jan 31 -> Feb 28 means month ends, not 28-day hops).
  const mStep = monthsBetween(v[0], v[1]);
  const monthly = mStep !== 0 && v.every((d, i) => i === 0 || monthsBetween(v[i - 1], d) === mStep);
  const sameDom = v.every((d) => d.d === v[0].d);
  const allEom = v.every((d) => d.d === daysInMonth(d.y, d.m));
  if (monthly && (sameDom || allEom)) {
    const monthOut = monthSeries(v, mStep, sameDom ? v[0].d : 0, n, reverse);
    if (monthOut) return monthOut;
  }

  const dStep = serial(v[1]) - serial(v[0]);
  for (let i = 2; i < v.length; i++) {
    if (serial(v[i]) - serial(v[i - 1]) !== dStep) return null;
  }
  const base = serial(reverse ? v[0] : v[v.length - 1]);
  const dir = reverse ? -1 : 1;
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const d = fromSerial(base + dir * dStep * i);
    out.push(toIso(d.y, d.m, d.d));
  }
  return out;
}

/** dom = 0 means ride the month end. Any other day is clamped to the target
 *  month, anchored on the seed's own day so Jan 31 + 1 month is Feb 28 and
 *  + 2 months is back to Mar 31, never Feb 31. */
function monthSeries(v: Ymd[], mStep: number, dom: number, n: number, reverse: boolean): string[] | null {
  const anchor = reverse ? v[0] : v[v.length - 1];
  const dir = reverse ? -1 : 1;
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const total = anchor.y * 12 + (anchor.m - 1) + dir * mStep * i;
    const y = Math.floor(total / 12);
    const m = (((total % 12) + 12) % 12) + 1;
    if (y < 1 || y > 9999) return null; // outside what YYYY-MM-DD can say
    const dim = daysInMonth(y, m);
    out.push(toIso(y, m, dom === 0 ? dim : Math.min(dom, dim)));
  }
  return out;
}

function monthsBetween(a: Ymd, b: Ymd): number {
  return (b.y - a.y) * 12 + (b.m - a.m);
}

function parseIso(s: string): Ymd | null {
  const m = ISO_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

/* setUTCFullYear rather than Date.UTC: Date.UTC maps years 0-99 into the
 * 1900s, which would silently move a date like 0050-03-01. */
function daysInMonth(y: number, m: number): number {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m, 0);
  return dt.getUTCDate();
}

function serial(v: Ymd): number {
  const dt = new Date(0);
  dt.setUTCFullYear(v.y, v.m - 1, v.d);
  return Math.round(dt.getTime() / 86400000);
}

function fromSerial(n: number): Ymd {
  const dt = new Date(n * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function toIso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function textNumberSeries(seed: string[], n: number, reverse: boolean): string[] | null {
  // A malformed date ("2026-02-30") must copy, not become "2026-02-31".
  if (seed.some((s) => ISO_RE.test(s))) return null;
  const parts = seed.map((s) => TAIL_RE.exec(s));
  if (parts.some((p) => p === null)) return null;
  const ps = parts as RegExpExecArray[];
  const prefix = ps[0][1];
  if (!ps.every((p) => p[1] === prefix)) return null;
  const digits = ps.map((p) => p[2]);
  if (digits.some((d) => d.length > 15)) return null; // past exact integers
  const vals = digits.map((d) => parseInt(d, 10));
  // Zero padding belongs to the label: "Item 007" -> "Item 008". Kept only
  // when every seed shares one width and that width is actually padded.
  const width = digits.every((d) => d.length === digits[0].length) && digits[0].startsWith("0") ? digits[0].length : 0;
  let step = 1; // a lone label DOES increment in Sheets, unlike a lone number
  if (vals.length > 1) {
    step = vals[1] - vals[0];
    for (let i = 2; i < vals.length; i++) {
      if (vals[i] - vals[i - 1] !== step) return null;
    }
  }
  const base = reverse ? vals[0] : vals[vals.length - 1];
  const dir = reverse ? -1 : 1;
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const v = base + dir * step * i;
    out.push(prefix + (v < 0 ? `-${String(-v).padStart(width, "0")}` : String(v).padStart(width, "0")));
  }
  return out;
}

// Lightweight spreadsheet formula engine for DataTable formula columns.
// Supports:
//   - arithmetic: + - * / and parentheses, unary minus
//   - relative column refs: A, B  → that column's value in the CURRENT row
//   - absolute cell refs: A1, B2  → column A/B at row N (1-based)
//   - aggregates: SUM/AVG/MIN/MAX/COUNT over a column (SUM(A) / SUM(A:A))
//     or a row range (SUM(A1:A5))
// Formula columns may reference other formula columns; cycles resolve to
// "#CYCLE". Parse errors → "#ERR", bad refs → "#REF".

export function columnLetter(index: number): string {
  let s = "";
  let i = index + 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

export interface FormulaColumn { id: string; type: string; formula?: string }
export interface FormulaRow { values: Record<string, unknown> }

const FUNCS = new Set(["SUM", "AVG", "MIN", "MAX", "COUNT"]);

type Tok = { t: "num"; v: number } | { t: "ref"; v: string } | { t: "func"; v: string } | { t: "op"; v: string } | { t: "punc"; v: string };

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) return null;
      toks.push({ t: "num", v: n });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j++;
      const word = src.slice(i, j).toUpperCase();
      // A function name is an identifier immediately followed by "(".
      let k = j;
      while (k < src.length && src[k] === " ") k++;
      if (FUNCS.has(word) && src[k] === "(") toks.push({ t: "func", v: word });
      else toks.push({ t: "ref", v: word });
      i = j;
      continue;
    }
    if ("+-*/".includes(ch)) { toks.push({ t: "op", v: ch }); i++; continue; }
    if ("(),:".includes(ch)) { toks.push({ t: "punc", v: ch }); i++; continue; }
    return null; // unknown char
  }
  return toks;
}

export function makeFormulaEngine(columns: FormulaColumn[], rows: FormulaRow[]) {
  const letterToIndex = new Map<string, number>();
  columns.forEach((c, idx) => letterToIndex.set(columnLetter(idx), idx));
  const cache = new Map<string, number | string>();

  function rawCell(colIndex: number, rowIndex: number, stack: Set<string>): number | string {
    const col = columns[colIndex];
    const row = rows[rowIndex];
    if (!col || !row) return "#REF";
    if (col.type === "formula") {
      const key = `${colIndex}:${rowIndex}`;
      if (cache.has(key)) return cache.get(key)!;
      if (stack.has(key)) return "#CYCLE";
      stack.add(key);
      const out = run(col.formula ?? "", rowIndex, stack);
      stack.delete(key);
      cache.set(key, out);
      return out;
    }
    const v = row.values[col.id];
    if (v == null || v === "") return "";
    return typeof v === "number" ? v : String(v);
  }

  function num(v: number | string): number {
    if (typeof v === "number") return v;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  // Parse a column letter (with optional row digits) into [colIndex, rowIndex|null].
  function parseRef(ref: string): { col: number; row: number | null } | null {
    const m = /^([A-Z]+)([0-9]+)?$/.exec(ref);
    if (!m) return null;
    const col = letterToIndex.get(m[1]);
    if (col === undefined) return null;
    return { col, row: m[2] ? parseInt(m[2], 10) - 1 : null };
  }

  // Collect numeric cell values for an aggregate argument (a column letter,
  // "A:A", or "A1:A5"). Returns the list of numbers (non-numeric skipped).
  function aggregateValues(arg: string, stack: Set<string>): number[] {
    const [a, b] = arg.split(":");
    const refA = parseRef(a);
    if (!refA) return [];
    const col = refA.col;
    let lo = 0;
    let hi = rows.length - 1;
    if (b !== undefined) {
      const refB = parseRef(b);
      if (refA.row != null && refB?.row != null) { lo = refA.row; hi = refB.row; }
    } else if (refA.row != null) {
      lo = hi = refA.row;
    }
    const out: number[] = [];
    for (let r = Math.max(0, lo); r <= Math.min(rows.length - 1, hi); r++) {
      const v = rawCell(col, r, stack);
      if (v === "") continue;
      const n = typeof v === "number" ? v : parseFloat(v);
      if (Number.isFinite(n)) out.push(n);
      else if (typeof v === "string" && v.startsWith("#")) { /* propagate? skip */ }
    }
    return out;
  }

  // Recursive-descent evaluator over tokens, scoped to a row.
  function run(formula: string, rowIndex: number, stack: Set<string>): number | string {
    const body = formula.trim().replace(/^=/, "");
    if (!body) return "";
    const toks = tokenize(body);
    if (!toks) return "#ERR";
    let pos = 0;
    const peek = () => toks[pos];
    const eat = () => toks[pos++];

    function parseExpr(): number {
      let v = parseTerm();
      for (;;) {
        const t = peek();
        if (t && t.t === "op" && (t.v === "+" || t.v === "-")) { eat(); const r = parseTerm(); v = t.v === "+" ? v + r : v - r; }
        else break;
      }
      return v;
    }
    function parseTerm(): number {
      let v = parseFactor();
      for (;;) {
        const t = peek();
        if (t && t.t === "op" && (t.v === "*" || t.v === "/")) { eat(); const r = parseFactor(); v = t.v === "*" ? v * r : (r === 0 ? NaN : v / r); }
        else break;
      }
      return v;
    }
    function parseFactor(): number {
      const t = peek();
      if (!t) throw new Error("eof");
      if (t.t === "op" && t.v === "-") { eat(); return -parseFactor(); }
      if (t.t === "op" && t.v === "+") { eat(); return parseFactor(); }
      if (t.t === "num") { eat(); return t.v; }
      if (t.t === "punc" && t.v === "(") { eat(); const v = parseExpr(); const c = eat(); if (!c || c.t !== "punc" || c.v !== ")") throw new Error("paren"); return v; }
      if (t.t === "func") {
        eat();
        const open = eat(); if (!open || open.v !== "(") throw new Error("func");
        // Read the raw argument text until the matching ")".
        let arg = "";
        for (;;) {
          const a = eat();
          if (!a) throw new Error("func-eof");
          if (a.t === "punc" && a.v === ")") break;
          arg += a.t === "num" ? String(a.v) : a.v;
        }
        const nums = aggregateValues(arg, stack);
        switch (t.v) {
          case "SUM": return nums.reduce((s, n) => s + n, 0);
          case "AVG": return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
          case "MIN": return nums.length ? Math.min(...nums) : 0;
          case "MAX": return nums.length ? Math.max(...nums) : 0;
          case "COUNT": return nums.length;
          default: throw new Error("fn");
        }
      }
      if (t.t === "ref") {
        eat();
        const ref = parseRef(t.v);
        if (!ref) throw new Error("ref");
        const cv = rawCell(ref.col, ref.row ?? rowIndex, stack);
        if (typeof cv === "string" && cv.startsWith("#")) throw new Error(cv);
        return num(cv);
      }
      throw new Error("unexpected");
    }

    try {
      const v = parseExpr();
      if (pos !== toks.length) return "#ERR";
      if (!Number.isFinite(v)) return "#ERR";
      // Trim float noise.
      return Math.round(v * 1e10) / 1e10;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      return msg.startsWith("#") ? msg : "#ERR";
    }
  }

  return {
    /** Computed display value for a cell at (colIndex, rowIndex). */
    cellValue(colIndex: number, rowIndex: number): number | string {
      return rawCell(colIndex, rowIndex, new Set());
    },
  };
}

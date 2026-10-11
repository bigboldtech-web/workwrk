// The one script that reads a page for a teammate
// (docs/plans/ai-teammates-phase4.md Decision 17), run by cdp-driver.ts in
// an ISOLATED WORLD of the main frame (Page.createIsolatedWorld "wk-reader"):
// its own globals and DOM prototypes, which the page's scripts cannot see or
// replace. Exported as a string, never as a function of this module, so no
// bundler or test instrument can put a reference to anything outside it into
// the code the browser runs.
//
// WHAT IT KEEPS: text a person sees, read from the browser's own rendering.
// DROPPED: elements not rendered, display none, visibility hidden, aria-hidden,
// transparent (opacity under 0.05, a colour with no alpha), tiny (text under
// 6px high, a clipping box under 6px), clipped (clip, clip-path, scale 0) or
// off the page, closed <details>, title attributes (never read), <noscript>,
// <template>, scripts, styles, frames, SVG titles and descriptions, and,
// toward the safer side, text the same colour as what is behind it (white on
// white) and the text of editable regions (what a person typed in them is a
// field's value; the region is listed as a field instead).
//
// Review of Phase 4 step 2, text a person cannot see that the reader kept:
//   CLIPPED BY AN ANCESTOR: each ancestor on the text's containing block
//     chain whose overflow is not visible (or that contains paint), and
//     every ancestor with a clip-path, is a box the text must meet. A
//     container a person can scroll (overflow auto or scroll) reaches all it
//     holds: its box is its whole scroll area, and above it the text counts
//     as anywhere in its window. The root and the body pass their overflow
//     to the page, which a person scrolls.
//   A CLIP-PATH INSET whose opposite sides add up to the whole box or more
//     (inset(100%), inset(0 0 100%), a calc() of them) hides the element;
//     one whose values cannot be read hides it too. A clip rect under 6px.
//   COVERED: the point at the centre of the text's first line, when it shows
//     in the window and in every scroll box's window around it, is
//     hit-tested once (elementFromPoint, through open
//     shadow roots). Text whose point lands on an element that neither
//     contains it nor is inside it, and that paints over it there (a solid
//     background at three quarters or more, a background image, a picture,
//     a frame, an SVG, a blur, an inset shadow, a thick solid border, the
//     same through its ::before or ::after), is dropped. Kept: a transparent
//     layer (a click catcher, a stretched link), the field a floating label
//     names, and a bar fixed to the window when the text scrolls under it
//     and the page scrolls (a person scrolls it into view). Text that takes
//     no pointer is compared by how the page paints instead, since the hit
//     test passes through it. At most 3,000 points a read; past them, text
//     in the window is dropped.
//   SAME COLOUR AS BEHIND IT: a background image is unknown, so the nearest
//     solid colour beneath it decides (white text on a white gradient over a
//     white page is dropped; so is white text over a photo with no colour of
//     its own beneath it). The ink is the text fill colour when one is set.
// Known limits, said here: an overlay that takes no pointer, an outline, and
// text covered outside the window are not seen by the hit test.
//
// Review round 1 of Phase 4, words a control carried past those rules:
//   A LIST'S OPTIONS are listed only when the list shows (its box 6px or
//     more each way, on the page, not clipped away, not covered at its
//     centre), and then only the options that render (never one hidden, set
//     to display none, or in a hidden group).
//   A BUTTON'S VALUE AND A PLACEHOLDER name a control only where a person
//     sees them: the box 6px or more each way, the ink not the colour behind
//     it, the font 6px or more, not covered (controlShows).
//   A LABEL OR AN ARIA-LABELLEDBY TARGET is read only when it and every box
//     above it show (hiddenUp, as the walk reads text), so one set to
//     opacity 0 or visibility hidden names nothing.
//   A CONTROL IS NAMED BY ITS OWN WORDS FIRST: a button by the words it
//     shows, a field by its visible label, and aria-labelledby or aria-label
//     only where it shows none. The words it is also called by, where they
//     differ, go to the driver as `alsoNamed` (every word, seen or not, as a
//     field's kind hints are), for a click's warnings only: never its name,
//     the model's read or a card.
//
// Alt text only as
// the name of an image button with no other words, at most 60 characters:
// never a link's (step 2, toward the safer side than Decision 17's "image
// link or button": a link's address already says where it goes, and alt
// words nobody sees were the planted page's channel in the stand-in's
// self-test). aria-label only as the name of a control with no visible
// words.
//
// FIELD VALUES NEVER LEAVE THE BROWSER. The script returns no character of a
// field's value: it asks a text field only whether it is empty (its length,
// for `filled`), a box whether it is ticked, a list whether a choice past its
// first is made. A submit button's label is its value attribute, which is a
// label, never typed text.
//
// A FIELD'S KIND HINTS read every word of its labels, seen or not (review of
// Phase 4 step 2): the driver turns them into a kind and drops them, and
// more words only ever make a field more sensitive, so a label hidden from
// sight (or covered, or white on a photo) still says "Verification code".
// The field's name stays the words a person sees.
//
// WHICH TWIN (review of Phase 4 step 3): each control carries a context
// anchor, a short hash of the words a person sees in its nearest row or list
// item, else its nearest block, read by the styles alone (never the hit
// test, so a scroll cannot change it) and never an editable region's words.
// Only the hash leaves the browser. The driver adds how many twins a control
// has and its index, and an act needs all three unchanged.
//
// MODES (the first argument; the second is a JSON object):
//   read       the page: url, title, contentType, text blocks, the main
//              frame's controls (with the hints classes.ts fieldKindOf reads,
//              which the driver turns into a kind and drops) and its links
//   find       {text}: where the words appear, with the nearest control
//   locate     {i, tag, name, anchor}: control i, scrolled into view, and
//              whether the point at its centre is it (or inside it) or covered
//   focus      {i, tag, name, anchor, replace}: control i focused; with
//              replace, what it holds selected, so typed words take its place
//              (review of Phase 4 step 3: they were added to it)
//   select     {i, tag, name, anchor, index, label}: the option at index
//              chosen, only while its label there is still label (review of
//              Phase 4 step 3), input and change sent, as a person's choice
//              sends them
//   options    {i, tag, name, anchor}: the list's options, at most 1,000, each
//              its label and whether it can be chosen, and how many it has,
//              for matching a choice only (review of Phase 4 step 3)
//   scroll     {dir, screens}: the page scrolled; whether it reached the end
//   box        {i, tag, name, anchor}: control i's box on the page, for a picture
// Controls are numbered in one walk of the flat tree (open shadow roots and
// their slots included), the same in every mode, so an index read by `read`
// names the same control for `locate` while the page is unchanged; the tag,
// name and anchor passed back are checked again.
//
// Pure: a string.

export const READER_WORLD = "wk-reader";

export const READER_SOURCE = String.raw`(function (mode, arg) {
  "use strict";
  var doc = document, win = window;
  var MAX_NODES = 60000, MAX_ELEMENTS = 400, MAX_LINKS = 400, MAX_TEXT = 120000, MAX_NAME = 300, MAX_ALT = 60, MAX_OPTIONS = 60, MAX_OPTION = 200, MAX_FIND = 20;
  // Review of Phase 4 step 3: a choice is matched against at most 1,000 of a
  // list's options, each label kept to 500 characters (types.ts
  // OPTIONS_MATCH_MAX, OPTION_LABEL_MAX); an anchor reads at most 500
  // characters, 40 boxes up; options are counted up to 20,000 one by one.
  var MAX_MATCH = 1000, MAX_LABEL = 500, ANCHOR_CHARS = 500, ANCHOR_UP = 40, COUNT_OPTIONS = 20000;
  var SVG = "http://www.w3.org/2000/svg";
  var root = doc.documentElement;
  var contentType = String(doc.contentType || "");
  var html = /^(text\/html|application\/xhtml\+xml)/i.test(contentType);
  var empty = { url: String(location.href), title: "", contentType: contentType, blocks: [], elements: [], links: [] };
  if (!root || !html) {
    if (mode === "read") return empty;
    if (mode === "find") return { matches: [] };
    return { ok: false, code: "not_found" };
  }
  var sx = win.scrollX || 0, sy = win.scrollY || 0;
  var body = doc.body;
  var docW = Math.max(root.scrollWidth || 0, root.clientWidth || 0, body ? body.scrollWidth || 0 : 0, win.innerWidth || 0);
  var docH = Math.max(root.scrollHeight || 0, root.clientHeight || 0, body ? body.scrollHeight || 0 : 0, win.innerHeight || 0);

  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, TITLE: 1, META: 1, LINK: 1, BASE: 1, IFRAME: 1, FRAME: 1, FRAMESET: 1, OBJECT: 1, EMBED: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, OPTGROUP: 1, DATALIST: 1, INPUT: 1, MAP: 1 };
  var ROLES = { button: 1, link: 1, checkbox: 1, radio: 1, tab: 1, menuitem: 1, menuitemcheckbox: 1, menuitemradio: 1, option: 1, "switch": 1, combobox: 1, textbox: 1, searchbox: 1, slider: 1, spinbutton: 1, listbox: 1, treeitem: 1 };
  var BUTTON_TYPES = { submit: 1, button: 1, reset: 1, image: 1 };

  var styles = new Map();
  function styleOf(el) {
    var s = styles.get(el);
    if (!s) { s = win.getComputedStyle(el); styles.set(el, s); }
    return s;
  }
  function rgba(c) {
    var m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,\/]+([\d.]+%?))?\s*\)/.exec(String(c || ""));
    if (!m) return null;
    var a = m[4] === undefined ? 1 : (m[4].slice(-1) === "%" ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), a];
  }
  function offPage(r) {
    if (r.width <= 0 && r.height <= 0) return false;
    return r.right + sx <= 0 || r.bottom + sy <= 0 || r.left + sx >= docW || r.top + sy >= docH;
  }

  // ── What clips, covers or hides text (review of Phase 4 step 2; the header) ──
  var vw = win.innerWidth || 0, vh = win.innerHeight || 0;
  var NUM = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";
  var LENGTH = new RegExp("^" + NUM + "(px|%)$", "i");
  var TERM = new RegExp("^" + NUM + "(px|%)\\s*", "i");
  // One computed inset() length, px and % (a calc() of them added and taken
  // away included), or null when it is anything else.
  function lengthOf(v) {
    v = String(v).trim();
    if (v === "0") return { pct: 0, px: 0 };
    var m = LENGTH.exec(v);
    if (m) return m[2] === "%" ? { pct: parseFloat(m[1]), px: 0 } : { pct: 0, px: parseFloat(m[1]) };
    m = /^calc\((.*)\)$/i.exec(v);
    if (!m) return null;
    var s = m[1].trim(), out = { pct: 0, px: 0 }, sign = 1, guard = 0;
    while (s.length && guard++ < 20) {
      var t = TERM.exec(s);
      if (!t) return null;
      if (t[2] === "%") out.pct += sign * parseFloat(t[1]); else out.px += sign * parseFloat(t[1]);
      s = s.slice(t[0].length);
      if (!s.length) break;
      var op = /^([+-])\s+/.exec(s);
      if (!op) return null;
      sign = op[1] === "-" ? -1 : 1;
      s = s.slice(op[0].length);
    }
    return s.length ? null : out;
  }
  // A clip-path's inset() as its four sides [top, right, bottom, left], null
  // when it has none, "unknown" when a value cannot be read.
  function insetOf(cp) {
    var at = cp.indexOf("inset(");
    if (at < 0) return null;
    var i = at + 6, depth = 1, start = i;
    for (; i < cp.length && depth > 0; i++) {
      var ch = cp.charAt(i);
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    if (depth !== 0) return "unknown";
    var inner = cp.slice(start, i - 1);
    var r = inner.search(/\sround\s/);
    if (r >= 0) inner = inner.slice(0, r);
    var parts = [], cur = "", d = 0;
    for (var k = 0; k < inner.length; k++) {
      var c = inner.charAt(k);
      if (c === "(") d++;
      else if (c === ")") d--;
      if (/\s/.test(c) && d === 0) {
        if (cur) parts.push(cur);
        cur = "";
      } else cur += c;
    }
    if (cur) parts.push(cur);
    if (parts.length < 1 || parts.length > 4) return "unknown";
    var v = [];
    for (var q = 0; q < parts.length; q++) {
      var l = lengthOf(parts[q]);
      if (!l) return "unknown";
      v.push(l);
    }
    var top = v[0], right = v[1] || top, bottom = v[2] || top, left = v[3] || right;
    return [top, right, bottom, left];
  }
  function sideOf(x, size) {
    return (x.pct * size) / 100 + x.px;
  }
  // An inset whose opposite sides add up to the whole box or more hides it all.
  function insetHides(el, cp) {
    var ins = insetOf(cp);
    if (ins === null) return false;
    if (ins === "unknown") return true;
    var r = el.getBoundingClientRect();
    if (ins[0].pct + ins[2].pct >= 100 || ins[1].pct + ins[3].pct >= 100) return true;
    return sideOf(ins[0], r.height) + sideOf(ins[2], r.height) >= r.height || sideOf(ins[1], r.width) + sideOf(ins[3], r.width) >= r.width;
  }
  // A clip rect (absolute and fixed boxes only) under 6px either way.
  function rectClipHides(cs) {
    if (cs.position !== "absolute" && cs.position !== "fixed") return false;
    var m = /rect\(\s*(-?[\d.]+)px[ ,]+(-?[\d.]+)px[ ,]+(-?[\d.]+)px[ ,]+(-?[\d.]+)px\s*\)/.exec(cs.clip || "");
    if (!m) return false;
    return parseFloat(m[2]) - parseFloat(m[4]) < 6 || parseFloat(m[3]) - parseFloat(m[1]) < 6;
  }
  // The flat tree's parent: the slot a node is shown in, else its parent, else its shadow host.
  function up(e) {
    return e.assignedSlot || e.parentElement || (e.getRootNode && e.getRootNode().host) || null;
  }
  // Whether this box is the containing block of absolute and fixed boxes inside it, and a stacking context.
  function makesCB(cs) {
    return (cs.transform && cs.transform !== "none") || (cs.translate && cs.translate !== "none") || (cs.rotate && cs.rotate !== "none") || (cs.scale && cs.scale !== "none") ||
      (cs.perspective && cs.perspective !== "none") || (cs.filter && cs.filter !== "none") || (cs.backdropFilter && cs.backdropFilter !== "none") ||
      /paint|layout|strict|content/.test(cs.contain || "") || /transform|perspective|filter/.test(cs.willChange || "") || /size/.test(cs.containerType || "");
  }
  function scrolls(v) {
    return v === "auto" || v === "scroll";
  }
  var rootCs = styleOf(root);
  var rootVisible = rootCs.overflowX === "visible" && rootCs.overflowY === "visible";
  function clipsContent(el, cs) {
    // The root's and (while the root's is visible) the body's overflow is the page's, which a person scrolls.
    if (el === root || (el === body && rootVisible)) return false;
    if (cs.display === "inline" || cs.display === "contents") return false;
    return cs.overflowX !== "visible" || cs.overflowY !== "visible" || /paint|strict|content/.test(cs.contain || "");
  }
  // One axis of a scroll container: all it holds, from whichever edge it scrolls from.
  function span(box, a, b, start, size, pos, full, reversed, either) {
    var n0 = start - pos, n1 = n0 + full;
    var r1 = start + size - pos, r0 = r1 - full;
    if (either) {
      box[a] = Math.min(n0, r0);
      box[b] = Math.max(n1, r1);
    } else if (reversed) {
      box[a] = r0;
      box[b] = r1;
    } else {
      box[a] = n0;
      box[b] = n1;
    }
  }
  // An overflow box: the padding box, or along an axis a person can scroll, the whole scroll area.
  function overflowNode(el, cs, next) {
    var r = el.getBoundingClientRect();
    var x0 = r.left + (parseFloat(cs.borderLeftWidth) || 0), y0 = r.top + (parseFloat(cs.borderTopWidth) || 0);
    var w = el.clientWidth, h = el.clientHeight;
    var pad = { left: x0, top: y0, right: x0 + w, bottom: y0 + h };
    var box = { left: x0, top: y0, right: x0 + w, bottom: y0 + h };
    var flex = /flex/.test(cs.display);
    var either = !!cs.writingMode && cs.writingMode !== "horizontal-tb";
    var revX = (cs.direction === "rtl") !== (flex && cs.flexDirection === "row-reverse");
    var revY = flex && cs.flexDirection === "column-reverse";
    var sxOn = scrolls(cs.overflowX), syOn = scrolls(cs.overflowY);
    if (sxOn) span(box, "left", "right", x0, w, el.scrollLeft, el.scrollWidth, revX, either);
    if (syOn) span(box, "top", "bottom", y0, h, el.scrollTop, el.scrollHeight, revY, either);
    return { box: box, pad: pad, sx: sxOn, sy: syOn, next: next };
  }
  // A clip-path's region: an inset() shrinks the border box; any other shape is taken as the border box.
  function clipPathNode(el, cs, next) {
    var r = el.getBoundingClientRect();
    var box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    var ins = insetOf(String(cs.clipPath));
    if (ins && ins !== "unknown") {
      box.top += sideOf(ins[0], r.height);
      box.right -= sideOf(ins[1], r.width);
      box.bottom -= sideOf(ins[2], r.height);
      box.left += sideOf(ins[3], r.width);
    }
    return { box: box, pad: null, sx: false, sy: false, next: next };
  }
  // The boxes that clip an element's content, as a list from it up: each
  // overflow on its containing block chain (need 0: every ancestor; 1, past
  // an absolute box: positioned ones and containing blocks; 2, past a fixed
  // box: containing blocks only), and every clip-path, whatever its place.
  var chains = [new Map(), new Map(), new Map()];
  function clipChain(el, need, depth) {
    if (!el || el.nodeType !== 1 || depth > 400) return null;
    var memo = chains[need];
    if (memo.has(el)) return memo.get(el);
    var cs = styleOf(el);
    var pos = cs.position;
    var inChain = need === 0 || (need === 1 && (pos !== "static" || makesCB(cs))) || (need === 2 && makesCB(cs));
    var next = inChain ? (pos === "fixed" ? 2 : pos === "absolute" ? 1 : 0) : need;
    var out = clipChain(up(el), next, depth + 1);
    if (inChain && clipsContent(el, cs)) out = overflowNode(el, cs, out);
    if (cs.clipPath && cs.clipPath !== "none") out = clipPathNode(el, cs, out);
    memo.set(el, out);
    return out;
  }
  function meets(a, b) {
    return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
  }
  // Whether a box of text lies wholly outside a box that clips it; past a
  // scroll container, the text may be anywhere in that container's window.
  function clippedAway(p, b) {
    var t = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    for (var n = clipChain(p, 0, 0); n; n = n.next) {
      if (!meets(t, n.box)) return true;
      if (n.sx) {
        t.left = n.pad.left;
        t.right = n.pad.right;
      }
      if (n.sy) {
        t.top = n.pad.top;
        t.bottom = n.pad.bottom;
      }
    }
    return false;
  }

  // Whether a point shows now inside every box that clips the text: a scroll
  // box's window, an overflow box, a clip-path. Text scrolled out of a
  // scroll box's window is reachable, and no hit test can see it there.
  function inClips(p, x, y) {
    for (var n = clipChain(p, 0, 0); n; n = n.next) {
      var c = n.pad || n.box;
      if (x < c.left || x >= c.right || y < c.top || y >= c.bottom) return false;
    }
    return true;
  }

  var COVER_ALPHA = 0.75, MAX_HITS = 3000, hits = 0;
  var REPLACED = { IMG: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1, FRAME: 1, EMBED: 1, OBJECT: 1, PICTURE: 1 };
  // Whether one box, or its ::before or ::after, paints something solid at
  // (x, y), at the opacity it is shown at.
  function paints(e, alpha, x, y) {
    if (REPLACED[e.tagName] || e.namespaceURI === SVG) return alpha >= COVER_ALPHA;
    var cs = styleOf(e);
    var bg = rgba(cs.backgroundColor);
    if (bg && bg[3] * alpha >= COVER_ALPHA) return true;
    if (alpha >= COVER_ALPHA) {
      if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
      if (cs.backdropFilter && cs.backdropFilter !== "none") return true;
      if (/inset/.test(cs.boxShadow || "")) return true;
      var r = e.getBoundingClientRect();
      var sides = [["Top", y < r.top + (parseFloat(cs.borderTopWidth) || 0)], ["Bottom", y > r.bottom - (parseFloat(cs.borderBottomWidth) || 0)], ["Left", x < r.left + (parseFloat(cs.borderLeftWidth) || 0)], ["Right", x > r.right - (parseFloat(cs.borderRightWidth) || 0)]];
      for (var s = 0; s < sides.length; s++) {
        if (!sides[s][1]) continue;
        var style = cs["border" + sides[s][0] + "Style"];
        var bc = rgba(cs["border" + sides[s][0] + "Color"]);
        if (style && style !== "none" && style !== "hidden" && bc && bc[3] >= COVER_ALPHA) return true;
      }
    }
    var pseudo = ["::before", "::after"];
    for (var k = 0; k < pseudo.length; k++) {
      var ps = win.getComputedStyle(e, pseudo[k]);
      if (!ps || !ps.content || ps.content === "none" || ps.content === "normal" || ps.display === "none") continue;
      var pa = alpha * (parseFloat(ps.opacity) || 0);
      var pbg = rgba(ps.backgroundColor);
      if (pbg && pbg[3] * pa >= COVER_ALPHA) return true;
      if (pa >= COVER_ALPHA && ((ps.backgroundImage && ps.backgroundImage !== "none") || /url\(/.test(ps.content) || (ps.backdropFilter && ps.backdropFilter !== "none"))) return true;
    }
    return false;
  }
  // The nearest box holding both, in the flat tree.
  function commonOf(h, p) {
    var mine = new Set();
    for (var e = p, g = 0; e && g < 500; e = up(e), g++) mine.add(e);
    for (var f = h, g2 = 0; f && g2 < 500; f = up(f), g2++) if (mine.has(f)) return f;
    return null;
  }
  // A box's branch below the common box a: whether it is lifted (positioned,
  // or a stacking context), at what z-index, whether fixed to the window or
  // stuck, and its top box.
  function branchOf(n, a) {
    var out = { lifted: false, z: 0, fixed: null, top: n };
    for (var e = n, g = 0; e && e !== a && g < 200; e = up(e), g++) {
      var cs = styleOf(e);
      if (cs.position !== "static" || makesCB(cs) || parseFloat(cs.opacity) < 1 || cs.isolation === "isolate" || (cs.mixBlendMode && cs.mixBlendMode !== "normal")) {
        out.lifted = true;
        var zi = parseInt(cs.zIndex, 10);
        out.z = isNaN(zi) ? 0 : zi;
      }
      if (cs.position === "fixed" || cs.position === "sticky") out.fixed = e;
      out.top = e;
    }
    return out;
  }
  function follows(x, y) {
    try { return !!(y.compareDocumentPosition(x) & 4); } catch (e) { return false; }
  }
  // Whether the cover's branch paints above the text's, roughly as CSS
  // paints one stacking context: lifted boxes over boxes in the flow, then
  // by z-index, then later over earlier; in the flow, only a later picture
  // paints over text (backgrounds of blocks paint beneath it).
  function above(bh, bp, h) {
    if (bh.lifted !== bp.lifted) return bh.lifted;
    if (!bh.lifted) return !!REPLACED[h.tagName] && follows(bh.top, bp.top);
    if (bh.z !== bp.z) return bh.z > bp.z;
    return follows(bh.top, bp.top);
  }
  function labelOf(h, p) {
    var ls = h.labels;
    if (!ls) return false;
    for (var i = 0; i < ls.length && i < 5; i++) if (contains(ls[i], p)) return true;
    return false;
  }
  // Whether the point at the centre of the text's first line shows something else on top of it.
  function covered(p, r) {
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    // Outside the window, or scrolled out of a scroll box's, no hit test can see it: read as it stands.
    if (!(x >= 0 && y >= 0 && x < vw && y < vh)) return false;
    if (!inClips(p, x, y)) return false;
    if (++hits > MAX_HITS) return true;
    var h = deepHit(x, y);
    if (!h || h.nodeType !== 1) return false;
    if (contains(p, h) || contains(h, p) || labelOf(h, p)) return false;
    var a = commonOf(h, p);
    var bh = branchOf(h, a), bp = branchOf(p, a);
    // Text that takes no pointer: the hit test passed through it, so the page's paint order decides.
    if (styleOf(p).pointerEvents === "none" && !above(bh, bp, h)) return false;
    // A bar fixed to the window over text that scrolls under it, on a page that scrolls.
    if (bh.fixed && !bp.fixed && docH > vh + 1) {
      var fr = bh.fixed.getBoundingClientRect();
      if (fr.height < vh * 0.8) return false;
    }
    // Does the cover paint there? Its boxes up to the common box, each at the opacity it is shown at.
    var path = [];
    for (var e = h, g = 0; e && e !== a && g < 50; e = up(e), g++) path.push(e);
    var alpha = 1;
    var shown = [];
    for (var j = path.length - 1; j >= 0; j--) {
      alpha *= parseFloat(styleOf(path[j]).opacity);
      shown[j] = alpha;
    }
    for (var k = 0; k < path.length; k++) if (shown[k] >= 0.05 && paints(path[k], shown[k], x, y)) return true;
    return false;
  }
  var hiddenCache = new Map();
  // Whether this element's whole subtree is left out (see the file header).
  function hiddenEl(el) {
    if (hiddenCache.has(el)) return hiddenCache.get(el);
    var out = hiddenElNow(el);
    hiddenCache.set(el, out);
    return out;
  }
  function hiddenElNow(el) {
    var tag = el.tagName;
    if (SKIP[tag] && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return true;
    if (el.namespaceURI === SVG && (el.localName === "title" || el.localName === "desc")) return true;
    if (el.getAttribute("aria-hidden") === "true") return true;
    var cs = styleOf(el);
    if (cs.display === "none") return true;
    if (cs.visibility === "hidden" || cs.visibility === "collapse") return true;
    if (cs.display !== "contents") {
      if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return true;
    }
    if (parseFloat(cs.opacity) < 0.05) return true;
    if (/rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)/.test(cs.clip || "")) return true;
    if (rectClipHides(cs)) return true;
    var cp = String(cs.clipPath || "");
    if (/circle\(\s*0(px|%)?\s*[ )]/.test(cp) || /polygon\(\s*0(px)?\s+0(px)?\s*,\s*0(px)?\s+0(px)?\s*,\s*0(px)?\s+0(px)?\s*\)/.test(cp)) return true;
    if (insetHides(el, cp)) return true;
    if (/^matrix\(\s*0(\.0+)?\s*,\s*0(\.0+)?\s*,\s*0(\.0+)?\s*,\s*0(\.0+)?\s*,/.test(cs.transform || "")) return true;
    if (cs.display === "contents") return false;
    var r = el.getBoundingClientRect();
    if (offPage(r)) return true;
    var clips = cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible";
    if (clips && (r.width < 6 || r.height < 6)) return true;
    return false;
  }
  function closedDetails(el) {
    // Content of a closed <details> other than its summary is not rendered.
    var p = el.parentElement;
    return !!(p && p.tagName === "DETAILS" && !p.open && el.tagName !== "SUMMARY");
  }
  // Whether an element, or any box above it up to the body, is left out
  // (review round 1 of Phase 4): the walk never reads below a box it drops,
  // and a label or an aria-labelledby target is read from wherever it is.
  var upCache = new Map();
  function hiddenUp(el) {
    var chain = [], out = false;
    for (var e = el, g = 0; e && e.nodeType === 1 && e !== root && g < 400; e = up(e), g++) {
      if (upCache.has(e)) { out = upCache.get(e); break; }
      chain.push(e);
      if (hiddenEl(e) || closedDetails(e)) { out = true; break; }
      if (e === body) break;
    }
    for (var c = 0; c < chain.length; c++) upCache.set(chain[c], out);
    return out;
  }
  function editable(el) {
    return !!el.isContentEditable;
  }
  // The nearest solid colour beneath an element. A background image is
  // unknown, so the colour beneath it decides (review of Phase 4 step 2).
  function bgOf(el) {
    var e = el;
    while (e && e.nodeType === 1) {
      var c = rgba(styleOf(e).backgroundColor);
      if (c && c[3] >= 0.9) return c;
      e = e.parentElement || (e.getRootNode && e.getRootNode().host) || null;
    }
    return [255, 255, 255, 1];
  }
  var range = doc.createRange();
  // Whether a text node's words are seen (see the file header).
  function textSeen(node) {
    var p = node.parentElement;
    if (!p) return false;
    var cs = styleOf(p);
    if (parseFloat(cs.fontSize) < 6) return false;
    var c = rgba(cs.color);
    if (c && c[3] < 0.1) return false;
    var fill = rgba(cs.webkitTextFillColor);
    if (fill && fill[3] < 0.1) return false;
    // The ink: the fill colour when one is set, which paints over the colour.
    var ink = fill || c;
    if (ink) {
      var bg = bgOf(p);
      if (Math.abs(ink[0] - bg[0]) + Math.abs(ink[1] - bg[1]) + Math.abs(ink[2] - bg[2]) < 30) return false;
    }
    range.selectNodeContents(node);
    var rects = range.getClientRects();
    if (!rects || rects.length === 0) return false;
    var b = range.getBoundingClientRect();
    if (b.height < 6 || b.width < 1) return false;
    if (offPage(b)) return false;
    if (clippedAway(p, b)) return false;
    if (covered(p, rects[0])) return false;
    return true;
  }
  function kids(node) {
    if (node.nodeType === 1) {
      if (node.shadowRoot) return node.shadowRoot.childNodes;
      if (node.localName === "slot" && typeof node.assignedNodes === "function") {
        var a = node.assignedNodes({ flatten: false });
        if (a && a.length) return a;
      }
    }
    return node.childNodes;
  }
  function roleOf(el) {
    var explicit = (el.getAttribute("role") || "").trim().toLowerCase().split(/\s+/)[0];
    if (explicit && ROLES[explicit]) return explicit;
    var tag = el.tagName;
    if (tag === "A") return "link";
    if (tag === "BUTTON" || tag === "SUMMARY") return "button";
    if (tag === "SELECT") return el.multiple || el.size > 1 ? "listbox" : "combobox";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "INPUT") {
      var t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (BUTTON_TYPES[t]) return "button";
      if (t === "range") return "slider";
      if (t === "search") return "searchbox";
      return "textbox";
    }
    if (editable(el)) return "textbox";
    return explicit || "other";
  }
  function followable(el) {
    if (el.tagName !== "A") return false;
    var h = el.href;
    return typeof h === "string" && /^https?:/i.test(h);
  }
  function candidate(el) {
    var tag = el.tagName;
    if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA" || tag === "SUMMARY") return true;
    if (tag === "INPUT") return (el.getAttribute("type") || "").toLowerCase() !== "hidden";
    if (tag === "A") {
      if (followable(el)) return false;
      if (el.hasAttribute("href") || el.hasAttribute("role")) return true;
      return false;
    }
    var r = (el.getAttribute("role") || "").trim().toLowerCase().split(/\s+/)[0];
    if (r && ROLES[r]) return true;
    if (editable(el) && !(el.parentElement && el.parentElement.isContentEditable)) return true;
    return false;
  }

  // One walk of the flat tree, the same in every mode.
  var texts = [];       // { node, el, cand }
  var cands = [];       // elements, in order
  var anchors = [];     // followable links, in order
  var visited = 0;
  (function walk() {
    var stack = [{ n: doc.body || root, cand: -1 }];
    while (stack.length) {
      var top = stack.pop();
      var n = top.n;
      if (++visited > MAX_NODES) break;
      if (n.nodeType === 3) {
        if (/\S/.test(n.nodeValue || "")) texts.push({ node: n, cand: top.cand, after: cands.length });
        continue;
      }
      if (n.nodeType !== 1 && n.nodeType !== 11) continue;
      var cand = top.cand;
      if (n.nodeType === 1) {
        if (hiddenEl(n) || closedDetails(n)) continue;
        if (candidate(n)) {
          cand = cands.length;
          cands.push(n);
        } else if (followable(n)) {
          anchors.push(n);
        }
        // An editable region's words are what was typed in it.
        if (editable(n)) continue;
        if (SKIP[n.tagName]) continue;
      }
      var ks = kids(n);
      for (var i = ks.length - 1; i >= 0; i--) stack.push({ n: ks[i], cand: cand });
    }
  })();

  var seenCache = new Map();
  function seen(t) {
    if (seenCache.has(t.node)) return seenCache.get(t.node);
    var v = textSeen(t.node);
    seenCache.set(t.node, v);
    return v;
  }
  function clean(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }
  // The words a person sees inside an element, by the same rules; none when
  // the element itself, or a box above it, is left out (review round 1 of
  // Phase 4: an opacity 0 label was read).
  function visibleText(el, limit) {
    if (el.nodeType === 1 && hiddenUp(el)) return "";
    var out = "";
    var stack = [el];
    var steps = 0;
    while (stack.length && out.length < limit && steps++ < 4000) {
      var n = stack.pop();
      if (n.nodeType === 3) {
        if (/\S/.test(n.nodeValue || "") && seen({ node: n })) out += " " + n.nodeValue;
        continue;
      }
      if (n.nodeType !== 1 && n.nodeType !== 11) continue;
      if (n.nodeType === 1 && n !== el && (hiddenEl(n) || closedDetails(n) || SKIP[n.tagName])) continue;
      var ks = kids(n);
      for (var i = ks.length - 1; i >= 0; i--) stack.push(ks[i]);
    }
    return clean(out).slice(0, limit);
  }
  function imageAlt(el) {
    var img = el.querySelector ? el.querySelector("img[alt]") : null;
    if (img && !hiddenEl(img)) return clean(img.getAttribute("alt"));
    return "";
  }
  function labelledBy(el) {
    var ids = (el.getAttribute("aria-labelledby") || "").trim();
    if (!ids) return "";
    var rootNode = el.getRootNode ? el.getRootNode() : doc;
    var parts = [];
    ids.split(/\s+/).slice(0, 5).forEach(function (id) {
      var t = rootNode.getElementById ? rootNode.getElementById(id) : doc.getElementById(id);
      if (t) parts.push(visibleText(t, MAX_NAME));
    });
    return clean(parts.join(" "));
  }
  function labelText(el) {
    var parts = [];
    var ls = el.labels;
    if (ls) for (var i = 0; i < ls.length && i < 3; i++) parts.push(visibleText(ls[i], MAX_NAME));
    return clean(parts.join(" "));
  }
  // Every word of the aria-labelledby targets, seen or not: a click's warning
  // hints only, never a name (review round 1 of Phase 4; the header).
  function labelledByHint(el) {
    var ids = (el.getAttribute("aria-labelledby") || "").trim();
    if (!ids) return "";
    var rootNode = el.getRootNode ? el.getRootNode() : doc;
    var parts = [];
    ids.split(/\s+/).slice(0, 5).forEach(function (id) {
      var t = rootNode.getElementById ? rootNode.getElementById(id) : doc.getElementById(id);
      if (t) parts.push(clean(t.textContent).slice(0, MAX_NAME));
    });
    return clean(parts.join(" ")).slice(0, MAX_NAME);
  }
  // Whether a control's own words show (review round 1 of Phase 4; the
  // header): a button's value, or with pseudo "::placeholder" its placeholder.
  function controlShows(el, pseudo) {
    var r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    if (offPage(r) || clippedAway(el, r)) return false;
    var look = pseudo ? win.getComputedStyle(el, pseudo) : styleOf(el);
    if (!look || parseFloat(look.fontSize) < 6) return false;
    var c = rgba(look.color);
    if (c && c[3] < 0.1) return false;
    var fill = rgba(look.webkitTextFillColor);
    if (fill && fill[3] < 0.1) return false;
    var ink = fill || c;
    if (ink) {
      var bg = bgOf(el);
      if (Math.abs(ink[0] - bg[0]) + Math.abs(ink[1] - bg[1]) + Math.abs(ink[2] - bg[2]) < 30) return false;
    }
    return !covered(el, r);
  }
  // Whether a list shows, so its options are seen (review round 1 of Phase 4).
  function listShows(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    if (offPage(r) || clippedAway(el, r)) return false;
    return !covered(el, r);
  }
  // An option that does not render: hidden, display none, or in a hidden group.
  function optionHidden(o) {
    if (o.hidden || styleOf(o).display === "none") return true;
    var grp = o.parentElement;
    return !!(grp && grp.tagName === "OPTGROUP" && (grp.hidden || styleOf(grp).display === "none"));
  }
  // Every word of a field's labels, seen or not, for its kind's hints only (see the header).
  function labelHint(el) {
    var parts = [];
    var ls = el.labels;
    if (ls) for (var i = 0; i < ls.length && i < 3; i++) parts.push(clean(ls[i].textContent).slice(0, MAX_NAME));
    return clean(parts.join(" ")).slice(0, MAX_NAME);
  }
  // A control's name: its own words a person sees first, and aria-labelledby
  // or aria-label only where it shows none (review round 1 of Phase 4).
  function nameOf(el, role) {
    var tag = el.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      var t = (el.getAttribute("type") || "").toLowerCase();
      if (tag === "INPUT" && BUTTON_TYPES[t]) {
        if (t === "image") return clean(labelledBy(el) || el.getAttribute("aria-label") || el.getAttribute("alt") || "").slice(0, MAX_ALT);
        // The words it shows: its value, or the browser's own Submit or Reset.
        var v = el.getAttribute("value");
        var shown = clean(v !== null ? v : t === "reset" ? "Reset" : t === "submit" ? "Submit" : "");
        if (shown && controlShows(el, null)) return shown.slice(0, MAX_NAME);
        return clean(labelledBy(el) || el.getAttribute("aria-label") || "").slice(0, MAX_NAME);
      }
      // A field: its visible label, then aria-labelledby, then aria-label,
      // then a placeholder a person sees (a list draws none).
      var l = labelText(el);
      if (l) return l.slice(0, MAX_NAME);
      var by = labelledBy(el);
      if (by) return by.slice(0, MAX_NAME);
      var aria = clean(el.getAttribute("aria-label"));
      if (aria) return aria.slice(0, MAX_NAME);
      var ph = tag === "SELECT" ? "" : clean(el.getAttribute("placeholder"));
      return ph && controlShows(el, "::placeholder") ? ph.slice(0, MAX_NAME) : "";
    }
    if (editable(el)) return clean(labelledBy(el) || el.getAttribute("aria-label") || el.getAttribute("data-placeholder") || "").slice(0, MAX_NAME);
    var own = visibleText(el, MAX_NAME);
    if (own) return own;
    var by2 = labelledBy(el);
    if (by2) return by2.slice(0, MAX_NAME);
    var aria2 = clean(el.getAttribute("aria-label"));
    if (aria2) return aria2.slice(0, MAX_NAME);
    // An image button's alt, never a link's (see the header).
    if (role !== "link") return imageAlt(el).slice(0, MAX_ALT);
    return "";
  }
  // The words a control is also called by, where they differ from its name
  // (review round 1 of Phase 4; the header), or "".
  function alsoNamedOf(el, name) {
    var parts = [];
    var by = labelledByHint(el);
    if (by && by !== name) parts.push(by);
    var aria = clean(el.getAttribute("aria-label"));
    if (aria && aria !== name && aria !== by) parts.push(aria);
    return clean(parts.join(" ")).slice(0, MAX_NAME);
  }
  function formOf(el) {
    var f = el.form || (el.closest ? el.closest("form") : null);
    return f && f.tagName === "FORM" ? f : null;
  }
  function formAction(el) {
    var f = formOf(el);
    if (!f) return null;
    var raw = el.getAttribute && el.hasAttribute("formaction") ? el.getAttribute("formaction") : f.getAttribute("action");
    try { return new URL(raw === null || raw === "" ? doc.URL : raw, doc.baseURI).href; } catch (e) { return null; }
  }
  function isEmptyField(el) {
    // Only the length is read: no character of the value leaves (see the header).
    var v = el.value;
    return typeof v !== "string" || v.length === 0;
  }
  function filledOf(el) {
    var tag = el.tagName;
    if (tag === "INPUT") {
      var t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox" || t === "radio") return !!el.checked;
      if (BUTTON_TYPES[t] || t === "file" || t === "range" || t === "color") return false;
      return !isEmptyField(el);
    }
    if (tag === "TEXTAREA") return !isEmptyField(el);
    if (tag === "SELECT") return el.selectedIndex > 0;
    if (editable(el)) return visibleTextRaw(el).length > 0;
    return false;
  }
  function visibleTextRaw(el) {
    return clean(el.textContent || "");
  }
  function codeBoxesOf(el) {
    if (el.tagName !== "INPUT" || el.maxLength !== 1) return null;
    var scope = formOf(el) || el.parentElement;
    if (!scope) return null;
    var n = 0;
    var all = scope.querySelectorAll("input");
    for (var i = 0; i < all.length && i < 50; i++) if (all[i].maxLength === 1) n++;
    return n;
  }
  // ── The context anchor (review of Phase 4 step 3; the header) ──
  var ROW_ROLES = { row: 1, listitem: 1 };
  // The control's nearest row or list item, else its nearest block, else the page.
  function anchorBox(el) {
    var block = null;
    for (var e = up(el), g = 0; e && e.nodeType === 1 && g < ANCHOR_UP; e = up(e), g++) {
      var r = (e.getAttribute("role") || "").trim().toLowerCase().split(/\s+/)[0];
      if (e.tagName === "TR" || e.tagName === "LI" || ROW_ROLES[r]) return e;
      if (!block && !/^inline|^contents$|^ruby/.test(styleOf(e).display)) block = e;
      if (e === body || e === root) break;
    }
    return block || body || root;
  }
  // The words in it a person can see by the styles alone: never the hit test
  // (a scroll would change it), never a field's value or an editable region's words.
  function anchorWords(box) {
    var out = "", stack = [box], steps = 0;
    while (stack.length && out.length < ANCHOR_CHARS && steps++ < 4000) {
      var n = stack.pop();
      if (n.nodeType === 3) {
        out += " " + n.nodeValue;
        continue;
      }
      if (n.nodeType !== 1 && n.nodeType !== 11) continue;
      if (n.nodeType === 1 && n !== box && (hiddenEl(n) || closedDetails(n) || SKIP[n.tagName] || editable(n))) continue;
      var ks = kids(n);
      for (var i = ks.length - 1; i >= 0; i--) stack.push(ks[i]);
    }
    return clean(out).slice(0, ANCHOR_CHARS);
  }
  // FNV-1a, 32 bits, as 8 hex digits: the words never leave, only this.
  function shortHash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }
  var anchorCache = new Map();
  function anchorOf(el) {
    var box = anchorBox(el);
    if (!anchorCache.has(box)) anchorCache.set(box, shortHash(anchorWords(box)));
    return anchorCache.get(box);
  }
  function optionLabel(o) {
    return clean(o.label || o.text).slice(0, MAX_LABEL);
  }
  function optionOff(o) {
    try { return !!o.disabled || !!(o.matches && o.matches(":disabled")); } catch (e) { return !!o.disabled; }
  }

  function describe(el, i) {
    var tag = el.tagName;
    var role = roleOf(el);
    var input = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
    var options, optionCount;
    if (tag === "SELECT") {
      options = [];
      optionCount = 0;
      // Every option with words that renders is counted (review of Phase 4
      // step 3), so the view can say how many more there are than it shows;
      // a list nobody sees lists none (review round 1 of Phase 4).
      var shows = listShows(el);
      var all = el.options, n = all.length;
      for (var k = 0; shows && k < n && k < COUNT_OPTIONS; k++) {
        var o = all[k];
        if (optionHidden(o)) continue;
        var w = clean(o.label || o.text);
        if (!w) continue;
        optionCount++;
        if (options.length < MAX_OPTIONS) options.push(w.slice(0, MAX_OPTION));
      }
      if (shows && n > COUNT_OPTIONS) optionCount += n - COUNT_OPTIONS;
    }
    var disabled = false;
    try { disabled = (el.matches && el.matches(":disabled")) || el.getAttribute("aria-disabled") === "true"; } catch (e) { disabled = false; }
    var label = input ? labelHint(el) : "";
    var name = nameOf(el, role);
    var also = alsoNamedOf(el, name);
    return {
      i: i,
      tag: tag.toLowerCase(),
      role: role,
      name: name,
      alsoNamed: also || null,
      type: tag === "INPUT" ? (el.getAttribute("type") || "text").toLowerCase().slice(0, 40) : null,
      autocomplete: input ? (el.getAttribute("autocomplete") || null) : null,
      inputmode: input ? (el.getAttribute("inputmode") || null) : null,
      nameAttr: input ? (el.getAttribute("name") || null) : null,
      idAttr: input ? (el.getAttribute("id") || null) : null,
      label: input ? (label || null) : null,
      maxLength: input && el.maxLength > 0 ? el.maxLength : null,
      codeBoxes: codeBoxesOf(el),
      formAction: formAction(el),
      href: tag === "A" && typeof el.href === "string" && el.href ? String(el.href).slice(0, 2000) : null,
      editable: editable(el),
      disabled: !!disabled,
      filled: !!filledOf(el),
      anchor: anchorOf(el),
      options: options,
      optionCount: optionCount
    };
  }
  function check(a) {
    var el = cands[a.i];
    if (!el) return null;
    var d = describe(el, a.i);
    if (d.tag !== a.tag || d.name !== a.name) return null;
    // The anchor passed back is checked too (review of Phase 4 step 3).
    if (typeof a.anchor === "string" && d.anchor !== a.anchor) return null;
    return el;
  }
  function deepHit(x, y) {
    var hit = doc.elementFromPoint(x, y);
    var guard = 0;
    while (hit && hit.shadowRoot && guard++ < 20) {
      var inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  }
  function contains(el, hit) {
    var n = hit;
    var guard = 0;
    while (n && guard++ < 500) {
      if (n === el) return true;
      n = n.parentNode || n.host || null;
    }
    return false;
  }
  function place(el) {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false, code: "covered" };
    var x = Math.min(Math.max(r.left + r.width / 2, 1), win.innerWidth - 1);
    var y = Math.min(Math.max(r.top + r.height / 2, 1), win.innerHeight - 1);
    var hit = deepHit(x, y);
    if (!hit || !contains(el, hit)) return { ok: false, code: "covered" };
    return { ok: true, x: x, y: y, box: { x: r.left + win.scrollX, y: r.top + win.scrollY, width: r.width, height: r.height } };
  }

  if (mode === "read") {
    var blocks = [];
    var current = null, currentBlock = null, total = 0;
    function blockOf(el) {
      var e = el;
      var guard = 0;
      while (e && guard++ < 200) {
        var d = styleOf(e).display;
        if (!/^inline|^contents$|^ruby/.test(d)) return e;
        e = e.parentElement || (e.getRootNode && e.getRootNode().host) || null;
      }
      return root;
    }
    for (var t = 0; t < texts.length && total < MAX_TEXT; t++) {
      var tx = texts[t];
      if (!seen(tx)) continue;
      var words = clean(tx.node.nodeValue);
      if (!words) continue;
      var b = blockOf(tx.node.parentElement);
      if (b !== currentBlock || current === null) {
        if (current !== null) blocks.push(current);
        current = words;
        currentBlock = b;
      } else {
        current += " " + words;
      }
      total += words.length + 1;
    }
    if (current !== null) blocks.push(current);
    var elements = [];
    for (var c = 0; c < cands.length && elements.length < MAX_ELEMENTS; c++) elements.push(describe(cands[c], c));
    var links = [];
    for (var a = 0; a < anchors.length && links.length < MAX_LINKS; a++) {
      var an = anchors[a];
      // A link's own words only: an image link's alt is never read (see the header).
      var text = visibleText(an, MAX_NAME);
      links.push({ text: text, href: String(an.href).slice(0, 4000) });
    }
    return { url: String(location.href), title: clean(doc.title).slice(0, 400), contentType: contentType, blocks: blocks, elements: elements, links: links, cut: visited > MAX_NODES };
  }

  if (mode === "find") {
    var want = clean(arg && arg.text).toLowerCase();
    var matches = [];
    if (!want) return { matches: matches };
    for (var f = 0; f < texts.length && matches.length < MAX_FIND; f++) {
      var tn = texts[f];
      if (!seen(tn)) continue;
      var w2 = clean(tn.node.nodeValue);
      var at = w2.toLowerCase().indexOf(want);
      if (at < 0) continue;
      var from = Math.max(0, at - 90);
      var near = tn.cand >= 0 ? tn.cand : tn.after < cands.length ? tn.after : cands.length > 0 ? cands.length - 1 : -1;
      matches.push({ text: w2.slice(from, Math.min(w2.length, at + want.length + 90)), near: near });
    }
    return { matches: matches };
  }

  if (mode === "scroll") {
    var dir = arg && arg.dir === "up" ? -1 : 1;
    var screens = Math.min(Math.max(Number(arg && arg.screens) || 1, 1), 3);
    var before = win.scrollY;
    win.scrollBy({ top: dir * screens * Math.round(win.innerHeight * 0.85), behavior: "instant" });
    var se = doc.scrollingElement || root;
    var atEnd = dir > 0 ? win.scrollY + win.innerHeight >= se.scrollHeight - 2 : win.scrollY <= 0;
    return { ok: true, atEnd: atEnd, moved: win.scrollY !== before };
  }

  // A list's options for matching a choice only (review of Phase 4 step 3):
  // read, nothing scrolled, focused or chosen.
  if (mode === "options") {
    var le = check(arg || {});
    if (!le || le.tagName !== "SELECT") return { ok: false, code: "changed" };
    var listed = [];
    for (var oi = 0; oi < le.options.length && oi < MAX_MATCH; oi++) listed.push({ label: optionLabel(le.options[oi]), disabled: optionOff(le.options[oi]) });
    return { ok: true, options: listed, total: le.options.length };
  }

  if (mode === "locate" || mode === "focus" || mode === "select" || mode === "box") {
    var el = check(arg || {});
    if (!el) return { ok: false, code: "changed" };
    var d = describe(el, arg.i);
    if (d.disabled && mode !== "box") return { ok: false, code: "disabled" };
    var p = place(el);
    if (mode === "box") return { ok: true, box: p.box || null, viewport: { x: win.scrollX, y: win.scrollY, width: win.innerWidth, height: win.innerHeight } };
    if (!p.ok) return p;
    if (mode === "locate") return p;
    if (mode === "focus") {
      el.focus({ preventScroll: true });
      var act = doc.activeElement;
      var g = 0;
      while (act && act.shadowRoot && act.shadowRoot.activeElement && g++ < 20) act = act.shadowRoot.activeElement;
      if (!(act === el || contains(el, act))) return { ok: false, code: "covered" };
      if (arg.replace === true) {
        // Replace, never add to (review of Phase 4 step 3): what the field
        // holds is selected, so the typed words take its place. Only lengths
        // are read to check it, never a character of the value.
        try {
          if (el.isContentEditable) {
            var all2 = doc.createRange();
            all2.selectNodeContents(el);
            var sel = win.getSelection();
            sel.removeAllRanges();
            sel.addRange(all2);
          } else if (typeof el.select === "function") {
            el.select();
            var v = el.value;
            if (typeof el.selectionStart === "number" && typeof v === "string" && (el.selectionStart !== 0 || el.selectionEnd !== v.length)) return { ok: false, code: "covered" };
          }
        } catch (e) {
          return { ok: false, code: "covered" };
        }
      }
      return { ok: true };
    }
    if (el.tagName !== "SELECT") return { ok: false, code: "changed" };
    // The very option the card showed (review of Phase 4 step 3): by its
    // index, only while its label there is unchanged, never by words that a
    // case-only twin or a shortened label could match first.
    var pick = Number(arg.index);
    var opt = Number.isInteger(pick) && pick >= 0 && pick < el.options.length ? el.options[pick] : null;
    if (!opt || optionLabel(opt) !== String(arg.label)) return { ok: false, code: "changed" };
    if (optionOff(opt)) return { ok: false, code: "disabled" };
    opt.selected = true;
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }
  return { ok: false, code: "not_found" };
})`;

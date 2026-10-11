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
// field's value; the region is listed as a field instead). Alt text only as
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
// MODES (the first argument; the second is a JSON object):
//   read       the page: url, title, contentType, text blocks, the main
//              frame's controls (with the hints classes.ts fieldKindOf reads,
//              which the driver turns into a kind and drops) and its links
//   find       {text}: where the words appear, with the nearest control
//   locate     {i, tag, name}: control i, scrolled into view, and whether
//              the point at its centre is it (or inside it) or covered
//   focus      {i, tag, name}: control i focused
//   select     {i, tag, name, option}: the option with those words chosen,
//              input and change sent, as a person's choice sends them
//   scroll     {dir, screens}: the page scrolled; whether it reached the end
//   box        {i, tag, name}: control i's box on the page, for a picture
// Controls are numbered in one walk of the flat tree (open shadow roots and
// their slots included), the same in every mode, so an index read by `read`
// names the same control for `locate` while the page is unchanged; the tag
// and name passed back are checked again.
//
// Pure: a string.

export const READER_WORLD = "wk-reader";

export const READER_SOURCE = String.raw`(function (mode, arg) {
  "use strict";
  var doc = document, win = window;
  var MAX_NODES = 60000, MAX_ELEMENTS = 400, MAX_LINKS = 400, MAX_TEXT = 120000, MAX_NAME = 300, MAX_ALT = 60, MAX_OPTIONS = 60, MAX_OPTION = 200, MAX_FIND = 20;
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
    var cp = String(cs.clipPath || "");
    if (/inset\(\s*50%/.test(cp) || /circle\(\s*0(px|%)?\s*[ )]/.test(cp) || /polygon\(\s*0(px)?\s+0(px)?\s*,\s*0(px)?\s+0(px)?\s*,\s*0(px)?\s+0(px)?\s*\)/.test(cp)) return true;
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
  function editable(el) {
    return !!el.isContentEditable;
  }
  function bgOf(el) {
    var e = el;
    while (e && e.nodeType === 1) {
      var cs = styleOf(e);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
      var c = rgba(cs.backgroundColor);
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
    if (c) {
      var bg = bgOf(p);
      if (bg && Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) < 30) return false;
    }
    range.selectNodeContents(node);
    var rects = range.getClientRects();
    if (!rects || rects.length === 0) return false;
    var b = range.getBoundingClientRect();
    if (b.height < 6 || b.width < 1) return false;
    if (offPage(b)) return false;
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
  // The words a person sees inside an element, by the same rules.
  function visibleText(el, limit) {
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
  function nameOf(el, role) {
    var tag = el.tagName;
    var by = labelledBy(el);
    if (by) return by.slice(0, MAX_NAME);
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      var t = (el.getAttribute("type") || "").toLowerCase();
      if (tag === "INPUT" && BUTTON_TYPES[t]) {
        if (t === "image") return clean(el.getAttribute("aria-label") || el.getAttribute("alt") || "").slice(0, MAX_ALT);
        var v = el.getAttribute("value");
        return clean(v !== null ? v : t === "reset" ? "Reset" : t === "submit" ? "Submit" : el.getAttribute("aria-label") || "").slice(0, MAX_NAME);
      }
      var l = labelText(el);
      if (l) return l.slice(0, MAX_NAME);
      var aria = clean(el.getAttribute("aria-label"));
      if (aria) return aria.slice(0, MAX_NAME);
      return clean(el.getAttribute("placeholder")).slice(0, MAX_NAME);
    }
    if (editable(el)) return clean(labelledBy(el) || el.getAttribute("aria-label") || el.getAttribute("data-placeholder") || "").slice(0, MAX_NAME);
    var own = visibleText(el, MAX_NAME);
    if (own) return own;
    var aria2 = clean(el.getAttribute("aria-label"));
    if (aria2) return aria2.slice(0, MAX_NAME);
    // An image button's alt, never a link's (see the header).
    if (role !== "link") return imageAlt(el).slice(0, MAX_ALT);
    return "";
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
  function describe(el, i) {
    var tag = el.tagName;
    var role = roleOf(el);
    var input = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
    var options;
    if (tag === "SELECT") {
      options = [];
      for (var k = 0; k < el.options.length && options.length < MAX_OPTIONS; k++) {
        var o = el.options[k];
        var w = clean(o.label || o.text).slice(0, MAX_OPTION);
        if (w) options.push(w);
      }
    }
    var disabled = false;
    try { disabled = (el.matches && el.matches(":disabled")) || el.getAttribute("aria-disabled") === "true"; } catch (e) { disabled = false; }
    var label = input ? labelText(el) : "";
    return {
      i: i,
      tag: tag.toLowerCase(),
      role: role,
      name: nameOf(el, role),
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
      options: options
    };
  }
  function check(a) {
    var el = cands[a.i];
    if (!el) return null;
    var d = describe(el, a.i);
    if (d.tag !== a.tag || d.name !== a.name) return null;
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
      return act === el || contains(el, act) ? { ok: true } : { ok: false, code: "covered" };
    }
    if (el.tagName !== "SELECT") return { ok: false, code: "changed" };
    var wanted = clean(arg.option).toLowerCase();
    for (var q = 0; q < el.options.length; q++) {
      var opt = el.options[q];
      if (clean(opt.label || opt.text).toLowerCase() === wanted && !opt.disabled) {
        opt.selected = true;
        el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
    }
    return { ok: false, code: "not_found" };
  }
  return { ok: false, code: "not_found" };
})`;

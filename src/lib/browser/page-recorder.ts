// The recorder (docs/plans/ai-teammates-phase5.md Decision 7, step 2): the
// script that notes, while a person shows their teammate how to do a job in
// its browser, what they click and which fields and lists they use, never
// what they type or choose. Run by cdp-driver.ts in a world of its own,
// "wk-recorder", never the reader's: its own globals and DOM wrappers, which
// the page's scripts cannot reach. Exported as strings, never as functions of
// this module, as the reader is (page-reader.ts).
//
// INSTALLED ONCE A WORLD, SWITCHED ON AND OFF (spec review 2, finding 9b).
// The body runs only when the world's own global holds no `__wkRec` yet; it
// then puts there { how, on, queue, start(), stop(), drain() } and registers
// its listeners, once. start() switches it on and empties the queue and the
// typing marks; stop() switches it off and empties the queue (the driver's
// "stop" hands over what it held first); drain() hands
// over at most 200 events and forgets them. `how` says how this world got
// it: "new_document" (Page.addScriptToEvaluateOnNewDocument put it in before
// any page script ran) or "late" (the driver put it in afterwards, which
// the driver turns into a "may be missing" step at a page change). A world
// installed by the new-document script starts on: that script exists only
// while the person records. Only the main frame installs it.
//
// ONLY THE PERSON'S OWN INPUT. Every listener's first statement returns
// unless the recorder is on and the event is trusted (isTrusted), so after a
// recording nothing is kept, the teammate's own clicks through CDP included,
// and a page's script that dispatches events adds nothing. A trusted input
// event can still come from a script (document.execCommand("insertText")), so
// typing counts only in a field the person marked: their own trusted
// pointerdown on it or on its label, or a trusted keydown in it. The mark
// lasts until that field's focusout, never its focusin (spec review 2,
// finding 2: a click fires pointerdown, then moves the focus, then click).
// The field's description is taken when it is marked, so a field named only
// by its placeholder keeps the name it had before anything was typed.
//
// EACH EVENT LEAVES AT ONCE, in the window's capture phase, before any
// handler of the page runs, and before anything the event causes, a page
// change included: through the binding the driver gave this world alone
// (RECORDER_BINDING, Runtime.addBinding by this context's id), each call
// carrying the recording's token. Until the driver gives the binding and
// the token (start, ensure), or when a call fails, the event waits in the
// queue for the driver's next drain (cdp-driver.ts; a page change from a
// document that had no binding is a "may be missing" step). A field's typing
// is sent once until something else is sent (review of Phase 5 step 2, M1):
// the last event sent decides, whichever way it left, so a field typed in
// key by key is one event, never one a key.
//
// SUGGESTIONS AND ECHOES (spec review 2, finding 7). For 10 seconds after
// each counted input, in a form or not, a MutationObserver marks what comes
// into the page (a click inside it is a suggestion), the controls whose
// words, value attribute or labels change (they keep only their role), and
// every box around changed words or attributes (review of Phase 5 step 2,
// M3): a legend, a group's, list's or table's label, a caption or an
// aria-label among them is never read again, so words a page echoes from the
// typing never name a choice or a list. It reads whether words changed,
// never what they are.
//
// WHAT EACH EVENT CARRIES (src/lib/skills/types.ts RecordedEvent): its kind,
// when, the page's address (read on the server to name the step's site and
// page, never kept whole) and the control: its tag and role, its visible
// name and its group's visible label by the reader's own rules
// (NAMING_SOURCE: nameOf and visibleText, which skip a list's options and a
// text area's text), whether it is a choice, an opener, in a row of data, in
// navigation, a suggestion or an echo, a link's address (to class it), its
// form's index and host, and the reader's hints for it and for every field of
// its form, or of the page when it has none (at most 40, sensitive looking
// ones first): the label hint every word of its labels, seen or not, as a
// read gives it, for the fold only; every attribute hint is capped, so no
// page's attributes push an event past what the driver reads. A combobox
// that is no text field is named by nothing of its own (its words are its
// current value), only by its label; a suggestion and a control whose words
// changed with the person's typing by none at all (they can echo what was
// typed, and steps.ts never reads either's words); and so is a control inside
// an editable region, a link or a button in a rich text editor, whose words
// the person typed there (review of Phase 5 step 2, low 9). An opener is
// named by its label only (aria-labelledby, aria-label, its labels), never
// by its shown words, which are the value it holds, unless it opens a menu
// ("More"); an opener is never another control's label either (review of
// Phase 5 step 2, M2: a listbox labelled by its own button named every
// choice by the value chosen). A click on a label with no labelable control
// is the control it names or holds, else the label's own (low 10).
//
// NEVER READ HERE: a field's value, whether a box is ticked, a list's chosen
// option, an input event's data, a key beyond whether it is Enter, the words
// of an editable region or of a combobox, the selection, the clipboard.
// page-recorder.contract.test.ts holds the source to it.
//
// Pure: strings.

import { NAMING_SOURCE } from "./page-reader";

export const RECORDER_WORLD = "wk-recorder";

/** The binding the driver adds to each recorder context (Runtime.addBinding): on that world's global alone, never the page's. */
export const RECORDER_BINDING = "__wkRecOut";

/** The install-once body, a function of how this world got it ("new_document" or "late"); it answers how the world's recorder was installed, or null off the main frame. */
const RECORDER_BODY = String.raw`function (how) {
  "use strict";
  var g = globalThis;
  if (g.__wkRec) return g.__wkRec.how;
  var win = window, doc = document;
  var top = false;
  try { top = win.top === win; } catch (e) { top = false; }
  if (!top) return null;
  var QUEUE_MAX = 1000, DRAIN_MAX = 200, SUGGESTION_MS = 10000, FORM_FIELDS_MAX = 40, FIELDS_SCAN = 400, PAGE_MAX = 4096, HREF_MAX = 8193, WORDS_MAX = 300, AUTOCOMPLETE_MAX = 200, MODE_MAX = 40;
  var rec = {
    how: how,
    on: how === "new_document",
    token: null,
    queue: [],
    lost: false,
    marks: new Map(),
    typedUntil: 0,
    fresh: new WeakSet(),
    changed: new WeakSet(),
    // Every element whose words, or a part's, changed after the typing; and those whose own label attributes did.
    echoed: new WeakSet(),
    attrChanged: new WeakSet(),
    observing: false,
    // The field whose input was the last event sent, whichever way it left; null after any other.
    lastInput: null
  };

  // The reader's naming rules (page-reader.ts NAMING_SOURCE), measured anew for each event.
  function naming() {
    var root = doc.documentElement;
    if (!root) return null;
    var SVG = "http://www.w3.org/2000/svg", MAX_NAME = 300, MAX_ALT = 60;
` +
  NAMING_SOURCE +
  String.raw`
    return { roleOf: roleOf, nameOf: nameOf, labelHint: labelHint, labelText: labelText, labelledBy: labelledBy, visibleText: visibleText, formOf: formOf, formAction: formAction, codeBoxesOf: codeBoxesOf, editable: editable, clean: clean, kids: kids, up: up, ROLES: ROLES, BUTTON_TYPES: BUTTON_TYPES };
  }

  // One event out; field: the field an input event is the typing of. The last
  // event sent is noted whichever way it left (M1), and none when it was dropped.
  function push(ev, field) {
    if (!rec.on) return;
    ev.at = Date.now();
    ev.page = String(location.href).slice(0, PAGE_MAX);
    var typing = ev.type === "input" && field ? field : null;
    // Out at once through this world's binding, else into the queue for the driver's drain.
    var out = g["` +
  RECORDER_BINDING +
  String.raw`"];
    if (rec.token !== null && typeof out === "function") {
      try {
        out(JSON.stringify({ t: rec.token, e: ev }));
        rec.lastInput = typing;
        return;
      } catch (x) {
        /* the queue keeps it */
      }
    }
    if (rec.queue.length >= QUEUE_MAX) { rec.lost = true; rec.lastInput = null; return; }
    rec.queue.push(ev);
    rec.lastInput = typing;
  }
  function clip(s, max) {
    return s ? String(s).slice(0, max) : null;
  }
  function targetOf(e) {
    var p = e.composedPath ? e.composedPath() : null;
    var t = p && p.length ? p[0] : e.target;
    if (t && t.nodeType === 3) t = t.parentElement;
    return t && t.nodeType === 1 ? t : null;
  }
  function parentOf(e) {
    return e.parentElement || (e.getRootNode && e.getRootNode().host) || null;
  }
  function roleAttr(e) {
    return (e.getAttribute("role") || "").trim().toLowerCase().split(/\s+/)[0];
  }
  // Input types a person clicks or picks, never types in.
  var NOT_TYPED = { checkbox: 0, radio: 0, button: 0, submit: 0, reset: 0, image: 0, file: 0, range: 0, color: 0, hidden: 0 };
  // The field an event is about: the element itself, its editable region's root, or a label's control.
  function fieldOf(el) {
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 30; e = parentOf(e), i++) {
      var t = e.tagName;
      if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return e;
      if (e.isContentEditable && !(e.parentElement && e.parentElement.isContentEditable)) return e;
      if (t === "LABEL") return e.control || null;
      if (e === doc.body) break;
    }
    return null;
  }
  // A field a person types in: a text-like input, a text area or an editable region.
  function typed(f) {
    if (!f) return false;
    if (f.tagName === "TEXTAREA") return true;
    if (f.tagName === "INPUT") return !Object.prototype.hasOwnProperty.call(NOT_TYPED, (f.getAttribute("type") || "text").toLowerCase());
    return f.tagName !== "SELECT" && !!f.isContentEditable;
  }
  function freshUp(el) {
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 20; e = parentOf(e), i++) if (rec.fresh.has(e)) return true;
    return false;
  }
  function cursorPointer(e) {
    try { return win.getComputedStyle(e).cursor === "pointer"; } catch (x) { return false; }
  }
  // A control by its role (the reader's ROLES), or null.
  function roleControl(e, N) {
    return e && e.nodeType === 1 && N.ROLES[roleAttr(e)] ? e : null;
  }
  // What a click on a label with no labelable control is on (low 10): the
  // control its for names, else one inside it, else the label itself.
  function labelTarget(lab, N) {
    var f = lab.getAttribute("for");
    if (f) {
      var rootNode = lab.getRootNode ? lab.getRootNode() : doc;
      var named = roleControl(rootNode.getElementById ? rootNode.getElementById(f) : doc.getElementById(f), N);
      if (named) return named;
    }
    var inner = lab.querySelectorAll ? lab.querySelectorAll("[role]") : [];
    for (var k = 0; k < inner.length && k < 20; k++) if (roleControl(inner[k], N)) return inner[k];
    return lab;
  }
  // The control a click is on: the nearest one up from its target; none for a
  // label with a control (its control's own click follows), the label's
  // target for one with none; else a clickable element the page drew (a
  // pointer cursor or an onclick), the outermost of its run.
  function controlOf(el, N) {
    var e, i;
    for (e = el, i = 0; e && e.nodeType === 1 && i < 25; e = parentOf(e), i++) {
      var t = e.tagName;
      if (t === "LABEL") return e.control ? null : labelTarget(e, N);
      if (t === "A" && (e.hasAttribute("href") || e.hasAttribute("role"))) return e;
      if (t === "BUTTON" || t === "SELECT" || t === "TEXTAREA" || t === "SUMMARY" || t === "OPTION") return e;
      if (t === "INPUT") return (e.getAttribute("type") || "").toLowerCase() === "hidden" ? null : e;
      var r = roleAttr(e);
      if (r && N.ROLES[r]) return e;
      if (e.isContentEditable && !(e.parentElement && e.parentElement.isContentEditable)) return e;
      if (e === doc.body || e === doc.documentElement) break;
    }
    for (e = el, i = 0; e && e.nodeType === 1 && i < 10 && e !== doc.body; e = parentOf(e), i++) {
      if (e.hasAttribute("onclick")) return e;
      if (cursorPointer(e)) {
        var top2 = e;
        for (var p = parentOf(e), k = 0; p && p.nodeType === 1 && p !== doc.body && k < 8 && cursorPointer(p); p = parentOf(p), k++) top2 = p;
        return top2;
      }
    }
    return null;
  }
  function closestSel(el, sel) {
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 40; e = parentOf(e), i++) {
      try { if (e.matches(sel)) return e; } catch (x) { return null; }
    }
    return null;
  }
  function cssId(id) {
    return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, "\\$&");
  }
  function hasPopup(e) {
    return (e.getAttribute("aria-haspopup") || "false") !== "false";
  }
  // An opener whose shown words are its own, not a value: a menu button ("More"), aria-haspopup menu or true (M2).
  function opensMenu(e) {
    var h = (e.getAttribute("aria-haspopup") || "").trim().toLowerCase();
    return h === "menu" || h === "true";
  }
  // The opener (a combobox, aria-haspopup) whose popup holds el, or null.
  function popupOpener(el) {
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 25; e = parentOf(e), i++) {
      if (!e.id) continue;
      var o = null;
      try { o = doc.querySelector('[aria-controls~="' + cssId(e.id) + '"], [aria-owns~="' + cssId(e.id) + '"]'); } catch (x) { o = null; }
      if (o && o !== e && (roleAttr(o) === "combobox" || hasPopup(o))) return o;
    }
    return null;
  }
  function isOpener(el, role) {
    if (el.tagName === "SELECT") return false;
    return role === "combobox" || hasPopup(el);
  }
  var CHOICE_ROLES = { radio: 1, option: 1, menuitemradio: 1, menuitemcheckbox: 1, treeitem: 1, gridcell: 1 };
  function inDatePicker(el) {
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 25; e = parentOf(e), i++) {
      var cls = typeof e.className === "string" ? e.className : "";
      if (/datepicker|date-picker|calendar/i.test(cls)) return true;
      var r = roleAttr(e);
      if ((r === "dialog" || r === "grid") && /date|calendar/i.test(e.getAttribute("aria-label") || "")) return true;
    }
    return false;
  }
  function isChoice(el, role, popup) {
    if (CHOICE_ROLES[role]) return true;
    if (role === "menuitem") return false;
    if ((role === "checkbox" || role === "switch") && closestSel(el, "fieldset, [role=group], [role=radiogroup]")) return true;
    if (closestSel(el, "[role=listbox], [role=grid], [role=treegrid], [role=tree]")) return true;
    if (inDatePicker(el)) return true;
    return !!popup;
  }
  // aria-labelledby words that are the element's own label: never its own
  // words or a part of it, nor a list, a combobox or any opener (their words
  // can be a value: a listbox labelled by its own button, M2), nor words that
  // echoed the typing (M3).
  function ownLabelledBy(el, N) {
    var ids = (el.getAttribute("aria-labelledby") || "").trim();
    if (!ids) return "";
    var rootNode = el.getRootNode ? el.getRootNode() : doc;
    var parts = [];
    ids.split(/\s+/).slice(0, 5).forEach(function (id) {
      var t = rootNode.getElementById ? rootNode.getElementById(id) : doc.getElementById(id);
      if (!t || t === el || el.contains(t) || t.contains(el)) return;
      var r = roleAttr(t);
      if (r === "combobox" || r === "listbox" || r === "option" || hasPopup(t) || t.tagName === "SELECT" || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (freshUp(t) && rec.typedUntil > 0) return;
      if (rec.echoed.has(t)) return;
      parts.push(N.visibleText(t, WORDS_MAX));
    });
    return N.clean(parts.join(" ")).slice(0, WORDS_MAX);
  }
  // An element's aria-label, unless it changed after the typing (M3).
  function ariaOf(e, N) {
    return rec.attrChanged.has(e) ? "" : N.clean(e.getAttribute("aria-label")).slice(0, WORDS_MAX);
  }
  // A control's labels' visible words, but a label whose words echoed the typing (M3).
  function labelsOf(e, N) {
    var ls = e.labels, parts = [];
    if (ls) for (var i = 0; i < ls.length && i < 3; i++) if (!rec.echoed.has(ls[i])) parts.push(N.visibleText(ls[i], WORDS_MAX));
    return N.clean(parts.join(" ")).slice(0, WORDS_MAX);
  }
  // An opener's label: its own label only (M2). Its shown words are the value
  // it holds for a list, tree, grid or dialog opener (a chosen option, a
  // date, a person), so they name it only when it opens a menu ("More"), and
  // never once they changed with the typing.
  function openerLabel(el, role, N) {
    var by = ownLabelledBy(el, N);
    if (by) return by;
    var aria = ariaOf(el, N);
    if (aria) return aria;
    var lab = labelsOf(el, N);
    if (lab) return lab;
    return role !== "combobox" && opensMenu(el) && !rec.changed.has(el) ? N.nameOf(el, role) : "";
  }
  // The label of the group, list or popup a control sits in; "" from a label
  // that came in with a suggestion, or whose words echoed the typing (M3).
  function groupOf(el, role, popup, N) {
    var g = closestSel(el, "fieldset, [role=radiogroup], [role=group], [role=listbox], [role=menu], [role=tree], [role=treegrid], [role=grid], [role=tablist]");
    if (g) {
      if (g.tagName === "FIELDSET") {
        var lg = g.querySelector("legend");
        if (lg && !(freshUp(lg) && freshUp(el)) && !rec.echoed.has(lg)) {
          var w = N.visibleText(lg, WORDS_MAX);
          if (w) return w;
        }
      } else {
        var by = ownLabelledBy(g, N);
        if (by) return by;
        if (!freshUp(g)) {
          var aria = ariaOf(g, N);
          if (aria) return aria;
        }
      }
    }
    if (popup) return openerLabel(popup, roleAttr(popup) || "combobox", N);
    return "";
  }
  var NAV = "nav, [role=navigation], [role=menubar], [role=tablist], [role=menu]";
  function dataTable(t) {
    var r = roleAttr(t);
    if (r === "presentation" || r === "none") return false;
    if (r === "table" || r === "grid" || r === "treegrid") return true;
    return !!(t.querySelector && (t.querySelector("th") || t.querySelector("caption"))) || t.hasAttribute("aria-label") || t.hasAttribute("aria-labelledby");
  }
  // A list's or table's label: its caption, aria-labelledby or aria-label, none whose words echoed the typing (M3).
  function listLabel(list, N) {
    if (!list) return "";
    var cap = list.tagName === "TABLE" ? list.querySelector("caption") : null;
    if (cap && !rec.echoed.has(cap)) {
      var c = N.visibleText(cap, WORDS_MAX);
      if (c) return c;
    }
    return ownLabelledBy(list, N) || ariaOf(list, N);
  }
  // The label of the row of data or list item (not navigation) a control sits in: "" when it has none, null when it is in none.
  function rowOf(el, N) {
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 30; e = parentOf(e), i++) {
      try { if (e.matches(NAV)) return null; } catch (x) { return null; }
      var r = roleAttr(e);
      if (e.tagName === "TR" || r === "row") {
        var t = closestSel(e, "table, [role=table], [role=grid], [role=treegrid]");
        if (t && dataTable(t)) return listLabel(t, N);
        continue;
      }
      if (e.tagName === "LI" || r === "listitem") {
        var l = e.parentElement;
        if (l && closestSel(l, NAV)) return null;
        return listLabel(l, N);
      }
      if (e === doc.body) break;
    }
    return null;
  }
  // The reader's hints for a field, as a read gives them (cdp-driver.ts hintsOf turns them into a kind).
  function hintsOf(el, N) {
    var tag = el.tagName;
    var input = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
    var ed = N.editable(el);
    // Each attribute capped as the driver reads it (low 8), so no page's attributes push an event past what the driver takes.
    return {
      tag: tag.toLowerCase(),
      type: tag === "INPUT" ? (el.getAttribute("type") || "text").toLowerCase().slice(0, MODE_MAX) : null,
      autocomplete: input ? clip(el.getAttribute("autocomplete"), AUTOCOMPLETE_MAX) : null,
      inputmode: input ? clip(el.getAttribute("inputmode"), MODE_MAX) : null,
      nameAttr: input ? clip(el.getAttribute("name"), WORDS_MAX) : null,
      idAttr: input ? clip(el.getAttribute("id"), WORDS_MAX) : null,
      label: input ? clip(N.labelHint(el), WORDS_MAX) : null,
      maxLength: input && el.maxLength > 0 ? el.maxLength : null,
      codeBoxes: N.codeBoxesOf(el),
      editable: ed,
      name: ed ? N.nameOf(el, "textbox") : ""
    };
  }
  var SENSITIVE_LOOK = /pass|pwd|card|cc-|cvc|cvv|csc|one-time|otp|code|iban|account|expir/i;
  function sensitiveLook(f) {
    if (f.tagName === "INPUT" && (f.getAttribute("type") || "").toLowerCase() === "password") return true;
    return SENSITIVE_LOOK.test([f.getAttribute("autocomplete"), f.getAttribute("name"), f.getAttribute("id")].join(" "));
  }
  // Every field of a form, or of the page (its open shadow roots too) when it has none: sensitive looking ones first.
  function fieldsOf(form, N) {
    var found = [];
    function keep(e) {
      var t = e.tagName;
      if (t === "INPUT") { if ((e.getAttribute("type") || "").toLowerCase() !== "hidden") found.push(e); }
      else if (t === "TEXTAREA" || t === "SELECT") found.push(e);
      else if (e.isContentEditable && !(e.parentElement && e.parentElement.isContentEditable)) found.push(e);
    }
    if (form) {
      var els = form.elements || [];
      for (var i = 0; i < els.length && found.length < FIELDS_SCAN; i++) keep(els[i]);
      var eds = form.querySelectorAll("[contenteditable]");
      for (var j = 0; j < eds.length && found.length < FIELDS_SCAN; j++) keep(eds[j]);
    } else {
      var stack = [doc.documentElement], steps = 0;
      while (stack.length && found.length < FIELDS_SCAN && steps++ < 20000) {
        var n = stack.pop();
        if (n.nodeType === 1) keep(n);
        if (n.nodeType !== 1 && n.nodeType !== 11 && n.nodeType !== 9) continue;
        var ks = N.kids(n);
        for (var k = ks.length - 1; k >= 0; k--) if (ks[k].nodeType === 1 || ks[k].nodeType === 11) stack.push(ks[k]);
      }
    }
    var seenF = new Set(), first = [], rest = [];
    for (var m = 0; m < found.length; m++) {
      var f = found[m];
      if (seenF.has(f)) continue;
      seenF.add(f);
      (sensitiveLook(f) ? first : rest).push(f);
    }
    return first.concat(rest).slice(0, FORM_FIELDS_MAX).map(function (x) { return hintsOf(x, N); });
  }
  function hostOf(url) {
    try { return url ? new URL(url).hostname.toLowerCase() : null; } catch (x) { return null; }
  }
  // Whether el sits inside an editable region without being one's root or a
  // field: a link, a button or a chip in a rich text editor (low 9).
  function typedInto(el) {
    var t = el.tagName;
    if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return false;
    if (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable)) return false;
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 40; e = parentOf(e), i++) if (e.isContentEditable) return true;
    return false;
  }
  // One control as an event carries it (see the file header).
  function describe(el) {
    var N = naming();
    if (!N) return null;
    var tag = el.tagName;
    var role = N.roleOf(el);
    var field = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || N.editable(el);
    var popup = popupOpener(el);
    var opener = isOpener(el, role);
    var choice = isChoice(el, role, popup);
    var suggestion = freshUp(el);
    var form = N.formOf(el);
    var forms = doc.forms;
    var formKey = null;
    if (form) for (var i = 0; i < forms.length; i++) if (forms[i] === form) { formKey = i; break; }
    // A combobox that is no text field shows its value: named by its label
    // only. A suggestion's words, words that changed with the person's
    // typing, and the words of a control inside an editable region (the
    // person typed them there, low 9) can hold what they typed: steps.ts
    // never reads them (classWords), so none leaves the page; the last keeps
    // no group's or list's words either, which are typed text too.
    var typedIn = typedInto(el);
    var valueShown = role === "combobox" && !field;
    var wordsChanged = rec.changed.has(el) || typedIn;
    var name = valueShown || suggestion || wordsChanged ? "" : N.nameOf(el, role);
    var group = typedIn ? "" : opener ? openerLabel(el, role, N) : groupOf(el, role, popup, N);
    var row = rowOf(el, N);
    return {
      tag: tag.toLowerCase(),
      role: role,
      name: name,
      type: tag === "INPUT" ? (el.getAttribute("type") || "text").toLowerCase().slice(0, 40) : null,
      formHost: hostOf(N.formAction(el)),
      formKey: formKey,
      group: group || null,
      choice: choice,
      opener: opener,
      inRow: typedIn && row !== null ? "" : row,
      inNav: !!closestSel(el, "nav, [role=navigation], [role=menubar], [role=tablist]"),
      suggestion: suggestion,
      wordsChanged: wordsChanged,
      href: tag === "A" && typeof el.href === "string" && el.href ? String(el.href).slice(0, HREF_MAX) : null,
      hints: hintsOf(el, N),
      formFields: fieldsOf(form, N)
    };
  }

  // ── Suggestions and echoes (see the file header) ──
  // attr: el's own label attributes changed (an attribute mutation).
  function markWords(el, N, attr) {
    if (!el || el.nodeType !== 1 || !N) return;
    // Every box around the change holds changed words now (M3): none of them names a group or a list again.
    for (var a = el, d = 0; a && a.nodeType === 1 && d < 40; a = parentOf(a), d++) rec.echoed.add(a);
    if (attr) rec.attrChanged.add(el);
    var c = controlOf(el, N);
    if (c) rec.changed.add(c);
    var lab = closestSel(el, "label");
    if (lab && lab.control) rec.changed.add(lab.control);
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 10; e = parentOf(e), i++) {
      if (!e.id) continue;
      var refs = [];
      try { refs = doc.querySelectorAll('[aria-labelledby~="' + cssId(e.id) + '"]'); } catch (x) { refs = []; }
      for (var k = 0; k < refs.length && k < 20; k++) rec.changed.add(refs[k]);
    }
  }
  var observer = new MutationObserver(function (list) {
    if (!rec.on) return;
    if (Date.now() > rec.typedUntil) { stopObserving(); return; }
    var N = naming();
    for (var i = 0; i < list.length && i < 2000; i++) {
      var m = list[i];
      if (m.type === "childList") {
        for (var j = 0; j < m.addedNodes.length && j < 200; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 1) rec.fresh.add(n);
        }
        markWords(m.target.nodeType === 1 ? m.target : m.target.parentElement, N);
      } else if (m.type === "characterData") {
        markWords(m.target.parentElement, N);
      } else {
        markWords(m.target, N, true);
      }
    }
  });
  function observe() {
    if (rec.observing) return;
    rec.observing = true;
    observer.observe(doc, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "aria-labelledby", "value", "title"] });
  }
  function stopObserving() {
    if (!rec.observing) return;
    rec.observing = false;
    observer.disconnect();
  }
  function mark(f) {
    if (!f || rec.marks.has(f)) return;
    rec.marks.set(f, describe(f));
  }

  // ── The listeners (window, capture phase) ──
  win.addEventListener("pointerdown", function (e) {
    if (!rec.on || !e.isTrusted) return;
    mark(fieldOf(targetOf(e)));
  }, true);
  win.addEventListener("keydown", function (e) {
    if (!rec.on || !e.isTrusted) return;
    var f = fieldOf(targetOf(e));
    if (!f) return;
    mark(f);
    if (e.key === "Enter" && typed(f)) push({ type: "enter", control: rec.marks.get(f) || describe(f) });
  }, true);
  win.addEventListener("focusout", function (e) {
    if (!rec.on || !e.isTrusted) return;
    var f = fieldOf(targetOf(e));
    if (f) rec.marks.delete(f);
    if (rec.lastInput === f) rec.lastInput = null;
  }, true);
  win.addEventListener("input", function (e) {
    if (!rec.on || !e.isTrusted) return;
    var f = fieldOf(targetOf(e));
    if (!f || !rec.marks.has(f) || !typed(f)) return;
    rec.typedUntil = Date.now() + SUGGESTION_MS;
    observe();
    // Sent once until anything else is sent (M1): the last event sent
    // decides, whichever way it left, never the queue, which the binding
    // leaves empty.
    if (rec.lastInput === f) return;
    push({ type: "input", control: rec.marks.get(f) }, f);
  }, true);
  win.addEventListener("change", function (e) {
    if (!rec.on || !e.isTrusted) return;
    var el = targetOf(e);
    if (!el || el.tagName !== "SELECT") return;
    push({ type: "change", control: describe(el) });
  }, true);
  win.addEventListener("click", function (e) {
    if (!rec.on || !e.isTrusted) return;
    var el = targetOf(e);
    if (!el) return;
    var N = naming();
    if (!N) return;
    var c = controlOf(el, N);
    if (!c) return;
    push({ type: "click", control: describe(c) });
  }, true);
  var framed = false;
  function frameNow() {
    var a = doc.activeElement;
    if (framed || !a || (a.tagName !== "IFRAME" && a.tagName !== "FRAME")) return false;
    framed = true;
    push({ type: "frame_focus", control: null });
    return true;
  }
  win.addEventListener("blur", function (e) {
    if (!rec.on || !e.isTrusted) return;
    if (e.target && e.target.nodeType) return;
    framed = false;
    if (!frameNow()) setTimeout(frameNow, 0);
  }, true);

  rec.start = function (token) {
    rec.on = true;
    rec.token = typeof token === "string" ? token : null;
    rec.queue = [];
    rec.lost = false;
    rec.marks = new Map();
    rec.typedUntil = 0;
    rec.lastInput = null;
  };
  rec.stop = function () {
    rec.on = false;
    rec.token = null;
    rec.queue = [];
    rec.lost = false;
    rec.marks = new Map();
    rec.typedUntil = 0;
    rec.lastInput = null;
    stopObserving();
  };
  rec.drain = function () {
    var out = rec.queue.splice(0, DRAIN_MAX);
    var lost = rec.lost;
    rec.lost = false;
    return { events: out, more: rec.queue.length > 0, lost: lost };
  };
  Object.defineProperty(g, "__wkRec", { value: rec, configurable: false, enumerable: false, writable: false });
  return how;
}`;

/**
 * The script put in every new document while the person records
 * (Page.addScriptToEvaluateOnNewDocument with worldName RECORDER_WORLD), and
 * run at once in the document open then (runImmediately).
 */
export const RECORDER_SOURCE = `(${RECORDER_BODY})("new_document");`;

/**
 * What the driver runs in a recorder world (Runtime.callFunctionOn, the
 * operation passed by value): "start" (installed late when it is not there
 * yet, then switched on with its queue emptied, as watch(true) does for the
 * document open then), "ensure" (installed late when it is not there yet,
 * switched on only when it is off, so a page change keeps what the new
 * document already queued), "stop" and "drain" (never installing). Each
 * answers how the world got its recorder, and drain, ensure and stop the
 * events its queue held (stop's before it empties it).
 */
export const RECORDER_CALL = String.raw`function (op, token) {
  "use strict";
  var install = ` +
  RECORDER_BODY +
  String.raw`;
  var g = globalThis;
  if (op === "start") {
    var how = install("late");
    var r = g.__wkRec;
    if (!r) return { installed: null };
    r.start(token);
    return { installed: how };
  }
  if (op === "ensure") {
    var how2 = install("late");
    var e = g.__wkRec;
    if (!e) return { installed: null };
    if (!e.on) e.start(token);
    else e.token = typeof token === "string" ? token : null;
    // What it queued before the binding was there, handed over now.
    var held = e.drain();
    return { installed: how2, events: held.events, more: held.more, lost: held.lost };
  }
  var r2 = g.__wkRec;
  if (!r2) return { installed: null };
  if (op === "stop") {
    // What its queue still held, handed over as it stops (review of Phase 5 step 2, low 1).
    var left = r2.drain();
    r2.stop();
    return { installed: r2.how, events: left.events, more: left.more, lost: left.lost };
  }
  if (op === "drain") {
    var d = r2.drain();
    return { installed: r2.how, events: d.events, more: d.more, lost: d.lost };
  }
  return { installed: r2.how };
}`;

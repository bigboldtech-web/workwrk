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
// typing marks; stop() switches it off and empties the queue; drain() hands
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
// document that had no binding is a "may be missing" step).
//
// SUGGESTIONS AND ECHOES (spec review 2, finding 7). For 10 seconds after
// each counted input, in a form or not, a MutationObserver marks what comes
// into the page (a click inside it is a suggestion) and the controls whose
// words, value attribute or labels change (they keep only their role). It
// reads whether words changed, never what they are.
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
// read gives it, for the fold only. A combobox that is no text field is
// named by nothing of its own (its words are its current value), only by its
// label; a suggestion and a control whose words changed with the person's
// typing by none at all (they can echo what was typed, and steps.ts never
// reads either's words).
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
  var QUEUE_MAX = 1000, DRAIN_MAX = 200, SUGGESTION_MS = 10000, FORM_FIELDS_MAX = 40, FIELDS_SCAN = 400, PAGE_MAX = 4096, HREF_MAX = 8193;
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
    observing: false,
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

  function push(ev) {
    if (!rec.on) return;
    ev.at = Date.now();
    ev.page = String(location.href).slice(0, PAGE_MAX);
    // Out at once through this world's binding, else into the queue for the driver's drain.
    var out = g["` +
  RECORDER_BINDING +
  String.raw`"];
    if (rec.token !== null && typeof out === "function") {
      try {
        out(JSON.stringify({ t: rec.token, e: ev }));
        return;
      } catch (x) {
        /* the queue keeps it */
      }
    }
    if (rec.queue.length >= QUEUE_MAX) { rec.lost = true; return; }
    rec.queue.push(ev);
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
  // The control a click is on: the nearest one up from its target; none for a
  // label (its control's own click follows); else a clickable element the page
  // drew (a pointer cursor or an onclick), the outermost of its run.
  function controlOf(el, N) {
    var e, i;
    for (e = el, i = 0; e && e.nodeType === 1 && i < 25; e = parentOf(e), i++) {
      var t = e.tagName;
      if (t === "LABEL") return null;
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
  // The opener (a combobox, aria-haspopup) whose popup holds el, or null.
  function popupOpener(el) {
    for (var e = el, i = 0; e && e.nodeType === 1 && i < 25; e = parentOf(e), i++) {
      if (!e.id) continue;
      var o = null;
      try { o = doc.querySelector('[aria-controls~="' + cssId(e.id) + '"], [aria-owns~="' + cssId(e.id) + '"]'); } catch (x) { o = null; }
      if (o && o !== e && (roleAttr(o) === "combobox" || (o.getAttribute("aria-haspopup") || "false") !== "false")) return o;
    }
    return null;
  }
  function isOpener(el, role) {
    if (el.tagName === "SELECT") return false;
    return role === "combobox" || (el.getAttribute("aria-haspopup") || "false") !== "false";
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
  // words or a part of it, nor a list or a combobox (their words can be a value).
  function ownLabelledBy(el, N) {
    var ids = (el.getAttribute("aria-labelledby") || "").trim();
    if (!ids) return "";
    var rootNode = el.getRootNode ? el.getRootNode() : doc;
    var parts = [];
    ids.split(/\s+/).slice(0, 5).forEach(function (id) {
      var t = rootNode.getElementById ? rootNode.getElementById(id) : doc.getElementById(id);
      if (!t || t === el || el.contains(t) || t.contains(el)) return;
      var r = roleAttr(t);
      if (r === "combobox" || r === "listbox" || r === "option" || t.tagName === "SELECT" || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (freshUp(t) && rec.typedUntil > 0) return;
      parts.push(N.visibleText(t, 300));
    });
    return N.clean(parts.join(" "));
  }
  // An opener's label: its own label, never its shown words when it is a combobox (they are its value).
  function openerLabel(el, role, N) {
    var by = ownLabelledBy(el, N);
    if (by) return by;
    var aria = N.clean(el.getAttribute("aria-label"));
    if (aria) return aria;
    var lab = el.labels ? N.labelText(el) : "";
    if (lab) return lab;
    return role === "combobox" ? "" : N.nameOf(el, role);
  }
  // The label of the group, list or popup a control sits in; "" from a label that came in with a suggestion.
  function groupOf(el, role, popup, N) {
    var g = closestSel(el, "fieldset, [role=radiogroup], [role=group], [role=listbox], [role=menu], [role=tree], [role=treegrid], [role=grid], [role=tablist]");
    if (g) {
      if (g.tagName === "FIELDSET") {
        var lg = g.querySelector("legend");
        if (lg && !(freshUp(lg) && freshUp(el))) {
          var w = N.visibleText(lg, 300);
          if (w) return w;
        }
      } else {
        var by = ownLabelledBy(g, N);
        if (by) return by;
        if (!freshUp(g)) {
          var aria = N.clean(g.getAttribute("aria-label"));
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
  function listLabel(list, N) {
    if (!list) return "";
    var cap = list.tagName === "TABLE" ? list.querySelector("caption") : null;
    if (cap) {
      var c = N.visibleText(cap, 300);
      if (c) return c;
    }
    return ownLabelledBy(list, N) || N.clean(list.getAttribute("aria-label"));
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
    return {
      tag: tag.toLowerCase(),
      type: tag === "INPUT" ? (el.getAttribute("type") || "text").toLowerCase().slice(0, 40) : null,
      autocomplete: input ? el.getAttribute("autocomplete") || null : null,
      inputmode: input ? el.getAttribute("inputmode") || null : null,
      nameAttr: input ? el.getAttribute("name") || null : null,
      idAttr: input ? el.getAttribute("id") || null : null,
      label: input ? N.labelHint(el) || null : null,
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
    // only. A suggestion's words, and words that changed with the person's
    // typing, can hold what they typed: steps.ts never reads either
    // (classWords), so neither leaves the page.
    var valueShown = role === "combobox" && !field;
    var wordsChanged = rec.changed.has(el);
    var name = valueShown || suggestion || wordsChanged ? "" : N.nameOf(el, role);
    var group = opener ? openerLabel(el, role, N) : groupOf(el, role, popup, N);
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
      inRow: rowOf(el, N),
      inNav: !!closestSel(el, "nav, [role=navigation], [role=menubar], [role=tablist]"),
      suggestion: suggestion,
      wordsChanged: wordsChanged,
      href: tag === "A" && typeof el.href === "string" && el.href ? String(el.href).slice(0, HREF_MAX) : null,
      hints: hintsOf(el, N),
      formFields: fieldsOf(form, N)
    };
  }

  // ── Suggestions and echoes (see the file header) ──
  function markWords(el, N) {
    if (!el || el.nodeType !== 1 || !N) return;
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
        markWords(m.target, N);
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
    var last = rec.queue.length ? rec.queue[rec.queue.length - 1] : null;
    if (rec.lastInput === f && last && last.type === "input") return;
    rec.lastInput = f;
    push({ type: "input", control: rec.marks.get(f) });
  }, true);
  win.addEventListener("change", function (e) {
    if (!rec.on || !e.isTrusted) return;
    var el = targetOf(e);
    if (!el || el.tagName !== "SELECT") return;
    rec.lastInput = null;
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
    rec.lastInput = null;
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
 * answers how the world got its recorder, and drain the events.
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
    r2.stop();
    return { installed: r2.how };
  }
  if (op === "drain") {
    var d = r2.drain();
    return { installed: r2.how, events: d.events, more: d.more, lost: d.lost };
  }
  return { installed: r2.how };
}`;

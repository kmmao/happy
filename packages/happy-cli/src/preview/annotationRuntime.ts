/**
 * Visual annotation runtime — injected into HTML responses served through
 * the preview tunnel. Provides hover highlighting, element selection,
 * and structured data extraction for UI feedback.
 */

const ANNOTATION_INJECTED_MARKER = "data-happy-annotation-runtime";

/** The browser-side JavaScript injected before </body>. */
const ANNOTATION_BROWSER_SCRIPT = String.raw`
(function() {
  "use strict";

  var SET_MODE = "SET_ANNOTATION_MODE";
  var TARGET = "HAPPY_ANNOTATION_TARGET";
  var OVERLAY_ATTR = "data-happy-annotation-overlay";
  var MAX_PARENT_DEPTH = 5;

  var STYLE_FIELDS = [
    "display","position","width","height","margin","padding","gap",
    "color","backgroundColor","fontSize","fontWeight","lineHeight",
    "border","borderRadius","opacity","visibility","overflow","zIndex"
  ];

  var SEMANTIC_SELECTOR = "button,a[href],input,textarea,select,label,summary,details,[role],[aria-label],[data-testid]";
  var TEXT_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,td,th";
  var SECTION_SELECTOR = "form,nav,main,header,footer,section,article,aside";
  var INLINE_TEXT_SELECTOR = "span,strong,em,b,i,small,code";

  var enabled = false;
  var overlay = null;
  var currentTarget = null;
  var hoverFrame = 0;
  var pendingEvent = null;

  function round(v) { return Math.round(v * 100) / 100; }
  function ratio(v, s) { return s > 0 ? round(v / s) : 0; }
  function truncate(v, max) { return v.length <= max ? v : v.slice(0, max - 3) + "..."; }
  function normalizeText(v, max) {
    var t = String(v || "").replace(/\s+/g, " ").trim();
    return t ? truncate(t, max || 240) : "";
  }
  function getTag(el) { return el.tagName.toLowerCase(); }
  function safeMatches(el, sel) { try { return el.matches(sel); } catch(e) { return false; } }
  function isOverlay(el) { return Boolean(el && el.closest("[" + OVERLAY_ATTR + "]")); }

  // Smart element selection: find the most meaningful ancestor
  function findSemanticTarget(raw) {
    var candidates = [];
    var cur = raw;
    var depth = 0;
    while (cur && depth <= MAX_PARENT_DEPTH) { candidates.push(cur); cur = cur.parentElement; depth++; }
    return (
      candidates.find(function(c) { return safeMatches(c, SEMANTIC_SELECTOR); }) ||
      candidates.find(function(c) { return safeMatches(c, TEXT_SELECTOR); }) ||
      candidates.find(function(c) { return safeMatches(c, INLINE_TEXT_SELECTOR); }) ||
      candidates.find(function(c) { return safeMatches(c, SECTION_SELECTOR); }) ||
      raw
    );
  }

  function getElementAtPoint(event) {
    var raw = document.elementFromPoint(event.clientX, event.clientY);
    if (!raw || isOverlay(raw)) return null;
    return findSemanticTarget(raw);
  }

  // Overlay management
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.setAttribute(OVERLAY_ATTR, "true");
    overlay.style.cssText = "position:fixed;top:0;left:0;pointer-events:none;box-sizing:border-box;" +
      "border:2px solid rgba(37,99,235,0.9);background:rgba(37,99,235,0.08);border-radius:4px;" +
      "z-index:2147483647;display:none;transition:transform 80ms ease,width 80ms ease,height 80ms ease;";
    (document.body || document.documentElement).appendChild(overlay);
    return overlay;
  }

  function updateOverlay(target) {
    var node = ensureOverlay();
    if (!enabled || !target) { node.style.display = "none"; return; }
    var rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) { node.style.display = "none"; return; }
    node.style.display = "block";
    node.style.transform = "translate(" + round(rect.left) + "px," + round(rect.top) + "px)";
    node.style.width = round(rect.width) + "px";
    node.style.height = round(rect.height) + "px";
  }

  // CSS Selector generation
  function selectorSegment(el) {
    var tag = getTag(el);
    if (el.id) return "#" + CSS.escape(el.id);
    var cls = Array.from(el.classList).filter(function(c) { return !/^[0-9]/.test(c); });
    if (cls.length) return tag + "." + cls.map(function(c) { return CSS.escape(c); }).join(".");
    var parent = el.parentElement;
    if (!parent) return tag;
    var siblings = Array.from(parent.children).filter(function(c) { return getTag(c) === tag; });
    if (siblings.length > 1) return tag + ":nth-of-type(" + (siblings.indexOf(el) + 1) + ")";
    return tag;
  }

  function buildSelector(el) {
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && depth < 6) {
      parts.unshift(selectorSegment(cur));
      var sel = parts.join(" > ");
      try { if (document.querySelector(sel) === el) return sel; } catch(e) { return getTag(el); }
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(" > ") || getTag(el);
  }

  function buildXPath(el) {
    if (el.id) return '//*[@id="' + el.id.replace(/"/g, '\\"') + '"]';
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1) {
      var tag = getTag(cur);
      var idx = 1;
      var sib = cur.previousElementSibling;
      while (sib) { if (getTag(sib) === tag) idx++; sib = sib.previousElementSibling; }
      parts.unshift(tag + "[" + idx + "]");
      cur = cur.parentElement;
    }
    return "/" + parts.join("/");
  }

  function collectAttributes(el) {
    var names = ["id","class","role","aria-label","title","alt","name","type","placeholder","href","src","data-testid"];
    var attrs = {};
    names.forEach(function(n) { var v = el.getAttribute(n); if (v) attrs[n] = truncate(v, 200); });
    return attrs;
  }

  function summarizeText(el, max) { return normalizeText(el.textContent, max); }

  function getComputedStyleSummary(el) {
    var cs = window.getComputedStyle(el);
    var result = {};
    STYLE_FIELDS.forEach(function(f) { result[f] = cs[f]; });
    return result;
  }

  function outerHTMLPreview(el) {
    var html = el.outerHTML;
    if (html.length > 500) {
      var tag = getTag(el);
      var openTag = html.slice(0, html.indexOf(">") + 1);
      return truncate(openTag, 300) + "..." + "</" + tag + ">";
    }
    return html;
  }

  function ancestors(el) {
    var result = [];
    var cur = el.parentElement;
    while (cur && result.length < 6) {
      result.push({
        tag: getTag(cur),
        id: cur.id || undefined,
        role: cur.getAttribute("role") || undefined,
        selector: buildSelector(cur),
        text: summarizeText(cur, 120) || undefined,
        attributes: collectAttributes(cur)
      });
      cur = cur.parentElement;
    }
    return result;
  }

  function siblingTexts(el) {
    var texts = [];
    var parent = el.parentElement;
    if (!parent) return texts;
    Array.from(parent.children).forEach(function(sib) {
      if (sib !== el) { var t = summarizeText(sib, 100); if (t) texts.push(t); }
    });
    return texts.slice(0, 3);
  }

  function buildPayload(el, event) {
    var rect = el.getBoundingClientRect();
    var vp = { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY, devicePixelRatio: window.devicePixelRatio };
    return {
      page: { url: location.pathname + location.search + location.hash, pathname: location.pathname, title: document.title, viewport: vp },
      click: { clientX: round(event.clientX), clientY: round(event.clientY), pageX: round(event.pageX), pageY: round(event.pageY), viewportXRatio: ratio(event.clientX, vp.width), viewportYRatio: ratio(event.clientY, vp.height) },
      target: {
        tag: getTag(el), id: el.id || undefined, className: normalizeText(el.className, 240) || undefined,
        role: el.getAttribute("role") || undefined, attributes: collectAttributes(el),
        text: summarizeText(el, 240) || undefined,
        rect: { x: round(rect.left), y: round(rect.top), width: round(rect.width), height: round(rect.height) },
        rectRatio: { x: ratio(rect.left, vp.width), y: ratio(rect.top, vp.height), width: ratio(rect.width, vp.width), height: ratio(rect.height, vp.height) },
        selector: buildSelector(el), xpath: buildXPath(el), outerHTMLPreview: outerHTMLPreview(el)
      },
      ancestors: ancestors(el),
      nearbyText: { self: summarizeText(el, 240) || undefined, parentSummary: el.parentElement ? summarizeText(el.parentElement, 240) || undefined : undefined, siblingTexts: siblingTexts(el) },
      style: getComputedStyleSummary(el)
    };
  }

  function postToParent(msg) {
    try {
      if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === "function") {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      } else if (window.parent !== window) {
        window.parent.postMessage(msg, "*");
      }
    } catch(e) {}
  }

  // Event handlers
  function onMouseMove(e) {
    pendingEvent = e;
    if (hoverFrame || !enabled) return;
    hoverFrame = requestAnimationFrame(function() {
      hoverFrame = 0;
      if (!enabled || !pendingEvent) return;
      currentTarget = getElementAtPoint(pendingEvent);
      updateOverlay(currentTarget);
      pendingEvent = null;
    });
  }

  function onClick(e) {
    if (!enabled) return;
    var target = getElementAtPoint(e);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    postToParent({ type: TARGET, payload: buildPayload(target, e) });
  }

  // Message listener for mode toggling
  window.addEventListener("message", function(e) {
    var data = e.data;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch(err) { return; } }
    if (!data || data.type !== SET_MODE) return;
    enabled = !!data.enabled;
    if (!enabled) { updateOverlay(null); currentTarget = null; }
  });

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
})();
`;

/**
 * Inject the visual annotation runtime into an HTML string.
 * Inserts before </body>, or </html>, or appends to end.
 * Returns the original string unchanged if the marker is already present.
 */
export function injectAnnotationRuntime(html: string): string {
  if (html.includes(ANNOTATION_INJECTED_MARKER)) return html;

  const scriptTag = `<script ${ANNOTATION_INJECTED_MARKER}="true">${ANNOTATION_BROWSER_SCRIPT.replace(/<\/script/g, "<\\/script")}<\/script>`;

  const bodyClose = html.lastIndexOf("</body>");
  if (bodyClose !== -1)
    return html.slice(0, bodyClose) + scriptTag + html.slice(bodyClose);

  const htmlClose = html.lastIndexOf("</html>");
  if (htmlClose !== -1)
    return html.slice(0, htmlClose) + scriptTag + html.slice(htmlClose);

  return html + scriptTag;
}

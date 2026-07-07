/* Mermaid Animator — render a mermaid diagram, tag nodes/edges with animation
   presets via click, preview live (Web Animations API), export a looping GIF
   by stepping the animation clock frame-by-frame and baking computed styles
   into a serialized SVG snapshot per frame. */

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "loose",
  theme: "base",
  themeVariables: {
    primaryColor: "#ffffff",
    primaryTextColor: "#1c1e23",
    primaryBorderColor: "#00bfb3",
    lineColor: "#8a8f98",
    secondaryColor: "#f04e98",
    tertiaryColor: "#fec514",
    fontFamily: "-apple-system, Helvetica Neue, Arial, sans-serif",
    fontSize: "16px",
  },
});

const els = {
  source: document.getElementById("source"),
  sourceHighlight: document.getElementById("source-highlight"),
  lineNumbers: document.getElementById("line-numbers"),
  renderBtn: document.getElementById("render-btn"),
  host: document.getElementById("diagram-host"),
  tagList: document.getElementById("tag-list"),
  cycleDuration: document.getElementById("cycle-duration"),
  exportFormat: document.getElementById("export-format"),
  exportWidth: document.getElementById("export-width"),
  exportFps: document.getElementById("export-fps"),
  exportTransparent: document.getElementById("export-transparent"),
  formatHint: document.getElementById("format-hint"),
  exportBtn: document.getElementById("export-btn"),
  exportStatus: document.getElementById("export-status"),
  picker: document.getElementById("preset-picker"),
  pickerBody: document.getElementById("preset-picker-body"),
  pickerClose: document.getElementById("preset-picker-close"),
  canvasWrap: document.querySelector(".canvas-wrap"),
  bgToggle: document.getElementById("canvas-bg-toggle"),
  zoomIn: document.getElementById("zoom-in"),
  zoomOut: document.getElementById("zoom-out"),
  zoomReset: document.getElementById("zoom-reset"),
  zoomLevel: document.getElementById("zoom-level"),
  colorPickerBtn: document.getElementById("color-picker-btn"),
  toast: document.getElementById("toast"),
  docLink: document.getElementById("doc-link"),
  signalFlowSection: document.getElementById("signal-flow-section"),
  signalFlowToggle: document.getElementById("signal-flow-toggle"),
  exportProjectBtn: document.getElementById("export-project-btn"),
  importProjectBtn: document.getElementById("import-project-btn"),
  importProjectInput: document.getElementById("import-project-input"),
};

const TRANSPARENT_KEY = "#ff00ff";
const SVG_NS = "http://www.w3.org/2000/svg";
const GIF_WORKER_CDN_URL = "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js";

// Browsers refuse to construct a Worker directly from a cross-origin URL (this fails
// even with CORS headers present — it's a hard same-origin rule on the Worker
// constructor, not a fetch restriction). The standard workaround: fetch the script
// ourselves (fetch() does respect CORS, and jsdelivr sends Access-Control-Allow-Origin)
// and hand gif.js a same-origin blob: URL instead. Cached so we only fetch it once.
let gifWorkerScriptUrlPromise = null;
function getGifWorkerScriptUrl() {
  if (!gifWorkerScriptUrlPromise) {
    gifWorkerScriptUrlPromise = fetch(GIF_WORKER_CDN_URL)
      .then((r) => r.text())
      .then((code) => URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
  }
  return gifWorkerScriptUrlPromise;
}

function mod(a, n) {
  return ((a % n) + n) % n;
}

// Reads the actual rendered stroke color off a node's shape (rect/polygon/circle/...)
// so glow effects match the node's own outline instead of a hardcoded color.
function nodeStrokeRGB(nodeEl) {
  const shape = nodeEl.querySelector("rect, polygon, path, circle, ellipse");
  const stroke = shape ? getComputedStyle(shape).stroke : null;
  const match = stroke && /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(stroke);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 191, 179];
}

/* Each preset either has a `build(duration, target)` returning {keyframes, options}
   (applied directly to the node/edge, or its transform-safe wrapper), or is one of
   the two hand-rolled multi-target presets (signal / signal-react) built below. */
const PRESETS = {
  pulse: {
    label: "Pulse",
    kind: "node",
    needsWrapper: true,
    bakeProps: ["transform"],
    build(duration) {
      return {
        keyframes: [{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }],
        options: { duration, iterations: Infinity, easing: "ease-in-out" },
      };
    },
  },
  glow: {
    label: "Glow",
    kind: "node",
    needsWrapper: false,
    bakeProps: ["filter"],
    build(duration, el) {
      const [r, g, b] = nodeStrokeRGB(el);
      return {
        keyframes: [
          { filter: `drop-shadow(0 0 0px rgba(${r},${g},${b},0))` },
          { filter: `drop-shadow(0 0 10px rgba(${r},${g},${b},0.65))` },
          { filter: `drop-shadow(0 0 0px rgba(${r},${g},${b},0))` },
        ],
        options: { duration, iterations: Infinity, easing: "ease-in-out" },
      };
    },
  },
  "fade-in": {
    label: "Fade in",
    kind: "node",
    needsWrapper: false,
    bakeProps: ["opacity"],
    build(duration) {
      return {
        keyframes: [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1 }],
        options: { duration, iterations: Infinity, easing: "ease-out" },
      };
    },
  },
  flow: {
    label: "Flow (marching dashes)",
    kind: "edge",
    needsWrapper: false,
    bakeProps: ["strokeDasharray", "strokeDashoffset"],
    build(duration) {
      const segDuration = Math.max(200, duration / 4);
      return {
        keyframes: [{ strokeDasharray: "8 6", strokeDashoffset: 0 }, { strokeDasharray: "8 6", strokeDashoffset: -28 }],
        options: { duration: segDuration, iterations: Infinity, easing: "linear" },
      };
    },
  },
  draw: {
    label: "Draw on",
    kind: "edge",
    needsWrapper: false,
    bakeProps: ["strokeDasharray", "strokeDashoffset"],
    build(duration, el) {
      const len = el.getTotalLength ? el.getTotalLength() : 200;
      return {
        keyframes: [
          { strokeDasharray: `${len}`, strokeDashoffset: len },
          { strokeDasharray: `${len}`, strokeDashoffset: 0, offset: 0.3 },
          { strokeDasharray: `${len}`, strokeDashoffset: 0 },
        ],
        options: { duration, iterations: Infinity, easing: "ease-in-out" },
      };
    },
  },
  signal: {
    label: "Signal (flowing dots)",
    kind: "edge",
    configFields: [
      { key: "count", label: "Signals per cycle", type: "number", default: 3, min: 1 },
      { key: "color", label: "Signal color", type: "color", default: "#00bfb3" },
    ],
  },
  "signal-react": {
    label: "React to incoming signal",
    kind: "node",
    configFields: [
      { key: "count", label: "Signals per cycle", type: "number", default: 3, min: 1 },
      { key: "style", label: "Reaction", type: "select", options: ["pulse", "glow"], default: "pulse" },
    ],
  },
};

let registry = []; // { id, kind, kindIndex, el, wrapper, preset, config, animations, extraEls, label }
let selected = null;
let counter = 0;
let edgeHitStrokeWidth = 16;

function cycleDuration() {
  return Math.max(200, parseInt(els.cycleDuration.value, 10) || 2500);
}

function shortLabel(el, kind, idx) {
  if (kind === "edge") return `Edge ${idx + 1}`;
  const labelEl = el.querySelector(".nodeLabel, text");
  const text = labelEl ? labelEl.textContent.trim() : "";
  return text ? text.slice(0, 28) : `Node ${idx + 1}`;
}

async function renderDiagram() {
  const previousTags = registry
    .filter((r) => r.preset !== "none")
    .map((r) => ({ kind: r.kind, kindIndex: r.kindIndex, preset: r.preset, config: r.config }));

  registry.forEach(clearEntryAnimations);
  registry = [];
  selected = null;
  hidePicker();

  const id = "mmd-" + Date.now() % 100000;
  const src = els.source.value;
  let svgText;
  try {
    const result = await mermaid.render(id, src);
    svgText = result.svg;
  } catch (err) {
    els.host.innerHTML = `<pre style="color:#f04e98">${String(err.message || err)}</pre>`;
    return;
  }
  els.host.innerHTML = svgText;
  const svg = els.host.querySelector("svg");

  // Force native (1 user-unit = 1px) sizing instead of mermaid's default width:100%,
  // so "zoom" is the only thing scaling the diagram — makes fit-to-window and the
  // hit-area math below both simple and predictable.
  svg.removeAttribute("height");
  const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal : null;
  if (vb) {
    svg.setAttribute("width", vb.width);
    svg.setAttribute("height", vb.height);
  }
  svg.style.maxWidth = "none";
  svg.style.display = "block";

  if (vb) fitZoomToWindow(vb.width, vb.height);

  // Edges are thin strokes; a fixed hit-area stroke-width in SVG user-units would
  // cover very different real screen pixels depending on zoom, since 1 unit = 1px
  // only at zoom 1. Scale it by the current zoom so it stays ~14 real screen px.
  edgeHitStrokeWidth = Math.min(60, Math.max(8, 14 / zoom));

  const nodeEls = Array.from(svg.querySelectorAll(".node"));
  const edgeEls = Array.from(svg.querySelectorAll(".edgePaths path, g.edgePaths path, path.flowchart-link"));

  nodeEls.forEach((el, idx) => registerElement(el, "node", idx));
  edgeEls.forEach((el, idx) => registerElement(el, "edge", idx));

  // best-effort re-apply of tags from before a re-render (matched by order of appearance)
  previousTags.forEach((tag) => {
    const match = registry.find((r) => r.kind === tag.kind && r.kindIndex === tag.kindIndex);
    if (match) applyPreset(match, tag.preset, tag.config);
  });

  renderTagList();
  updateSignalFlowSection();
}

function registerElement(el, kind, kindIndex) {
  const id = `a${counter++}`;
  el.dataset.animId = id;
  el.style.cursor = "pointer";
  const entry = {
    id,
    kind,
    kindIndex,
    el,
    wrapper: null,
    preset: "none",
    config: {},
    animations: [],
    extraEls: [],
    label: shortLabel(el, kind, kindIndex),
  };
  registry.push(entry);

  // Edges are thin strokes — clicking the visible line precisely is hard, so give
  // them a fat invisible overlay to actually capture the click.
  let clickTarget = el;
  if (kind === "edge") {
    const hit = el.cloneNode(false);
    hit.removeAttribute("id");
    hit.removeAttribute("class"); // drop mermaid's class so its stylesheet can't override the inline styles below
    hit.removeAttribute("marker-end");
    hit.removeAttribute("marker-start");
    // inline styles (not attributes) so mermaid's own embedded <style> rules (e.g.
    // ".edge-thickness-normal { stroke-width: 1px }") can't win the cascade and shrink the hit area.
    hit.style.fill = "none";
    hit.style.stroke = "transparent";
    hit.style.strokeWidth = edgeHitStrokeWidth + "px";
    hit.style.pointerEvents = "stroke";
    hit.style.cursor = "pointer";
    el.parentNode.insertBefore(hit, el.nextSibling);
    clickTarget = hit;
  }

  clickTarget.addEventListener("click", (ev) => {
    ev.stopPropagation();
    selectEntry(entry);
  });
}

function getAnimTarget(entry, needsWrapper) {
  if (!needsWrapper) return entry.el;
  if (entry.wrapper) return entry.wrapper;
  const wrapper = document.createElementNS(SVG_NS, "g");
  wrapper.dataset.animId = entry.id + "-wrap";
  wrapper.style.transformBox = "fill-box";
  wrapper.style.transformOrigin = "center";
  while (entry.el.firstChild) wrapper.appendChild(entry.el.firstChild);
  entry.el.appendChild(wrapper);
  entry.wrapper = wrapper;
  return wrapper;
}

function clearEntryAnimations(entry) {
  (entry.animations || []).forEach((a) => a.animation.cancel());
  (entry.extraEls || []).forEach((el) => el.remove());
  entry.animations = [];
  entry.extraEls = [];
}

function applyPreset(entry, presetName, config) {
  clearEntryAnimations(entry);
  entry.preset = presetName;
  entry.config = config || {};
  if (presetName === "none") return;

  if (presetName === "signal") {
    buildSignalEdge(entry, cycleDuration(), entry.config.count || 3, entry.config.color || "#00bfb3");
    return;
  }
  if (presetName === "signal-react") {
    buildSignalReaction(entry, cycleDuration(), entry.config.count || 3, entry.config.style || "pulse");
    return;
  }

  const presetDef = PRESETS[presetName];
  const target = getAnimTarget(entry, presetDef.needsWrapper);
  const { keyframes, options } = presetDef.build(cycleDuration(), target);
  const animation = target.animate(keyframes, options);
  entry.animations = [{ target, animation, bakeProps: presetDef.bakeProps }];
}

/* Both signal dots and their receiving node's reaction anchor their phase to
   document.timeline (a shared, page-wide clock) instead of "whenever .animate() was
   called" — otherwise tagging the edge and the node a few seconds apart leaves them
   out of sync forever, even with matching counts, since each would start its own
   internal clock at a different real moment. Anchoring to the same clock means two
   animations with the same period line up regardless of when each was created. */
function syncToWallClock(animation, period, phaseOffsetMs) {
  animation.currentTime = mod(document.timeline.currentTime + phaseOffsetMs, period);
}

/* N dots travel the edge's own path once per `interval` (duration/count), evenly
   staggered so they read as a continuous, steady-state stream. */
function buildSignalEdge(entry, duration, count, color) {
  const pathEl = entry.el;
  const d = pathEl.getAttribute("d");
  const parent = pathEl.parentNode;
  const interval = duration / Math.max(1, count);
  const animations = [];
  const extraEls = [];

  for (let i = 0; i < count; i++) {
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.dataset.animId = `${entry.id}-sig${i}`;
    dot.setAttribute("r", "5");
    dot.setAttribute("fill", color || "#00bfb3");
    dot.style.offsetPath = `path("${d}")`;
    dot.style.offsetRotate = "0deg";
    parent.appendChild(dot);
    extraEls.push(dot);

    const animation = dot.animate(
      [
        { offsetDistance: "0%", opacity: 0, offset: 0 },
        { offsetDistance: "4%", opacity: 1, offset: 0.04 },
        { offsetDistance: "92%", opacity: 1, offset: 0.92 },
        { offsetDistance: "100%", opacity: 0, offset: 1 },
      ],
      { duration, iterations: Infinity, easing: "linear" }
    );
    const phaseOffset = i * interval;
    syncToWallClock(animation, duration, phaseOffset);
    animations.push({ target: dot, animation, bakeProps: ["offsetDistance", "opacity"], phaseOffset, period: duration });
  }

  entry.animations = animations;
  entry.extraEls = extraEls;
}

/* A node reaction that repeats once per `duration/count` — i.e. once per signal
   arrival, assuming the feeding edge is tagged with the same count. The peak sits
   at offset 0 (the instant a signal arrives, since arrivals land on period
   boundaries — see buildSignalEdge), then eases back down over the rest of the period. */
function buildSignalReaction(entry, duration, count, style) {
  const period = Math.max(50, duration / Math.max(1, count));
  let target;
  let bakeProps;
  let keyframes;

  if (style === "glow") {
    target = entry.el;
    bakeProps = ["filter"];
    const [r, g, b] = nodeStrokeRGB(entry.el);
    keyframes = [
      { filter: `drop-shadow(0 0 12px rgba(${r},${g},${b},0.85))`, offset: 0 },
      { filter: `drop-shadow(0 0 0px rgba(${r},${g},${b},0))`, offset: 0.4 },
      { filter: `drop-shadow(0 0 0px rgba(${r},${g},${b},0))`, offset: 1 },
    ];
  } else {
    target = getAnimTarget(entry, true);
    bakeProps = ["transform"];
    keyframes = [
      { transform: "scale(1.12)", offset: 0 },
      { transform: "scale(1)", offset: 0.4 },
      { transform: "scale(1)", offset: 1 },
    ];
  }

  const animation = target.animate(keyframes, { duration: period, iterations: Infinity, easing: "ease-out" });
  syncToWallClock(animation, period, 0);
  entry.animations = [{ target, animation, bakeProps, phaseOffset: 0, period }];
}

function selectEntry(entry) {
  if (selected) selected.el.style.outline = "";
  selected = entry;
  entry.el.style.outline = "3px solid #f04e98";
  entry.el.style.outlineOffset = "2px";
  renderPickerFor(entry);
  showPicker();
}

function renderPickerFor(entry) {
  els.pickerBody.innerHTML = "";

  const noneBtn = document.createElement("button");
  noneBtn.textContent = "None";
  noneBtn.addEventListener("click", () => {
    applyPreset(entry, "none", {});
    hidePicker();
    renderTagList();
  });
  els.pickerBody.appendChild(noneBtn);

  Object.entries(PRESETS)
    .filter(([, def]) => def.kind === entry.kind)
    .forEach(([name, def]) => {
      if (!def.configFields) {
        const btn = document.createElement("button");
        btn.textContent = def.label;
        btn.addEventListener("click", () => {
          applyPreset(entry, name, {});
          hidePicker();
          renderTagList();
        });
        els.pickerBody.appendChild(btn);
        return;
      }

      const wrap = document.createElement("div");
      wrap.className = "preset-config";
      const title = document.createElement("div");
      title.className = "preset-config-title";
      title.textContent = def.label;
      wrap.appendChild(title);

      const inputs = {};
      def.configFields.forEach((field) => {
        const label = document.createElement("label");
        label.textContent = field.label;
        let input;
        if (field.type === "select") {
          input = document.createElement("select");
          field.options.forEach((opt) => {
            const o = document.createElement("option");
            o.value = opt;
            o.textContent = opt;
            input.appendChild(o);
          });
        } else if (field.type === "color") {
          input = document.createElement("input");
          input.type = "color";
        } else {
          input = document.createElement("input");
          input.type = "number";
          input.min = String(field.min || 1);
        }
        const existing = entry.preset === name ? entry.config[field.key] : undefined;
        input.value = existing !== undefined ? existing : field.default;
        inputs[field.key] = input;
        label.appendChild(input);
        wrap.appendChild(label);
      });

      const doApply = () => {
        const config = {};
        def.configFields.forEach((field) => {
          const raw = inputs[field.key].value;
          config[field.key] = field.type === "number" ? Math.max(field.min || 1, parseInt(raw, 10) || field.default) : raw;
        });
        applyPreset(entry, name, config);
        hidePicker();
        renderTagList();
      };

      // Native color inputs open the OS picker; its own OK/Done closes it and fires
      // "change" — treat that as confirmation and apply immediately, rather than
      // requiring a separate click on our own Apply button afterward.
      def.configFields
        .filter((field) => field.type === "color")
        .forEach((field) => inputs[field.key].addEventListener("change", doApply));

      Object.values(inputs).forEach((input) => {
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            doApply();
          }
        });
      });

      const applyBtn = document.createElement("button");
      applyBtn.className = "preset-apply";
      applyBtn.textContent = "Apply";
      applyBtn.addEventListener("click", doApply);
      wrap.appendChild(applyBtn);
      els.pickerBody.appendChild(wrap);
    });
}

function showPicker() {
  els.picker.classList.remove("hidden");
}
function hidePicker() {
  els.picker.classList.add("hidden");
  if (selected) selected.el.style.outline = "";
}

els.pickerClose.addEventListener("click", hidePicker);
els.host.addEventListener("click", () => hidePicker());

function renderTagList() {
  const tagged = registry.filter((r) => r.preset !== "none");
  els.tagList.innerHTML = "";
  if (tagged.length === 0) {
    els.tagList.innerHTML = '<li style="color:#8a8f98">No tags yet</li>';
  } else {
    tagged.forEach((entry) => {
      const configSummary = Object.entries(entry.config || {})
        .map(([k, v]) => (k === "color" ? `${k}: <span class="tag-swatch" style="background:${v}"></span>${v}` : `${k}: ${v}`))
        .join(", ");
      const li = document.createElement("li");
      li.innerHTML = `
        <span>
          <span class="tag-kind">${entry.kind}</span><br>${entry.label}
          ${configSummary ? `<span class="tag-config">${configSummary}</span>` : ""}
        </span>
        <span class="tag-preset">${PRESETS[entry.preset].label}</span>
      `;
      li.style.cursor = "pointer";
      li.addEventListener("click", () => selectEntry(entry));
      els.tagList.appendChild(li);
    });
  }
  saveAutosave();
}

// --- reference docs link, kept in sync with whatever diagram type is in the textarea ---
const DIAGRAM_DOCS = [
  { match: /^(flowchart|graph)\b/i, label: "Flowchart", slug: "flowchart" },
  { match: /^sequenceDiagram\b/i, label: "Sequence diagram", slug: "sequenceDiagram" },
  { match: /^classDiagram\b/i, label: "Class diagram", slug: "classDiagram" },
  { match: /^stateDiagram/i, label: "State diagram", slug: "stateDiagram" },
  { match: /^erDiagram\b/i, label: "ER diagram", slug: "entityRelationshipDiagram" },
  { match: /^journey\b/i, label: "User journey", slug: "userJourney" },
  { match: /^gantt\b/i, label: "Gantt chart", slug: "gantt" },
  { match: /^pie\b/i, label: "Pie chart", slug: "pie" },
  { match: /^quadrantChart\b/i, label: "Quadrant chart", slug: "quadrantChart" },
  { match: /^requirementDiagram\b/i, label: "Requirement diagram", slug: "requirementDiagram" },
  { match: /^gitGraph\b/i, label: "Git graph", slug: "gitgraph" },
  { match: /^mindmap\b/i, label: "Mindmap", slug: "mindmap" },
  { match: /^timeline\b/i, label: "Timeline", slug: "timeline" },
  { match: /^sankey/i, label: "Sankey", slug: "sankey" },
  { match: /^block/i, label: "Block diagram", slug: "block" },
  { match: /^xychart/i, label: "XY chart", slug: "xyChart" },
  { match: /^C4(Context|Container|Component|Dynamic|Deployment)\b/, label: "C4 diagram", slug: "c4" },
  { match: /^kanban\b/i, label: "Kanban", slug: "kanban" },
  { match: /^packet/i, label: "Packet", slug: "packet" },
  { match: /^radar/i, label: "Radar", slug: "radar" },
  { match: /^treemap/i, label: "Treemap", slug: "treemap" },
];

function firstMermaidLine() {
  return (
    els.source.value
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("%%")) || ""
  );
}

function isFlowchartSource() {
  return /^(flowchart|graph)\b/i.test(firstMermaidLine());
}

function updateDocLink() {
  const def = DIAGRAM_DOCS.find((d) => d.match.test(firstMermaidLine())) || DIAGRAM_DOCS[0];
  els.docLink.href = `https://mermaid.ai/open-source/syntax/${def.slug}.html`;
  els.docLink.textContent = `Mermaid docs: ${def.label} ↗`;
}

function updateSignalFlowSection() {
  els.signalFlowSection.classList.toggle("hidden", !isFlowchartSource());
}

// --- lightweight mermaid syntax highlighting: a <pre> overlay rendered behind the
// (text-transparent) textarea, kept in sync on every edit and on scroll. ---
function highlightMermaidSource(src) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const TOKEN_RE =
    /(%%[^\n]*)|("(?:[^"\\]|\\.)*")|(-{2,3}(?:&gt;)?|-\.-{1,2}(?:&gt;)?|={2,3}(?:&gt;)?|~{3}|--[ox]\b|\b[ox]--[ox]?\b)|\b(flowchart|graph|subgraph|end|direction|classDef|class|click|style|linkStyle|TD|TB|LR|RL|BT|DT)\b|\b(shape|label)(?=\s*:)|(@\{|\{|\}|\[\[|\]\]|\(\(|\)\)|\[|\]|\()/g;
  return esc(src).replace(TOKEN_RE, (m, comment, str, arrow, keyword, shapeKey, bracket) => {
    if (comment) return `<span class="tok-comment">${comment}</span>`;
    if (str) return `<span class="tok-string">${str}</span>`;
    if (arrow) return `<span class="tok-arrow">${arrow}</span>`;
    if (keyword) return `<span class="tok-keyword">${keyword}</span>`;
    if (shapeKey) return `<span class="tok-key">${shapeKey}</span>`;
    if (bracket) return `<span class="tok-bracket">${bracket}</span>`;
    return m;
  });
}

function refreshSourceHighlight() {
  // a trailing newline keeps the overlay's last line height in sync with the textarea
  els.sourceHighlight.querySelector("code").innerHTML = highlightMermaidSource(els.source.value) + "\n";
  const lineCount = els.source.value.split("\n").length;
  els.lineNumbers.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join("\n");
}

els.source.addEventListener("scroll", () => {
  els.sourceHighlight.scrollTop = els.source.scrollTop;
  els.sourceHighlight.scrollLeft = els.source.scrollLeft;
  els.lineNumbers.scrollTop = els.source.scrollTop;
});

let autosaveDebounce = null;
els.source.addEventListener("input", () => {
  refreshSourceHighlight();
  updateDocLink();
  updateSignalFlowSection();
  clearTimeout(autosaveDebounce);
  autosaveDebounce = setTimeout(saveAutosave, 500);
});
refreshSourceHighlight();
updateDocLink();
updateSignalFlowSection();

els.signalFlowToggle.addEventListener("change", () => {
  const edges = registry.filter((r) => r.kind === "edge");
  if (els.signalFlowToggle.checked) {
    edges.forEach((r) => applyPreset(r, "signal", { count: 3, color: "#00bfb3" }));
  } else {
    edges.filter((r) => r.preset === "signal").forEach((r) => applyPreset(r, "none", {}));
  }
  renderTagList();
});

// --- toast ---
let toastTimer = null;
function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 3000);
}

// --- screen color picker (EyeDropper API — Chrome/Edge only) ---
els.colorPickerBtn.addEventListener("click", async () => {
  if (!window.EyeDropper) {
    showToast("Color picker isn't supported in this browser (try Chrome or Edge).");
    return;
  }
  let result;
  try {
    result = await new window.EyeDropper().open();
  } catch (err) {
    return; // user cancelled (Escape) — no toast
  }
  try {
    await navigator.clipboard.writeText(result.sRGBHex);
    showToast(`hex ${result.sRGBHex} was copied`);
  } catch (err) {
    showToast(`Picked ${result.sRGBHex}, but couldn't copy to clipboard`);
  }
});

// --- project export/import: source + timing + every tag/config, as JSON ---
function serializeProject() {
  return {
    kind: "mermaid-animator-project",
    version: 1,
    source: els.source.value,
    cycleDuration: cycleDuration(),
    tags: registry
      .filter((r) => r.preset !== "none")
      .map((r) => ({ kind: r.kind, kindIndex: r.kindIndex, preset: r.preset, config: r.config })),
  };
}

function exportProject() {
  const blob = new Blob([JSON.stringify(serializeProject(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mermaid-animation-project.json";
  a.click();
  URL.revokeObjectURL(url);
  showToast("Project exported");
}

async function loadProjectData(data) {
  els.source.value = data.source;
  if (data.cycleDuration) els.cycleDuration.value = data.cycleDuration;
  refreshSourceHighlight();
  updateDocLink();
  updateSignalFlowSection();

  await renderDiagram();
  (data.tags || []).forEach((tag) => {
    const match = registry.find((r) => r.kind === tag.kind && r.kindIndex === tag.kindIndex);
    if (match) applyPreset(match, tag.preset, tag.config);
  });
  renderTagList();
}

async function importProjectFromFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    showToast("Import failed: not a valid JSON file");
    return;
  }
  if (typeof data.source !== "string") {
    showToast("Import failed: not a mermaid-animator project file");
    return;
  }
  await loadProjectData(data);
  showToast(`Project imported (${(data.tags || []).length} tag${(data.tags || []).length === 1 ? "" : "s"})`);
}

// --- autosave to localStorage, so an accidental refresh doesn't lose work ---
const AUTOSAVE_KEY = "mermaid-animator-autosave";

function saveAutosave() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeProject()));
  } catch (err) {
    // localStorage unavailable/full — silently skip, autosave is a convenience, not a guarantee
  }
}

function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

els.exportProjectBtn.addEventListener("click", exportProject);
els.importProjectBtn.addEventListener("click", () => els.importProjectInput.click());
els.importProjectInput.addEventListener("change", (ev) => {
  const file = ev.target.files[0];
  if (file) importProjectFromFile(file);
  ev.target.value = "";
});

["dragover", "dragenter"].forEach((evt) =>
  els.canvasWrap.addEventListener(evt, (ev) => {
    ev.preventDefault();
    els.canvasWrap.classList.add("drag-over");
  })
);
["dragleave", "drop"].forEach((evt) =>
  els.canvasWrap.addEventListener(evt, (ev) => {
    ev.preventDefault();
    els.canvasWrap.classList.remove("drag-over");
  })
);
els.canvasWrap.addEventListener("drop", (ev) => {
  const file = ev.dataTransfer.files[0];
  if (file) importProjectFromFile(file);
});

els.source.addEventListener("keydown", (ev) => {
  if (ev.key === "Tab") {
    ev.preventDefault();
    // execCommand (not direct .value assignment) keeps this on the native undo stack, so Cmd+Z still works.
    const inserted = document.execCommand && document.execCommand("insertText", false, "  ");
    if (!inserted) {
      const { selectionStart, selectionEnd, value } = els.source;
      els.source.value = value.slice(0, selectionStart) + "  " + value.slice(selectionEnd);
      els.source.selectionStart = els.source.selectionEnd = selectionStart + 2;
      refreshSourceHighlight();
    }
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
    ev.preventDefault();
    renderDiagram();
  }
});

els.renderBtn.addEventListener("click", renderDiagram);
els.cycleDuration.addEventListener("change", () => {
  registry.filter((r) => r.preset !== "none").forEach((r) => applyPreset(r, r.preset, r.config));
  saveAutosave();
});

els.bgToggle.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-bg]");
  if (!btn) return;
  els.bgToggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  els.canvasWrap.classList.remove("bg-light", "bg-dark");
  if (btn.dataset.bg === "light") els.canvasWrap.classList.add("bg-light");
  if (btn.dataset.bg === "dark") els.canvasWrap.classList.add("bg-dark");
});

// --- zoom (preview only — export always reads the SVG's own viewBox/bbox,
// so on-screen zoom never affects exported resolution) ---
let zoom = 1;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;

function setZoom(next) {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  els.host.style.transform = `scale(${zoom})`;
  els.zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
}

function fitZoomToWindow(naturalWidth, naturalHeight) {
  const margin = 60;
  const availW = els.canvasWrap.clientWidth - margin;
  const availH = els.canvasWrap.clientHeight - margin;
  if (availW <= 0 || availH <= 0 || !naturalWidth || !naturalHeight) return;
  const scale = Math.min(availW / naturalWidth, availH / naturalHeight);
  setZoom(scale);
}

els.zoomIn.addEventListener("click", () => setZoom(zoom * 1.2));
els.zoomOut.addEventListener("click", () => setZoom(zoom / 1.2));
els.zoomReset.addEventListener("click", () => setZoom(1));

els.canvasWrap.addEventListener(
  "wheel",
  (ev) => {
    if (!ev.ctrlKey && !ev.metaKey) return; // plain wheel/trackpad scroll still works normally
    ev.preventDefault();
    setZoom(zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
  },
  { passive: false }
);

setZoom(1);

/* Two export engines:
   - APNG (via UPNG.js, ps=0 i.e. no palette): true 24-bit color + real 8-bit alpha.
     No banding, no chroma-key hacks — this is the sharp/high-quality default.
   - GIF (via gif.js): universal compatibility, but capped at a 256-color palette
     per frame and binary (not real) transparency, so it's offered as a fallback. */
async function exportGif() {
  const svg = els.host.querySelector("svg");
  if (!svg) return;
  const format = els.exportFormat.value;
  const duration = cycleDuration();
  const fps = Math.max(5, Math.min(30, parseInt(els.exportFps.value, 10) || 20));
  const frameCount = Math.max(1, Math.round((duration / 1000) * fps));
  const frameInterval = duration / frameCount;
  const transparent = els.exportTransparent.checked;
  const useChromaKey = format === "gif" && transparent; // APNG has real alpha, doesn't need this

  const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal : svg.getBBox();
  const outWidth = Math.max(50, parseInt(els.exportWidth.value, 10) || 900);
  const outHeight = Math.round(outWidth * (vb.height / vb.width));

  els.exportBtn.disabled = true;
  els.exportStatus.textContent = `Capturing frame 0/${frameCount}...`;

  registry.forEach((r) => (r.animations || []).forEach((a) => a.animation.pause()));

  let gif = null;
  if (format === "gif") {
    gif = new GIF({
      workers: 4,
      quality: 1, // lower = better (1 = sample every pixel); fine since fps is kept modest
      width: outWidth,
      height: outHeight,
      workerScript: await getGifWorkerScriptUrl(),
      transparent: useChromaKey ? 0xff00ff : null,
    });
  }
  const apngFrames = [];

  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  for (let i = 0; i < frameCount; i++) {
    const t = i * frameInterval;
    registry.forEach((r) => (r.animations || []).forEach((a) => (a.animation.currentTime = t + (a.phaseOffset || 0))));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => requestAnimationFrame(r));

    const clone = svg.cloneNode(true);
    registry.forEach((entry) => {
      (entry.animations || []).forEach((a) => {
        const targetId = a.target.dataset.animId;
        if (!targetId) return;
        const cloneTarget = clone.querySelector(`[data-anim-id="${CSS.escape(targetId)}"]`);
        if (!cloneTarget) return;
        const computed = getComputedStyle(a.target);
        a.bakeProps.forEach((prop) => {
          cloneTarget.style[prop] = computed[prop];
        });
      });
    });
    clone.setAttribute("width", outWidth);
    clone.setAttribute("height", outHeight);
    clone.style.width = outWidth + "px";
    clone.style.height = outHeight + "px";

    const svgString = new XMLSerializer().serializeToString(clone);
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
    // eslint-disable-next-line no-await-in-loop
    const img = await loadImage(url);

    ctx.clearRect(0, 0, outWidth, outHeight);
    if (useChromaKey) {
      ctx.fillStyle = TRANSPARENT_KEY;
      ctx.fillRect(0, 0, outWidth, outHeight);
    } else if (!transparent) {
      ctx.fillStyle = els.canvasWrap.classList.contains("bg-dark") ? "#14161a" : "#ffffff";
      ctx.fillRect(0, 0, outWidth, outHeight);
    }
    // else: transparent APNG — leave the canvas cleared (alpha 0); real alpha carries through.
    ctx.drawImage(img, 0, 0, outWidth, outHeight);
    // GIF transparency is a single exact-match palette index, but anti-aliased edges
    // (text glyphs, curved lines) blend partway toward the chroma key without ever
    // being an exact match — left alone, that shows up as a visible magenta halo
    // around every shape. Snap near-key pixels to the exact key so they cleanly key
    // out instead. Our real palette (teal/pink/yellow/ink/gray/white) all sit much
    // farther from magenta than this threshold, so real content is left alone.
    if (useChromaKey) snapChromaKey(ctx, outWidth, outHeight);

    if (format === "gif") {
      gif.addFrame(canvas, { copy: true, delay: frameInterval });
    } else {
      apngFrames.push(ctx.getImageData(0, 0, outWidth, outHeight).data.buffer);
    }
    els.exportStatus.textContent = `Capturing frame ${i + 1}/${frameCount}...`;
  }

  if (format === "gif") {
    gif.on("finished", (blob) => {
      downloadBlob(blob, `mermaid-animation-${Date.now()}.gif`);
      els.exportStatus.textContent = "Done — GIF downloaded.";
      finishExport();
    });
    els.exportStatus.textContent = "Encoding GIF...";
    gif.render();
  } else {
    els.exportStatus.textContent = "Encoding APNG...";
    const delays = new Array(frameCount).fill(Math.round(frameInterval));
    // ps=0 — no palette reduction, full 24-bit color + alpha, exactly what's on screen.
    const pngBuffer = UPNG.encode(apngFrames, outWidth, outHeight, 0, delays);
    downloadBlob(new Blob([pngBuffer], { type: "image/png" }), `mermaid-animation-${Date.now()}.png`);
    els.exportStatus.textContent = "Done — APNG downloaded.";
    finishExport();
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function finishExport() {
  els.exportBtn.disabled = false;
  registry.filter((r) => r.preset !== "none").forEach((r) => applyPreset(r, r.preset, r.config));
}

function snapChromaKey(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const THRESHOLD = 90; // distance in RGB space; our farthest-from-magenta real color (pink, ~130) stays safe
  for (let i = 0; i < d.length; i += 4) {
    const dr = d[i] - 255;
    const dg = d[i + 1] - 0;
    const db = d[i + 2] - 255;
    if (Math.sqrt(dr * dr + dg * dg + db * db) < THRESHOLD) {
      d[i] = 255;
      d[i + 1] = 0;
      d[i + 2] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

els.exportBtn.addEventListener("click", () => exportGif().catch((err) => {
  console.error(err);
  els.exportStatus.textContent = "Export failed: " + err.message;
  els.exportBtn.disabled = false;
}));

function updateFormatHint() {
  els.formatHint.textContent =
    els.exportFormat.value === "apng"
      ? "True color, real alpha transparency. Downloads as .png — works animated in browsers, PowerPoint, and Keynote."
      : "256-color palette per frame; transparency is a keyed color, not real alpha, so curved/anti-aliased edges can show faint fringing.";
}
els.exportFormat.addEventListener("change", updateFormatHint);
updateFormatHint();

const autosaved = loadAutosave();
if (autosaved) {
  loadProjectData(autosaved).then(() => showToast("Restored your last session"));
} else {
  renderDiagram();
}

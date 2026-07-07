# Mermaid Animator

A standalone browser tool for authoring diagrams in Mermaid syntax, then animating and exporting them as APNG or GIF — instead of hand-writing SVG per asset.

## Running it

- `python3 -m http.server 8743`, then open `http://localhost:8743/index.html`.
- A local server is required (not `file://`) because GIF encoding uses a Web Worker, which browsers block on the `file://` protocol.
- Requires internet access: all libraries load from a CDN rather than being vendored (see Implementation notes) — no offline use.

## Workflow

- Paste/edit Mermaid source → Render → click a node or edge in the canvas → pick an animation preset from the popup → repeat for other elements → Export.
- Presets: `pulse`, `glow` (color matches the node's own stroke), `fade-in` for nodes; `flow` (marching dashes) and `draw` (edge draws itself in) for edges; `signal` (edge — N dots flow along the path per cycle) paired with `signal-react` (node — pulses/glows once per signal arrival). A flowchart-only sidebar checkbox batch-tags every edge with `signal` at once.
- Signal dots and signal-react anchor their phase to `document.timeline` (not to whenever `.animate()` was called), so tagging the edge and its receiving node at different times still stays in sync as long as their counts match — see `syncToWallClock` in `app.js`.
- All presets on a diagram share one "cycle length" so the export loops seamlessly.
- Re-tagging after editing the Mermaid source is best-effort: tags are matched back to nodes/edges by their order of appearance, so large structural edits to the diagram may lose tags — re-tag if that happens.
- Diagram look/colors are controlled via Mermaid `themeVariables` in `app.js` (currently seeded with the palette below), not via hand-edited SVG — update that config, not individual exported files, when the palette changes.
- Work autosaves to `localStorage` on every render/tag/timing change and restores on reload — losing state on an accidental refresh isn't a real risk. Project state (source + timing + tags) can also be explicitly exported/imported as a `.json` file, including via drag-and-drop onto the canvas.

## Style defaults

- Palette: ink `#1c1e23` (text/lines), teal `#00bfb3` (primary accent), pink `#f04e98` (secondary accent / selection highlight), yellow `#fec514` (tertiary highlight), gray `#8a8f98` (muted icons/lines).
- Typography: system sans-serif stack (`-apple-system, "Helvetica Neue", Arial, sans-serif`).
- Background: exported assets default to transparent so they drop into any slide or background.
- Animation timing: one shared loop ("cycle length"), default 4000ms, so multiple animated elements in one diagram stay in sync and the export loops seamlessly.

## Implementation notes

- Export runs fully client-side in the browser (no ffmpeg/puppeteer install needed): it steps each Web Animations API animation's `currentTime` frame-by-frame, bakes the computed styles into a cloned/serialized SVG per frame, and rasterizes each to canvas.
- Two export engines, picked via the Format dropdown:
  - **APNG** (default) — via `UPNG.js` with `ps=0` (no palette reduction): true 24-bit color and real 8-bit alpha, so no color banding and no transparency fringing. Downloads as `.png`; animates in browsers, PowerPoint, and Keynote.
  - **GIF** — via `gif.js`, kept for compatibility with tools that require a literal `.gif`. Capped at a 256-color palette per frame, and transparency is a single keyed color (not real alpha) — anti-aliased edges can leave faint fringing even after the chroma-key-snap cleanup (`snapChromaKey` in `app.js`) that catches most of it.
- No vendored/committed third-party code, by design: `mermaid.min.js`, `gif.js`, `pako.min.js`, and `UPNG.js` load from jsdelivr in `index.html`, each pinned to an exact version (not a range) so an upstream release can't silently change behavior. Bump the pinned version deliberately when needed, e.g. `mermaid@11.16.0` was required over the v10 line for the newer `@{ shape: ..., label: ... }` node syntax, which v10 doesn't parse.
- One exception requiring a workaround: `gif.js` loads its encoder as a Web Worker, and browsers hard-block constructing a `Worker` from a cross-origin URL — this fails even though jsdelivr sends CORS headers; it's a same-origin rule on the `Worker` constructor itself, not a fetch restriction. `getGifWorkerScriptUrl()` in `app.js` works around it: `fetch()` the worker script from the CDN (fetch *does* respect CORS), wrap the text in a `Blob`, and pass gif.js a same-origin `blob:` URL instead. This only affects the GIF path — APNG export has no worker involved.

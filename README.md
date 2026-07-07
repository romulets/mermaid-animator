# Mermaid Animator

A browser-based tool for turning [Mermaid](https://mermaid.js.org/) diagrams into animated exports (APNG or GIF), without hand-writing SVG or using any external animation software.

## Usage

1. Start a local server (required — GIF export uses a Web Worker, which browsers block on `file://`):
   ```sh
   python3 -m http.server 8743
   ```
2. Open `http://localhost:8743/index.html`.
3. Paste or write your Mermaid diagram source and click **Render**.
4. Click a node or edge in the rendered diagram to open the animation popup and pick a preset.
5. Repeat for any other elements you want animated.
6. Click **Export** and choose a format.

## Animation presets

- **Nodes**: `pulse`, `glow`, `fade-in`
- **Edges**: `flow` (marching dashes), `draw` (edge draws itself in), `signal` (dots travel along the edge)
- **Signal reaction**: pair a `signal` edge with `signal-react` on the receiving node to have it pulse each time a signal arrives

All animated elements share one timing loop, so exports always loop seamlessly.

## Export formats

- **APNG** (default) — full color and real transparency, no banding or fringing. Works in browsers, PowerPoint, and Keynote.
- **GIF** — for tools that require a literal `.gif` file. Limited to 256 colors and keyed (non-alpha) transparency.

## Saving your work

Your diagram, timing, and animation tags autosave to the browser's local storage as you work. You can also export/import a project as a `.json` file, including by dragging it onto the canvas.

## Requirements

An internet connection — all libraries (Mermaid, gif.js, UPNG.js) load from a CDN rather than being bundled with the project.

See `CLAUDE.md` for implementation details.

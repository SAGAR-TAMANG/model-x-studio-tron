# System prompt — rebuild "Model X Studio"

You are building a single-page web application from scratch: an interactive
holographic 3D study of a Tesla Model X. Work through the phases in order. Each
phase ends in a state that typechecks and builds; do not move on from a broken
one.

---

## 1. Ground rules

These override any instinct to make the app more impressive than it is.

1. **Never invent vehicle facts.** Every descriptive sentence must be safe for a
   pre-refresh Model X of unverified year. No horsepower, kWh, torque split,
   part numbers, or model years anywhere in the copy. Where a number appears in
   the HUD read-outs, label it as display dressing on screen.
2. **Name what is illustrative.** The battery, drive units and suspension are
   procedural geometry you author — not scanned parts. Mark them "Illustrative"
   in the UI and say so in the About panel.
3. **Attribute the asset.** The car mesh is third-party. Creator credit and a
   licence link appear in the About panel and the README.
4. **The mesh pieces are geometry islands, not a parts catalog.** Say "334
   modeled pieces", never "334 parts".
5. **Accessibility is not a later pass.** Every control is a real focusable
   element with an accessible name; `prefers-reduced-motion` freezes all
   animation; touch targets are ≥44px on phones.
6. **Performance is a design constraint.** The car mesh is ~775k triangles.
   Any technique whose cost scales with triangle count is disqualified — see
   §9, which records what already failed and why.

---

## 2. Reference image first (higgsfield)

Before writing UI code, use the **higgsfield plugin** to generate the visual
target: a *green-on-black holographic HUD* — a glowing wireframe car floating on
concentric light rings, surrounded by thin-stroke technical panels with corner
brackets, small uppercase letter-spaced labels, and drifting code-fragment text.

Iterate on the image until it reads as a single coherent instrument panel, then
save it to `public/higgsfield_image.png` and treat it as the spec for every
later visual decision. When a layout or colour question comes up, re-read the
image rather than inventing.

---

## 3. Stack

- React 19 + TypeScript (strict), Three.js 0.159, Tailwind 4.
- shadcn components, `base-nova` style, base-ui primitives, lucide icons.
  Only `Select`, `Slider`, `Switch`, `Tabs` are actually used.
- `@mediapipe/tasks-vision` for hand tracking, loaded via dynamic `import()`.
- Build: a Vite SPA is the deliverable (`vite.vercel.config.ts` → `dist/vercel`,
  root `vercel-app/`, `publicDir` `public/`, alias `@` → repo root). If your
  environment also has an RSC/Cloudflare dev harness, keep both entry points
  rendering the *same* `app/page.tsx`; otherwise ship only the SPA.
- Lint with oxlint, `correctness: error`, plugins including `jsx-a11y`,
  `react/react-compiler`, `typescript` type-aware rules.

**House code style:** dense one-line-per-statement TypeScript, minimal
whitespace, single quotes, no semicolon-free lines. Comments are rare and
explain *why*, never *what*. Match it.

---

## 4. File map

```
app/
  layout.tsx            html shell, metadata, themeColor #000403
  page.tsx              the entire HUD; all React state lives here
  globals.css           design tokens + every hand-written style
  parts.ts              8 systems + per-piece prose
  vehicle-scene.tsx     the whole Three.js engine in one useEffect
  explosion-layout.ts   deterministic 2D packing of 334 pieces
  noise-field.ts        drifting text / debris / dust
  hand-control.ts       MediaPipe gesture control
  pointer-tap.ts        tap-vs-drag discrimination
public/models/
  model-x.glb           the car (see §5)
  model-x-manifest.json 334 piece records
scripts/
  convert-model.py      Blender → glTF pipeline
  validate-explosion.mjs, validate-touch.mjs
vercel-app/             index.html + main.tsx SPA entry
```

---

## 5. Phase 1 — the asset (read this before planning)

**This is the one part a prompt cannot regenerate.** The car is
`tesla-model-x-cgimoon.blend` by *cgi Moon* on BlendKit, used under the BlendKit
Royalty Free licence. You must either be given that `.blend`, or be given the
already-converted `model-x.glb` + manifest. Do not substitute a different car
model silently, and do not fabricate the manifest.

Given the `.blend`, `scripts/convert-model.py` runs inside Blender's `bpy` and:

1. Opens the file with `use_scripts=False`.
2. Unparents every object while preserving world matrices.
3. Clamps SUBSURF modifiers to level 1 (2 for the two body-shell objects),
   removes geometry-nodes modifiers.
4. Replaces every Cycles-only node group with an exportable Principled BSDF,
   choosing base colour / metallic / roughness from the material *name*
   (`carpaint`, `chrome`, `windows`, `headlights`, `interior`, `tyre`, …).
5. Evaluates modifiers into snapshot meshes, applies transforms, then
   `mesh.separate(type='LOOSE')` to split genuine disconnected geometry.
6. Classifies every resulting island into one of `body | glass | doors | cabin |
   wheels` and gives it a human label from material names plus its centroid
   (`Hood`, `Front bumper`, `Falcon wing door panel`, `Fender / quarter panel`,
   `Tire and tread`, `Brake disc`, …), suffixed ` · left/right` and, for wheels,
   ` · front/rear`.
7. Writes `part`, `label`, `component` into per-object glTF extras and exports
   GLB with `export_extras=True`, `export_yup=True`.
8. Writes the manifest: `{creator, modelYear, source, objects[]}` where each
   object is `{id, part, label, source, center, size, faces}`.

Expected output: **334 pieces**, vehicle bounds ≈ 2.276 × 1.680 × 5.056 m.
Verify by loading the GLB headlessly in Node and checking the count and bounds.

The three internal systems (`battery`, `drive`, `suspension`) have **no** source
geometry — you author them procedurally in the scene (§6).

---

## 6. Phase 2 — the holographic renderer (`app/vehicle-scene.tsx`)

One `useEffect` with `[]` deps holds the entire engine. Props are read through a
`latest` ref updated on every render, so the effect never re-runs.

### Materials — the core technique

Every surface is a **near-black occluding shell** carrying a **world-space scan
grid injected by shader patch**, with the model's own **feature edges** drawn
over it. There is no lighting, no environment map, no shadows, no tone mapping.

```ts
const LINE=0x3dffb0, ACTIVE=0x9dffd8, HOT=0xe4fff6, SHELL=0x02120c,
      GRID_SCALE=11.5, EDGE_ANGLE=26;
```

- **Fill**: `MeshBasicMaterial({color:SHELL, transparent, opacity, depthWrite:true,
  polygonOffset:true, polygonOffsetFactor:1.4, polygonOffsetUnits:1.4})`.
  Depth-writing dark fills are what give hidden-line removal.
- **Grid**: patch the fill in `onBeforeCompile`. Add a `vHoloWorld` varying set
  after `#include <project_vertex>`, then before `#include <fog_fragment>`
  compute `abs(fract(p-0.5)-0.5)/fwidth(p)` on the world position × `uGridScale`,
  take the min across xyz, and `mix` the grid colour in. Because it is derived
  from world position, **its cost and appearance are independent of mesh
  density** — this is the whole point.
- **Edges**: `new THREE.EdgesGeometry(geometry, 26)` → `LineSegments` with
  `LineBasicMaterial({depthWrite:false})`, `renderOrder` 1 against the fill's 0,
  and `raycast = () => {}` so overlays never intercept picking.
  **Cache `EdgesGeometry` per source `BufferGeometry`** in a `Map` — instanced
  pieces must build theirs once.

Per-system opacity table (`fill`, `grid`, `edge`), tuned so glass reads thinner
and the internals read brighter:

```
body .9/.5/.5   glass .3/.42/.55  doors .9/.5/.5    cabin .8/.34/.3
battery/drive/suspension .88/.55/.6                 wheels .9/.45/.45
```

### Post-processing

`EffectComposer` → `RenderPass` → `UnrealBloomPass(res, 0.4, 0.3, 0.3)` →
`OutputPass` → the noise `ShaderPass` (§8). Renderer uses
`THREE.NoToneMapping`, clear colour `#000403`, pixel ratio capped at 1.25 on
coarse pointers and 1.5 otherwise.

### Camera and stage

`PerspectiveCamera(37, aspect, .05, 500)` at `(-5.7, 2.9, 6.3)`, OrbitControls
target `(0, .8, 0)`, damping .065, `minDistance` 5, `maxDistance` 180,
`maxPolarAngle` `PI*.49`, `minPolarAngle` .18, `autoRotateSpeed` .65.
`Fog('#000403', 18, 62)` whose near/far widen as the explosion progresses.

The platform is a ring stage, not a plinth: additive `TorusGeometry` rings at
radii 3.98 / 3.9 / 3.62 / 3.1 / 2.72, seven counter-rotating arc segments at
3.78, four at 3.36, one pulsing ring at 3.46, a dark `CircleGeometry(4.02)`
disc, a `GridHelper(120,120,0x1f7a5b,0x115c42)` floor at 30% opacity, and ~420
drifting motes. The stage fades out as the explosion passes 2–18%.

### Procedural internals

Author with `RoundedBoxGeometry`, `CylinderGeometry`, `TorusGeometry` and
`TubeGeometry` over `CatmullRomCurve3`, sharing three material sets
(`shell`, `core`, `hot`): a battery casing with an 8×4 module grid and two
bright busbars; two motors with half-shafts and ribbed inverter housings; four
air-spring struts with stacked rings and wishbone tubes.

### Frame loop

Invalidation-driven. Compute `geometryChanged`, `cameraChanged` and `animating`,
and **return early when nothing changed** unless labels are pending. Explosion
amount is damped (`MathUtils.damp(..., 7, dt)`) unless reduced motion, in which
case it snaps. Highlighting is a colour swap on the cached materials — base
green, `ACTIVE` for the selected system, `HOT` for a focused piece — never a
material rebuild.

Teardown must dispose every geometry and material (including `LineSegments`),
clear the edge cache, dispose the composer and renderer, remove the canvas and
every DOM label, and detach all listeners.

---

## 7. Phase 3 — explosion (`app/explosion-layout.ts`)

Two-stage separation driven by one 0–100 slider:

- **0 → ~40%**: systems translate along fixed per-system offsets (glass up 2,
  doors up 1.1, battery down .85, …), plus a small per-piece spread so wheels
  and doors fan outward.
- **~40 → 100%**: every piece flies to its own slot in a flat exhibition grid.

The layout is a deterministic shelf pack. Project each piece's `Box3` corners
onto the two axes perpendicular to `overviewDirection = (-5.7,2.1,6.3).normalize()`
to get its true on-screen footprint, pad by .22, sort by `part` then descending
height then id, and shelf-pack into a board of width `max(12, sqrt(area*1.6))`
centred on `layoutCenter = (0,3,0)`. Return a `Map<id, {translation, center,
width, height}>`. Pieces keep their original orientation and scale throughout.

Labels are DOM buttons positioned by `transform: translate3d(...)` only — never
by writing `top`/`left` — and updated at most every 50ms.

---

## 8. Phase 4 — the HUD (`app/page.tsx`, `app/globals.css`)

All state lives in `page.tsx`. Tokens:

```css
--hud-line:#3dffb0;  --hud-dim:#4fbf90;  --hud-bright:#c9ffe9;
--hud-edge:rgba(61,255,176,.26);  --hud-glow:rgba(61,255,176,.55);
--background:#00120c;  body background #000403;  --radius-lg:2px;
font: 'Chakra Petch' via @import in CSS (NOT a <link> — see §9), monospace fallback
```

Chrome, all hand-written CSS:

- `.hud-veil` — 1px scanline `repeating-linear-gradient` + radial vignette.
- `.studio:before` — screen-edge corner brackets from 8 stacked
  `linear-gradient` layers with `background-size`/`-position` per corner.
- `.brackets` — the same trick at panel scale; render as `<i className="brackets"/>`
  inside every `.hud-panel`.
- Panels: `linear-gradient` fill, hairline border, inset glow, `backdrop-filter`,
  plus an inset `:after` hairline.

Layout: model plaque top-left; COMPONENTS list left (8 rows, numbered, lucide
icon each); a vertical tool rail right (zoom ±, reset, auto-rotate, hand
control, fullscreen, about, overflow); a right column holding HAND CONTROL /
SYSTEM STATUS or the detail panel / PERFORMANCE; and a bottom dock with the
EXPLODE slider, ALL PARTS, LABELS and NOISE switches.

The right column is `pointer-events:none` with `pointer-events:auto` children,
or it will silently eat canvas drags across its whole width. Scrollable panels
put `overflow:auto` on an *inner* element so the corner brackets don't scroll
away. Breakpoints at 1180px, 900px (drops the read-out panels), and a phone
block at `(max-width:700px),(max-height:500px)` using `dvh`, safe-area insets
and 44px targets.

SYSTEM STATUS and PERFORMANCE are decorative. Footnote them
"Reference figures · display only" and repeat it in About.

---

## 9. Phase 5 — noise layer (`app/noise-field.ts`), default **off**

Three layers plus a screen pass:

1. **Code fragments** — ~1300 short strings (`PACK 400V`, `CAN 0x2A1`,
   `TRI 775K`, `FALCON L`, `01101001`, …) drifting on a squashed ellipsoid
   around the car. Render them as **one draw call**: bake all strings into a
   single vertical canvas atlas (256 × 32 per row), build an
   `InstancedBufferGeometry` from a unit `PlaneGeometry` with per-instance
   `aOrbit(radius, phi, speed, phase)`, `aSize`, `aRow`, `aAlpha`, and compute
   both the orbit and the billboard in the **vertex shader** from a `uTime`
   uniform. Zero per-frame CPU cost.
2. **Debris** — ~200 icosa/tetra/octa shards on tilted orbits, three
   `InstancedMesh`es, matrices updated in one loop.
3. **Dust** — ~1500 additive points with a soft radial-gradient dot texture.
4. **Screen pass** — a `ShaderPass` *after* `OutputPass`: radial chromatic
   split, a slow `sin` flicker, and hashed grain, so the effect lands on the
   finished sRGB image.

Plus a CSS `.hud-grain` overlay: an inline `feTurbulence` fractal-noise SVG data
URI, `mix-blend-mode:screen` at ~9%, its `background-position` shuffled by a
`steps()` keyframe so it reads as live signal. Frozen under reduced motion.

Turning noise on means the renderer stops idling and runs continuously — that is
inherent, and the switch is the escape hatch.

---

## 10. Phase 6 — hand control (`app/hand-control.ts`), default **off**

MediaPipe `HandLandmarker`, `numHands: 2`, GPU delegate with CPU fallback, WASM
and model from CDN. **Split the gesture grammar by hand count** so no two
readings compete:

- **One hand → the explosion.** Not a toggle: hand openness maps continuously to
  0–100%. Measure it on the metric `worldLandmarks` as mean fingertip-to-wrist
  distance in palm widths (wrist→middle-MCP); a fist lands near **1.2**, a
  splayed hand near **1.95**, and that range is the scale. Using world
  landmarks makes it orientation-invariant. EMA-smooth (~0.28) and quantise to
  whole percent before calling React.
- **Two hands → the camera.** Midpoint delta orbits (×4.5 horizontal, ×3.0
  vertical, mirrored); the change in distance between the hands zooms, clamped
  to ~[0.9, 1.11] per frame. The explosion holds.

Do **not** use pinch-to-drag: in a fist the thumb tip sits beside the index tip,
so a fist reads as a pinch.

Add `orbit(dTheta,dPhi)` to the scene's imperative handle, rotating the camera
in spherical coordinates around the OrbitControls target.

UI: a panel with the mirrored webcam preview, the tracked skeleton drawn on a
canvas overlay, a live mode read-out, a two-line legend, and explicit
permission-denied / no-camera / failure states.

Both this and the noise layer default off: they cost a camera permission and a
continuously running renderer respectively, and users may be on weak machines.

---

## 11. Phase 7 — interaction, picking, agent surface

- `PointerTap` discriminates a tap from an orbit/pinch/pan: track pointer ids
  with a move threshold (5px mouse, 10px touch), block on a second pointer or on
  `pointercancel`, and only treat a single unblocked pointer as a selection.
- Raycast on tap to focus an individual piece; isolate mode reframes onto the
  focused piece or system.
- Register a WebMCP tool when `document.modelContext?.registerTool` exists —
  `explore_vehicle_component` taking `{component, explosion?, isolate?}`,
  validating every field, applying state in `flushSync`, aborting on unmount.
  Feature-detect; never assume the API is present.
- Handle `webglcontextlost` and surface a readable error with a reload button.

---

## 12. Phase 8 — docs and validation

Write `README.md` (dev commands, deployment, validation, asset source and scope
limits) and `VALIDATION.md` (what you actually checked, and explicitly what you
did **not**).

Validation gates, all of which must pass:

```sh
npx tsc --noEmit
npm run lint
node --experimental-strip-types scripts/validate-explosion.mjs
node --experimental-strip-types scripts/validate-touch.mjs
npm run build:vercel
```

`validate-explosion.mjs` parses the GLB in Node, runs the layout, and asserts
334 distinct slots plus camera coverage at three viewport proportions — it is a
geometry check, not a frame-rate measurement, and the README must say so.
`validate-touch.mjs` asserts the tap/drag truth table.

---

## 13. Pitfalls already paid for

Do not rediscover these.

1. **A per-triangle wireframe is unusable.** `wireframe:true` on this asset is
   ~2.3M line segments; with additive blending it saturates bloom into a white
   blob and the frame rate collapses. Measured `EdgesGeometry` segment counts:
   1° → 555k, 20° → 156k, 26° → ~150k, 35° → 86k. 26° is the chosen balance.
2. **Adding children during `traverse` recurses forever.** Collect meshes into
   an array first, then attach edge overlays.
3. **Font via `<link>` in the layout trips `next(no-page-custom-font)`.** Use
   `@import url(...)` as the first line of `globals.css`; verify it survives
   into the built CSS.
4. **base-ui `Switch` puts your `id` on a hidden input**, so `<label htmlFor>`
   leaves the visible `role=switch` unnamed and `jsx-a11y` still fails. Use
   `<span id="x-label">` + `aria-labelledby="x-label"`.
5. **Never key a start/stop effect on the status it sets itself.** Keying the
   hand tracker on `gesture` tore it down the instant it reported `on`. Key on
   the *request* (`wantGesture`) and let status be display-only.
6. **A teardown landing mid-`getUserMedia` leaks the camera.** Make the tracker
   single-use with a `stopped` flag checked after every `await`.
7. **First bloom pass will be too bright.** Ring opacities, mote alpha and the
   vignette all needed roughly halving against real renders. Look at output;
   don't tune blind.
8. **Reading `ref.current` during render** trips `react/react-compiler`. The
   `latest`-props ref is the deliberate exception; keep everything else in
   effects and handlers.

---

## 14. Acceptance

- [ ] Reference image generated with higgsfield and committed.
- [ ] 334 pieces load; assembled bounds ≈ 2.28 × 1.68 × 5.06 m.
- [ ] Slider sweeps assembled → systems separated → 334-piece grid, no overlap.
- [ ] Selecting a system highlights it; tapping a piece focuses it; isolate
      reframes; labels toggle.
- [ ] Noise off by default; on, it matches the reference image's density.
- [ ] Hand control off by default; a fist assembles the car and an open hand
      explodes it; two hands orbit and zoom.
- [ ] Reduced motion freezes rings, motes, noise and explosion damping.
- [ ] Phone layout: no horizontal scroll, 44px targets, safe-area insets.
- [ ] No invented vehicle facts anywhere; illustrative systems and decorative
      read-outs are labelled as such; creator attributed.
- [ ] All five validation commands pass.

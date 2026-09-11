# Model X Studio — Tron Edition

An interactive holographic study of a Tesla Model X. Orbit a glowing wireframe
projection, separate it into all 334 modeled pieces, inspect each system — and
drive the whole thing with your hands through your webcam.

> **Live demo:** _add your Vercel URL here_

<!-- Add a GIF here: the fist-closing gesture assembling the car is the shot. -->

---

## The build prompt

**→ [`RECREATE-PROMPT.md`](RECREATE-PROMPT.md) — the complete specification that rebuilds this app from scratch.**

Hand it to any coding agent as a system prompt and it works through every phase
in order: the asset pipeline, the holographic
renderer, the explosion layout, the HUD, the noise field and the gesture
control. It carries the exact constants — colours, camera, bloom, edge angle,
gesture thresholds — plus a **"pitfalls already paid for"** section recording
what was measured and what failed, so the agent doesn't burn hours
rediscovering them.

**One thing it can't do:** regenerate the car. `public/models/model-x.glb` is a
third-party asset (see [Model source and scope](#model-source-and-scope)), so
the prompt tells the agent to expect it as an input rather than inventing one.
Everything else in this repository is reproducible from that document.

---

## Setup

**→ [higgsfield setup link](https://higgsfield.ai/s/gpt-6-astra-x-higgsfield-plugin-ig-vol-2-claude-creators-sagar_builds-zAPOsP)**

The higgsfield setup behind the reference visuals this interface was designed
against.

---

## Credit

Built on **[ashemag/model-x-studio](https://github.com/ashemag/model-x-studio)**.

The base studio comes from that project: the component data and prose, the
explosion layout algorithm, the tap/drag discrimination, the Blender → glTF
conversion pipeline, the 334-piece manifest, and the build configuration.

This fork replaces the renderer and adds two new systems. See
[What this fork adds](#what-this-fork-adds).

---

## What this fork adds

### Holographic renderer (`app/vehicle-scene.tsx`, `app/globals.css`)

The original rendered a lit PBR studio — environment map, shadows, ACES tone
mapping. This version throws all of that out and rebuilds the car as a green
wireframe hologram on a ring platform.

The interesting constraint: **the asset is 775,000 triangles**, so anything
whose cost scales with triangle count is off the table. A literal
`wireframe: true` is ~2.3 million line segments; the first attempt at it
saturated the bloom pass into a solid white blob and dropped the frame rate
through the floor.

So the look is built from two density-independent pieces:

- **A world-space scan grid**, injected into a `MeshBasicMaterial` through
  `onBeforeCompile`. It derives its lines from the fragment's world position
  (`fract`/`fwidth` derivatives), so the grid looks and costs the same whether
  the mesh underneath it has 50 triangles or 50,000.
- **Feature edges** from `EdgesGeometry` at a 26° threshold, cached per source
  geometry so instanced pieces build theirs once. Measured segment counts:
  1° → 555k, 20° → 156k, 26° → ~150k, 35° → 86k. 26° keeps the door shutlines
  and wheel spokes while staying affordable.

Hidden-line removal comes from the fills being near-black, depth-writing and
polygon-offset, drawn at `renderOrder` 0 against the edges' 1. Post-processing
is `EffectComposer` → `RenderPass` → `UnrealBloomPass(0.4, 0.3, 0.3)` →
`OutputPass`, with `NoToneMapping`.

The HUD chrome around it — corner brackets, scanlines, vignette, panel frames —
is hand-written CSS, with the brackets built from eight stacked
`linear-gradient` layers per element.

### Noise field (`app/noise-field.ts`) — off by default

Signal noise, ported from a Jarvis-style orb UI and recoloured:

- **~1300 drifting code fragments** in **one draw call**. All the strings are
  baked into a single canvas atlas; an `InstancedBufferGeometry` carries
  per-instance orbit parameters, and both the orbit and the billboarding happen
  in the vertex shader off a `uTime` uniform. Zero per-frame CPU cost.
- **~200 orbiting debris shards** across three `InstancedMesh`es.
- **~1500 additive dust points** with a soft radial falloff texture.
- **A screen pass after `OutputPass`** — radial chromatic split, slow flicker,
  hashed grain — so the effect lands on the finished sRGB image.
- **A CSS film grain** overlay using an inline `feTurbulence` SVG, its position
  shuffled by a `steps()` keyframe so it reads as live signal.

### Hand control (`app/hand-control.ts`) — off by default

MediaPipe `HandLandmarker`, loaded through a dynamic `import()` so the vision
runtime code-splits and only downloads when you switch it on.

The gesture grammar is **split by hand count**, so no two readings ever compete:

| Gesture | Effect |
| --- | --- |
| **One hand** | Hand openness *is* the explosion. Close a fist and the 334 pieces gather into a car; open your hand and it blooms apart. Continuous, not a toggle. |
| **Two hands** | You're holding the model. Move both to orbit, pull apart to zoom in, bring together to zoom out. The explosion holds. |

Openness is measured on MediaPipe's **metric `worldLandmarks`** — mean
fingertip-to-wrist distance in palm widths — so it reads the same whether your
hand faces the camera or is turned away. A fist lands near 1.2 palm widths, a
splayed hand near 1.95, and that range is the 0–100% scale.

Pinch-to-drag was deliberately avoided: in a closed fist the thumb tip sits
right beside the index tip, so a fist reads as a pinch.

### Also

- `RECREATE-PROMPT.md` — a complete build specification. Hand it to a coding
  agent and it rebuilds this app from scratch, including the measured pitfalls.
- Both new systems default **off**: they cost a camera permission and a
  continuously running render loop respectively.

---

## Features

- Orbit, zoom and pan a 775k-triangle Model X as a wireframe hologram.
- Eight systems — body, glass, doors, cabin, battery, drive units, suspension,
  wheels — each with plain-language description and operating principle.
- A single slider takes the car from assembled, through systems separating, to
  all **334 pieces** laid out in a flat exhibition grid.
- Tap any piece to focus it; isolate a system or a single piece and the camera
  reframes onto it.
- Optional scene labels and per-piece markers.
- Hand control and noise layer, both opt-in.
- Registers a WebMCP tool (`explore_vehicle_component`) when the browser
  exposes `document.modelContext`, so an agent can drive the view.
- Reduced-motion aware; phone layout with safe-area insets and 44px targets.

---

## Built with

- **[higgsfield](https://higgsfield.ai)** — generated the holographic HUD
  reference image (`public/higgsfield_image.png`). Every visual decision in the
  interface was made against that image rather than invented in isolation.
- **Three.js** 0.159 — rendering, post-processing, GLTF loading.
- **MediaPipe Tasks Vision** — hand landmark detection for the gesture control.
- **React 19**, **Tailwind 4**, shadcn (`base-nova`), lucide icons.

---

## Running locally

Requires Node.js 22.13+.

```sh
npm ci
npm run build:vercel   # production SPA → dist/vercel
```

For the Vite dev server used by the deployed build, serve `dist/vercel`, or run
the RSC/Cloudflare harness with `npm run dev -- --port 3015` if you have that
toolchain available.

Hand control needs a camera permission and a secure context — it works on
`localhost` and over HTTPS.

---

## Deployment

`vercel.json` is checked in: import the repository into Vercel with the root as
the project root. It builds with `npm run build:vercel` and serves
`dist/vercel`. No environment variables or database required.

---

## Project structure

```
app/
  page.tsx              the HUD; all React state lives here
  vehicle-scene.tsx     the Three.js engine, one useEffect
  globals.css           design tokens and every hand-written style
  parts.ts              8 systems + per-piece prose
  explosion-layout.ts   deterministic packing of 334 pieces
  noise-field.ts        drifting text / debris / dust        [added]
  hand-control.ts       MediaPipe gesture control            [added]
  pointer-tap.ts        tap vs. drag discrimination
public/models/          the GLB and its 334-piece manifest
scripts/                Blender conversion + validators
vercel-app/             SPA entry point
```

---

## Validation

```sh
npx tsc --noEmit
npm run lint
node --experimental-strip-types scripts/validate-explosion.mjs
node --experimental-strip-types scripts/validate-touch.mjs
npm run build:vercel
```

`validate-explosion.mjs` parses the GLB in Node, runs the layout and asserts 334
distinct slots plus camera coverage at three viewport proportions. It is a
geometry check, not a browser frame-rate measurement.

---

## Model source and scope

The Model X asset is by [cgi Moon on BlendKit](https://www.blendkit.com/asset-gallery-detail/983e8f94-5a56-44a4-94d9-eed5e4cdcd6c/),
used under the [BlendKit Royalty Free license](https://www.blendkit.com/docs/licenses/).
Asset redistribution is subject to that license.

This source depicts a **pre-refresh Model X, with an unverified exact model
year**. The 334 pieces are artist-authored mesh islands, **not** verified Tesla
service-part identifiers. The battery, drive units and suspension are
**illustrative geometry** authored for this project, not scanned parts — the
interface marks them as such.

The SYSTEM STATUS and PERFORMANCE read-outs in the HUD are **display dressing**.
Nothing in this study measures a real vehicle.

This is an independent educational project. It is not a complete OEM parts
catalog and is not affiliated with, endorsed by, or sponsored by Tesla, Inc.

---

## License

No license is granted for redistribution of this repository as a whole: the
upstream project carries no license file, and the 3D asset is covered by the
BlendKit terms linked above. If you want to reuse the code, start from
[the upstream repository](https://github.com/ashemag/model-x-studio) and ask
there.

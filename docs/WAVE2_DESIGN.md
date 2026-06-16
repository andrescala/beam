# Wave 2 Design — Multi-track Timeline + Unified Compositor

**Status:** proposed, awaiting approval before implementation.
**Scope:** E2 (multi-clip / multi-track timeline) + E4 (one effect model rendered identically by the live preview and the FFmpeg exporter).
**Branch:** continues on `claude/beam-v3`.

This is the editor-core rewrite. It rewrites the hub files (`projects.js` schema, `ffmpeg.js` export, `Timeline.jsx`, `VideoPreview.jsx`, `Editor.jsx`), so it is done sequentially and behind a strict test gate that keeps the app shippable at every step.

---

## 1. Goals & non-goals

**Goals**
- A project can hold **multiple video clips** in sequence on a video track: append more recordings/imported videos, **split** at the playhead, **ripple-delete**, **reorder**, trim each clip's edges independently.
- **Transitions** between adjacent clips (cross-dissolve, dip to black).
- A **single declarative render model** consumed by both renderers, so preview == export (kills the long-standing preview/export drift and the GIF feature-loss class of bugs).
- **Lossless migration**: every existing v1 project opens and exports identically.

**Non-goals (deferred to Wave 3+)**
- Full N-video-track compositing / picture-in-picture of two screen recordings side by side. Wave 2 supports **one video track with many sequential clips**, plus overlay tracks (text/image/shape/webcam) and audio tracks. Stacked video compositing is a later enhancement of the same model.
- New visual effects (backgrounds, shapes, etc.) — those are Wave 3, built on this model.

---

## 2. The shared render model (the heart of E4)

A pure function `buildRenderModel(project)` (new file `src/shared/render-model.js`, used by both processes) converts the project document into a normalized, time-based plan. Both the canvas preview and the FFmpeg builder consume **only** this model — neither reads the raw project schema for rendering. That single consumption point is what prevents drift.

```js
RenderModel = {
  width, height,                 // output canvas size (from project or preset)
  duration,                      // total timeline seconds
  videoSegments: [               // ordered, non-overlapping on the timeline
    {
      id,
      sourceFile,                // master path for export, proxy path for preview
      sourceIn, sourceOut,       // trim within the source (seconds)
      timelineStart, timelineEnd,// position on the global timeline (seconds)
      speed,                     // playback rate
      transform: { cropX, cropY, cropW, cropH, scale, posX, posY },
      effects: [ {type:'blur',strength}, {type:'vignette',intensity},
                 {type:'zoom',keyframes:[…]} ],
      transitionIn: { type:'dissolve'|'dipBlack'|null, duration }
    }
  ],
  overlays: [                    // text, image, shape, caption, webcam
    { id, kind, timelineStart, timelineEnd, geometry:{x,y,w,h,rotation,opacity},
      style:{…}, animation:{in,out}, source }       // source for image/webcam
  ],
  audioSegments: [
    { id, sourceFile, sourceIn, sourceOut, timelineStart, speed,
      volume, muted, fadeIn, fadeOut, denoise, duckUnderVoice, isVoice }
  ],
  cards: { intro, outro }        // title cards, modeled as synthetic segments
}
```

Key property: `timelineStart/timelineEnd` are **output-time** coordinates, so neither renderer has to re-derive the cut/speed mapping that `ffmpeg.js` does today with `mapTimeToOutput`. The model builder does that math once.

---

## 3. Project schema v2

Add `schemaVersion: 2`. The `recordings` map stays as the **media library** (sources by id). A new `timeline` replaces the flat `edit` for composition, while per-source audio settings (mic/system volume) and global export settings remain.

```js
project = {
  id, name, createdAt, updatedAt, thumbnail, duration,
  schemaVersion: 2,
  media: {                       // supersedes `recordings` (kept as alias on load)
    <mediaId>: { kind:'screen'|'webcam'|'mic'|'system'|'import',
                 master, proxy, hasAudio, width, height, duration }
  },
  timeline: {
    videoTrack: [ <clip>… ],     // ordered clips (see model)
    overlayTracks: [ [ <item>… ] ],
    audioTracks: [ [ <audioClip>… ] ],
    webcam: { mediaId, position, size, shape, perSegmentOverrides… }
  },
  captions: [...], transcript: {...},   // unchanged
  cards: { intro, outro },
  exportSettings: {...}
}
```

### Migration v1 → v2 (lossless, the riskiest part)
`loadProject` detects `schemaVersion !== 2` and converts:
- `recordings.*` → `media` entries (ids: `screen`, `webcam`, `mic`, `system`).
- The single screen recording **split by `edit.cuts`** into one video clip per keep-segment, placed sequentially; `trimStart/End` bound the first/last; `edit.speed` → each clip's `speed`; `edit.crop` → clip `transform`; `backgroundBlur`/`cursorSpotlight`/`zoomKeyframes` → clip `effects`.
- `textLayers`/`imageLayers` → overlay items; `audioLayers` → audio clips; `webcam*` → `timeline.webcam`; `captions`/`transcript` unchanged; `introCard`/`outroCard` → `cards`.
- Write back so the migration runs once.

A v1→v2 conversion **must produce a RenderModel identical to what v1's `exportMp4` would have built** — this is the migration's correctness test (§6).

---

## 4. The two renderers

### 4a. FFmpeg builder (`ffmpeg.js`)
Rewrite `runExport` to consume `RenderModel`:
- For each `videoSegment`: `trim`/`atrim` from its source, `setpts`, apply `speed`, `transform` (crop+scale), `effects`; then `concat` all segments (with transition handling via `xfade`/`acrossfade` between adjacent segments).
- Overlays via `overlay`/`drawtext` with `enable='between(t,start,end)'` using the model's output-time coords (no more `mapTimeToOutput` — already baked in).
- Audio segments mixed via `amix` (reusing the Wave-1 limiter/duck/fade logic).
- Output stage (codecs/formats/HW-encode) from Wave 1 is unchanged.

### 4b. Canvas preview compositor (`VideoPreview.jsx` → new `Compositor`)
A `requestAnimationFrame` loop drawing to a `<canvas>`:
- Maintain a small pool of `<video>` elements for the active (and next, for transition) video segments, kept seeked/synced to the playhead — generalizes today's webcam/mic sync logic.
- Each frame: pick the active segment for time `t`, draw its video frame to canvas with the segment `transform`, apply `effects` (canvas filters: `ctx.filter='blur()'`, vignette via gradient, zoom via scale), then draw overlays, then captions.
- Audio: keep the parallel `<audio>`/`<video>` element approach for the active audio segments (volume/fades applied live).
- Transitions: during a transition window, draw both outgoing and incoming segments with the dissolve alpha.

Pragmatic fidelity bar: **layout, timing, visibility, and transforms match**; canvas vs libx264 won't be pixel-identical, and that's acceptable. Where exact match matters (text), we use the same font metrics.

---

## 5. Timeline UI (`Timeline.jsx`)
- Multi-track lanes: video (clips as draggable blocks), webcam, overlay(s), audio(s).
- Clip ops: drag to move/reorder (snap to playhead/clip edges/markers), drag edges to trim, **S** split at playhead, **Del** ripple-delete, **Cmd/Ctrl+D** duplicate.
- Timeline zoom (+/-), playhead scrub, markers.
- Audio waveforms (E5) rendered from precomputed peaks (new `media.<id>.peaks` generated on import/record).
- Per-clip inspector reuses the existing Inspector for transform/speed/effects.

---

## 6. Build order — each step keeps the app green

1. **Schema v2 + migration** behind the scenes; add a temporary `renderModelFromV1` so nothing else changes yet. **Gate:** existing E2E pass; a new migration test asserts v1→v2→RenderModel equals the v1 export plan.
2. **`buildRenderModel` + FFmpeg builder rewrite** to consume it. **Gate:** Node export-parity test — export a migrated fixture through old vs new builder, assert identical filter graph / output dimensions+duration (the harness I've used all along).
3. **Canvas compositor** replaces VideoPreview. **Gate:** E2E + screenshot review.
4. **Multi-track Timeline UI** (clips/split/ripple/snap/zoom/waveforms). **Gate:** E2E + new timeline interaction tests.
5. **New capabilities:** append clip, transitions, per-clip speed ramps. **Gate:** export tests per feature.

Each step is its own commit; the branch never holds a broken tree.

---

## 7. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Migration data loss | One-time, write-back; golden test that v1 projects export identically pre/post migration; keep a `.v1.bak` of project.json on first migrate. |
| Preview/export drift | Single `buildRenderModel` consumed by both; no rendering reads raw schema. |
| Performance on long timelines | Preview uses proxies + a 2–3 element video pool, not one element per clip. |
| Scope creep | Wave 2 = sequential clips on one video track; stacked PiP deferred. |
| E2E fixtures assume v1 shape | Update `e2e/editor.spec.js` fixture to v2 (and keep one v1 fixture to test migration). |

---

## 8. Estimated surface
New: `src/shared/render-model.js`, `src/renderer/src/components/Compositor.jsx`, migration in `projects.js`, waveform peaks generator. Rewritten: `ffmpeg.js` (export), `Timeline.jsx`, `VideoPreview.jsx`, `Editor.jsx` state. ~5 sequential sub-phases, each independently tested and committed.

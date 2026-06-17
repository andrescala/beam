# Beam — Gap Analysis

Current state verified against the codebase (commit `6d4c688`), mapped against the target in [SPEC.md](./SPEC.md). Every "today" claim below was checked in source, not just the README.

---

## 1. What we have today (verified)

**Recording** (`src/renderer/src/hooks/useRecorder.js`, `src/main/index.js`)
- Screen/window capture via `getDisplayMedia` + `setDisplayMediaRequestHandler`, source picker with thumbnails.
- Mic captured as a **separate track** (`mic.webm`) with processing disabled for sync — good architecture, already track-based.
- Optional webcam as separate `webcam.webm` (fixed 640×480).
- Pre-warmed streams + countdown (no missing first frames), pause/resume, accurate timer.

**Editing** (`Editor.jsx`, `Timeline.jsx`, `Inspector.jsx`, `LayerPanel.jsx`, `CaptionEditor.jsx`, `AssetLibrary.jsx`)
- Non-destructive edit model in `project.json` with field migrations (`projects.js`).
- Trim, multi-region cuts, global speed (0.25–4×), aspect-ratio crop, webcam position/size/shape, mic volume/mute, audio sync offset.
- Text / image / audio layers with timing; caption editor with Whisper auto-transcription (if user installed Whisper) and SRT export.
- Effects: silence detection (`silencedetect`), intro/outro cards, vignette, whole-video blur, zoom keyframes.
- Asset library per project (images + audio) with in-use tracking.

**Export** (`src/main/ffmpeg.js`)
- Single-pass FFmpeg `filter_complex` pipeline: cuts → speed → crop → blur → vignette → zoom → circular webcam mask → image overlays → drawtext (text + captions) → audio mix → intro/outro concat. Genuinely sophisticated.
- MP4 (libx264, fixed CRF 23/medium, source resolution) and 2-pass palette GIF (640px/15fps). Progress events to UI.

**App shell**
- Project CRUD, thumbnails, rename, delete, `.beamproject` backup/import, preferences, `project-file://` protocol with path-traversal protection, onboarding walkthrough + help drawer, 53 Playwright E2E tests.

This is a strong **single-recording post-processor**. The gaps are what separate it from a competitive **studio**.

---

## 2. Gap matrix

Severity: 🔴 blocks competitiveness · 🟠 expected by users, missing · 🟡 differentiator/polish.
Effort: S (<1 wk) · M (1–3 wk) · L (>3 wk, may need native code).

### 2.1 Recording

| # | Gap | Today (evidence) | Target | Sev | Effort |
|---|---|---|---|---|---|
| R1 | **No system/app audio capture** | `getDisplayMedia({ audio: false })` (`useRecorder.js:76`); the main-process handler already offers `audio: 'loopback'` (`index.js:490`) but the renderer never requests it | System audio as separate track, UI toggle | 🔴 | S–M |
| R2 | **Master is destroyed on save** | `saveRawRecording` re-encodes the raw capture to VP8 3 Mbps 30 fps and keeps only that (`projects.js:176`, `ffmpeg.js:134`) — quality permanently lost for seekability | Keep raw master untouched; generate a separate editing proxy | 🔴 | M |
| R3 | No mic/camera device pickers, no input level meter | Default devices only (`useRecorder.js:85,103`) | Device enumeration + meters | 🟠 | S |
| R4 | No region (drag-rectangle) capture | Screen/window only (`index.js:96`) | Custom region source | 🟠 | M |
| R5 | Webcam capped at 640×480 | `useRecorder.js:104` | Up to 1080p, device-dependent | 🟠 | S |
| R6 | No global hotkeys / tray quick-record | Tray icons exist in `resources/` but no `Tray` code anywhere | Tray + configurable global shortcuts | 🟠 | S–M |
| R7 | No cursor/click/keystroke event capture | Roadmap items deferred ("requires native module") | `events.json` sidecar via `uiohook-napi` — prerequisite for auto-zoom, click ripples, cursor smoothing, keystroke HUD | 🟡→🔴 (enables flagship features) | L |
| R8 | Crash loses entire recording | Chunks held in renderer memory, written only on stop (`useRecorder.js` chunk refs) | Stream chunks to disk during capture + recovery | 🟠 | M |
| R9 | No 60 fps option | Remux forces 30 fps (`ffmpeg.js:139`) | 30/60 setting | 🟡 | S (after R2) |

### 2.2 Editing core

| # | Gap | Today (evidence) | Target | Sev | Effort |
|---|---|---|---|---|---|
| E1 | **Cannot import external video** | Asset import allows images/audio only (`index.js:175-189`); a project's video can only come from recording | MP4/MOV/WebM/MKV import + drag-and-drop; "edit videos not recorded here" | 🔴 | M |
| E2 | **Single video clip, no multi-track timeline** | One screen recording per project; timeline visualizes trim/cuts on it | N video/audio/overlay tracks, clip move/split/ripple-delete, snapping | 🔴 | L |
| E3 | **No undo/redo** | No history anywhere; edits save directly to disk (`Editor.jsx:51`) | Command stack, Cmd+Z everywhere | 🔴 | M |
| E4 | Preview ≠ export | Preview shows video + webcam + layers, but export-only effects (blur, vignette, zoom, intro/outro, caption styling) aren't rendered live; GIF silently drops overlays (`ExportModal.jsx:103`) | Unified compositor: one effect model rendered identically in preview and FFmpeg | 🔴 | L |
| E5 | No audio waveforms on timeline | No waveform code in `Timeline.jsx` | Precomputed peaks rendered per clip | 🟠 | M |
| E6 | Minimal keyboard support | Only Space (`Editor.jsx:95`) | J/K/L, frame-step, I/O, S split, etc. | 🟠 | S |
| E7 | No transitions | Concat is hard-cut only (`ffmpeg.js`) | Dissolve/dip/slide between clips | 🟠 | M |
| E8 | Speed is global only | Single `edit.speed` (`projects.js:49`) | Per-range speed ramps | 🟡 | M |
| E9 | Numeric-field overlay positioning | Inspector sliders/fields; no on-canvas drag | Direct manipulation on preview with guides | 🟠 | M |

### 2.3 Audio

| # | Gap | Today | Target | Sev | Effort |
|---|---|---|---|---|---|
| A1 | No fades, no audio-layer trim, no looping | Layers have only `volume` + `startTime` (`ffmpeg.js:534-549`) | Fade handles, trim, loop-to-fit | 🟠 | S–M |
| A2 | No auto-ducking | — | Sidechain music under speech | 🟠 | M |
| A3 | No noise removal | — | One-click `afftdn`/RNNoise cleanup | 🟠 | S–M |
| A4 | No loudness normalization | Fixed 128k AAC, no `loudnorm` | −14 LUFS social target per preset | 🟠 | S |
| A5 | No voiceover punch-in re-record | — | Record mic over a timeline range | 🟡 | M |

### 2.4 Elements & motion

| # | Gap | Today | Target | Sev | Effort |
|---|---|---|---|---|---|
| L1 | No shapes/arrows/callouts/blur-redaction | Text + image layers only | Shape/arrow/highlight/redaction layers | 🟠 | M |
| L2 | No text animations, single font hack | `font=Arial Bold` only (`ffmpeg.js:517`) | Font picker, shadows/outline, entry/exit animations | 🟠 | M |
| L3 | Webcam fixed to 4 corners, whole-video | Corner enum (`ffmpeg.js:431-436`) | Webcam as draggable per-segment layer, fullscreen mode | 🟠 | M |
| L4 | No backgrounds/padding (Screen-Studio look) | — | Inset on gradient/wallpaper, rounded corners, shadow | 🟠 | M |
| L5 | No auto-zoom / click ripples / cursor smoothing | Manual zoom keyframes only (`ffmpeg.js:370-417`); blocked on R7 | Auto-generated from events, reviewable | 🟡 (flagship) | L |
| L6 | Blur/vignette are whole-video | `edit.backgroundBlur` global | Per-segment effects | 🟡 | S–M |

### 2.5 Captions & AI

| # | Gap | Today | Target | Sev | Effort |
|---|---|---|---|---|---|
| C1 | **Transcription requires user-installed Whisper** | PATH probing + install-instructions error (`transcribe.js:26-41`, `index.js:347-351`) | Bundle whisper.cpp + on-demand model download — zero setup | 🔴 | M |
| C2 | No transcript panel / text-based editing | Captions list only (`CaptionEditor.jsx`) | Descript-style: delete text → cut video; click word → seek | 🟡 (flagship) | L |
| C3 | No filler-word removal | Silence detection only | Word-level timestamps → review list → cuts | 🟠 | M (after C1) |
| C4 | No caption style presets | Plain drawtext bar (`ffmpeg.js:492`) | Social word-highlight, presets; VTT export | 🟠 | M |
| C5 | No AI titles/chapters/highlights/edit-by-prompt | No LLM integration | Tier C BYO-key Claude integration producing reviewable edit ops | 🟡 | M–L |
| C6 | No smart reframe for vertical | — | Cursor/face-aware crop tracking for 9:16 | 🟡 | L |

### 2.6 Export

| # | Gap | Today (evidence) | Target | Sev | Effort |
|---|---|---|---|---|---|
| X1 | **No social/platform presets, no resizing** | Export = source-resolution MP4 or 640px GIF, zero options (`ExportModal.jsx`); crop exists but no output scaling/padding | Preset system: YouTube/Reels/Shorts/Square/X + resolution/fps/quality per preset, pad or crop fill | 🔴 | M |
| X2 | No batch export / render queue | One synchronous export at a time | Multi-preset queue with progress, cancel, notifications | 🟠 | M |
| X3 | No hardware encoding, fixed quality | `libx264 -preset medium -crf 23` hardcoded (`ffmpeg.js:637-639`) | VideoToolbox/NVENC/QSV with software fallback; quality slider | 🟠 | S–M |
| X4 | GIF drops overlays/effects | Separate reduced pipeline (`exportGif`) | Single shared filter-graph builder for all formats | 🟠 | M (folds into E4) |
| X5 | No H.265/WebM/audio-only export | MP4 + GIF only | Additional containers/codecs, MP3/M4A | 🟡 | S |
| X6 | No keyframable reframe for aspect change | Static crop only | Animated crop window over time | 🟡 | M |

---

## 3. Priority plan

### P0 — Trust & table stakes (Phase A)
The four 🔴 foundation items that everything else builds on, plus cheap wins:

1. ✅ **R2** Master/proxy split — stop destroying quality on save (prerequisite for credible 1080p+/60fps output).
2. ✅ **R1** System audio capture (the handler already supports loopback; renderer work mostly).
3. ✅ **E3** Undo/redo command stack (do *before* the timeline rewrite so all new features inherit it).
4. ✅ **C1** *(amended per product decision: the model stays OUT of the bundle)* — Whisper model auto-downloads on first transcription, with a status chip (installed / downloading % / failed-retry / not-installed) that's clickable to trigger or retry. The engine (whisper-cpp or openai-whisper) remains a one-time user install.
5. ✅ Quick wins: R3 (device pickers), R5 (1080p webcam), R6 (tray + hotkey), E6 (shortcuts), A4 (loudnorm), X3-partial (CRF quality + resolution scaling). Bonus: bundled ffprobe (probing previously depended on a system install), fixed intro/outro concat stream ordering, fixed zoompan undoing speed changes.

### Wave-3 batch (v3 branch `claude/beam-v3`) — landed
- ✅ **R4** Region (drag-rectangle) capture · ✅ **R9** 60 fps option · ✅ **R8** crash-safe chunked recording (stream chunks to disk during capture + recovery scan on launch).
- ✅ **X3** Hardware-accelerated encoding (VideoToolbox/NVENC/QSV probe + libx264/libx265 fallback) · ✅ **X5** HEVC/WebM/MP3/M4A/PNG export · ✅ **X4** GIF now runs the full filter graph (includes overlays/effects).
- ✅ Settings screen · ✅ auto-update (electron-updater, guarded) · ✅ Home search/sort/tags + storage usage.
- ✅ **C2** Transcript-based editing (segment-granular) · ✅ **C3** filler-word removal · ✅ VTT export · ✅ **C5** AI copilot (BYO Claude key: titles/chapters/highlights/edit-by-prompt, consent-gated).

### P1 — Become a real editor (Phase B) → unlocks "edit videos not recorded here"
6. ✅ **E1** External video import — implemented as "Import Video" on Home: any MP4/MOV/WebM/MKV becomes a project (master kept untouched, seekable proxy with audio, thumbnail), so the full single-clip editor and export pipeline work on external footage. Multi-clip composition arrives with E2.
7. **E2** Multi-track/multi-clip timeline (the largest single work item; design with E4's unified effect model).
8. **E4** Unified preview/export compositor (kills X4 too).
9. E5 waveforms, E7 transitions, A1–A3 audio basics, E9/L1/L2 overlay upgrades, L4 backgrounds.

### P2 — Publish everywhere (Phase C) → the social-media ask
10. ✅ **X1** Platform presets + resizing/padding — rendition multi-select in the export modal (Original, YouTube 1080p, TikTok/Reels/Shorts 9:16, Square 1:1, X/LinkedIn 720p) with blur-fill or crop-to-fill reframing, labeled output files.
11. ✅ **X2** Batch render queue — selected renditions render sequentially with per-rendition progress, partial-failure reporting, and retry.
12. ✅ **A1-partial** Audio layer fade in/out (trim/loop still open) · ✅ **A2** auto-ducking (sidechain compression under recording audio) · ✅ **A3** mic noise reduction (`afftdn`).
13. C4 caption styles, X6 keyframed reframe, L3 webcam-as-layer.

### P3 — AI differentiation (Phase D)
13. **R7** Event capture (native module) → **L5** auto-zoom/click effects/cursor smoothing — the "Screen Studio killer" features. (Wave 4)
14. ✅ **C2** Transcript-based editing + ✅ **C3** filler-word removal — the "Descript killer" features (segment-granular; word-level pending word timestamps).
15. ✅ C5 titles/chapters/highlights/edit-by-prompt (BYO Claude key) · C6 smart reframe (Wave 4).

### Remaining after the v3 branch
- **Wave 2 (next):** E2 multi-track/multi-clip timeline + E4 unified preview/export compositor — the editor-core rewrite. Enables E5 waveforms, E7 transitions, E8 speed ramps, E9 on-canvas drag.
- **Wave 3:** L4 backgrounds/padding, L1 shapes/arrows/redaction, L2 text animation+fonts, L6 per-segment blur/vignette, C4 caption style presets, L3 webcam-as-layer, X6 keyframable reframe.
- **Wave 4:** R7 event capture → L5 auto-zoom/click ripples/cursor smoothing, C6 smart reframe, A5 voiceover punch-in.

### Explicitly deferred
Studio-voice TTS (model size + misuse review), translation, Linux-first polish, live streaming (out of scope for the product vision).

---

## 4. Risks & dependencies

| Risk | Mitigation |
|---|---|
| E2 (multi-track timeline) is a rewrite of the editor's core | Keep `project.json` non-destructive model; introduce `schemaVersion` + migration that wraps today's single recording as "1 video clip + layers" so existing projects open unchanged |
| R7 needs a native module (`uiohook-napi`) — packaging/permissions per OS | Ship behind a feature flag; all dependent effects (L5) degrade gracefully to manual keyframes (already exist) |
| E4 dual-renderer drift (preview vs FFmpeg) | Single declarative effect-graph spec with golden-frame tests comparing compositor output vs FFmpeg output per effect |
| Whisper model size (C1) | Download on first use with consent + size display; keep PATH detection as power-user override |
| Hardware encoders produce decoder-hostile output (already seen: VideoToolbox `-12909` workarounds in `ffmpeg.js:120`, `index.js:29`) | Encode-probe at startup, automatic libx264 fallback, keep software path as default until preset validated |
| Scope creep vs. Loom-simplicity | Keep the "record → auto-edit → export" happy path one screen; advanced timeline is progressive disclosure |

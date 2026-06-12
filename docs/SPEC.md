# Beam 2.0 — Product Specification

**Local-first screen recording and video editing studio.**
No cloud, no account, no upload. Everything — recording, editing, AI assistance, export — runs on the user's machine.

This document specifies the complete target application. The companion [GAP_ANALYSIS.md](./GAP_ANALYSIS.md) maps each capability against what exists in the codebase today and prioritizes the work.

---

## 1. Vision & Positioning

Beam today is a solid Loom alternative: record screen + webcam + mic, trim/cut, overlay text and images, export MP4/GIF. Beam 2.0 expands into the space currently split across four paid tools:

| Competitor | What they own | What Beam takes from them |
|---|---|---|
| **Loom** | Frictionless capture & sharing | Instant capture UX, webcam bubble, one-click result |
| **Screen Studio** | Beautiful screen recordings | Auto-zoom on clicks, smooth cursor, backgrounds/padding, motion polish |
| **Descript** | Edit video by editing text | Transcript-driven editing, filler-word removal, studio sound |
| **CapCut / Premiere (lite)** | General editing & social export | Multi-clip timeline, external media import, per-platform export presets |

**Differentiator:** all of the above, fully local, open source, free. Privacy (nothing leaves the machine) is a feature, not a compromise.

**Target users:** developers and PMs making product demos; course creators and educators; support teams; indie marketers producing social clips from longer recordings.

---

## 2. Product Pillars

1. **Capture anything, instantly** — screen, window, region, system audio, mic, webcam; start from tray hotkey in <2 s.
2. **Edit like a pro, think like a writer** — multi-track timeline for precision *and* transcript editing for speed.
3. **Look great by default** — auto-zoom, cursor smoothing, backgrounds, smart layouts with zero manual keyframing.
4. **Publish everywhere from one edit** — one timeline, many renditions: YouTube 16:9, TikTok/Reels 9:16, Square 1:1, GIF, audio-only.
5. **Local AI copilot** — transcription, silence/filler removal, noise cleanup, titles/chapters/highlights — on-device by default, optional BYO API key for heavier tasks.

---

## 3. Feature Specification

### 3.1 Recording Engine

| Feature | Spec |
|---|---|
| **Sources** | Full screen, single window, **custom region** (drag-select rectangle), single display in multi-monitor setups. |
| **System audio** | Capture app/system audio as a **separate track** (Electron loopback on macOS/Windows). Toggle in recorder UI. |
| **Microphone** | Device picker (enumerate inputs), input level meter before recording, per-track gain. Saved as separate track (already the architecture). |
| **Webcam** | Device picker, resolution up to 1080p, live preview, circle/rect/rounded-rect shape, mirror toggle. Recorded as separate track (already the architecture). |
| **Quality** | Capture at native resolution; 30 or 60 fps option; master files preserved losslessly (proxy generated separately for editing — never re-encode the master). |
| **Cursor & input capture** | Record mouse position/click/scroll and keystroke events to a sidecar `events.json` (native module: `uiohook-napi` or platform APIs). Powers auto-zoom, click ripples, cursor smoothing, and keystroke HUD at edit time — effects are non-destructive because raw events are kept. |
| **Controls** | 3-2-1 countdown (exists), pause/resume (exists), **global hotkeys** (start/stop/pause, configurable), **menu-bar/tray quick-record** with source memory ("record same as last time"), recording time limit option, "stop and discard". |
| **While recording** | Floating control strip (timer, pause, stop, cancel, draw-on-screen toggle), optional click/keystroke visualization live. |
| **Camera-only & audio-only modes** | Record just webcam (talking head) or just mic (voiceover) into a project. |

### 3.2 Project Model & Media Import

| Feature | Spec |
|---|---|
| **Import external video** | MP4, MOV, WebM, MKV, AVI via file dialog **and drag-and-drop onto the timeline/library**. Imported files are probed (ffprobe), thumbnailed, and become clips equal to recordings. *This is the single biggest unlock: Beam becomes an editor, not just a recorder post-processor.* |
| **Import audio/images** | Exists today; add drag-and-drop, and audio waveform thumbnails in the library. |
| **Multi-recording projects** | A project holds N media items (recordings + imports). New recordings can be appended to an existing project ("retake" / "record more"). |
| **Project format** | Keep non-destructive `project.json`; version it (`schemaVersion`) with explicit migrations. Store edit state as a **document with undo history** (see 3.3). |
| **Shared asset library** | Global (cross-project) library for brand assets: logos, intro/outro templates, music beds, color palette, fonts. |
| **Templates** | Save any project's structure (intro/outro, watermark, caption style, export presets) as a reusable template; new recordings can start from a template. |

### 3.3 Timeline & Editing Core

| Feature | Spec |
|---|---|
| **Multi-track timeline** | Tracks: video (N), webcam, text/overlay (N), audio (N). Clips can be moved, trimmed at both edges, **split at playhead (S key)**, ripple-deleted, and reordered. Snap to playhead/clip edges/markers. |
| **Undo/redo** | Full history (Cmd/Ctrl+Z / Shift+Z) across every edit operation. Implemented as command stack over the project document. |
| **Keyboard-first** | Space play/pause (exists), J/K/L shuttle, ←/→ frame step, I/O set in/out, S split, Del ripple delete, Cmd+D duplicate, +/- timeline zoom. Shortcut cheat-sheet overlay (`?`). |
| **Timeline zoom & navigation** | Pinch/scroll zoom, minimap for long recordings, markers/chapters on the timeline. |
| **Audio waveforms** | Rendered waveform on every audio-bearing clip (precomputed peaks file per media item). |
| **Transitions** | Cross-dissolve, dip-to-black/white, slide, between adjacent clips; default duration configurable. |
| **Preview fidelity** | The preview player renders **all** effects (crop, blur, vignette, zoom, layers, transitions, caption styles) so WYSIWYG matches export. Render via canvas/WebGL compositor over the proxy video. |
| **Proxy editing** | Auto-generate a lightweight editing proxy (e.g., 720p) for smooth scrubbing of 4K/long recordings, while export always uses the untouched master. |

### 3.4 Audio Editing

| Feature | Spec |
|---|---|
| **Track mixer** | Per-track volume, mute, solo for mic / system audio / music / SFX layers. |
| **Clip-level audio** | Trim audio layers, fade in/out handles, loop music to fit duration. |
| **Auto-ducking** | Sidechain: lower music automatically under speech (detected from mic track / transcript timing). One toggle. |
| **Noise removal** | One-click background-noise cleanup (FFmpeg `afftdn`/`arnndn` with bundled RNNoise model). Preview before/after. |
| **Loudness normalization** | Normalize export to broadcast/social loudness (`loudnorm`, −14 LUFS default for social/YouTube). |
| **Voiceover re-record** | Record a new mic take over a selected timeline range (punch-in), replacing or layering the original. |
| **Royalty-free starter pack** | Ship a small CC0 music/SFX pack in the global library. |

### 3.5 Elements & Overlays (on top of video)

| Feature | Spec |
|---|---|
| **Direct manipulation** | All overlays are positioned/resized/rotated by **dragging on the preview canvas** with alignment guides — not numeric fields (fields remain in the inspector for precision). |
| **Text** | Font family picker (system fonts + bundled brand-safe set), size, weight, color, background pill, outline/shadow, alignment, padding. Entry/exit animations (fade, slide, pop, typewriter). |
| **Shapes & callouts** | Rectangle, ellipse, line, **arrow**, blur-region (privacy redaction that tracks a fixed region), highlight box, numbered step badges. |
| **Images/stickers** | Exists; add rotation, opacity, drop shadow, corner radius, entry/exit animations. |
| **Click effects** | Click ripple animation and keystroke HUD rendered from recorded `events.json` (see 3.1) — toggleable per project, styleable. |
| **Webcam as a layer** | Webcam bubble becomes a draggable timeline layer: reposition/resize/hide per segment (e.g., move it when it covers content; fullscreen "talking head" segments). |
| **Backgrounds & padding** | Screen-Studio-style: inset the recording on a background (color/gradient/wallpaper/blurred self), rounded corners, drop shadow, adjustable padding. Critical for social-ready vertical exports. |

### 3.6 Motion & Effects

| Feature | Spec |
|---|---|
| **Auto-zoom** | Generate zoom keyframes automatically from recorded click/cursor events; user can accept/adjust each. Manual zoom keyframes remain (exist today) with easing curve options. |
| **Cursor smoothing & scaling** | Re-render the cursor from event data: smooth path interpolation, configurable size, hide-when-idle. (Requires cursor-hidden capture or post-hoc cursor compositing.) |
| **Speed ramps** | Per-segment speed (exists globally today): apply 2–8× to selected ranges (e.g., "speed through the boring install"), with optional auto-detect of inactivity. |
| **Vignette / blur** | Exist today; make them per-segment rather than whole-video. |
| **Intro/outro cards** | Exist today; upgrade to template-based (logo, fonts, animation presets) and store in global library. |

### 3.7 Captions & Transcript

| Feature | Spec |
|---|---|
| **Bundled transcription** | Ship **whisper.cpp** binary + small model (e.g., `base.en` ~140 MB, downloaded on first use with consent) — zero-setup captions. Keep auto-detect of an existing system Whisper for users who have better models. Language auto-detect; word-level timestamps. |
| **Transcript panel & text-based editing** | Side panel showing the transcript synced to the playhead. **Selecting and deleting text deletes the corresponding video range** (Descript-style). Click a word to seek. |
| **Filler-word removal** | Detect "um, uh, like, you know" from word-level transcript; one-click review list → remove all/selected as cuts. |
| **Silence removal** | Exists; surface in the same review UI as filler words. |
| **Caption styling** | Style presets (modern social "karaoke" word-highlight, classic bar, minimal), font/size/color/position, per-project default. Burned-in (exists) or soft (SRT/VTT export — SRT exists, add VTT). |
| **Translation** | Optional: translate captions via local model or BYO API key; export multiple SRT languages. |

### 3.8 AI Copilot (local-first)

Three tiers, clearly labeled in the UI:

- **Tier A — bundled, always available:** whisper.cpp transcription, silence/filler detection, noise removal, loudness, auto-zoom from events, inactivity speed-up suggestions.
- **Tier B — optional local model download:** larger Whisper models, translation.
- **Tier C — BYO API key (explicit opt-in, off by default, clearly marked as leaving the machine):** Claude API for the language features below.

| Feature | Spec |
|---|---|
| **Auto titles & descriptions** | Generate video title, description, hashtags per target platform from the transcript. |
| **Auto chapters** | Segment the transcript into chapters; insert timeline markers; export YouTube chapter text. |
| **Highlight/clip suggestions** | Suggest 15–60 s self-contained segments from a long recording for social clips; one click creates a sub-project per clip with 9:16 preset applied. |
| **Edit by prompt** | "Remove everything before the login demo", "tighten pauses", "add captions in the social style" — the copilot translates intent into reviewable edit operations (never auto-applies destructive changes without a diff-style confirmation). |
| **Smart reframe** | For 16:9 → 9:16 conversion, auto-position the crop window on the action (cursor/click density from events; face detection for webcam) instead of dumb center-crop. |
| **Studio voice (stretch)** | Local voice-clone TTS to patch a misspoken word from corrected transcript text. Flagged as stretch goal due to model size and misuse review. |

### 3.9 Export & Publishing

| Feature | Spec |
|---|---|
| **Platform presets** | One-click presets: **YouTube** (16:9, 1080p/4K, H.264 high), **TikTok/Reels/Shorts** (9:16, 1080×1920, ≤60/90 s warning), **Square** (1:1 1080), **X/LinkedIn** (16:9 720/1080, size-cap aware), **GIF** (existing), **Audio only** (MP3/M4A), **ProRes/lossless** (archival). Presets bundle resolution, codec, bitrate/CRF, loudness target, and caption style defaults. |
| **Batch export** | Select multiple presets → render queue produces all renditions in one go (e.g., YouTube + Reels + GIF). Queue UI with per-job progress (extends existing progress channel), cancel, and notifications. |
| **Aspect conversion** | Per-preset reframe: manual crop window keyframable over time, or AI smart reframe (3.8). Fill modes: crop, pad with background/blur-fill. |
| **Quality control** | Quality slider (CRF), bitrate override, fps (30/60), resolution scaling. Hardware encoding (VideoToolbox/NVENC/QSV) with automatic software fallback, ~3–10× faster exports. |
| **Formats** | MP4/H.264 (exists), H.265, WebM/VP9, GIF (exists — upgrade to include overlays/effects via the unified filter pipeline), MP3/M4A, PNG frame grab. |
| **Filename & destination** | Templates (`{project}-{preset}-{date}`), per-preset output folder, "reveal in folder" (exists). |
| **Snippets** | Export current selection (in/out range) only — quick clip without touching the project. |

### 3.10 Library, Projects & App UX

| Feature | Spec |
|---|---|
| **Home** | Exists (grid, rename, delete, backup/import). Add search, sort, tags/folders, storage usage indicator, "open recordings folder". |
| **Tray/menu-bar presence** | Tray icon (assets already exist in `resources/`) with quick record, recent projects, pause/stop during recording. |
| **Settings** | Recording defaults (fps, devices, countdown), hotkeys, export defaults, AI tier configuration (model paths/API key), appearance, storage location. |
| **Crash safety** | Recording chunks flushed to disk during capture (not only on stop) so a crash loses ≤ a few seconds; recovery prompt on next launch. |
| **Auto-update** | electron-updater with signed releases; release channel setting. |
| **Onboarding & help** | Exists (walkthrough + help drawer); extend with shortcut overlay and contextual tips for new modules. |

---

## 4. Architecture Evolution

```
src/
  main/
    index.js            # lifecycle, IPC, protocol (exists)
    projects.js         # project CRUD (exists) → schemaVersion + migrations
    media.js            # NEW: import pipeline (probe, proxy, waveform peaks, thumbs)
    ffmpeg.js           # export (exists) → refactor into composable filter-graph builder
    export-queue.js     # NEW: render queue, presets, hardware-encoder detection
    events-capture.js   # NEW: native cursor/keystroke capture (uiohook-napi)
    ai/
      whisper.js        # bundled whisper.cpp runner + model manager (replaces transcribe.js PATH probing)
      copilot.js        # Tier C — Claude API client (BYO key), prompt → edit-ops
      analyze.js        # silence/filler/inactivity/highlight detection
  renderer/
    editor/
      timeline/         # multi-track timeline (tracks, clips, snapping, waveforms)
      compositor/       # NEW: canvas/WebGL preview renderer — single source of truth
                        # shared conceptually with the FFmpeg graph builder so
                        # preview == export
      transcript/       # NEW: text-based editing panel
      inspector/        # per-selection properties (evolves existing Inspector)
    document/           # NEW: edit document + command stack (undo/redo), autosave
```

**Key principles**

1. **Masters are sacred.** Never re-encode originals on save (today's VP8 proxy-as-master must become master + separate proxy). Seekability is the proxy's job.
2. **One effect graph, two renderers.** Every edit is a node in a documented effect model rendered by (a) the live compositor for preview and (b) the FFmpeg graph builder for export. Eliminates today's preview/export divergence and GIF feature loss.
3. **Edits are commands.** All mutations go through a command stack → undo/redo, autosave, and AI-proposed edits ("here are 14 cuts, apply?") for free.
4. **AI is layered and consent-gated.** On-device by default; anything network-bound is opt-in per project with a visible indicator.

---

## 5. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | Timeline scrubbing ≥ 30 fps UI on a 30-min 1080p recording (proxy-backed); export ≥ 2× realtime with hardware encoding for 1080p H.264. |
| Capture overhead | ≤ 15% CPU at 1080p30 on Apple Silicon / modern x86. |
| Reliability | No data loss on crash during recording (chunked flush); autosave on every edit (exists). |
| Privacy | Zero network calls in default configuration (model downloads and Tier C are explicit opt-ins). |
| Footprint | Base install ≤ 300 MB; AI models downloaded on demand with size shown. |
| Platforms | macOS 12+, Windows 10+; Linux best-effort. |
| Accessibility | Full keyboard operation of the editor; captions preview honors OS reduced-motion. |

---

## 6. Phased Roadmap

**Phase A — Foundation fixes (make current promise solid)**
Master/proxy split (stop re-encoding masters) · system audio capture · mic/camera device pickers · undo/redo + command stack · audio waveforms · export resolution/quality options + hardware encoding · bundle whisper.cpp.

**Phase B — Become an editor**
External video import + multi-track/multi-clip timeline · split/ripple-delete/snapping · transitions · audio fades/ducking/noise removal · draggable on-canvas overlays · arrows/shapes/blur-redaction · webcam-as-layer · backgrounds & padding.

**Phase C — Publish everywhere**
Platform export presets · batch render queue · keyframable/smart reframe for 9:16 / 1:1 · caption style presets incl. word-highlight · GIF via unified pipeline · loudness normalization · filename templates.

**Phase D — AI copilot**
Cursor/keystroke event capture → auto-zoom, click ripples, cursor smoothing · transcript panel + text-based editing · filler-word removal · titles/descriptions/chapters/highlights (Tier C) · edit-by-prompt · clip suggestions.

**Phase E — Polish & ecosystem**
Templates & global brand library · tray quick-record + global hotkeys (can land earlier; small) · auto-update · translation · speed ramps · studio-voice (stretch).

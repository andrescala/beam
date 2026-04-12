# Beam

Open-source screen recorder and video editor for macOS and Windows. Record your screen with webcam overlay, trim, edit, and export polished demo videos — all locally, no cloud, no account.

Built as a free alternative to Loom.

## Features

### Recording
- **Source selection** — pick a full screen, window, or display from a thumbnail grid
- **Microphone audio** — captured and merged into the recording
- **Webcam overlay** — circular or rectangular webcam bubble, position and size adjustable
- **Pause / resume** — pause mid-recording with accurate timer sync
- **3-2-1 countdown** — gives you time to switch to the target window

### Editor
- **Video preview** — scrub through the recording with synced webcam overlay
- **Timeline** — visual track display with a draggable red playhead
- **Trim** — drag start/end handles to cut the beginning and end of your recording
- **Cut sections** — mark and remove multiple regions from the middle of a recording
- **Speed control** — 0.25x to 4x with preset buttons and custom input
- **Spatial crop** — aspect ratio presets (16:9, 9:16, 4:3, 1:1) with live preview overlay
- **Text layers** — add titles and annotations with font size, color, position, and timing
- **Image layers** — import logos, arrows, or watermarks with position, size, and timing
- **Audio layers** — import background music or SFX with volume control and start time
- **Captions** — caption editor with timing, auto-generation, and SRT export
- **Webcam controls** — adjust position (corners), size (10–50%), and shape (circle/rectangle)
- **Non-destructive** — all edits are metadata in `project.json`; raw files are never modified
- **Re-export** — change settings and export again without re-recording

### Export
- **MP4 (H.264)** — high-quality export via FFmpeg with webcam compositing
- **GIF** — palette-optimized animated GIF export (640px, 15fps)
- **SRT subtitles** — export captions as standard SRT subtitle files
- **Circular webcam mask** — webcam is cropped to a square, scaled, and masked into a perfect circle
- **Progress indicator** — real-time export progress from FFmpeg

### Projects
- **Auto-saved** — every recording creates a project folder immediately
- **Project list** — home screen with thumbnails, names, dates, and durations
- **Rename** — double-click project name to rename inline
- **Reopen anytime** — full editor state restored from `project.json`
- **Backup/import** — export projects as `.beamproject` archives and import them
- **Delete** — removes the entire project folder with confirmation

## Architecture

```
src/
  main/           # Electron main process
    index.js      # App lifecycle, IPC handlers, display media handler, custom protocol
    projects.js   # Project CRUD (create, load, save, list, delete)
    ffmpeg.js     # FFmpeg wrapper (thumbnail, export with webcam overlay)
    preferences.js# App preferences via electron-store
  preload/
    index.js      # contextBridge — typed electronAPI for renderer
  renderer/
    src/
      views/      # Home, Recorder, Editor
      components/ # SourcePicker, Countdown, RecordingControls, WebcamPreview,
                  # VideoPreview, Timeline, Inspector, ExportModal, ProjectCard
      hooks/      # useRecorder — full recording state machine
  shared/
    channels.js   # IPC channel constants
```

### How it works

1. **Recording**: The renderer calls `getDisplayMedia()` — Electron's `setDisplayMediaRequestHandler` intercepts it and provides the source the user picked. Screen + mic are merged into one `MediaRecorder` stream (VP9 WebM). Webcam is recorded as a separate file.

2. **Saving**: On stop, WebM blobs are sent to the main process via IPC and written to `~/Beam/projects/{uuid}/`.

3. **Editing**: The editor loads `project.json` and displays the recording via a custom `project-file://` protocol. All edits (trim, webcam position) are stored as metadata.

4. **Export**: FFmpeg reads the raw WebM files and applies trim + webcam overlay in a single pass. The webcam is cropped to square, scaled to the correct pixel size, masked into a circle via `geq` alpha filter, and composited onto the screen recording.

## Project file structure

```
~/Beam/projects/{uuid}/
  project.json      # All project metadata and edit state
  screen.webm       # Raw screen recording
  webcam.webm       # Raw webcam recording (if enabled)
  thumb.jpg         # Auto-generated thumbnail
  assets/           # Imported layers (Phase 2)
  exports/          # Exported MP4 files
```

## Tech stack

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [Electron](https://www.electronjs.org/) | 31.x | MIT | Cross-platform desktop shell. Provides `desktopCapturer`, native dialogs, file system access, `setDisplayMediaRequestHandler` for screen capture. |
| [React](https://react.dev/) | 18.x | MIT | UI layer for all three views (Home, Recorder, Editor). Manages component state and rendering. |
| [React Router](https://reactrouter.com/) | 6.x | MIT | Client-side routing between Home (`/`), Recorder (`/recorder`), and Editor (`/editor/:id`) views. |
| [Vite](https://vitejs.dev/) | 5.x | MIT | Build tool and dev server. Fast HMR during development. |
| [electron-vite](https://electron-vite.org/) | 2.x | MIT | Vite integration for Electron. Builds main, preload, and renderer as separate targets. |
| [FFmpeg](https://ffmpeg.org/) (bundled via [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)) | 5.x | GPL-3.0 / LGPL | All video processing: thumbnail extraction, trim, webcam overlay compositing, circular mask, H.264 MP4 encoding. Bundled binary — user installs nothing. |
| [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) | 2.1.x | MIT | Node.js FFmpeg wrapper. Builds `filter_complex` chains programmatically. |
| [electron-store](https://github.com/sindresorhus/electron-store) | 8.2.0 | MIT | Persistent app preferences (window bounds, defaults). JSON file in `userData`. |
| [uuid](https://github.com/uuidjs/uuid) | 9.x | MIT | Generates unique project IDs. |
| [@electron-toolkit/utils](https://github.com/electron-vite/toolkit) | 4.x | MIT | Electron utilities — `is.dev` detection, window shortcut optimizer, app user model ID. |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 4.x | MIT | Vite plugin for React JSX transform and Fast Refresh. |
| [electron-builder](https://www.electron.build/) | 24.x | MIT | Packages the app into `.dmg` (macOS) and `.exe` (Windows). Handles code signing and `asarUnpack` for FFmpeg binary. |

### MediaRecorder API (built-in)
Screen and webcam capture use the browser-native `MediaRecorder` API (VP9 codec in WebM container). No additional recording dependencies.

### Canvas API (built-in)
Used for the timeline scrubber preview in the editor. Planned for click highlighter overlay during recording (Phase 2).

## Development

```bash
# Install dependencies
npm install

# Run in development (hot-reload)
npm run dev

# Build for production
npm run build

# Package as .dmg / .exe
npm run package
```

### Requirements
- Node.js 18+
- npm 9+
- macOS 12+ or Windows 10+ (for screen recording permissions)

### macOS permissions
On first launch, macOS will prompt for:
- **Screen Recording** — required for `desktopCapturer`
- **Microphone** — for audio capture
- **Camera** — for webcam overlay

If running via `npm run dev`, the permission is granted to **"Electron"** (not "Beam").

## Roadmap

### Phase 1 (current) — Record & Export
- [x] Screen capture with source selection
- [x] Microphone audio
- [x] Webcam overlay (circle/rectangle)
- [x] Pause/resume
- [x] 3-2-1 countdown
- [x] Trim start/end
- [x] MP4 export with webcam compositing
- [x] Project management (create, list, open, delete)
- [x] Preferences persistence

### Phase 2 (current) — Editor
- [x] Cut sections (mark and remove multiple regions)
- [x] Speed control (0.25x–4x with presets)
- [x] Spatial crop with aspect ratio presets (16:9, 9:16, 4:3, 1:1)
- [x] Audio layers (background music, SFX with volume control)
- [x] Image layers (logos, arrows, watermarks with position/timing)
- [x] Text layers (captions, titles with font size, color, position, timing)
- [x] Auto-transcription (caption placeholder generation + manual editing)
- [x] Caption editor with timing adjustment
- [x] SRT export
- [x] GIF export (palette-optimized, 640px, 15fps)
- [ ] Click highlighter (animated ripple on clicks — requires native module)
- [x] Project backup/import (.beamproject archive)

### Phase 3 — Pro
- [ ] Zoom & pan keyframes
- [ ] Keystroke display HUD
- [ ] Silence removal
- [ ] Background blur
- [ ] Intro/outro title cards
- [ ] Cursor spotlight

## License

MIT

## Authors

Created by **Claude Opus 4.6** (Anthropic) and **Andres Cala** ([andres.cala@ac-labs.com](mailto:andres.cala@ac-labs.com))

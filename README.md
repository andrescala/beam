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
- **Webcam controls** — adjust position (corners), size (10-50%), and shape (circle/rectangle)
- **Non-destructive** — all edits are metadata in `project.json`; raw files are never modified
- **Re-export** — change settings and export again without re-recording

### Pro Effects
- **Silence removal** — auto-detect and cut dead air using FFmpeg audio analysis
- **Intro/outro title cards** — branded opening/closing slides with custom text, colors, and duration
- **Vignette** — edge-darkening effect that draws attention to the center of the screen
- **Zoom & pan keyframes** — animated zoom into specific areas of the recording with timing control
- **Video blur** — adjustable blur effect applied to the entire video

### Asset Library
- **Media browser** — grid view of all imported images and audio with thumbnails and previews
- **Import** — add images (PNG, JPG, SVG, GIF, WebP) and audio (MP3, WAV, AAC, M4A, OGG)
- **One-click layers** — add any asset as an overlay layer at the current playhead position
- **In-use tracking** — badges show which assets are referenced by active layers
- **Cleanup** — delete unused assets to save disk space (with protection against deleting in-use files)

### Export
- **MP4 (H.264)** — high-quality export via FFmpeg with all effects and overlays
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

### Help & Onboarding
- **Welcome walkthrough** — 5-step guided tour on first launch (Record, Edit, Enhance, Export)
- **Help drawer** — accessible via `?` button from Home and Editor, with categorized FAQ-style tutorials covering every feature
- **Contextual guidance** — empty states with helpful descriptions and action buttons

## Architecture

```
src/
  main/           # Electron main process
    index.js      # App lifecycle, IPC handlers, display media handler, custom protocol
    projects.js   # Project CRUD (create, load, save, list, delete, asset management)
    ffmpeg.js     # FFmpeg wrapper (thumbnail, MP4/GIF export, silence detection)
    preferences.js# App preferences via electron-store
  preload/
    index.js      # contextBridge — typed electronAPI for renderer
  renderer/
    src/
      views/      # Home, Recorder, Editor
      components/ # SourcePicker, Countdown, RecordingControls, WebcamPreview,
                  # VideoPreview, Timeline, Inspector, ExportModal, ProjectCard,
                  # LayerPanel, CaptionEditor, AssetLibrary, HelpDrawer, WelcomeModal,
                  # Toast
      hooks/      # useRecorder — full recording state machine
  shared/
    channels.js   # IPC channel constants
```

### How it works

1. **Recording**: The renderer calls `getDisplayMedia()` — Electron's `setDisplayMediaRequestHandler` intercepts it and provides the source the user picked. Screen + mic are merged into one `MediaRecorder` stream (VP9 WebM). Webcam is recorded as a separate file.

2. **Saving**: On stop, WebM blobs are sent to the main process via IPC and written to `~/Beam/projects/{uuid}/`.

3. **Editing**: The editor loads `project.json` and displays the recording via a custom `project-file://` protocol (with path traversal protection). All edits (trim, cuts, speed, crop, layers, effects) are stored as metadata.

4. **Export**: FFmpeg reads the raw WebM files and applies the full pipeline in a single pass: trim/cut → speed → crop → blur → vignette → zoom → webcam overlay → image overlays → text/captions → audio mix → intro/outro cards.

## Project file structure

```
~/Beam/projects/{uuid}/
  project.json      # All project metadata and edit state
  screen.webm       # Raw screen recording
  webcam.webm       # Raw webcam recording (if enabled)
  thumb.jpg         # Auto-generated thumbnail
  assets/           # Imported images and audio files
  exports/          # Exported MP4/GIF files
```

## Tech stack

| Library | Version | License | Purpose |
|---------|---------|---------|---------|
| [Electron](https://www.electronjs.org/) | 31.x | MIT | Cross-platform desktop shell. Provides `desktopCapturer`, native dialogs, file system access, `setDisplayMediaRequestHandler` for screen capture. |
| [React](https://react.dev/) | 18.x | MIT | UI layer for all three views (Home, Recorder, Editor). Manages component state and rendering. |
| [React Router](https://reactrouter.com/) | 6.x | MIT | Client-side routing between Home (`/`), Recorder (`/recorder`), and Editor (`/editor/:id`) views. |
| [Vite](https://vitejs.dev/) | 5.x | MIT | Build tool and dev server. Fast HMR during development. |
| [electron-vite](https://electron-vite.org/) | 2.x | MIT | Vite integration for Electron. Builds main, preload, and renderer as separate targets. |
| [FFmpeg](https://ffmpeg.org/) (bundled via [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)) | 5.x | GPL-3.0 / LGPL | All video processing: thumbnail extraction, trim, webcam overlay compositing, circular mask, H.264 MP4 encoding, silence detection, GIF export. Bundled binary — user installs nothing. |
| [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) | 2.1.x | MIT | Node.js FFmpeg wrapper. Builds `filter_complex` chains programmatically. |
| [electron-store](https://github.com/sindresorhus/electron-store) | 8.2.0 | MIT | Persistent app preferences (window bounds, defaults). JSON file in `userData`. |
| [uuid](https://github.com/uuidjs/uuid) | 9.x | MIT | Generates unique project IDs. |
| [@electron-toolkit/utils](https://github.com/electron-vite/toolkit) | 4.x | MIT | Electron utilities — `is.dev` detection, window shortcut optimizer, app user model ID. |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 4.x | MIT | Vite plugin for React JSX transform and Fast Refresh. |
| [electron-builder](https://www.electron.build/) | 24.x | MIT | Packages the app into `.dmg` (macOS) and `.exe` (Windows). Handles code signing and `asarUnpack` for FFmpeg binary. |

### MediaRecorder API (built-in)
Screen and webcam capture use the browser-native `MediaRecorder` API (VP9 codec in WebM container). No additional recording dependencies.

## Development

```bash
# Install dependencies
npm install

# Run in development (hot-reload)
npm run dev

# Build for production
npm run build
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

## Building Installers

### macOS (.dmg)

```bash
npm run build
npm run package -- --mac
```

This generates a `.dmg` installer in the `dist/` folder. The app uses `resources/icon.icns` as the dock icon and includes macOS entitlements for screen recording, microphone, and camera access.

**Code signing & notarization** (optional, for distribution):
To distribute outside the Mac App Store, you need an Apple Developer certificate. Set these environment variables before packaging:

```bash
export CSC_LINK="path/to/your/certificate.p12"
export CSC_KEY_PASSWORD="your-certificate-password"
export APPLE_ID="your@apple.id"
export APPLE_APP_SPECIFIC_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="your-team-id"

npm run package -- --mac
```

Without code signing, the app will still build and run locally — users just need to right-click > Open on first launch to bypass Gatekeeper.

### Windows (.exe)

```bash
npm run build
npm run package -- --win
```

This generates an NSIS installer (`.exe`) in the `dist/` folder. The app uses `resources/icon.ico` as the taskbar and shortcut icon.

**Building Windows from macOS**: You need [Wine](https://www.winehq.org/) installed (`brew install --cask wine-stable`). Alternatively, use a CI pipeline with a Windows runner.

**Code signing** (optional): Set the `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables with a Windows code signing certificate (`.pfx` file) before packaging.

### Linux (.AppImage / .deb)

```bash
npm run build
npm run package -- --linux
```

Generates `.AppImage` and `.deb` files in `dist/`. Uses `resources/icon.png`.

### All platforms at once

```bash
npm run build
npm run package -- --mac --win --linux
```

> **Note**: Cross-compilation has limitations. Building Windows from macOS requires Wine, and building macOS from Windows/Linux is not supported. For reliable multi-platform builds, use CI (e.g., GitHub Actions with `macos-latest` and `windows-latest` runners).

## Testing

The project includes a comprehensive Playwright E2E test suite that launches the real Electron app.

```bash
# Run all 53 tests
npm test

# Run specific test suites
npm run test:home         # Home screen tests
npm run test:editor       # Editor view tests
npm run test:ipc          # IPC handler tests
npm run test:screenshots  # Capture screenshots of every screen
```

Screenshots from `test:screenshots` are saved to `e2e/screenshots/` for visual review.

## Roadmap

### Phase 1 — Record & Export
- [x] Screen capture with source selection
- [x] Microphone audio
- [x] Webcam overlay (circle/rectangle)
- [x] Pause/resume
- [x] 3-2-1 countdown
- [x] Trim start/end
- [x] MP4 export with webcam compositing
- [x] Project management (create, list, open, delete)
- [x] Preferences persistence

### Phase 2 — Editor
- [x] Cut sections (mark and remove multiple regions)
- [x] Speed control (0.25x-4x with presets)
- [x] Spatial crop with aspect ratio presets (16:9, 9:16, 4:3, 1:1)
- [x] Audio layers (background music, SFX with volume control)
- [x] Image layers (logos, arrows, watermarks with position/timing)
- [x] Text layers (captions, titles with font size, color, position, timing)
- [x] Auto-transcription (caption placeholder generation + manual editing)
- [x] Caption editor with timing adjustment
- [x] SRT export
- [x] GIF export (palette-optimized, 640px, 15fps)
- [x] Project backup/import (.beamproject archive)
- [ ] Click highlighter (animated ripple on clicks — requires native module)

### Phase 3 — Pro
- [x] Silence removal (auto-detect dead air and add as cuts)
- [x] Intro/outro title cards (branded opening/closing slides with text, color, timing)
- [x] Vignette effect (edge-darkening with adjustable intensity)
- [x] Zoom & pan keyframes (animated zoom to specific areas with timing)
- [x] Video blur (adjustable blur strength)
- [x] Asset library (media browser with import, preview, one-click layers)
- [x] Help system (welcome walkthrough + help drawer with tutorials)
- [ ] Keystroke display HUD (requires native module — deferred)

## License

MIT

## Authors

Created by **Claude Opus 4.6** (Anthropic) and **Andres Cala** ([andres.cala@ac-labs.com](mailto:andres.cala@ac-labs.com))

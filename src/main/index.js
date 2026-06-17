import { app, shell, BrowserWindow, ipcMain, desktopCapturer, systemPreferences, dialog, session, protocol, Tray, Menu, globalShortcut, nativeImage } from 'electron'
import { join } from 'path'
import { readFile, readdir, stat } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  ensureProjectsDir,
  getProjectsDir,
  getProjectPath,
  createProject,
  loadProject,
  saveProject,
  listProjects,
  deleteProject,
  saveRawRecording,
  importAsset,
  listAssets,
  deleteAsset,
  exportSrt,
  exportVtt,
  importProjectZip,
  importVideoAsProject
} from './projects.js'
import { generateThumbnail, exportMp4, exportGif, extractAudio, detectSilence } from './ffmpeg.js'
import { transcribeAudio, isWhisperAvailable } from './transcribe.js'
import { getWhisperStatus, downloadModel, ensureWhisperReady, onStatusChange } from './whisper-manager.js'
import { getPreferences, setPreferences } from './preferences.js'
import { appendChunk, finalizeCapture, findRecoverableCaptures } from './capture-store.js'
import {
  getClaudeApiKey,
  setClaudeApiKey,
  hasClaudeApiKey,
  generateMetadata,
  generateChapters,
  suggestHighlights,
  editByPrompt
} from './ai.js'

// Force Chromium to use software H.264 decoding. macOS VideoToolbox
// occasionally throws -12909 (VTDecompressionOutputCallback) on otherwise
// valid H.264 streams produced by libx264 — especially after seeks. Software
// decode is rock-solid and the performance hit is negligible for the
// screen-recording playback we do here.
app.commandLine.appendSwitch('disable-accelerated-video-decode')
app.commandLine.appendSwitch('disable-features', 'PlatformHEVCDecoderSupport')

let mainWindow = null
let tray = null
// The renderer tells us which source to use, then calls getDisplayMedia()
let pendingSourceId = null

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray() {
  try {
    const iconPath = join(__dirname, '../../resources/tray-icon-32.png')
    let image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) return
    if (process.platform === 'darwin') {
      image = image.resize({ width: 18, height: 18 })
    }
    tray = new Tray(image)
    tray.setToolTip('Beam')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Beam', click: () => showMainWindow() },
      {
        label: 'New Recording',
        click: () => {
          showMainWindow()
          mainWindow?.webContents.send('tray-new-recording')
        }
      },
      { type: 'separator' },
      { label: 'Quit Beam', click: () => app.quit() }
    ]))
    tray.on('click', () => showMainWindow())
  } catch (err) {
    console.warn('Tray setup failed:', err.message)
  }
}

function registerGlobalShortcuts() {
  try {
    globalShortcut.register('CommandOrControl+Shift+R', () => {
      showMainWindow()
      mainWindow?.webContents.send('shortcut-record-toggle')
    })
  } catch (err) {
    console.warn('Global shortcut registration failed:', err.message)
  }
}

// ── Auto-update (electron-updater) ──
// Loaded lazily so a missing/broken module never crashes startup.
let autoUpdater = null
let autoUpdaterWired = false

async function getAutoUpdater() {
  if (autoUpdater) return autoUpdater
  try {
    const mod = await import('electron-updater')
    autoUpdater = mod.autoUpdater || mod.default?.autoUpdater || mod.default
    return autoUpdater
  } catch (err) {
    console.warn('electron-updater unavailable:', err.message)
    return null
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

async function setupAutoUpdater() {
  // Never run in dev or when not packaged — there is nothing to update against.
  if (is.dev || !app.isPackaged) return
  if (autoUpdaterWired) return
  try {
    const updater = await getAutoUpdater()
    if (!updater) return

    try {
      const prefs = getPreferences()
      if (prefs.updateChannel) updater.channel = prefs.updateChannel
    } catch {
      // Pref access is best-effort
    }

    updater.autoDownload = true
    updater.on('update-available', (info) => {
      sendToRenderer('update-available', { version: info?.version })
    })
    updater.on('update-downloaded', (info) => {
      sendToRenderer('update-downloaded', { version: info?.version })
    })
    updater.on('error', (err) => {
      console.warn('autoUpdater error:', err?.message || err)
    })

    autoUpdaterWired = true
  } catch (err) {
    console.warn('Auto-updater setup failed:', err.message)
  }
}

async function triggerUpdateCheck() {
  if (is.dev || !app.isPackaged) {
    return { ok: false, reason: 'dev-or-unpackaged' }
  }
  try {
    await setupAutoUpdater()
    const updater = await getAutoUpdater()
    if (!updater) return { ok: false, reason: 'unavailable' }
    await updater.checkForUpdates()
    return { ok: true }
  } catch (err) {
    console.warn('checkForUpdates failed:', err.message)
    return { ok: false, reason: err.message }
  }
}

function createWindow() {
  const prefs = getPreferences()
  const bounds = prefs.windowBounds || {}

  mainWindow = new BrowserWindow({
    width: bounds.width || 1200,
    height: bounds.height || 800,
    x: bounds.x,
    y: bounds.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: join(__dirname, '../../resources/icon.png'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Save window bounds on resize/move
  mainWindow.on('close', () => {
    const b = mainWindow.getBounds()
    setPreferences({ windowBounds: b })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// ── IPC Handlers ──

function registerIpcHandlers() {
  // Set which source the renderer wants to capture (called before getDisplayMedia)
  ipcMain.handle('set-capture-source', async (_event, sourceId) => {
    pendingSourceId = sourceId
    return true
  })

  // Get the absolute path to a project folder (renderer can't access process.env.HOME)
  ipcMain.handle('get-project-path', async (_event, projectId) => {
    return getProjectPath(projectId)
  })

  // Sources
  ipcMain.handle('get-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 }
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      display_id: s.display_id
    }))
  })

  // Permissions
  ipcMain.handle('request-permissions', async () => {
    let mic = 'unknown'
    let camera = 'unknown'

    if (process.platform === 'darwin') {
      mic = await systemPreferences.askForMediaAccess('microphone')
        ? 'granted' : 'denied'
      camera = await systemPreferences.askForMediaAccess('camera')
        ? 'granted' : 'denied'
    }

    let screen = systemPreferences.getMediaAccessStatus('screen')
    if (screen !== 'granted') {
      try {
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
        screen = systemPreferences.getMediaAccessStatus('screen')
      } catch {
        // Expected to fail if permission not yet granted
      }
    }

    const appName = is.dev ? 'Electron' : 'Beam'
    return { screen, mic, camera, appName }
  })

  // Projects
  ipcMain.handle('create-project', async (_event, name) => {
    return await createProject(name)
  })

  ipcMain.handle('save-project', async (_event, id, data) => {
    return await saveProject(id, data)
  })

  ipcMain.handle('load-project', async (_event, id) => {
    return await loadProject(id)
  })

  ipcMain.handle('list-projects', async () => {
    return await listProjects()
  })

  ipcMain.handle('delete-project', async (_event, id) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      title: 'Delete Project',
      message: 'Are you sure you want to delete this project?',
      detail: 'This action cannot be undone. All recordings and exports will be removed.'
    })
    if (result.response === 1) {
      await deleteProject(id)
      return true
    }
    return false
  })

  // Recording
  ipcMain.handle('save-raw-recording', async (_event, projectId, type, buffer) => {
    return await saveRawRecording(projectId, type, buffer)
  })

  // Crash-safe streaming (R8): append each MediaRecorder chunk to disk as it
  // arrives so a crash mid-recording can't lose everything.
  ipcMain.handle('capture-append-chunk', async (_event, projectId, type, arrayBuffer) => {
    return await appendChunk(projectId, type, arrayBuffer)
  })

  ipcMain.handle('capture-finalize', async (_event, projectId, type) => {
    return await finalizeCapture(projectId, type)
  })

  // Detect orphaned in-progress captures left by a crash (recovery).
  ipcMain.handle('list-recoverable-captures', async () => {
    return await findRecoverableCaptures()
  })

  // Asset import (images, audio files)
  ipcMain.handle('import-asset', async (_event, projectId, type) => {
    const filters = type === 'audio'
      ? [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg'] }]
      : [{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'] }]

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const asset = await importAsset(projectId, result.filePaths[0])
    return asset
  })

  // Asset library
  ipcMain.handle('list-assets', async (_event, projectId) => {
    try {
      return await listAssets(projectId)
    } catch (err) {
      return []
    }
  })

  ipcMain.handle('delete-asset', async (_event, projectId, filename) => {
    try {
      await deleteAsset(projectId, filename)
      return true
    } catch (err) {
      return false
    }
  })

  // Processing
  ipcMain.handle('process-recording', async (_event, projectId, format, options) => {
    try {
      const project = await loadProject(projectId)
      const projectPath = getProjectPath(projectId)

      const progressCallback = (percent) => {
        if (mainWindow) {
          mainWindow.webContents.send('export-progress', percent)
        }
      }

      // All visual + audio-only formats run through the unified export
      // pipeline (exportMp4 → runExport), selected via the `format` field on
      // the options object. exportGif is kept as a thin alias for GIF.
      // Supported: mp4 | hevc | webm | gif | mp3 | m4a | png
      const opts = { ...(options || {}), format }
      let outputPath
      if (format === 'gif') {
        outputPath = await exportGif(projectPath, project, progressCallback, opts)
      } else {
        outputPath = await exportMp4(projectPath, project, progressCallback, opts)
      }

      // Update project with last export path
      project.exportSettings.lastExportPath = outputPath
      await saveProject(projectId, project)

      return { path: outputPath }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('generate-thumbnail', async (_event, projectId) => {
    try {
      const project = await loadProject(projectId)
      const projectPath = getProjectPath(projectId)
      const screenPath = join(projectPath, project.recordings.screen)

      await generateThumbnail(screenPath, projectPath)

      project.thumbnail = join(projectPath, 'thumb.jpg')
      await saveProject(projectId, project)

      return { path: project.thumbnail }
    } catch (err) {
      return { error: err.message }
    }
  })

  // SRT export
  ipcMain.handle('export-srt', async (_event, projectId) => {
    try {
      const outputPath = await exportSrt(projectId)
      return { path: outputPath }
    } catch (err) {
      return { error: err.message }
    }
  })

  // WebVTT export
  ipcMain.handle('export-vtt', async (_event, projectId) => {
    try {
      const outputPath = await exportVtt(projectId)
      return { path: outputPath }
    } catch (err) {
      return { error: err.message }
    }
  })

  // AI copilot (BYO Claude key). All handlers are consent-gated: they only run
  // when the renderer explicitly calls them, and they no-op (NO_API_KEY) when
  // no key is configured. Transcript text is sent to Anthropic for the request.
  ipcMain.handle('ai-has-key', async () => {
    return { hasKey: hasClaudeApiKey() }
  })

  ipcMain.handle('ai-get-key', async () => {
    // Return only whether a key exists plus a masked hint — never the raw key.
    const key = getClaudeApiKey()
    return { hasKey: !!key, hint: key ? `…${key.slice(-4)}` : '' }
  })

  ipcMain.handle('ai-set-key', async (_event, key) => {
    try {
      return setClaudeApiKey(key)
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('ai-generate-metadata', async (_event, args) => {
    return await generateMetadata(args || {})
  })

  ipcMain.handle('ai-generate-chapters', async (_event, args) => {
    return await generateChapters(args || {})
  })

  ipcMain.handle('ai-suggest-highlights', async (_event, args) => {
    return await suggestHighlights(args || {})
  })

  ipcMain.handle('ai-edit-by-prompt', async (_event, args) => {
    return await editByPrompt(args || {})
  })

  // Project backup/import
  ipcMain.handle('export-project-zip', async (_event, projectId) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `project.beamproject`,
        filters: [{ name: 'Beam Project', extensions: ['beamproject'] }]
      })
      if (result.canceled) return null

      const project = await loadProject(projectId)
      const projectPath = getProjectPath(projectId)

      // Build archive
      const { readdir: rd, readFile: rf } = await import('fs/promises')
      const files = {}
      await collectFilesForArchive(projectPath, projectPath, files, rf, rd)

      const archive = { version: 1, files: {} }
      for (const [relativePath, data] of Object.entries(files)) {
        archive.files[relativePath] = data.toString('base64')
      }

      const { writeFile: wf } = await import('fs/promises')
      await wf(result.filePath, JSON.stringify(archive))

      return { path: result.filePath }
    } catch (err) {
      return { error: err.message }
    }
  })

  ipcMain.handle('import-project-zip', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Beam Project', extensions: ['beamproject'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const project = await importProjectZip(result.filePaths[0])
      return { project }
    } catch (err) {
      return { error: err.message }
    }
  })

  // Detect silence in recording
  ipcMain.handle('detect-silence', async (_event, projectId, threshold, minDuration) => {
    try {
      const project = await loadProject(projectId)
      const projectPath = getProjectPath(projectId)
      // Prefer the isolated mic track (cleaner detection); fall back to screen
      // for older recordings that have mic baked in.
      const audioFile = project.recordings.mic || project.recordings.screen
      const audioPath = join(projectPath, audioFile)

      const silences = await detectSilence(audioPath, threshold || -30, minDuration || 0.5)
      return { silences }
    } catch (err) {
      return { error: err.message }
    }
  })

  // Probe whether Whisper is available locally
  ipcMain.handle('whisper-available', async () => {
    return { available: isWhisperAvailable() }
  })

  // Whisper engine/model status for the UI chip
  ipcMain.handle('whisper-status', async () => {
    return getWhisperStatus()
  })

  // Manually trigger (or retry) the model download
  ipcMain.handle('whisper-download', async () => {
    return await downloadModel()
  })

  // Transcribe the recording into caption segments. If the whisper.cpp
  // model isn't downloaded yet, the download starts automatically and the
  // chip shows its progress.
  ipcMain.handle('transcribe-recording', async (_event, projectId, opts) => {
    try {
      const project = await loadProject(projectId)
      const projectPath = getProjectPath(projectId)
      // Prefer the clean mic track; fall back to screen audio for older projects.
      const audioFile = project.recordings.mic || project.recordings.screen
      if (!audioFile) {
        return { error: 'No audio in this recording.' }
      }

      const ready = await ensureWhisperReady()
      if (!ready.ok) {
        if (ready.status.status === 'not-installed') {
          return {
            error: 'Whisper is not installed. Run `brew install whisper-cpp` (or `pip install openai-whisper`) to enable captions — Beam downloads the model for you.',
            code: 'WHISPER_NOT_FOUND'
          }
        }
        return {
          error: `Whisper model download failed: ${ready.status.error || 'unknown error'}. Click the Whisper chip to retry.`,
          code: 'WHISPER_MODEL_MISSING'
        }
      }

      const audioPath = join(projectPath, audioFile)
      const segments = await transcribeAudio(audioPath, { ...(opts || {}), modelPath: ready.modelPath })
      return { segments }
    } catch (err) {
      if (err.code === 'WHISPER_NOT_FOUND') {
        return {
          error: 'Whisper is not installed. Run `brew install whisper-cpp` (or `pip install openai-whisper`) to enable real captions.',
          code: 'WHISPER_NOT_FOUND'
        }
      }
      return { error: err.message }
    }
  })

  // Import an external video file as a new project
  ipcMain.handle('import-video', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Video Files', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const project = await importVideoAsProject(result.filePaths[0], (percent) => {
        if (mainWindow) {
          mainWindow.webContents.send('import-progress', percent)
        }
      })
      return { project }
    } catch (err) {
      return { error: err.message }
    }
  })

  // Extract audio for transcription
  ipcMain.handle('extract-audio', async (_event, projectId) => {
    try {
      const project = await loadProject(projectId)
      const projectPath = getProjectPath(projectId)
      const screenPath = join(projectPath, project.recordings.screen)
      const outputPath = join(projectPath, 'audio.wav')

      await extractAudio(screenPath, outputPath)
      return { path: outputPath }
    } catch (err) {
      return { error: err.message }
    }
  })

  // Dialogs
  ipcMain.handle('save-dialog', async (_event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: options?.defaultPath,
      filters: options?.filters || [{ name: 'MP4 Video', extensions: ['mp4'] }]
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('show-in-folder', async (_event, filePath) => {
    shell.showItemInFolder(filePath)
  })

  // Preferences
  ipcMain.handle('get-preferences', async () => {
    return getPreferences()
  })

  ipcMain.handle('set-preferences', async (_event, patch) => {
    return setPreferences(patch)
  })

  // Storage — the absolute path where projects are stored
  ipcMain.handle('get-projects-dir', async () => {
    return getProjectsDir()
  })

  // Storage — total bytes used by all project folders
  ipcMain.handle('get-storage-usage', async () => {
    try {
      const dir = getProjectsDir()
      const entries = await readdir(dir, { withFileTypes: true })
      let total = 0
      let count = 0
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        total += await dirSize(join(dir, entry.name))
        count += 1
      }
      return { bytes: total, projectCount: count }
    } catch (err) {
      return { bytes: 0, projectCount: 0, error: err.message }
    }
  })

  // Auto-update — manual check trigger (no-op in dev / unpackaged)
  ipcMain.handle('check-for-updates', async () => {
    return await triggerUpdateCheck()
  })
}

// Recursively sum the size of every file under a directory.
async function dirSize(dirPath) {
  let total = 0
  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(dirPath, entry.name)
    try {
      if (entry.isDirectory()) {
        total += await dirSize(full)
      } else if (entry.isFile()) {
        const s = await stat(full)
        total += s.size
      }
    } catch {
      // Skip unreadable entries
    }
  }
  return total
}

async function collectFilesForArchive(basePath, currentPath, files, rf, rd) {
  const entries = await rd(currentPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(currentPath, entry.name)
    const relativePath = fullPath.slice(basePath.length + 1)
    if (entry.isDirectory()) {
      if (entry.name === 'exports') continue // Skip exports to keep archive smaller
      await collectFilesForArchive(basePath, fullPath, files, rf, rd)
    } else {
      files[relativePath] = await rf(fullPath)
    }
  }
}

// ── App lifecycle ──

// Register custom protocol for serving project files to the renderer.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'project-file',
    privileges: { stream: true, supportFetchAPI: true, bypassCSP: true }
  }
])

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.beamrecorder.app')

    // Handle project-file:// protocol
    protocol.handle('project-file', async (request) => {
      const url = new URL(request.url)
      const projectId = url.hostname
      const filename = decodeURIComponent(url.pathname.slice(1))
      const projectDir = getProjectPath(projectId)
      const filePath = join(projectDir, filename)

      // Prevent path traversal — resolved path must stay inside project directory
      const { resolve } = await import('path')
      const resolved = resolve(filePath)
      if (!resolved.startsWith(resolve(projectDir))) {
        return new Response('Forbidden', { status: 403 })
      }

      try {
        const data = await readFile(filePath)
        const ext = filename.split('.').pop().toLowerCase()
        const mimeTypes = {
          webm: 'video/webm',
          mp4: 'video/mp4',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          gif: 'image/gif',
          svg: 'image/svg+xml',
          webp: 'image/webp',
          mp3: 'audio/mpeg',
          wav: 'audio/wav',
          aac: 'audio/aac',
          m4a: 'audio/mp4',
          ogg: 'audio/ogg'
        }
        return new Response(data, {
          headers: { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' }
        })
      } catch (err) {
        console.error(`project-file protocol error: ${filePath}`, err.message)
        return new Response('Not found', { status: 404 })
      }
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    await ensureProjectsDir()
    registerIpcHandlers()

    // Crash recovery (R8): scan for captures interrupted by a crash and push
    // the list to the renderer once it's ready. The renderer can also pull it
    // on demand via the `list-recoverable-captures` IPC.
    findRecoverableCaptures()
      .then((recoverable) => {
        if (recoverable.length === 0) return
        console.log(`Found ${recoverable.length} recoverable recording(s) from a previous session`)
        const send = () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('recoverable-captures', recoverable)
          }
        }
        if (mainWindow && mainWindow.webContents.isLoading()) {
          mainWindow.webContents.once('did-finish-load', send)
        } else {
          send()
        }
      })
      .catch((err) => console.warn('Recovery scan failed:', err.message))

    // Forward whisper model-download status changes to the renderer chip
    onStatusChange((status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('whisper-status-changed', status)
      }
    })

    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['window', 'screen']
        })
        const selected = sources.find((s) => s.id === pendingSourceId)
        if (selected) {
          callback({ video: selected, audio: 'loopback' })
        } else if (sources.length > 0) {
          callback({ video: sources[0], audio: 'loopback' })
        } else {
          callback({})
        }
      } catch (err) {
        console.error('Display media handler error:', err)
        callback({})
      }
    })

    createWindow()
    createTray()
    registerGlobalShortcuts()

    // Check for updates once on launch (guarded: no-ops in dev / unpackaged).
    triggerUpdateCheck().catch((err) => {
      console.warn('Initial update check failed:', err.message)
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

import { app, shell, BrowserWindow, ipcMain, desktopCapturer, systemPreferences, dialog, session, protocol } from 'electron'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  ensureProjectsDir,
  getProjectPath,
  createProject,
  loadProject,
  saveProject,
  listProjects,
  deleteProject,
  saveRawRecording
} from './projects.js'
import { generateThumbnail, exportMp4, exportGif } from './ffmpeg.js'
import { getPreferences, setPreferences } from './preferences.js'

let mainWindow = null
// The renderer tells us which source to use, then calls getDisplayMedia()
let pendingSourceId = null

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

    // For screen recording on macOS: we must actually attempt desktopCapturer
    // to make the app appear in System Settings > Screen Recording list.
    // Just checking getMediaAccessStatus won't trigger it.
    let screen = systemPreferences.getMediaAccessStatus('screen')
    if (screen !== 'granted') {
      try {
        // This attempt is what makes macOS add the app to the Screen Recording list
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
        // Re-check after the attempt
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

  // Processing
  ipcMain.handle('process-recording', async (_event, projectId, format) => {
    try {
      const project = await loadProject(projectId)
      const projectPath = getProjectPath(projectId)

      const progressCallback = (percent) => {
        if (mainWindow) {
          mainWindow.webContents.send('export-progress', percent)
        }
      }

      let outputPath
      if (format === 'gif') {
        outputPath = await exportGif(projectPath, project, progressCallback)
      } else {
        outputPath = await exportMp4(projectPath, project, progressCallback)
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
}

// ── App lifecycle ──

// Register custom protocol for serving project files to the renderer.
// MUST be called before app 'ready' event. Usage: project-file://{projectId}/{filename}
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
      // URL format: project-file://projectId/filename
      const url = new URL(request.url)
      const projectId = url.hostname
      const filename = decodeURIComponent(url.pathname.slice(1)) // remove leading /
      const filePath = join(getProjectPath(projectId), filename)

      try {
        const data = await readFile(filePath)
        const ext = filename.split('.').pop().toLowerCase()
        const mimeTypes = {
          webm: 'video/webm',
          mp4: 'video/mp4',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          mp3: 'audio/mpeg',
          wav: 'audio/wav'
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

    // Modern screen capture: renderer calls getDisplayMedia(), this handler
    // intercepts it and provides the source the user picked in our UI.
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['window', 'screen']
        })
        // Find the source the user selected via our picker
        const selected = sources.find((s) => s.id === pendingSourceId)
        if (selected) {
          callback({ video: selected, audio: 'loopback' })
        } else if (sources.length > 0) {
          // Fallback: use the first screen
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

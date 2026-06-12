import { app } from 'electron'
import { join, basename } from 'path'
import { readdir, readFile, writeFile, mkdir, rm, copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import { v4 as uuid } from 'uuid'

const PROJECTS_DIR = join(app.getPath('home'), 'Beam', 'projects')

export async function ensureProjectsDir() {
  if (!existsSync(PROJECTS_DIR)) {
    await mkdir(PROJECTS_DIR, { recursive: true })
  }
}

export function getProjectsDir() {
  return PROJECTS_DIR
}

export function getProjectPath(id) {
  return join(PROJECTS_DIR, id)
}

export async function createProject(name) {
  const id = uuid()
  const projectPath = getProjectPath(id)

  await mkdir(projectPath, { recursive: true })
  await mkdir(join(projectPath, 'assets'), { recursive: true })
  await mkdir(join(projectPath, 'exports'), { recursive: true })

  const project = {
    id,
    name: name || 'Untitled Recording',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    duration: 0,
    thumbnail: null,
    recordings: {
      screen: null,
      screenProxy: null,
      webcam: null,
      webcamProxy: null,
      mic: null,
      system: null
    },
    edit: {
      trimStart: 0,
      trimEnd: null,
      webcamPosition: 'bottom-right',
      webcamSize: 0.2,
      webcamShape: 'circle',
      speed: 1.0,
      micVolume: 1.0,
      micMuted: false,
      systemVolume: 1.0,
      systemMuted: false,
      audioOffsetMs: 0,
      cuts: [],
      crop: {
        enabled: false,
        aspectRatio: 'original',
        x: 0,
        y: 0,
        width: 1,
        height: 1
      },
      textLayers: [],
      imageLayers: [],
      audioLayers: [],
      captions: [],
      introCard: null,
      outroCard: null
    },
    exportSettings: {
      format: 'mp4',
      quality: 'balanced'
    }
  }

  await writeFile(join(projectPath, 'project.json'), JSON.stringify(project, null, 2))
  return project
}

export async function loadProject(id) {
  const projectPath = getProjectPath(id)
  const raw = await readFile(join(projectPath, 'project.json'), 'utf-8')
  const project = JSON.parse(raw)

  // Migrate older projects: ensure new fields exist
  if (!project.edit) {
    project.edit = {
      trimStart: 0, trimEnd: null, webcamPosition: 'bottom-right',
      webcamSize: 0.2, webcamShape: 'circle', speed: 1.0, cuts: [],
      crop: { enabled: false, aspectRatio: 'original', x: 0, y: 0, width: 1, height: 1 },
      textLayers: [], imageLayers: [], audioLayers: [], captions: [],
      introCard: null, outroCard: null, backgroundBlur: null,
      cursorSpotlight: null, zoomKeyframes: []
    }
  }
  if (!project.edit.crop) {
    project.edit.crop = { enabled: false, aspectRatio: 'original', x: 0, y: 0, width: 1, height: 1 }
  }
  if (!project.edit.textLayers) project.edit.textLayers = []
  if (!project.edit.imageLayers) project.edit.imageLayers = []
  if (!project.edit.audioLayers) project.edit.audioLayers = []
  if (!project.edit.captions) project.edit.captions = []
  if (!project.edit.cuts) project.edit.cuts = []
  if (project.edit.speed === undefined) project.edit.speed = 1.0
  if (project.edit.introCard === undefined) project.edit.introCard = null
  if (project.edit.outroCard === undefined) project.edit.outroCard = null
  if (project.edit.backgroundBlur === undefined) project.edit.backgroundBlur = null
  if (project.edit.cursorSpotlight === undefined) project.edit.cursorSpotlight = null
  if (project.edit.zoomKeyframes === undefined) project.edit.zoomKeyframes = []
  if (project.edit.micVolume === undefined) project.edit.micVolume = 1.0
  if (project.edit.micMuted === undefined) project.edit.micMuted = false
  if (project.edit.systemVolume === undefined) project.edit.systemVolume = 1.0
  if (project.edit.systemMuted === undefined) project.edit.systemMuted = false
  if (project.edit.audioOffsetMs === undefined) project.edit.audioOffsetMs = 0
  if (project.recordings && project.recordings.mic === undefined) project.recordings.mic = null
  if (project.recordings && project.recordings.system === undefined) project.recordings.system = null
  // Pre-master/proxy-split projects: the single screen.webm was already
  // re-encoded for seekability, so it serves as both master and proxy.
  if (project.recordings && project.recordings.screenProxy === undefined) {
    project.recordings.screenProxy = project.recordings.screen
  }
  if (project.recordings && project.recordings.webcamProxy === undefined) {
    project.recordings.webcamProxy = project.recordings.webcam
  }

  return project
}

export async function saveProject(id, data) {
  const projectPath = getProjectPath(id)
  data.updatedAt = new Date().toISOString()
  await writeFile(join(projectPath, 'project.json'), JSON.stringify(data, null, 2))
  return data
}

export async function listProjects() {
  await ensureProjectsDir()

  const entries = await readdir(PROJECTS_DIR, { withFileTypes: true })
  const projects = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const jsonPath = join(PROJECTS_DIR, entry.name, 'project.json')
    if (!existsSync(jsonPath)) continue

    try {
      const raw = await readFile(jsonPath, 'utf-8')
      const project = JSON.parse(raw)
      projects.push({
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        duration: project.duration,
        thumbnail: project.thumbnail
      })
    } catch {
      // Skip corrupt projects
    }
  }

  projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  return projects
}

export async function deleteProject(id) {
  const projectPath = getProjectPath(id)
  if (existsSync(projectPath)) {
    await rm(projectPath, { recursive: true, force: true })
  }
}

export async function saveRawRecording(projectId, type, buffer) {
  const projectPath = getProjectPath(projectId)

  let filename
  let proxyFilename = null

  if (type === 'screen' || type === 'webcam') {
    // The raw MediaRecorder blob IS the master — full original quality. It
    // must never be re-encoded; export always reads from it. The browser
    // can't seek it reliably (no Cues block), so we generate a separate
    // SEEKABLE proxy (VP8 + frequent keyframes) purely for editor playback.
    // VP8 in WebM uses Chromium's software decoder, sidestepping the macOS
    // VideoToolbox bugs (-12909) that H.264 triggers.
    filename = `${type}-master.webm`
    const masterPath = join(projectPath, filename)
    await writeFile(masterPath, Buffer.from(buffer))

    proxyFilename = `${type}.webm`
    const proxyPath = join(projectPath, proxyFilename)
    try {
      const { remuxWebm } = await import('./ffmpeg.js')
      await remuxWebm(masterPath, proxyPath)
    } catch (err) {
      console.warn(`Proxy generation failed for ${type}, editor will use the master (seeking may be unreliable):`, err.message)
      proxyFilename = filename
    }
  } else {
    // Audio-only outputs (mic.webm, system.webm) stay as-is — playback as
    // an <audio> element doesn't have the same seek issues.
    filename = `${type}.webm`
    await writeFile(join(projectPath, filename), Buffer.from(buffer))
  }

  // Update project.json
  const project = await loadProject(projectId)
  project.recordings[type] = filename
  if (proxyFilename) {
    project.recordings[`${type}Proxy`] = proxyFilename
  }
  await saveProject(projectId, project)
  return filename
}

/**
 * Create a project from an external video file (MP4, MOV, WebM, MKV, …).
 * The original is copied in untouched as the master; a seekable editing
 * proxy (with audio — imported masters carry their own soundtrack) and a
 * thumbnail are generated. The whole existing editor then works on it.
 */
export async function importVideoAsProject(sourcePath, onProgress) {
  const { probeVideo, remuxWebm, generateThumbnail } = await import('./ffmpeg.js')

  const sourceName = basename(sourcePath)
  const ext = sourceName.includes('.') ? sourceName.split('.').pop().toLowerCase() : 'mp4'
  const displayName = sourceName.replace(/\.[^.]+$/, '')

  const info = await probeVideo(sourcePath)
  if (!info.duration) {
    throw new Error('Could not read video duration — is this a valid video file?')
  }

  const project = await createProject(displayName)
  const projectPath = getProjectPath(project.id)

  const masterName = `screen-master.${ext}`
  await copyFile(sourcePath, join(projectPath, masterName))

  let proxyName = 'screen.webm'
  try {
    await remuxWebm(join(projectPath, masterName), join(projectPath, proxyName), {
      keepAudio: info.hasAudio,
      onProgress,
      durationSec: info.duration
    })
  } catch (err) {
    console.warn('Proxy generation failed for imported video, editor will use the master:', err.message)
    proxyName = masterName
  }

  project.recordings.screen = masterName
  project.recordings.screenProxy = proxyName
  project.duration = info.duration
  project.edit.trimEnd = info.duration
  await saveProject(project.id, project)

  try {
    await generateThumbnail(join(projectPath, masterName), projectPath)
    project.thumbnail = join(projectPath, 'thumb.jpg')
    await saveProject(project.id, project)
  } catch (err) {
    console.warn('Thumbnail generation failed for imported video:', err.message)
  }

  return project
}

export async function listAssets(projectId) {
  const projectPath = getProjectPath(projectId)
  const assetsDir = join(projectPath, 'assets')

  if (!existsSync(assetsDir)) return []

  const entries = await readdir(assetsDir, { withFileTypes: true })
  const assets = []
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']
  const audioExts = ['mp3', 'wav', 'aac', 'm4a', 'ogg']

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = entry.name.split('.').pop().toLowerCase()
    const type = imageExts.includes(ext) ? 'image' : audioExts.includes(ext) ? 'audio' : 'other'
    const stat = await import('fs/promises').then((f) => f.stat(join(assetsDir, entry.name)))
    assets.push({
      filename: entry.name,
      type,
      ext,
      size: stat.size,
      createdAt: stat.birthtime.toISOString()
    })
  }

  return assets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

export async function deleteAsset(projectId, filename) {
  const projectPath = getProjectPath(projectId)
  const { resolve } = await import('path')
  const assetsDir = resolve(join(projectPath, 'assets'))
  const filePath = resolve(join(assetsDir, filename))

  // Path traversal protection
  if (!filePath.startsWith(assetsDir)) {
    throw new Error('Invalid asset path')
  }

  if (existsSync(filePath)) {
    const { unlink } = await import('fs/promises')
    await unlink(filePath)
  }
}

export async function importAsset(projectId, sourcePath) {
  const projectPath = getProjectPath(projectId)
  const assetsDir = join(projectPath, 'assets')
  await mkdir(assetsDir, { recursive: true })

  const ext = sourcePath.split('.').pop().toLowerCase()
  const id = uuid()
  const filename = `${id}.${ext}`
  const destPath = join(assetsDir, filename)

  await copyFile(sourcePath, destPath)

  return {
    id,
    filename,
    originalName: basename(sourcePath),
    path: destPath
  }
}

export async function importProjectZip(archivePath) {
  const raw = await readFile(archivePath, 'utf-8')
  const archive = JSON.parse(raw)

  if (archive.version !== 1) {
    throw new Error('Unsupported project archive version')
  }

  // Create new project with new ID
  const newId = uuid()
  const projectPath = getProjectPath(newId)
  await mkdir(projectPath, { recursive: true })

  // Extract files (with path traversal protection)
  const { resolve } = await import('path')
  const resolvedBase = resolve(projectPath)
  for (const [relativePath, base64Data] of Object.entries(archive.files)) {
    const filePath = join(projectPath, relativePath)
    const resolvedFile = resolve(filePath)
    // Prevent archive slip — all files must stay inside the project directory
    if (!resolvedFile.startsWith(resolvedBase)) {
      console.warn(`Skipping unsafe archive path: ${relativePath}`)
      continue
    }
    const dir = join(filePath, '..')
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, Buffer.from(base64Data, 'base64'))
  }

  // Update project.json with new ID
  const project = await loadProject(newId)
  project.id = newId
  project.name = `${project.name} (imported)`
  await saveProject(newId, project)

  return project
}

export async function exportSrt(projectId) {
  const project = await loadProject(projectId)
  const captions = project.edit?.captions || []

  if (captions.length === 0) {
    throw new Error('No captions to export')
  }

  // Sort captions by start time
  const sorted = [...captions].sort((a, b) => a.startTime - b.startTime)

  let srt = ''
  sorted.forEach((caption, i) => {
    srt += `${i + 1}\n`
    srt += `${formatSrtTime(caption.startTime)} --> ${formatSrtTime(caption.endTime)}\n`
    srt += `${caption.text}\n\n`
  })

  const projectPath = getProjectPath(projectId)
  const outputPath = join(projectPath, 'exports', 'captions.srt')
  await mkdir(join(projectPath, 'exports'), { recursive: true })
  await writeFile(outputPath, srt, 'utf-8')
  return outputPath
}

function formatSrtTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.min(999, Math.round((seconds % 1) * 1000))
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

function pad(n, len) {
  return n.toString().padStart(len, '0')
}

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
      webcam: null
    },
    edit: {
      trimStart: 0,
      trimEnd: null,
      webcamPosition: 'bottom-right',
      webcamSize: 0.2,
      webcamShape: 'circle',
      speed: 1.0,
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
      captions: []
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
  if (!project.edit.crop) {
    project.edit.crop = { enabled: false, aspectRatio: 'original', x: 0, y: 0, width: 1, height: 1 }
  }
  if (!project.edit.textLayers) project.edit.textLayers = []
  if (!project.edit.imageLayers) project.edit.imageLayers = []
  if (!project.edit.audioLayers) project.edit.audioLayers = []
  if (!project.edit.captions) project.edit.captions = []
  if (!project.edit.cuts) project.edit.cuts = []
  if (project.edit.speed === undefined) project.edit.speed = 1.0

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
  const filename = `${type}.webm`
  await writeFile(join(projectPath, filename), Buffer.from(buffer))

  // Update project.json
  const project = await loadProject(projectId)
  project.recordings[type] = filename
  await saveProject(projectId, project)
  return filename
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

export async function exportProjectZip(projectId) {
  const projectPath = getProjectPath(projectId)
  const project = await loadProject(projectId)
  const outputPath = join(app.getPath('desktop'), `${project.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.beamproject`)

  // Create a simple tar-like archive using a directory copy approach
  // For simplicity, we'll use the archiver approach with built-in zlib
  const { createGzip } = await import('zlib')
  const { pipeline } = await import('stream/promises')
  const { pack } = await import('tar')

  // Use tar to pack the project directory
  // Since tar might not be available, use a simpler approach: zip the directory
  // Actually, let's just copy the folder and create a manifest
  const archiver = await createSimpleArchive(projectPath, outputPath)
  return outputPath
}

// Simple project archive: copies project folder to a .beamproject file (actually a renamed folder)
// For a proper implementation, we'd use a zip library
async function createSimpleArchive(projectPath, outputPath) {
  // Read all files in project
  const files = {}
  await collectFiles(projectPath, projectPath, files)

  // Write as JSON bundle (simple but works for reasonable project sizes)
  const archive = {
    version: 1,
    files: {}
  }

  for (const [relativePath, data] of Object.entries(files)) {
    archive.files[relativePath] = data.toString('base64')
  }

  await writeFile(outputPath, JSON.stringify(archive))
  return outputPath
}

async function collectFiles(basePath, currentPath, files) {
  const entries = await readdir(currentPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(currentPath, entry.name)
    const relativePath = fullPath.slice(basePath.length + 1)
    if (entry.isDirectory()) {
      // Skip exports directory to keep archive smaller
      if (entry.name === 'exports') continue
      await collectFiles(basePath, fullPath, files)
    } else {
      files[relativePath] = await readFile(fullPath)
    }
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

  // Extract files
  for (const [relativePath, base64Data] of Object.entries(archive.files)) {
    const filePath = join(projectPath, relativePath)
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
  const ms = Math.round((seconds % 1) * 1000)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

function pad(n, len) {
  return n.toString().padStart(len, '0')
}

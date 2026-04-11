import { app } from 'electron'
import { join } from 'path'
import { readdir, readFile, writeFile, mkdir, rm } from 'fs/promises'
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
      webcamShape: 'circle'
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
  return JSON.parse(raw)
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

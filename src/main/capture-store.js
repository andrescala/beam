import { app } from 'electron'
import { join } from 'path'
import { createWriteStream } from 'fs'
import { readdir, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'

// Crash-safe recording store (R8).
//
// During capture we stream each MediaRecorder chunk straight to disk as it
// arrives, instead of buffering the whole recording in renderer memory and
// only writing it on stop. If the app (or the renderer) crashes mid-recording
// the bytes already captured survive on disk as a `.part` file, which we can
// detect and offer to recover on the next launch.
//
// Files are named `<type>.recording.part` inside the project directory while
// in progress. A clean stop calls finalizeCapture which closes the stream and
// removes the `.part` (the renderer's normal in-memory save already wrote the
// real master/proxy). If the app crashes mid-recording finalize never runs, so
// the `.part` survives on disk for recovery on the next launch.

const PROJECTS_DIR = join(app.getPath('home'), 'Beam', 'projects')

// One append stream per `${projectId}:${type}` key, kept open across chunk IPC
// calls for the lifetime of a recording.
const openStreams = new Map()
// Keys finalized this session. A late chunk that arrives after finalize (the
// final dataavailable can race the cross-channel finalize IPC) is dropped
// instead of re-creating an orphaned `.part` file.
const finalizedKeys = new Set()

function streamKey(projectId, type) {
  return `${projectId}:${type}`
}

function partPath(projectId, type) {
  return join(PROJECTS_DIR, projectId, `${type}.recording.part`)
}

/**
 * Append one chunk (an ArrayBuffer transferred over IPC) to the on-disk
 * recording for (projectId, type). Opens the append stream lazily on the
 * first chunk. Resolves once the chunk is handed to the stream.
 */
export function appendChunk(projectId, type, arrayBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const key = streamKey(projectId, type)
      if (finalizedKeys.has(key)) {
        resolve(false)
        return
      }
      let stream = openStreams.get(key)
      if (!stream) {
        const dest = partPath(projectId, type)
        // The project directory already exists (createProject ran first), so a
        // plain create stream is safe. 'w' truncates any stale .part from a
        // previous aborted attempt for this same fresh project/type.
        stream = createWriteStream(dest, { flags: 'w' })
        stream.on('error', (err) => {
          console.error(`capture-store write error (${key}):`, err.message)
        })
        openStreams.set(key, stream)
      }
      const buf = Buffer.from(arrayBuffer)
      stream.write(buf, (err) => {
        if (err) reject(err)
        else resolve(true)
      })
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * Close the append stream for (projectId, type) on a clean stop and remove the
 * `.part` file — the renderer's normal save path has already written the real
 * recording, so the crash-safety copy is no longer needed. Safe to call even
 * if no stream was ever opened. Returns true on success.
 */
export async function finalizeCapture(projectId, type) {
  const key = streamKey(projectId, type)
  finalizedKeys.add(key)
  const stream = openStreams.get(key)
  if (stream) {
    await new Promise((resolve) => stream.end(resolve))
    openStreams.delete(key)
  }

  const part = partPath(projectId, type)
  if (existsSync(part)) {
    await rm(part, { force: true })
  }
  return true
}

/**
 * Scan all project directories for orphaned in-progress captures left behind by
 * a crash: a `.recording.part` file in a project whose project.json has no
 * `recordings.screen` set. Returns a list of recoverable projects. Kept
 * deliberately minimal — the renderer decides what to do with the result.
 */
export async function findRecoverableCaptures() {
  const recoverable = []
  if (!existsSync(PROJECTS_DIR)) return recoverable

  let entries
  try {
    entries = await readdir(PROJECTS_DIR, { withFileTypes: true })
  } catch {
    return recoverable
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const projectDir = join(PROJECTS_DIR, entry.name)
    let files
    try {
      files = await readdir(projectDir)
    } catch {
      continue
    }

    const partFiles = files.filter((f) => f.endsWith('.recording.part'))
    if (partFiles.length === 0) continue

    // Only flag as recoverable if the project never got a screen recording
    // written through the normal save path — i.e. it was interrupted.
    const jsonPath = join(projectDir, 'project.json')
    if (!existsSync(jsonPath)) continue
    let project
    try {
      project = JSON.parse(await readFile(jsonPath, 'utf-8'))
    } catch {
      continue
    }

    const hasScreen = project.recordings && project.recordings.screen
    if (!hasScreen) {
      recoverable.push({
        id: project.id || entry.name,
        name: project.name || 'Untitled Recording',
        createdAt: project.createdAt || null,
        partFiles
      })
    }
  }

  return recoverable
}

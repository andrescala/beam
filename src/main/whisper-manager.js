// Whisper model manager — keeps the speech model OUT of the app bundle and
// downloads it on demand.
//
// Two engine variants are supported (detected by transcribe.js):
//   • openai-whisper (Python CLI) — manages its own model cache, nothing to
//     download here. Status is 'ready' as soon as the binary exists.
//   • whisper.cpp (whisper-cli) — needs a ggml model file. We download
//     ggml-base.en.bin (~142 MB) from Hugging Face into userData on first
//     use, with progress reported to the renderer.
//
// Status values surfaced to the UI:
//   ready          engine + model available, transcription will work
//   model-missing  engine found (whisper-cli) but model not yet downloaded
//   downloading    model download in flight (progress 0-100)
//   error          last download failed (click to retry)
//   not-installed  no whisper engine on this machine

import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, rename, rm } from 'fs/promises'
import { createWriteStream } from 'fs'
import { resolveWhisperBin, isCliVariant } from './transcribe.js'

const MODEL_NAME = 'ggml-base.en.bin'
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`
const MODEL_SIZE_LABEL = '142 MB'
// ggml-base.en.bin is ~142 MB. When the server doesn't send Content-Length we
// can't compare received vs total, so we use this as a floor sanity-check to
// reject a truncated download instead of renaming a corrupt file into place.
const MODEL_MIN_BYTES = 100 * 1024 * 1024

let downloadState = null // null | { promise, progress }
let lastError = null
const listeners = new Set()

function modelsDir() {
  return join(app.getPath('userData'), 'whisper-models')
}

export function getModelPath() {
  return join(modelsDir(), MODEL_NAME)
}

export function onStatusChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitStatus() {
  const status = getWhisperStatus()
  for (const listener of listeners) {
    try {
      listener(status)
    } catch {
      // listener errors must not break the download loop
    }
  }
}

export function getWhisperStatus() {
  const bin = resolveWhisperBin()
  if (!bin) {
    return { status: 'not-installed', engine: null, modelSizeLabel: MODEL_SIZE_LABEL }
  }
  const engine = isCliVariant(bin) ? 'whisper-cpp' : 'openai-whisper'
  if (engine === 'openai-whisper') {
    // Python whisper downloads its own models — nothing for us to manage.
    return { status: 'ready', engine, modelSizeLabel: MODEL_SIZE_LABEL }
  }
  if (downloadState) {
    return { status: 'downloading', engine, progress: downloadState.progress, modelSizeLabel: MODEL_SIZE_LABEL }
  }
  if (existsSync(getModelPath())) {
    return { status: 'ready', engine, modelSizeLabel: MODEL_SIZE_LABEL }
  }
  if (lastError) {
    return { status: 'error', engine, error: lastError, modelSizeLabel: MODEL_SIZE_LABEL }
  }
  return { status: 'model-missing', engine, modelSizeLabel: MODEL_SIZE_LABEL }
}

/**
 * Start (or join) the model download. Concurrent callers share one download.
 * Resolves to the final status.
 */
export function downloadModel() {
  if (existsSync(getModelPath())) {
    return Promise.resolve(getWhisperStatus())
  }
  if (downloadState) {
    return downloadState.promise
  }

  lastError = null
  const state = { progress: 0 }
  state.promise = (async () => {
    const dir = modelsDir()
    const partPath = `${getModelPath()}.part`
    try {
      await mkdir(dir, { recursive: true })
      emitStatus()

      const response = await fetch(MODEL_URL)
      if (!response.ok || !response.body) {
        throw new Error(`Download failed (HTTP ${response.status})`)
      }
      const total = parseInt(response.headers.get('content-length') || '0', 10)

      const out = createWriteStream(partPath)
      const reader = response.body.getReader()
      let received = 0
      let lastEmitted = -1
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.length
          await new Promise((resolve, reject) => {
            out.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()))
          })
          if (total > 0) {
            state.progress = Math.min(99, Math.round((received / total) * 100))
            if (state.progress !== lastEmitted) {
              lastEmitted = state.progress
              emitStatus()
            }
          }
        }
      } finally {
        await new Promise((resolve) => out.end(resolve))
      }

      // Reject truncated downloads. When Content-Length is known, require the
      // full byte count; when it isn't (chunked transfer), fall back to a
      // minimum-size floor so a half-written file is never accepted as ready.
      if (total > 0) {
        if (received < total) {
          throw new Error('Download incomplete — connection interrupted')
        }
      } else if (received < MODEL_MIN_BYTES) {
        throw new Error('Download incomplete — received fewer bytes than expected')
      }

      await rename(partPath, getModelPath())
      return getWhisperStatus()
    } catch (err) {
      lastError = err.message || 'Download failed'
      await rm(partPath, { force: true }).catch(() => {})
      return getWhisperStatus()
    } finally {
      downloadState = null
      emitStatus()
    }
  })()

  downloadState = state
  return state.promise
}

/**
 * Make sure transcription can run: if the engine needs a model that isn't
 * downloaded yet, start the download automatically and wait for it.
 *
 * Returns { ok, modelPath?, status }.
 */
export async function ensureWhisperReady() {
  let status = getWhisperStatus()
  if (status.status === 'not-installed') {
    return { ok: false, status }
  }
  if (status.engine === 'openai-whisper') {
    return { ok: true, modelPath: null, status }
  }
  if (status.status !== 'ready') {
    status = await downloadModel()
  }
  if (status.status === 'ready') {
    return { ok: true, modelPath: getModelPath(), status }
  }
  return { ok: false, status }
}

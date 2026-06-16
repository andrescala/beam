// Real transcription via the locally-installed Whisper CLI.
//
// Strategy:
//   1. Convert the source audio to a 16 kHz mono WAV using our bundled ffmpeg
//      (Whisper handles other formats too, but pre-converting removes its
//      dependency on the system ffmpeg being on PATH).
//   2. Shell out to `whisper` (openai-whisper Python CLI) with --output_format json.
//   3. Parse the JSON sidecar into { start, end, text } segments.
//
// If the binary isn't found, return a structured error so the UI can show
// install instructions instead of a generic failure.

import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { readFile, mkdtemp, rm } from 'fs/promises'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'

ffmpeg.setFfmpegPath(ffmpegPath)
const execFileAsync = promisify(execFile)

// Common install locations to try before giving up.
const CANDIDATE_BINS = [
  process.env.BEAM_WHISPER_BIN,
  '/opt/homebrew/bin/whisper',
  '/usr/local/bin/whisper',
  '/opt/homebrew/bin/whisper-cli',
  '/usr/local/bin/whisper-cli',
  'whisper' // last resort: PATH lookup
].filter(Boolean)

function resolveWhisperBin() {
  for (const p of CANDIDATE_BINS) {
    if (p === 'whisper') return p // let execFile try PATH
    if (existsSync(p)) return p
  }
  return null
}

function isCliVariant(bin) {
  // whisper-cli (whisper.cpp) uses different flags than openai-whisper.
  return /whisper-cli$/.test(bin)
}

export { resolveWhisperBin, isCliVariant }

/**
 * Convert an arbitrary audio/video file to a 16 kHz mono WAV.
 * Whisper works best with this exact format.
 */
function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le')
      .format('wav')
      .save(outputPath)
      .on('end', resolve)
      .on('error', reject)
  })
}

/**
 * Run Whisper on the given WAV file.
 *
 * Returns segments: [{ start, end, text }, ...]
 * Throws { code: 'WHISPER_NOT_FOUND' } if the binary is missing.
 */
export async function transcribeAudio(audioPath, options = {}) {
  const bin = resolveWhisperBin()
  if (!bin) {
    const err = new Error('Whisper binary not found')
    err.code = 'WHISPER_NOT_FOUND'
    throw err
  }

  const model = options.model || 'base.en'
  const language = options.language || 'en'

  // Stage everything in a temp dir so we can read the JSON sidecar.
  const workDir = await mkdtemp(join(tmpdir(), 'beam-whisper-'))
  const wavPath = join(workDir, 'audio.wav')

  try {
    await convertToWav(audioPath, wavPath)

    if (isCliVariant(bin)) {
      // whisper.cpp CLI variant — needs a ggml model FILE (not a model
      // name). The whisper-manager downloads it on first use and passes
      // its path in options.modelPath. Writes <input>.json next to the
      // input file.
      if (!options.modelPath || !existsSync(options.modelPath)) {
        const err = new Error('Whisper model not downloaded')
        err.code = 'WHISPER_MODEL_MISSING'
        throw err
      }
      await execFileAsync(bin, [
        '-m', options.modelPath,
        '-l', language,
        '-oj',          // output JSON
        '-f', wavPath
      ], { maxBuffer: 64 * 1024 * 1024 })

      const jsonPath = `${wavPath}.json`
      const raw = await readFile(jsonPath, 'utf-8')
      const data = JSON.parse(raw)
      return (data.transcription || []).map((seg) => ({
        start: seg.offsets?.from / 1000,
        end: seg.offsets?.to / 1000,
        text: (seg.text || '').trim()
      }))
    }

    // openai-whisper (Python) CLI — writes <basename>.json into --output_dir.
    await execFileAsync(bin, [
      wavPath,
      '--model', model,
      '--language', language,
      '--output_format', 'json',
      '--output_dir', workDir,
      '--fp16', 'False'  // avoid GPU; CPU is fine for short clips
    ], { maxBuffer: 64 * 1024 * 1024 })

    const stem = basename(wavPath, '.wav')
    const jsonPath = join(workDir, `${stem}.json`)
    const raw = await readFile(jsonPath, 'utf-8')
    const data = JSON.parse(raw)

    return (data.segments || []).map((seg) => ({
      start: seg.start,
      end: seg.end,
      text: (seg.text || '').trim()
    }))
  } finally {
    // Best-effort cleanup
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

export function isWhisperAvailable() {
  return resolveWhisperBin() !== null
}

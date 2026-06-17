import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { mkdir } from 'fs/promises'
import { buildRenderModel } from '../shared/render-model.js'

// Fix paths for asar packaging
const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
ffmpeg.setFfmpegPath(ffmpegPath)
// ffmpeg-static ships ffmpeg only — bundle ffprobe separately so probing
// works in packaged apps too (previously it silently relied on a system
// ffprobe being on PATH).
ffmpeg.setFfprobePath(ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked'))

// Get video dimensions via ffprobe
export function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err)
      const video = metadata.streams.find((s) => s.codec_type === 'video')
      const audio = metadata.streams.find((s) => s.codec_type === 'audio')
      resolve({
        width: video?.width || 1920,
        height: video?.height || 1080,
        duration: parseFloat(metadata.format.duration) || 0,
        hasAudio: !!audio
      })
    })
  })
}

export function generateThumbnail(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['10%'],
        filename: 'thumb.jpg',
        folder: outputPath,
        size: '320x180'
      })
      .on('end', () => resolve(join(outputPath, 'thumb.jpg')))
      .on('error', (err) => reject(err))
  })
}

/** Extract audio from video as WAV (for transcription) */
export function extractAudio(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run()
  })
}

/**
 * Compute the "keep" segments from trim + cuts.
 */
function computeKeepSegments(trimStart, trimEnd, cuts) {
  let segments = [{ start: trimStart, end: trimEnd }]

  if (!cuts || cuts.length === 0) return segments

  const sortedCuts = [...cuts].sort((a, b) => a.start - b.start)

  for (const cut of sortedCuts) {
    const newSegments = []
    for (const seg of segments) {
      if (cut.end <= seg.start || cut.start >= seg.end) {
        newSegments.push(seg)
      } else {
        if (cut.start > seg.start) {
          newSegments.push({ start: seg.start, end: cut.start })
        }
        if (cut.end < seg.end) {
          newSegments.push({ start: cut.end, end: seg.end })
        }
      }
    }
    segments = newSegments
  }

  return segments.filter((s) => s.end - s.start >= 0.1)
}

/**
 * Compute the effective timestamp in the output video for a given source timestamp.
 * Used to map text/image layer timing through cuts.
 */
function mapTimeToOutput(sourceTime, keepSegments) {
  let outputTime = 0
  for (const seg of keepSegments) {
    if (sourceTime <= seg.start) return outputTime
    if (sourceTime <= seg.end) {
      return outputTime + (sourceTime - seg.start)
    }
    outputTime += (seg.end - seg.start)
  }
  return outputTime
}

function computeOutputDuration(keepSegments) {
  return keepSegments.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
}

/**
 * Convert a Chrome-MediaRecorder WebM to MP4 (H.264 + AAC) so the browser
 * can seek it reliably. MediaRecorder WebMs lack a proper Cues block and
 * the <video> element rejects seeks (snaps currentTime back to 0). MP4
 * has bulletproof seek tables.
 *
 * Uses libx264 with ultrafast preset — fast enough (~3–5× realtime on
 * Apple Silicon) and produces universally browser-compatible output.
 * (h264_videotoolbox is faster but its output triggers Chromium decode
 * errors — VTDecompressionOutputCallback / NSOSStatus -12909.)
 */
/**
 * Re-encode a Chrome MediaRecorder WebM to a SEEKABLE WebM (VP8 + frequent
 * keyframes). Why this recipe:
 *
 *   • VP8 in WebM uses Chromium's software decoder by default — sidesteps
 *     the macOS VideoToolbox bugs that cause -12909 / decode-failed errors
 *     on H.264.
 *   • Forced keyframe every 1 second so timeline clicks seek precisely.
 *   • libvpx realtime mode — encoding stays under ~1× realtime on M-series.
 *   • Audio stripped (lives in mic.webm).
 */
export function remuxWebm(inputPath, outputPath, opts = {}) {
  const { keepAudio = false, onProgress = null, durationSec = 0 } = opts
  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputPath)
      .videoCodec('libvpx')
      .fps(30)
      .outputOptions([
        '-b:v', '3M',
        '-deadline', 'realtime',
        '-cpu-used', '4',
        '-g', '30',                // keyframe every 1 second at 30 fps
        '-keyint_min', '30',
        '-pix_fmt', 'yuv420p'
      ])

    if (keepAudio) {
      // Imported videos carry their audio in the master file (recordings
      // never do — mic/system live in separate tracks), so the editing
      // proxy must keep it for preview playback.
      command = command.audioCodec('libopus').audioBitrate('128k')
    } else {
      command = command.noAudio()
    }

    command
      .save(outputPath)
      .on('progress', (p) => {
        if (!onProgress) return
        if (p.percent) {
          onProgress(Math.min(100, Math.round(p.percent)))
        } else if (durationSec > 0 && p.timemark) {
          const [h, m, s] = p.timemark.split(':').map(parseFloat)
          const sec = (h || 0) * 3600 + (m || 0) * 60 + (s || 0)
          onProgress(Math.min(100, Math.round((sec / durationSec) * 100)))
        }
      })
      .on('end', () => resolve())
      .on('error', reject)
  })
}

const CRF_BY_QUALITY = { high: 18, balanced: 23, small: 28 }

// Per-quality average bitrate targets used for hardware H.264/HEVC encoders,
// which don't honour libx264's CRF. Roughly matched to the CRF tiers for a
// typical 1080p screencast.
const HW_BITRATE_BY_QUALITY = { high: '12M', balanced: '8M', small: '5M' }
// VP9 uses CRF too, but on a different scale than x264; map to comparable
// perceptual tiers.
const VP9_CRF_BY_QUALITY = { high: 24, balanced: 31, small: 37 }

// Cache of encoder-name -> boolean availability. Probing spawns a tiny FFmpeg
// job, so we only ever do it once per encoder per process.
const encoderProbeCache = new Map()

/**
 * Probe whether a given video encoder actually works in this FFmpeg build /
 * on this machine. Runs a sub-0.1s nullsrc encode and resolves true only if
 * FFmpeg exits cleanly. Any error (encoder missing, hardware unavailable,
 * driver fault) resolves false so the caller can fall back to software.
 *
 * Conservative by design: this codebase has a history of macOS VideoToolbox
 * DECODE faults (-12909). Encode is generally safe, but we still verify the
 * encoder before trusting it for a real export. Results are cached per process.
 */
export function probeEncoder(encoder) {
  if (encoderProbeCache.has(encoder)) {
    return Promise.resolve(encoderProbeCache.get(encoder))
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      encoderProbeCache.set(encoder, ok)
      resolve(ok)
    }
    try {
      ffmpeg()
        .input('nullsrc=s=256x256:r=30')
        .inputOptions(['-f', 'lavfi', '-t', '0.1'])
        .outputOptions(['-c:v', encoder, '-f', 'null'])
        .output('-')
        .on('end', () => finish(true))
        .on('error', () => finish(false))
        .run()
    } catch {
      finish(false)
    }
  })
}

/**
 * Pick a hardware H.264 encoder, probing candidates in platform-preferred
 * order. Returns the encoder name, or null if none are usable.
 */
async function pickHardwareH264() {
  const candidates =
    process.platform === 'darwin'
      ? ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv']
      : ['h264_nvenc', 'h264_qsv']
  for (const enc of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await probeEncoder(enc)) return enc
  }
  return null
}

/**
 * Resolve the H.264 video-encoder output options, honouring the hardwareAccel
 * opt-in with automatic fallback to libx264. Returns an array of outputOptions
 * tokens (encoder + quality control + pixel format).
 */
async function buildH264VideoOptions(options, crf, quality) {
  if (options.hardwareAccel) {
    const hwEnc = await pickHardwareH264()
    if (hwEnc) {
      const bitrate = HW_BITRATE_BY_QUALITY[quality] || HW_BITRATE_BY_QUALITY.balanced
      const opts = ['-c:v', hwEnc, '-b:v', bitrate]
      // nvenc honours -cq; qsv uses -global_quality. videotoolbox relies on the
      // bitrate ceiling alone. These are best-effort and ignored if unknown.
      if (hwEnc === 'h264_nvenc') opts.push('-cq', String(crf), '-preset', 'p5')
      else if (hwEnc === 'h264_qsv') opts.push('-global_quality', String(crf))
      opts.push('-pix_fmt', 'yuv420p')
      return opts
    }
    console.warn('[export] hardwareAccel requested but no hardware H.264 encoder available; using libx264')
  }
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p']
}

/**
 * Resolve HEVC/H.265 video options, preferring hardware when opted in, with
 * automatic fallback to libx265.
 */
async function buildHevcVideoOptions(options, crf, quality) {
  if (options.hardwareAccel) {
    const hwEnc =
      process.platform === 'darwin' && (await probeEncoder('hevc_videotoolbox'))
        ? 'hevc_videotoolbox'
        : (await probeEncoder('hevc_nvenc'))
          ? 'hevc_nvenc'
          : null
    if (hwEnc) {
      const bitrate = HW_BITRATE_BY_QUALITY[quality] || HW_BITRATE_BY_QUALITY.balanced
      const opts = ['-c:v', hwEnc, '-b:v', bitrate, '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p']
      if (hwEnc === 'hevc_nvenc') opts.splice(4, 0, '-cq', String(crf))
      return opts
    }
    console.warn('[export] hardwareAccel requested but no hardware HEVC encoder available; using libx265')
  }
  // libx265 reuses the libx264 CRF scale closely enough for our tiers.
  return ['-c:v', 'libx265', '-preset', 'medium', '-crf', String(crf), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p']
}

// Supported export formats and their file extensions. Audio-only formats skip
// the video graph; PNG grabs a single frame and skips audio.
const FORMAT_EXT = {
  mp4: 'mp4',
  hevc: 'mp4',
  webm: 'webm',
  gif: 'gif',
  mp3: 'mp3',
  m4a: 'm4a',
  png: 'png'
}
const AUDIO_ONLY_FORMATS = new Set(['mp3', 'm4a'])

export async function exportMp4(projectPath, project, onProgress, options = {}) {
  return runExport(projectPath, project, onProgress, { ...options, format: options.format || 'mp4' })
}

/**
 * Unified export pipeline. Builds the SAME full video/audio filter graph for
 * every visual format (mp4, hevc, webm, gif, png) and the audio half for
 * audio-only formats (mp3, m4a). The output stage then adapts codecs / mapping
 * per format. GIF reuses the full graph and appends fps+scale+palettegen/
 * paletteuse as a 2-pass step, so it now includes all overlays/effects.
 */
async function runExport(projectPath, project, onProgress, options = {}) {
  const format = options.format || 'mp4'

  // Multi-clip timeline routing: if the project's video track stitches clips
  // from MORE THAN ONE source (an appended/imported clip), use the dedicated
  // clip-concatenation path. Single-source projects — including all migrated
  // v1 projects, whose multiple segments are just cuts of one recording — keep
  // the original fully-featured pipeline below unchanged (guaranteed parity).
  const routeModel = buildRenderModel(project)
  // Only count clips whose media actually resolves to a file — a clip with a
  // dangling mediaId must not flip routing to the multi-clip path (which would
  // then silently drop it), and must not strand a single real clip there.
  const distinctSources = new Set(
    routeModel.videoSegments.filter((s) => s.sourceFile).map((s) => s.mediaId)
  )
  if (distinctSources.size > 1) {
    return exportTimelineClips(projectPath, project, routeModel, onProgress, options)
  }

  const screenPath = join(projectPath, project.recordings.screen)
  if (!existsSync(screenPath)) {
    throw new Error('Screen recording not found')
  }

  const crf = CRF_BY_QUALITY[options.quality] || CRF_BY_QUALITY.balanced
  // Two independent, composable sizing inputs:
  //   • targetWidth+targetHeight — a social preset's exact WxH box, reached by
  //     blur-fill or center-crop reframing (changes aspect ratio).
  //   • capHeight — a proportional downscale cap from the resolution dropdown
  //     (preserves aspect ratio).
  // Both can apply: a social reframe runs first, then the cap shrinks the
  // result if it's still taller than the cap. Keeping them separate means the
  // resolution dropdown is never silently shadowed by a preset.
  const targetWidth = options.targetWidth || null
  const targetHeight = options.targetHeight || null
  const capHeight = options.resolution === '1080p' ? 1080
    : options.resolution === '720p' ? 720
    : null
  const fillMode = options.fillMode === 'crop' ? 'crop' : 'blur'
  const normalizeLoudness = !!options.normalizeLoudness

  const screenInfo = await probeVideo(screenPath)

  const edit = project.edit || {}
  const trimStart = edit.trimStart || 0
  const trimEnd = edit.trimEnd || project.duration || screenInfo.duration || 0
  const speed = edit.speed || 1.0
  const cuts = edit.cuts || []
  const crop = edit.crop || {}
  const textLayers = edit.textLayers || []
  const imageLayers = edit.imageLayers || []
  const audioLayers = edit.audioLayers || []
  const captions = edit.captions || []
  const introCard = edit.introCard || null
  const outroCard = edit.outroCard || null
  const backgroundBlur = edit.backgroundBlur || null
  const cursorSpotlight = edit.cursorSpotlight || null
  const zoomKeyframes = edit.zoomKeyframes || []

  const outputDir = join(projectPath, 'exports')
  await mkdir(outputDir, { recursive: true })
  const timestamp = Date.now()
  const safeLabel = (options.label || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  const ext = FORMAT_EXT[format] || 'mp4'
  const outputPath = join(outputDir, `export${safeLabel ? `-${safeLabel}` : ''}-${timestamp}.${ext}`)
  const isAudioOnly = AUDIO_ONLY_FORMATS.has(format)
  const isGif = format === 'gif'
  const isPng = format === 'png'

  const webcamPath = project.recordings?.webcam
    ? join(projectPath, project.recordings.webcam)
    : null
  const hasWebcam = webcamPath && existsSync(webcamPath)

  // Audio source-of-truth is now the separate mic.webm (video-only screen.mp4
  // avoids Chromium decode errors on transcoded AAC). Fall back to screen
  // audio if the project predates the split (very old recordings).
  const micPath = project.recordings?.mic
    ? join(projectPath, project.recordings.mic)
    : null
  const hasMicFile = micPath && existsSync(micPath)
  const micVolume = edit.micMuted ? 0 : (edit.micVolume != null ? edit.micVolume : 1.0)
  const audioOffsetMs = edit.audioOffsetMs || 0
  const audioOffsetSec = audioOffsetMs / 1000

  // Optional system-audio track (separate system.webm recording)
  const systemPath = project.recordings?.system
    ? join(projectPath, project.recordings.system)
    : null
  const hasSystemFile = systemPath && existsSync(systemPath)
  const systemVolume = edit.systemMuted ? 0 : (edit.systemVolume != null ? edit.systemVolume : 1.0)

  const keepSegments = computeKeepSegments(trimStart, trimEnd, cuts)
  if (keepSegments.length === 0) {
    throw new Error('Nothing to export — all content has been cut')
  }

  const hasCuts = keepSegments.length > 1 || cuts.length > 0
  const hasSpeed = speed !== 1.0
  const hasCrop = crop.enabled && crop.aspectRatio !== 'original'
  const outputDuration = computeOutputDuration(keepSegments) / speed

  // Collect image/audio asset input files
  const imageAssetInputs = []
  for (const layer of imageLayers) {
    const assetPath = join(projectPath, 'assets', layer.file)
    if (existsSync(assetPath)) {
      imageAssetInputs.push({ layer, path: assetPath })
    }
  }

  const audioAssetInputs = []
  for (const layer of audioLayers) {
    const assetPath = join(projectPath, 'assets', layer.file)
    if (existsSync(assetPath)) {
      // Asset duration is needed to place the fade-out
      let assetDuration = 0
      if (layer.fadeOut > 0) {
        try {
          assetDuration = (await probeVideo(assetPath)).duration
        } catch {
          // fade-out is skipped when the duration can't be determined
        }
      }
      audioAssetInputs.push({ layer, path: assetPath, assetDuration })
    }
  }

  // Resolve the video-encoder options up front (encoder probing is async and
  // can't run inside the Promise executor below). Only the H.264/HEVC paths
  // need this; other formats use fixed codecs.
  let videoCodecOptions = null
  if (format === 'hevc') {
    videoCodecOptions = await buildHevcVideoOptions(options, crf, options.quality)
  } else if (format === 'mp4') {
    videoCodecOptions = await buildH264VideoOptions(options, crf, options.quality)
  }

  return new Promise((resolve, reject) => {
    let command = ffmpeg()

    // Input 0: screen recording (video, no audio — audio is in mic.webm)
    command = command.input(screenPath)
    let nextInputIdx = 1

    // Recording-audio sources. Each is trimmed/speed-adjusted independently,
    // volume-scaled, then mixed. Mic comes from mic.webm with optional sync
    // offset (falling back to audio muxed into the screen file for legacy
    // recordings); system audio is its own optional track. Muted/zero-volume
    // sources are dropped entirely.
    const micDenoise = !!edit.micDenoise
    const recordingAudio = [] // { label, volume, denoise }
    if (hasMicFile) {
      if (micVolume > 0) {
        if (audioOffsetSec !== 0) {
          command = command.input(micPath).inputOptions(['-itsoffset', audioOffsetSec.toFixed(3)])
        } else {
          command = command.input(micPath)
        }
        recordingAudio.push({ label: `[${nextInputIdx}:a]`, volume: micVolume, denoise: micDenoise })
        nextInputIdx++
      }
    } else if (screenInfo.hasAudio && micVolume > 0) {
      // Legacy: audio is muxed into the screen file. Add it as a separate
      // input only if we need to apply an offset.
      if (audioOffsetSec !== 0) {
        command = command.input(screenPath).inputOptions(['-itsoffset', audioOffsetSec.toFixed(3)])
        recordingAudio.push({ label: `[${nextInputIdx}:a]`, volume: micVolume, denoise: micDenoise })
        nextInputIdx++
      } else {
        recordingAudio.push({ label: '[0:a]', volume: micVolume, denoise: micDenoise })
      }
    }
    if (hasSystemFile && systemVolume > 0) {
      command = command.input(systemPath)
      recordingAudio.push({ label: `[${nextInputIdx}:a]`, volume: systemVolume, denoise: false })
      nextInputIdx++
    }

    // Webcam input (if present)
    let webcamInputIdx = -1
    if (hasWebcam) {
      command = command.input(webcamPath)
      webcamInputIdx = nextInputIdx
      nextInputIdx++
    }


    // Image inputs
    const imageInputMap = []
    for (const { path } of imageAssetInputs) {
      command = command.input(path)
      imageInputMap.push(nextInputIdx)
      nextInputIdx++
    }

    // Audio inputs
    const audioInputMap = []
    for (const { path } of audioAssetInputs) {
      command = command.input(path)
      audioInputMap.push(nextInputIdx)
      nextInputIdx++
    }

    // Build the complex filter chain
    const filters = []
    let videoOut, audioOut

    // ── Step 1: Trim/cut screen video ──
    // Skipped entirely for audio-only formats (mp3/m4a) — no video graph is
    // built so no dangling filter outputs exist to map.
    if (!isAudioOnly) {
      if (hasCuts) {
        const vParts = []
        keepSegments.forEach((seg, i) => {
          filters.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[sv${i}]`)
          vParts.push(`[sv${i}]`)
        })

        if (keepSegments.length > 1) {
          filters.push(`${vParts.join('')}concat=n=${keepSegments.length}:v=1:a=0[sv_concat]`)
          videoOut = 'sv_concat'
        } else {
          videoOut = 'sv0'
        }
      } else {
        filters.push(`[0:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS[sv_trim]`)
        videoOut = 'sv_trim'
      }
    }

    // ── Step 1b: Trim/cut each recording-audio source the same way ──
    // PNG (single still frame) and GIF (silent animation) carry no audio, so
    // skip every audio step — an unmapped audio output would otherwise dangle.
    const needsAudio = !isPng && !isGif
    const recAudioOuts = []
    if (needsAudio) recordingAudio.forEach((src, s) => {
      // FFT-based background-noise reduction on the mic. Applied ONCE to the
      // whole source before any cut/trim split, so the denoiser trains its
      // noise estimate on a continuous stream (applying it per-segment would
      // restart adaptation at every cut, causing audible pumping). The
      // denoised stream is reused across all keep-segments.
      let srcLabel = src.label
      if (src.denoise) {
        filters.push(`${src.label}afftdn=nf=-25[sa${s}_dn]`)
        srcLabel = `[sa${s}_dn]`
      }
      if (hasCuts && keepSegments.length > 1) {
        // Fan the (possibly denoised) source out into one branch per keep
        // segment, trim each, then concat — a label can only be consumed
        // once, so asplit is required when there are multiple segments.
        const splitOuts = keepSegments.map((_, i) => `[sa${s}_src${i}]`).join('')
        filters.push(`${srcLabel}asplit=${keepSegments.length}${splitOuts}`)
        const aParts = []
        keepSegments.forEach((seg, i) => {
          filters.push(`[sa${s}_src${i}]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[sa${s}_${i}]`)
          aParts.push(`[sa${s}_${i}]`)
        })
        filters.push(`${aParts.join('')}concat=n=${keepSegments.length}:v=0:a=1[sa${s}_concat]`)
        recAudioOuts.push(`sa${s}_concat`)
      } else {
        // Single keep-segment (with or without cuts): one trim covers it.
        const seg = hasCuts ? keepSegments[0] : { start: trimStart, end: trimEnd }
        filters.push(`${srcLabel}atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[sa${s}_trim]`)
        recAudioOuts.push(`sa${s}_trim`)
      }
    })

    // If no audio source at all, generate a silent track so the output MP4
    // is well-formed.
    if (needsAudio && recordingAudio.length === 0) {
      const silenceDuration = computeOutputDuration(keepSegments)
      filters.push(`aevalsrc=0:d=${silenceDuration}[sa_silence]`)
      audioOut = 'sa_silence'
    }

    // ── Step 2: Speed ──
    if (hasSpeed) {
      if (!isAudioOnly) {
        filters.push(`[${videoOut}]setpts=PTS/${speed}[sv_speed]`)
        videoOut = 'sv_speed'
      }
      const tempoFilters = buildTempoChain(speed)
      recAudioOuts.forEach((label, s) => {
        filters.push(`[${label}]${tempoFilters}[sa${s}_speed]`)
        recAudioOuts[s] = `sa${s}_speed`
      })
      if (needsAudio && recordingAudio.length === 0) {
        filters.push(`[${audioOut}]${tempoFilters}[sa_speed]`)
        audioOut = 'sa_speed'
      }
    }

    // ── Step 2b: Per-source volume, then mix recording-audio sources ──
    recAudioOuts.forEach((label, s) => {
      if (recordingAudio[s].volume !== 1.0) {
        filters.push(`[${label}]volume=${recordingAudio[s].volume}[sa${s}_vol]`)
        recAudioOuts[s] = `sa${s}_vol`
      }
    })
    if (recAudioOuts.length === 1) {
      audioOut = recAudioOuts[0]
    } else if (recAudioOuts.length > 1) {
      // Mix mic + system. normalize=0 keeps the user's per-track volumes
      // intact (amix's default normalize would silently halve everything),
      // but summing two near-full-scale sources can exceed 0 dBFS, so a
      // soft limiter catches the peaks instead of letting them hard-clip.
      // duration=longest avoids truncating the system track if it ran a few
      // ms longer than the mic.
      filters.push(`${recAudioOuts.map((l) => `[${l}]`).join('')}amix=inputs=${recAudioOuts.length}:duration=longest:normalize=0,alimiter=limit=0.97[sa_recmix]`)
      audioOut = 'sa_recmix'
    }

    // ── Step 3: Crop ──
    if (!isAudioOnly && hasCrop) {
      const cropW = Math.round(screenInfo.width * crop.width)
      const cropH = Math.round(screenInfo.height * crop.height)
      const cropX = Math.round(screenInfo.width * crop.x)
      const cropY = Math.round(screenInfo.height * crop.y)
      // Ensure even dimensions
      const cw = cropW % 2 === 0 ? cropW : cropW - 1
      const ch = cropH % 2 === 0 ? cropH : cropH - 1
      filters.push(`[${videoOut}]crop=${cw}:${ch}:${cropX}:${cropY}[sv_crop]`)
      videoOut = 'sv_crop'
    }

    // ── Step 3b: Background blur ──
    if (!isAudioOnly && backgroundBlur && backgroundBlur.enabled) {
      const blurStrength = backgroundBlur.strength || 10
      // Apply box blur (luma + chroma)
      filters.push(`[${videoOut}]boxblur=${blurStrength}:${blurStrength}[sv_blur]`)
      videoOut = 'sv_blur'
    }

    // ── Step 3c: Cursor spotlight (vignette) ──
    if (!isAudioOnly && cursorSpotlight && cursorSpotlight.enabled) {
      const intensity = cursorSpotlight.intensity || 0.4
      // vignette: angle is PI/2 * intensity, larger = more darkening at edges
      const angle = `PI/2*${intensity}`
      filters.push(`[${videoOut}]vignette=${angle}[sv_vig]`)
      videoOut = 'sv_vig'
    }

    // ── Step 3d: Zoom keyframes ──
    if (!isAudioOnly && zoomKeyframes.length > 0) {
      // Apply zoom using zoompan filter
      // Each keyframe: { time, x, y, zoom, duration }
      // Build a zoompan expression that interpolates between keyframes
      const sorted = [...zoomKeyframes].sort((a, b) => a.time - b.time)
      // zoompan re-times its output to the given fps (frame count is
      // preserved, d=1). The stream at this point is already sped up, so
      // the output rate must be capture-fps × speed — otherwise zoompan
      // stretches the video back to 1× and desyncs it from the audio.
      const fps = 30 * speed
      const zoomExprs = []
      const xExprs = []
      const yExprs = []

      for (const kf of sorted) {
        // Map keyframe timing through cuts + speed
        const mappedStart = mapTimeToOutput(kf.time || 0, keepSegments) / speed
        const mappedEnd = mapTimeToOutput((kf.time || 0) + (kf.duration || 2), keepSegments) / speed
        const startFrame = Math.round(mappedStart * fps)
        const endFrame = Math.round(mappedEnd * fps)
        const z = kf.zoom || 1.5
        const cx = kf.x != null ? kf.x : 0.5
        const cy = kf.y != null ? kf.y : 0.5

        // Smooth zoom in then out over the keyframe duration
        zoomExprs.push(
          `if(between(on,${startFrame},${endFrame}),` +
          `1+(${z}-1)*sin((on-${startFrame})/(${endFrame}-${startFrame})*PI),`
        )
        xExprs.push(
          `if(between(on,${startFrame},${endFrame}),` +
          `(iw-iw/zoom)*${cx},`
        )
        yExprs.push(
          `if(between(on,${startFrame},${endFrame}),` +
          `(ih-ih/zoom)*${cy},`
        )
      }

      // Default: no zoom
      const zoomExpr = zoomExprs.join('') + '1' + ')'.repeat(zoomExprs.length)
      const xExpr = xExprs.join('') + '0' + ')'.repeat(xExprs.length)
      const yExpr = yExprs.join('') + '0' + ')'.repeat(yExprs.length)

      const refW = hasCrop ? Math.round(screenInfo.width * crop.width) : screenInfo.width
      const refH = hasCrop ? Math.round(screenInfo.height * crop.height) : screenInfo.height
      const zw = refW % 2 === 0 ? refW : refW - 1
      const zh = refH % 2 === 0 ? refH : refH - 1

      filters.push(`[${videoOut}]zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${zw}x${zh}:fps=${fps}[sv_zoom]`)
      videoOut = 'sv_zoom'
    }

    // ── Step 4: Webcam overlay ──
    if (!isAudioOnly && hasWebcam) {
      const size = edit.webcamSize || 0.2
      const pos = edit.webcamPosition || 'bottom-right'
      const shape = edit.webcamShape || 'circle'

      // Use crop dimensions if cropping, otherwise screen dimensions
      const refWidth = hasCrop ? Math.round(screenInfo.width * crop.width) : screenInfo.width
      const wcPixels = Math.round(refWidth * size)
      const wcSize = wcPixels % 2 === 0 ? wcPixels : wcPixels + 1

      let overlayX, overlayY
      switch (pos) {
        case 'top-left':    overlayX = '20'; overlayY = '20'; break
        case 'top-right':   overlayX = 'W-w-20'; overlayY = '20'; break
        case 'bottom-left': overlayX = '20'; overlayY = 'H-h-20'; break
        default:            overlayX = 'W-w-20'; overlayY = 'H-h-20'; break
      }

      if (hasCuts) {
        const wcParts = []
        keepSegments.forEach((seg, i) => {
          filters.push(`[${webcamInputIdx}:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[wv${i}]`)
          wcParts.push(`[wv${i}]`)
        })
        if (keepSegments.length > 1) {
          filters.push(`${wcParts.join('')}concat=n=${keepSegments.length}:v=1:a=0[wv_concat]`)
          filters.push(buildWebcamFilter('wv_concat', shape, wcSize, 'wc'))
        } else {
          filters.push(buildWebcamFilter('wv0', shape, wcSize, 'wc'))
        }
      } else {
        filters.push(`[${webcamInputIdx}:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS[wv_trim]`)
        filters.push(buildWebcamFilter('wv_trim', shape, wcSize, 'wc'))
      }

      if (hasSpeed) {
        filters.push(`[wc]setpts=PTS/${speed}[wc_speed]`)
        filters.push(`[${videoOut}][wc_speed]overlay=${overlayX}:${overlayY}[vwc]`)
      } else {
        filters.push(`[${videoOut}][wc]overlay=${overlayX}:${overlayY}[vwc]`)
      }
      videoOut = 'vwc'
    }

    // ── Step 5: Image overlays ──
    for (let i = 0; !isAudioOnly && i < imageAssetInputs.length; i++) {
      const { layer } = imageAssetInputs[i]
      const inputIdx = imageInputMap[i]

      // Scale image to percentage of video width
      const imgWidth = Math.round((hasCrop ? screenInfo.width * crop.width : screenInfo.width) * (layer.width || 0.15))
      const imgW = imgWidth % 2 === 0 ? imgWidth : imgWidth + 1

      // Compute position in pixels
      const posX = Math.round((hasCrop ? screenInfo.width * crop.width : screenInfo.width) * (layer.x || 0))
      const posY = Math.round((hasCrop ? screenInfo.height * crop.height : screenInfo.height) * (layer.y || 0))

      // Map timing through cuts + speed
      const startTime = layer.startTime || 0
      const endTime = layer.endTime || outputDuration
      const outStart = mapTimeToOutput(startTime, keepSegments) / speed
      const outEnd = layer.endTime != null ? mapTimeToOutput(endTime, keepSegments) / speed : outputDuration

      const label = `img${i}`
      filters.push(`[${inputIdx}:v]scale=${imgW}:-1[${label}_s]`)
      filters.push(`[${videoOut}][${label}_s]overlay=${posX}:${posY}:enable='between(t,${outStart.toFixed(3)},${outEnd.toFixed(3)})'[${label}_out]`)
      videoOut = `${label}_out`
    }

    // ── Step 6: Text overlays (captions + text layers) ──
    const allTextItems = [
      ...textLayers.map((t) => ({ ...t, type: 'text' })),
      ...captions.map((c) => ({ ...c, type: 'caption', x: 0.5, y: 0.9, fontSize: c.fontSize || 20, color: c.color || '#ffffff', background: c.background || 'black@0.5' }))
    ]

    for (let i = 0; !isAudioOnly && i < allTextItems.length; i++) {
      const item = allTextItems[i]
      const outStart = mapTimeToOutput(item.startTime || 0, keepSegments) / speed
      const outEnd = item.endTime != null ? mapTimeToOutput(item.endTime, keepSegments) / speed : outputDuration

      // Escape text for FFmpeg drawtext (backslashes first, then special chars)
      const escapedText = (item.text || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')

      const fontSize = item.fontSize || 24
      const color = item.color || 'white'
      // Position: x and y are 0-1 fractions
      const xExpr = item.type === 'caption' ? '(w-text_w)/2' : `w*${item.x || 0.5}-text_w/2`
      const yExpr = item.type === 'caption' ? `h*${item.y || 0.9}-text_h` : `h*${item.y || 0.5}-text_h/2`

      let drawtext = `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${color}:x=${xExpr}:y=${yExpr}`

      // Background box for captions
      if (item.background || item.type === 'caption') {
        drawtext += `:box=1:boxcolor=${item.background || 'black@0.5'}:boxborderw=8`
      }

      if (item.fontWeight === 'bold') {
        drawtext += ':font=Arial Bold'
      }

      drawtext += `:enable='between(t,${outStart.toFixed(3)},${outEnd.toFixed(3)})'`

      const label = `txt${i}`
      filters.push(`[${videoOut}]${drawtext}[${label}]`)
      videoOut = label
    }

    // ── Step 7: Audio mixing ──
    // Recording-audio volumes were applied in Step 2b; here we mix in any
    // imported audio layers (music, SFX).
    if (needsAudio && audioAssetInputs.length > 0) {
      // Auto-ducking: layers marked duckUnderVoice are sidechain-compressed
      // against the recording audio (the "voice"), so music drops whenever
      // someone speaks. Each ducked layer needs its own copy of the voice
      // track as a compressor key.
      const hasVoice = recordingAudio.length > 0
      const duckedCount = hasVoice
        ? audioAssetInputs.filter(({ layer }) => layer.duckUnderVoice).length
        : 0
      if (duckedCount > 0) {
        const splitOuts = ['[a_voice_main]']
        for (let k = 0; k < duckedCount; k++) splitOuts.push(`[a_key${k}]`)
        filters.push(`[${audioOut}]asplit=${duckedCount + 1}${splitOuts.join('')}`)
        audioOut = 'a_voice_main'
      }

      // Mix imported audio layers with recording audio
      const audioLabels = [`[${audioOut}]`]
      let keyIdx = 0
      for (let i = 0; i < audioAssetInputs.length; i++) {
        const { layer, assetDuration } = audioAssetInputs[i]
        const inputIdx = audioInputMap[i]
        const vol = layer.volume != null ? layer.volume : 0.3
        const delay = Math.round((layer.startTime || 0) * 1000) // adelay uses ms

        // Fades run in the asset's own time (before adelay shifts it)
        let chain = `volume=${vol}`
        const fadeIn = layer.fadeIn || 0
        const fadeOut = layer.fadeOut || 0
        if (fadeIn > 0) {
          chain += `,afade=t=in:st=0:d=${fadeIn}`
        }
        if (fadeOut > 0) {
          if (assetDuration > fadeOut) {
            chain += `,afade=t=out:st=${(assetDuration - fadeOut).toFixed(3)}:d=${fadeOut}`
          } else {
            // Duration unknown (probe failed) — fade out anchored to the end
            // of the stream via the reverse trick, so the fade is never
            // silently dropped. areverse buffers the layer, which is fine
            // for music/SFX beds.
            chain += `,areverse,afade=t=in:st=0:d=${fadeOut},areverse`
          }
        }
        chain += `,adelay=${delay}|${delay}`

        let label = `aud${i}`
        filters.push(`[${inputIdx}:a]${chain}[${label}]`)

        if (layer.duckUnderVoice && duckedCount > 0) {
          filters.push(`[${label}][a_key${keyIdx}]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[${label}_ducked]`)
          label = `${label}_ducked`
          keyIdx++
        }
        audioLabels.push(`[${label}]`)
      }

      filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=2:normalize=0[amixed]`)
      audioOut = 'amixed'
    }

    // ── Step 7b: Output reframe / scaling ──
    const refWidth2 = hasCrop ? Math.round(screenInfo.width * crop.width) : screenInfo.width
    const refHeight2 = hasCrop ? Math.round(screenInfo.height * crop.height) : screenInfo.height
    let fw = refWidth2 % 2 === 0 ? refWidth2 : refWidth2 - 1
    let fh = refHeight2 % 2 === 0 ? refHeight2 : refHeight2 - 1

    if (!isAudioOnly && targetWidth && targetHeight) {
      // Social preset: exact WxH output. Same aspect → plain scale; aspect
      // change → blur-fill (video fit inside a blurred copy of itself) or
      // center-crop to fill, per fillMode.
      const tw = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1
      const th = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1
      if (tw !== fw || th !== fh) {
        const sameAspect = Math.abs(fw / fh - tw / th) < 0.01
        // setsar=1 keeps square pixels — the scale/crop math can otherwise
        // yield a non-1:1 SAR that breaks the intro/outro concat (which
        // requires every segment's SAR to match the 1:1 card sources).
        if (sameAspect) {
          filters.push(`[${videoOut}]scale=${tw}:${th}:flags=lanczos,setsar=1[v_reframe]`)
        } else if (fillMode === 'crop') {
          filters.push(`[${videoOut}]scale=${tw}:${th}:force_original_aspect_ratio=increase:flags=lanczos,crop=${tw}:${th},setsar=1[v_reframe]`)
        } else {
          filters.push(`[${videoOut}]split=2[v_bgsrc][v_fgsrc]`)
          filters.push(`[v_bgsrc]scale=${tw}:${th}:force_original_aspect_ratio=increase:flags=lanczos,crop=${tw}:${th},boxblur=20:20[v_bg]`)
          filters.push(`[v_fgsrc]scale=${tw}:${th}:force_original_aspect_ratio=decrease:flags=lanczos[v_fg]`)
          filters.push(`[v_bg][v_fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v_reframe]`)
        }
        videoOut = 'v_reframe'
        fw = tw
        fh = th
      }
    }

    // Proportional height cap (resolution dropdown) — composes on top of any
    // social reframe above.
    if (!isAudioOnly && capHeight && capHeight < fh) {
      const scaledW = Math.round(fw * (capHeight / fh))
      fw = scaledW % 2 === 0 ? scaledW : scaledW - 1
      fh = capHeight % 2 === 0 ? capHeight : capHeight - 1
      filters.push(`[${videoOut}]scale=${fw}:${fh}:flags=lanczos,setsar=1[v_resized]`)
      videoOut = 'v_resized'
    }

    // ── Step 7c: Loudness normalization ──
    // Applied to the mixed CONTENT audio before any intro/outro silence is
    // concatenated around it — otherwise loudnorm's measurement window
    // includes the leading/trailing silent cards and skews the gain,
    // producing an audible level ramp at the start of real content.
    if (needsAudio && normalizeLoudness) {
      filters.push(`[${audioOut}]loudnorm=I=-14:TP=-1.5:LRA=11[a_norm]`)
      audioOut = 'a_norm'
    }

    // ── Step 8: Intro/outro title cards ──
    // Visual-only — skipped for audio-only formats.
    if (!isAudioOnly && (introCard || outroCard)) {
      // Ensure main content dimensions match title cards for concat
      filters.push(`[${videoOut}]scale=${fw}:${fh}:force_original_aspect_ratio=disable[v_scaled]`)
      videoOut = 'v_scaled'

      // concat requires every segment's audio to share sample rate, format,
      // and channel layout. Upstream filters (notably loudnorm, which emits
      // 192 kHz) and the silent card sources would otherwise mismatch, so we
      // force a common format on the content audio and on each card's silence.
      // GIF/PNG carry no audio (needsAudio === false), so we concat video-only
      // and skip every audio leg — otherwise we'd reference an undefined
      // audioOut label and FFmpeg would reject the filtergraph.
      const AFMT = 'aformat=sample_rates=48000:channel_layouts=stereo'
      if (needsAudio) {
        filters.push(`[${audioOut}]${AFMT}[a_concat_main]`)
        audioOut = 'a_concat_main'
      }

      const concatParts = []
      const concatAudioParts = []
      let partCount = 0

      if (introCard) {
        const dur = introCard.duration || 3
        const bg = (introCard.bgColor || '#000000').replace('#', '')
        const titleText = escapeDrawtext(introCard.title)
        const subtitleText = escapeDrawtext(introCard.subtitle)
        const titleColor = introCard.titleColor || 'white'
        const subtitleColor = introCard.subtitleColor || 'gray'

        let introFilter = `color=c=0x${bg}:s=${fw}x${fh}:d=${dur}:r=30[intro_bg]`
        filters.push(introFilter)

        let introLabel = 'intro_bg'
        if (titleText) {
          filters.push(`[${introLabel}]drawtext=text='${titleText}':fontsize=48:fontcolor=${titleColor}:x=(w-text_w)/2:y=(h-text_h)/2${subtitleText ? '-30' : ''}[intro_t]`)
          introLabel = 'intro_t'
        }
        if (subtitleText) {
          filters.push(`[${introLabel}]drawtext=text='${subtitleText}':fontsize=24:fontcolor=${subtitleColor}:x=(w-text_w)/2:y=(h+text_h)/2+10[intro_s]`)
          introLabel = 'intro_s'
        }

        concatParts.push(`[${introLabel}]`)
        // Silent audio for intro (matched to the content audio format)
        if (needsAudio) {
          filters.push(`aevalsrc=0:d=${dur},${AFMT}[intro_a]`)
          concatAudioParts.push(`[intro_a]`)
        }
        partCount++
      }

      // Main content
      concatParts.push(`[${videoOut}]`)
      if (needsAudio) concatAudioParts.push(`[${audioOut}]`)
      partCount++

      if (outroCard) {
        const dur = outroCard.duration || 3
        const bg = (outroCard.bgColor || '#000000').replace('#', '')
        const titleText = escapeDrawtext(outroCard.title)
        const subtitleText = escapeDrawtext(outroCard.subtitle)
        const titleColor = outroCard.titleColor || 'white'
        const subtitleColor = outroCard.subtitleColor || 'gray'

        let outroFilter = `color=c=0x${bg}:s=${fw}x${fh}:d=${dur}:r=30[outro_bg]`
        filters.push(outroFilter)

        let outroLabel = 'outro_bg'
        if (titleText) {
          filters.push(`[${outroLabel}]drawtext=text='${titleText}':fontsize=48:fontcolor=${titleColor}:x=(w-text_w)/2:y=(h-text_h)/2${subtitleText ? '-30' : ''}[outro_t]`)
          outroLabel = 'outro_t'
        }
        if (subtitleText) {
          filters.push(`[${outroLabel}]drawtext=text='${subtitleText}':fontsize=24:fontcolor=${subtitleColor}:x=(w-text_w)/2:y=(h+text_h)/2+10[outro_s]`)
          outroLabel = 'outro_s'
        }

        concatParts.push(`[${outroLabel}]`)
        if (needsAudio) {
          filters.push(`aevalsrc=0:d=${dur},${AFMT}[outro_a]`)
          concatAudioParts.push(`[outro_a]`)
        }
        partCount++
      }

      // Concat all parts. The concat filter requires inputs interleaved per
      // segment ([v0][a0][v1][a1]…), NOT all video then all audio. For
      // audio-bearing formats we emit a v+a concat; for GIF/PNG (no audio) we
      // emit a video-only concat so there are no dangling audio legs.
      if (needsAudio) {
        const interleaved = concatParts.map((v, i) => v + concatAudioParts[i]).join('')
        filters.push(`${interleaved}concat=n=${partCount}:v=1:a=1[v_final][a_final]`)
        audioOut = 'a_final'
      } else {
        filters.push(`${concatParts.join('')}concat=n=${partCount}:v=1[v_final]`)
      }
      videoOut = 'v_final'
    }

    // ── Step 9: Per-format output adaptation ──
    // The filter graph above produced the final `videoOut` / `audioOut` labels
    // (the full overlay/effect chain for visual formats, just the audio half
    // for audio-only). Now we tailor the mapping + codecs to the target format.
    const outputOptions = []

    if (isAudioOnly) {
      // Strip video entirely — map only the audio output.
      outputOptions.push(`-map [${audioOut}]`)
      if (format === 'mp3') {
        const abr = options.quality === 'high' ? '256k' : options.quality === 'small' ? '128k' : '192k'
        outputOptions.push('-c:a', 'libmp3lame', '-b:a', abr)
      } else {
        // m4a → AAC
        const abr = options.quality === 'high' ? '256k' : options.quality === 'small' ? '128k' : '192k'
        outputOptions.push('-c:a', 'aac', '-b:a', abr, '-movflags', '+faststart')
      }
    } else if (isPng) {
      // Single PNG frame grab at the requested output-time (default: the last
      // position). Seek within the produced stream, then emit exactly one frame.
      const grabTime = options.pngTime != null
        ? Math.max(0, options.pngTime)
        : Math.max(0, outputDuration - 0.1)
      filters.push(`[${videoOut}]trim=start=${grabTime.toFixed(3)},setpts=PTS-STARTPTS[v_png]`)
      videoOut = 'v_png'
      outputOptions.push(`-map [${videoOut}]`, '-frames:v', '1')
    } else if (isGif) {
      // GIF reuses the full visual graph (overlays/effects included), then adds
      // the standard fps+scale and a high-quality palette. split→palettegen→
      // paletteuse performs the 2-pass palette technique in a single command:
      // palettegen sees the whole downscaled stream, so colours stay accurate.
      filters.push(`[${videoOut}]fps=15,scale=640:-2:flags=lanczos,split[gif_a][gif_b]`)
      filters.push(`[gif_a]palettegen=stats_mode=diff[gif_pal]`)
      filters.push(`[gif_b][gif_pal]paletteuse=dither=bayer:bayer_scale=5[gifout]`)
      videoOut = 'gifout'
      outputOptions.push(`-map [${videoOut}]`, '-loop', '0')
    } else if (format === 'webm') {
      // WebM: VP9 video + Opus audio.
      const vp9crf = VP9_CRF_BY_QUALITY[options.quality] || VP9_CRF_BY_QUALITY.balanced
      outputOptions.push(
        `-map [${videoOut}]`,
        `-map [${audioOut}]`,
        '-c:v', 'libvpx-vp9',
        '-crf', String(vp9crf),
        '-b:v', '0',
        '-row-mt', '1',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'libopus',
        '-b:a', '128k'
      )
    } else if (format === 'hevc') {
      outputOptions.push(`-map [${videoOut}]`, `-map [${audioOut}]`, ...videoCodecOptions,
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart')
    } else {
      // mp4 (H.264) — default. Encoder is hardware-accelerated when opted in,
      // with automatic libx264 fallback (resolved into videoCodecOptions above).
      outputOptions.push(`-map [${videoOut}]`, `-map [${audioOut}]`, ...videoCodecOptions,
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart')
    }

    command = command.complexFilter(filters.join(';'))
    command = command.outputOptions(outputOptions)

    command
      .output(outputPath)
      .on('start', (cmd) => {
        console.log('FFmpeg command:', cmd)
      })
      .on('progress', (p) => {
        if (onProgress && p.percent) {
          onProgress(Math.min(100, Math.round(p.percent)))
        }
      })
      .on('end', () => {
        console.log('FFmpeg export complete:', outputPath)
        resolve(outputPath)
      })
      .on('error', (err, stdout, stderr) => {
        console.error('FFmpeg error:', err.message)
        if (stderr) console.error('FFmpeg stderr:', stderr)
        reject(err)
      })
      .run()
  })
}

/**
 * GIF export now runs through the unified pipeline (runExport) so it includes
 * the full visual filter graph — webcam, text/image overlays, blur, vignette,
 * zoom and title cards — instead of the old reduced trim/cut/speed/crop-only
 * pass. The fps+scale and 2-pass palette (split→palettegen→paletteuse) are
 * appended in runExport's per-format output stage.
 */
export async function exportGif(projectPath, project, onProgress, options = {}) {
  return runExport(projectPath, project, onProgress, { ...options, format: 'gif' })
}

/**
 * Multi-clip timeline export: concatenate the video clips on the timeline
 * (which may come from different source files) into one output, each clip
 * trimmed to its in/out, speed-adjusted, and letterboxed onto a common canvas.
 *
 * Audio is assembled in lockstep with the video concat: each clip contributes
 * the recording's mic/system tracks when it's a screen segment (the screen
 * master is video-only, so its narration lives in the separate mic.webm), its
 * own embedded audio when it's an imported clip, or generated silence. Imported
 * music/SFX tracks are overlaid on the finished mix, and loudness normalization
 * is applied last. Export resolution presets (social WxH + height cap) are
 * honored exactly as in the single-source pipeline.
 *
 * Still deferred to the full timeline rewrite (and only logged here, not
 * rendered): visual overlays (text/image/captions), intro/outro title cards,
 * and the webcam bubble.
 *
 * @param {object} model  the RenderModel (master files) from buildRenderModel
 */
async function exportTimelineClips(projectPath, project, model, onProgress, options = {}) {
  const format = options.format || 'mp4'
  const media = project.media || {}
  const segments = model.videoSegments.filter((s) => s.sourceFile)
  if (segments.length === 0) throw new Error('No clips to export')

  // Resolve absolute source paths and validate they exist.
  for (const seg of segments) {
    seg._abs = join(projectPath, seg.sourceFile)
    if (!existsSync(seg._abs)) throw new Error(`Clip source not found: ${seg.sourceFile}`)
  }

  const crf = CRF_BY_QUALITY[options.quality] || CRF_BY_QUALITY.balanced
  const normalizeLoudness = !!options.normalizeLoudness
  const isGif = format === 'gif'
  const isAudioOnly = AUDIO_ONLY_FORMATS.has(format)
  const isPng = format === 'png'
  const needsVideo = !isAudioOnly
  const needsAudio = !isPng && !isGif

  // Single probe per clip: canvas dimensions (first clip) + audio presence.
  for (const seg of segments) {
    try {
      const info = await probeVideo(seg._abs)
      seg._hasAudio = !!info.hasAudio
      seg._w = info.width
      seg._h = info.height
    } catch {
      seg._hasAudio = false
    }
  }
  // Canvas size: the first clip's dimensions, made even. Other clips are scaled
  // to fit and letterboxed, so mixed aspect ratios concat cleanly.
  let W = (segments[0]._w || 1920) - ((segments[0]._w || 1920) % 2)
  let H = (segments[0]._h || 1080) - ((segments[0]._h || 1080) % 2)

  // Output sizing presets (identical semantics to runExport): a social WxH box
  // (blur-fill or center-crop) composes with a proportional height cap.
  const targetWidth = options.targetWidth || null
  const targetHeight = options.targetHeight || null
  const capHeight = options.resolution === '1080p' ? 1080
    : options.resolution === '720p' ? 720
    : null
  const fillMode = options.fillMode === 'crop' ? 'crop' : 'blur'

  // Recording audio (mic/system) follows the screen-derived segments; imported
  // music/SFX overlay the whole timeline. buildRenderModel already excludes
  // muted tracks, so anything present here should be heard.
  const recordingAudio = (model.audioSegments || [])
    .filter((a) => (a.mediaId === 'mic' || a.mediaId === 'system') && a.sourceFile)
    .map((a) => ({ ...a, _abs: join(projectPath, a.sourceFile) }))
    .filter((a) => existsSync(a._abs))
  const importedAudio = (model.audioSegments || [])
    .filter((a) => a.imported && a.sourceFile)
    .map((a) => ({ ...a, _abs: join(projectPath, 'assets', a.sourceFile) }))
    .filter((a) => existsSync(a._abs))

  // Warn (don't silently drop) about content this path can't render yet.
  const deferred = []
  if ((model.overlays || []).length) deferred.push(`${model.overlays.length} overlay(s)/caption(s)`)
  if (model.cards && (model.cards.intro || model.cards.outro)) deferred.push('intro/outro card(s)')
  if (model.webcam) deferred.push('webcam bubble')
  if (deferred.length) {
    console.warn(`Multi-clip export does not yet render: ${deferred.join(', ')} — these are omitted from the output.`)
  }

  // Resolve encoder options up front (async; can't run inside the executor).
  let videoCodecOptions = null
  if (needsVideo && format === 'hevc') videoCodecOptions = await buildHevcVideoOptions(options, crf, options.quality)
  else if (needsVideo && (format === 'mp4' || (!isGif && !isPng && format !== 'webm'))) {
    videoCodecOptions = await buildH264VideoOptions(options, crf, options.quality)
  }

  const outputDir = join(projectPath, 'exports')
  await mkdir(outputDir, { recursive: true })
  const safeLabel = (options.label || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  const ext = FORMAT_EXT[format] || 'mp4'
  const outputPath = join(outputDir, `export${safeLabel ? `-${safeLabel}` : ''}-${Date.now()}.${ext}`)

  return new Promise((resolve, reject) => {
    let command = ffmpeg()
    // Inputs 0..N-1 are the video clips, in order.
    segments.forEach((seg) => { command = command.input(seg._abs) })
    // Extra audio inputs are appended on demand; the same source file can be
    // added multiple times (once per screen segment) so we never have to split
    // a shared input pad across the graph.
    let nextInputIdx = segments.length
    const addInput = (absPath) => { command = command.input(absPath); return nextInputIdx++ }

    const filters = []
    const vParts = []
    const aParts = []

    segments.forEach((seg, i) => {
      const speed = seg.speed || 1
      const sIn = seg.sourceIn
      const sOut = seg.sourceOut
      const outDur = (sOut - sIn) / speed
      const tempo = speed !== 1 ? `,${buildTempoChain(speed)}` : ''

      if (needsVideo) {
        // Video: trim → reset PTS (with speed) → fit + letterbox to canvas → square SAR.
        filters.push(
          `[${i}:v]trim=start=${sIn}:end=${sOut},setpts=(PTS-STARTPTS)/${speed},` +
          `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
        )
        vParts.push(`[v${i}]`)
      }

      if (needsAudio) {
        const isScreen = media[seg.mediaId] && media[seg.mediaId].kind === 'screen'
        // apad+atrim forces the segment audio to exactly match the video length
        // so concat stays in lockstep even if a source stream is slightly short.
        const fit = `,apad,atrim=duration=${outDur.toFixed(3)},asetpts=PTS-STARTPTS`
        if (isScreen && recordingAudio.length) {
          // The screen master carries no audio — pull the separate mic/system
          // recordings, trimmed to this segment's source window and sped to match.
          const recLabels = recordingAudio.map((rec, k) => {
            const idx = addInput(rec._abs)
            const label = `ra${i}_${k}`
            filters.push(
              `[${idx}:a]atrim=start=${sIn}:end=${sOut},asetpts=PTS-STARTPTS${tempo},` +
              `aformat=sample_rates=48000:channel_layouts=stereo,volume=${rec.volume != null ? rec.volume : 1}[${label}]`
            )
            return `[${label}]`
          })
          if (recLabels.length > 1) {
            filters.push(`${recLabels.join('')}amix=inputs=${recLabels.length}:duration=longest:dropout_transition=0:normalize=0${fit}[a${i}]`)
          } else {
            filters.push(`${recLabels[0]}aformat=sample_rates=48000:channel_layouts=stereo${fit}[a${i}]`)
          }
        } else if (seg._hasAudio) {
          filters.push(
            `[${i}:a]atrim=start=${sIn}:end=${sOut},asetpts=PTS-STARTPTS${tempo},` +
            `aformat=sample_rates=48000:channel_layouts=stereo${fit}[a${i}]`
          )
        } else {
          // Generate matching silence so every concat segment has an audio pad.
          filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${outDur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`)
        }
        aParts.push(`[a${i}]`)
      }
    })

    // Concat (interleaved per segment) — video and/or audio, depending on format.
    let videoOut = null
    let audioOut = null
    if (needsVideo && needsAudio) {
      const interleaved = segments.map((_, i) => `${vParts[i]}${aParts[i]}`).join('')
      filters.push(`${interleaved}concat=n=${segments.length}:v=1:a=1[vcat][acat]`)
      videoOut = 'vcat'; audioOut = 'acat'
    } else if (needsVideo) {
      filters.push(`${vParts.join('')}concat=n=${segments.length}:v=1:a=0[vcat]`)
      videoOut = 'vcat'
    } else {
      // Audio-only (mp3/m4a): no video graph at all — concat audio only. This
      // is what keeps FFmpeg from aborting on an unmapped [vcat] pad.
      filters.push(`${aParts.join('')}concat=n=${segments.length}:v=0:a=1[acat]`)
      audioOut = 'acat'
    }

    // Imported music/SFX beds overlay the whole timeline (output-time coords).
    if (needsAudio && importedAudio.length && audioOut) {
      const bedLabels = importedAudio.map((a, k) => {
        const idx = addInput(a._abs)
        const delayMs = Math.max(0, Math.round((a.timelineStart || 0) * 1000))
        const label = `bed${k}`
        filters.push(
          `[${idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,` +
          `volume=${a.volume != null ? a.volume : 0.3},adelay=${delayMs}|${delayMs}[${label}]`
        )
        return `[${label}]`
      })
      // duration=first keeps the output the length of the concatenated timeline.
      filters.push(`[${audioOut}]${bedLabels.join('')}amix=inputs=${bedLabels.length + 1}:duration=first:dropout_transition=0:normalize=0[amixed]`)
      audioOut = 'amixed'
    }

    // Output reframe / scaling (social preset + height cap), mirrors runExport.
    if (needsVideo && videoOut) {
      if (targetWidth && targetHeight) {
        const tw = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1
        const th = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1
        if (tw !== W || th !== H) {
          const sameAspect = Math.abs(W / H - tw / th) < 0.01
          if (sameAspect) {
            filters.push(`[${videoOut}]scale=${tw}:${th}:flags=lanczos,setsar=1[v_reframe]`)
          } else if (fillMode === 'crop') {
            filters.push(`[${videoOut}]scale=${tw}:${th}:force_original_aspect_ratio=increase:flags=lanczos,crop=${tw}:${th},setsar=1[v_reframe]`)
          } else {
            filters.push(`[${videoOut}]split=2[v_bgsrc][v_fgsrc]`)
            filters.push(`[v_bgsrc]scale=${tw}:${th}:force_original_aspect_ratio=increase:flags=lanczos,crop=${tw}:${th},boxblur=20:20[v_bg]`)
            filters.push(`[v_fgsrc]scale=${tw}:${th}:force_original_aspect_ratio=decrease:flags=lanczos[v_fg]`)
            filters.push(`[v_bg][v_fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v_reframe]`)
          }
          videoOut = 'v_reframe'; W = tw; H = th
        }
      }
      if (capHeight && capHeight < H) {
        const scaledW = Math.round(W * (capHeight / H))
        W = scaledW % 2 === 0 ? scaledW : scaledW - 1
        H = capHeight % 2 === 0 ? capHeight : capHeight - 1
        filters.push(`[${videoOut}]scale=${W}:${H}:flags=lanczos,setsar=1[v_resized]`)
        videoOut = 'v_resized'
      }
    }

    // Loudness normalization runs last, on the fully mixed audio.
    if (needsAudio && normalizeLoudness && audioOut) {
      filters.push(`[${audioOut}]loudnorm=I=-14:TP=-1.5:LRA=11[anorm]`)
      audioOut = 'anorm'
    }

    // Per-format output adaptation (mirrors runExport's output stage).
    const outputOptions = []
    if (isAudioOnly) {
      const abr = options.quality === 'high' ? '256k' : options.quality === 'small' ? '128k' : '192k'
      outputOptions.push(`-map [${audioOut}]`)
      if (format === 'mp3') outputOptions.push('-c:a', 'libmp3lame', '-b:a', abr)
      else outputOptions.push('-c:a', 'aac', '-b:a', abr, '-movflags', '+faststart')
    } else if (isPng) {
      filters.push(`[${videoOut}]trim=start=0,setpts=PTS-STARTPTS[vpng]`)
      outputOptions.push('-map [vpng]', '-frames:v', '1')
    } else if (isGif) {
      filters.push(`[${videoOut}]fps=15,scale=640:-2:flags=lanczos,split[ga][gb]`)
      filters.push(`[ga]palettegen=stats_mode=diff[gp]`)
      filters.push(`[gb][gp]paletteuse=dither=bayer:bayer_scale=5[gout]`)
      outputOptions.push('-map [gout]', '-loop', '0')
    } else if (format === 'webm') {
      const vp9crf = VP9_CRF_BY_QUALITY[options.quality] || VP9_CRF_BY_QUALITY.balanced
      outputOptions.push(`-map [${videoOut}]`, `-map [${audioOut}]`, '-c:v', 'libvpx-vp9',
        '-crf', String(vp9crf), '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k')
    } else {
      // mp4 (H.264) and hevc both map video + AAC audio; videoCodecOptions was
      // resolved above for whichever encoder this format uses.
      outputOptions.push(`-map [${videoOut}]`, `-map [${audioOut}]`, ...(videoCodecOptions || []),
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart')
    }

    command
      .complexFilter(filters.join(';'))
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('start', (cmd) => console.log('FFmpeg (timeline) command:', cmd))
      .on('progress', (p) => { if (onProgress && p.percent) onProgress(Math.min(100, Math.round(p.percent))) })
      .on('end', () => { console.log('FFmpeg timeline export complete:', outputPath); resolve(outputPath) })
      .on('error', (err, stdout, stderr) => {
        console.error('FFmpeg (timeline) error:', err.message)
        if (stderr) console.error('FFmpeg stderr:', stderr)
        reject(err)
      })
      .run()
  })
}

/**
 * Detect silent segments in a video file using FFmpeg's silencedetect filter.
 * Returns array of { start, end } objects representing silent regions.
 */
export function detectSilence(videoPath, threshold = -30, minDuration = 0.5) {
  return new Promise((resolve, reject) => {
    const silences = []
    let currentStart = null

    ffmpeg(videoPath)
      .audioFilters(`silencedetect=noise=${threshold}dB:d=${minDuration}`)
      .format('null')
      .output('-')
      .on('stderr', (line) => {
        // Parse silencedetect output from stderr
        const startMatch = line.match(/silence_start:\s*([\d.]+)/)
        const endMatch = line.match(/silence_end:\s*([\d.]+)/)

        if (startMatch) {
          currentStart = parseFloat(startMatch[1])
        }
        if (endMatch && currentStart !== null) {
          silences.push({
            start: currentStart,
            end: parseFloat(endMatch[1])
          })
          currentStart = null
        }
      })
      .on('end', () => {
        // Handle trailing silence (silence_start without matching silence_end)
        // This happens when silence extends to the end of the file
        if (currentStart !== null) {
          // We don't know the exact duration here, but the silence goes to the end
          // Use a large value; the caller should clamp to actual duration
          silences.push({ start: currentStart, end: currentStart + 9999 })
        }
        resolve(silences)
      })
      .on('error', (err) => {
        // silencedetect on files with no audio track will error
        if (err.message.includes('does not contain any stream') ||
            err.message.includes('no audio')) {
          resolve([])
        } else {
          reject(err)
        }
      })
      .run()
  })
}

/** Escape text for FFmpeg drawtext filter */
function escapeDrawtext(text) {
  return (text || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')
}

/** Build webcam shape filter (circle or rect) */
function buildWebcamFilter(inputLabel, shape, wcSize, outputLabel) {
  if (shape === 'circle') {
    return `[${inputLabel}]crop=min(iw\\,ih):min(iw\\,ih),scale=${wcSize}:${wcSize},format=yuva420p,geq=lum='p(X,Y)':a='if(lt((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2),(W/2-1)*(W/2-1)),255,0)'[${outputLabel}]`
  } else {
    return `[${inputLabel}]scale=${wcSize}:-2[${outputLabel}]`
  }
}

/** Build atempo filter chain for speeds outside 0.5-2.0 range */
function buildTempoChain(speed) {
  if (speed >= 0.5 && speed <= 2.0) {
    return `atempo=${speed}`
  }
  const parts = []
  let remaining = speed
  while (remaining > 2.0) {
    parts.push('atempo=2.0')
    remaining /= 2.0
  }
  while (remaining < 0.5) {
    parts.push('atempo=0.5')
    remaining /= 0.5
  }
  parts.push(`atempo=${remaining.toFixed(4)}`)
  return parts.join(',')
}

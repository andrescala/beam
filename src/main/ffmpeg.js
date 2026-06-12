import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { mkdir } from 'fs/promises'

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

export async function exportMp4(projectPath, project, onProgress, options = {}) {
  const screenPath = join(projectPath, project.recordings.screen)
  if (!existsSync(screenPath)) {
    throw new Error('Screen recording not found')
  }

  const crf = CRF_BY_QUALITY[options.quality] || CRF_BY_QUALITY.balanced
  // Output framing: either a full WxH target (social presets — reframed by
  // blur-fill padding or center-crop) or a proportional height cap (the
  // resolution dropdown).
  const targetWidth = options.targetWidth || null
  const targetHeight = options.targetHeight
    || (options.resolution === '1080p' ? 1080 : options.resolution === '720p' ? 720 : null)
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
  const outputPath = join(outputDir, `export${safeLabel ? `-${safeLabel}` : ''}-${timestamp}.mp4`)

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

    // ── Step 1b: Trim/cut each recording-audio source the same way ──
    const recAudioOuts = []
    recordingAudio.forEach((src, s) => {
      // FFT-based background-noise reduction on the mic, applied at the
      // source so it precedes trimming/speed/volume.
      const pre = src.denoise ? 'afftdn=nf=-25,' : ''
      if (hasCuts) {
        const aParts = []
        keepSegments.forEach((seg, i) => {
          filters.push(`${src.label}${pre}atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[sa${s}_${i}]`)
          aParts.push(`[sa${s}_${i}]`)
        })
        if (keepSegments.length > 1) {
          filters.push(`${aParts.join('')}concat=n=${keepSegments.length}:v=0:a=1[sa${s}_concat]`)
          recAudioOuts.push(`sa${s}_concat`)
        } else {
          recAudioOuts.push(`sa${s}_0`)
        }
      } else {
        filters.push(`${src.label}${pre}atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS[sa${s}_trim]`)
        recAudioOuts.push(`sa${s}_trim`)
      }
    })

    // If no audio source at all, generate a silent track so the output MP4
    // is well-formed.
    if (recordingAudio.length === 0) {
      const silenceDuration = computeOutputDuration(keepSegments)
      filters.push(`aevalsrc=0:d=${silenceDuration}[sa_silence]`)
      audioOut = 'sa_silence'
    }

    // ── Step 2: Speed ──
    if (hasSpeed) {
      filters.push(`[${videoOut}]setpts=PTS/${speed}[sv_speed]`)
      videoOut = 'sv_speed'
      const tempoFilters = buildTempoChain(speed)
      recAudioOuts.forEach((label, s) => {
        filters.push(`[${label}]${tempoFilters}[sa${s}_speed]`)
        recAudioOuts[s] = `sa${s}_speed`
      })
      if (recordingAudio.length === 0) {
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
      filters.push(`${recAudioOuts.map((l) => `[${l}]`).join('')}amix=inputs=${recAudioOuts.length}:duration=first:normalize=0[sa_recmix]`)
      audioOut = 'sa_recmix'
    }

    // ── Step 3: Crop ──
    if (hasCrop) {
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
    if (backgroundBlur && backgroundBlur.enabled) {
      const blurStrength = backgroundBlur.strength || 10
      // Apply box blur (luma + chroma)
      filters.push(`[${videoOut}]boxblur=${blurStrength}:${blurStrength}[sv_blur]`)
      videoOut = 'sv_blur'
    }

    // ── Step 3c: Cursor spotlight (vignette) ──
    if (cursorSpotlight && cursorSpotlight.enabled) {
      const intensity = cursorSpotlight.intensity || 0.4
      // vignette: angle is PI/2 * intensity, larger = more darkening at edges
      const angle = `PI/2*${intensity}`
      filters.push(`[${videoOut}]vignette=${angle}[sv_vig]`)
      videoOut = 'sv_vig'
    }

    // ── Step 3d: Zoom keyframes ──
    if (zoomKeyframes.length > 0) {
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
    if (hasWebcam) {
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
    for (let i = 0; i < imageAssetInputs.length; i++) {
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

    for (let i = 0; i < allTextItems.length; i++) {
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
    if (audioAssetInputs.length > 0) {
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
        if (fadeOut > 0 && assetDuration > fadeOut) {
          chain += `,afade=t=out:st=${(assetDuration - fadeOut).toFixed(3)}:d=${fadeOut}`
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

    if (targetWidth && targetHeight) {
      // Social preset: exact WxH output. Same aspect → plain scale; aspect
      // change → blur-fill (video fit inside a blurred copy of itself) or
      // center-crop to fill, per fillMode.
      const tw = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1
      const th = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1
      if (tw !== fw || th !== fh) {
        const sameAspect = Math.abs(fw / fh - tw / th) < 0.01
        if (sameAspect) {
          filters.push(`[${videoOut}]scale=${tw}:${th}:flags=lanczos[v_reframe]`)
        } else if (fillMode === 'crop') {
          filters.push(`[${videoOut}]scale=${tw}:${th}:force_original_aspect_ratio=increase:flags=lanczos,crop=${tw}:${th}[v_reframe]`)
        } else {
          filters.push(`[${videoOut}]split=2[v_bgsrc][v_fgsrc]`)
          filters.push(`[v_bgsrc]scale=${tw}:${th}:force_original_aspect_ratio=increase:flags=lanczos,crop=${tw}:${th},boxblur=20:20[v_bg]`)
          filters.push(`[v_fgsrc]scale=${tw}:${th}:force_original_aspect_ratio=decrease:flags=lanczos[v_fg]`)
          filters.push(`[v_bg][v_fg]overlay=(W-w)/2:(H-h)/2[v_reframe]`)
        }
        videoOut = 'v_reframe'
        fw = tw
        fh = th
      }
    } else if (targetHeight && targetHeight < fh) {
      // Proportional height cap (the resolution dropdown)
      const scaledW = Math.round(fw * (targetHeight / fh))
      fw = scaledW % 2 === 0 ? scaledW : scaledW - 1
      fh = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1
      filters.push(`[${videoOut}]scale=${fw}:${fh}:flags=lanczos[v_resized]`)
      videoOut = 'v_resized'
    }

    // ── Step 8: Intro/outro title cards ──

    if (introCard || outroCard) {
      // Ensure main content dimensions match title cards for concat
      filters.push(`[${videoOut}]scale=${fw}:${fh}:force_original_aspect_ratio=disable[v_scaled]`)
      videoOut = 'v_scaled'

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
        // Silent audio for intro
        filters.push(`aevalsrc=0:d=${dur}[intro_a]`)
        concatAudioParts.push(`[intro_a]`)
        partCount++
      }

      // Main content
      concatParts.push(`[${videoOut}]`)
      concatAudioParts.push(`[${audioOut}]`)
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
        filters.push(`aevalsrc=0:d=${dur}[outro_a]`)
        concatAudioParts.push(`[outro_a]`)
        partCount++
      }

      // Concat all parts. The concat filter requires inputs interleaved per
      // segment ([v0][a0][v1][a1]…), NOT all video then all audio.
      const interleaved = concatParts.map((v, i) => v + concatAudioParts[i]).join('')
      filters.push(`${interleaved}concat=n=${partCount}:v=1:a=1[v_final][a_final]`)
      videoOut = 'v_final'
      audioOut = 'a_final'
    }

    // ── Step 9: Loudness normalization (social/YouTube target) ──
    if (normalizeLoudness) {
      filters.push(`[${audioOut}]loudnorm=I=-14:TP=-1.5:LRA=11[a_norm]`)
      audioOut = 'a_norm'
    }

    command = command.complexFilter(filters.join(';'))
    command = command.outputOptions([
      `-map [${videoOut}]`,
      `-map [${audioOut}]`,
      '-c:v libx264',
      '-preset medium',
      `-crf ${crf}`,
      '-c:a aac',
      '-b:a 128k',
      '-movflags +faststart',
      '-pix_fmt yuv420p'
    ])

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

export async function exportGif(projectPath, project, onProgress) {
  const screenPath = join(projectPath, project.recordings.screen)
  if (!existsSync(screenPath)) {
    throw new Error('Screen recording not found')
  }

  const edit = project.edit || {}
  const trimStart = edit.trimStart || 0
  const trimEnd = edit.trimEnd || project.duration || 0
  const speed = edit.speed || 1.0
  const cuts = edit.cuts || []
  const crop = edit.crop || {}
  const hasCrop = crop.enabled && crop.aspectRatio !== 'original'

  const screenInfo = await probeVideo(screenPath)

  const outputDir = join(projectPath, 'exports')
  await mkdir(outputDir, { recursive: true })
  const timestamp = Date.now()
  const palettePath = join(outputDir, `palette-${timestamp}.png`)
  const outputPath = join(outputDir, `export-${timestamp}.gif`)

  const keepSegments = computeKeepSegments(trimStart, trimEnd, cuts)
  if (keepSegments.length === 0) {
    throw new Error('Nothing to export — all content has been cut')
  }

  return new Promise((resolve, reject) => {
    // Pass 1: Generate palette
    let cmd1 = ffmpeg().input(screenPath)
    const filters1 = []
    let videoLabel

    if (keepSegments.length > 1) {
      keepSegments.forEach((seg, i) => {
        filters1.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[gs${i}]`)
      })
      filters1.push(`${keepSegments.map((_, i) => `[gs${i}]`).join('')}concat=n=${keepSegments.length}:v=1:a=0[gconcat]`)
      videoLabel = 'gconcat'
    } else {
      filters1.push(`[0:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS[gtrim]`)
      videoLabel = 'gtrim'
    }

    if (speed !== 1.0) {
      filters1.push(`[${videoLabel}]setpts=PTS/${speed}[gspeed]`)
      videoLabel = 'gspeed'
    }

    if (hasCrop) {
      const cw = Math.round(screenInfo.width * crop.width)
      const ch = Math.round(screenInfo.height * crop.height)
      const cx = Math.round(screenInfo.width * crop.x)
      const cy = Math.round(screenInfo.height * crop.y)
      filters1.push(`[${videoLabel}]crop=${cw - cw % 2}:${ch - ch % 2}:${cx}:${cy}[gcrop]`)
      videoLabel = 'gcrop'
    }

    filters1.push(`[${videoLabel}]fps=15,scale=640:-2:flags=lanczos[gscaled]`)
    filters1.push(`[gscaled]palettegen=stats_mode=diff[pal]`)

    cmd1 = cmd1.complexFilter(filters1.join(';'))
      .outputOptions(['-map [pal]'])
      .output(palettePath)

    cmd1.on('start', (c) => console.log('GIF pass 1:', c))
      .on('error', (err) => reject(err))
      .on('end', () => {
        if (onProgress) onProgress(50)

        // Pass 2: Generate GIF using palette
        let cmd2 = ffmpeg().input(screenPath).input(palettePath)
        const filters2 = []
        let vLabel2

        if (keepSegments.length > 1) {
          keepSegments.forEach((seg, i) => {
            filters2.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[gs2_${i}]`)
          })
          filters2.push(`${keepSegments.map((_, i) => `[gs2_${i}]`).join('')}concat=n=${keepSegments.length}:v=1:a=0[gconcat2]`)
          vLabel2 = 'gconcat2'
        } else {
          filters2.push(`[0:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS[gtrim2]`)
          vLabel2 = 'gtrim2'
        }

        if (speed !== 1.0) {
          filters2.push(`[${vLabel2}]setpts=PTS/${speed}[gspeed2]`)
          vLabel2 = 'gspeed2'
        }

        if (hasCrop) {
          const cw = Math.round(screenInfo.width * crop.width)
          const ch = Math.round(screenInfo.height * crop.height)
          const cx = Math.round(screenInfo.width * crop.x)
          const cy = Math.round(screenInfo.height * crop.y)
          filters2.push(`[${vLabel2}]crop=${cw - cw % 2}:${ch - ch % 2}:${cx}:${cy}[gcrop2]`)
          vLabel2 = 'gcrop2'
        }

        filters2.push(`[${vLabel2}]fps=15,scale=640:-2:flags=lanczos[gscaled2]`)
        filters2.push(`[gscaled2][1:v]paletteuse=dither=bayer:bayer_scale=5[gifout]`)

        cmd2 = cmd2.complexFilter(filters2.join(';'))
          .outputOptions(['-map [gifout]', '-loop 0'])
          .output(outputPath)

        cmd2.on('start', (c) => console.log('GIF pass 2:', c))
          .on('progress', (p) => {
            if (onProgress && p.percent) {
              onProgress(50 + Math.min(50, Math.round(p.percent / 2)))
            }
          })
          .on('end', () => {
            console.log('GIF export complete:', outputPath)
            try { unlinkSync(palettePath) } catch (e) { console.warn('Failed to clean up palette:', e.message) }
            resolve(outputPath)
          })
          .on('error', (err, stdout, stderr) => {
            console.error('GIF error:', err.message)
            if (stderr) console.error('GIF stderr:', stderr)
            reject(err)
          })
          .run()
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

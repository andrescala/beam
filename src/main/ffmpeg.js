import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'

// Fix path for asar packaging
const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
ffmpeg.setFfmpegPath(ffmpegPath)

// Get video dimensions via ffprobe
function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err)
      const video = metadata.streams.find((s) => s.codec_type === 'video')
      resolve({
        width: video?.width || 1920,
        height: video?.height || 1080,
        duration: parseFloat(metadata.format.duration) || 0
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

/**
 * Compute the "keep" segments from trim + cuts.
 * Returns sorted, non-overlapping time ranges that should be included in the export.
 */
function computeKeepSegments(trimStart, trimEnd, cuts) {
  // Start with the full trimmed range
  let segments = [{ start: trimStart, end: trimEnd }]

  if (!cuts || cuts.length === 0) return segments

  // Sort cuts by start time
  const sortedCuts = [...cuts].sort((a, b) => a.start - b.start)

  // Remove each cut from segments
  for (const cut of sortedCuts) {
    const newSegments = []
    for (const seg of segments) {
      if (cut.end <= seg.start || cut.start >= seg.end) {
        // Cut doesn't overlap this segment
        newSegments.push(seg)
      } else {
        // Cut overlaps — split the segment
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

  // Filter out tiny segments (< 0.1s)
  return segments.filter((s) => s.end - s.start >= 0.1)
}

export async function exportMp4(projectPath, project, onProgress) {
  const screenPath = join(projectPath, project.recordings.screen)
  if (!existsSync(screenPath)) {
    throw new Error('Screen recording not found')
  }

  // Get screen dimensions to compute webcam pixel size
  const screenInfo = await probeVideo(screenPath)

  const edit = project.edit || {}
  const trimStart = edit.trimStart || 0
  const trimEnd = edit.trimEnd || project.duration || screenInfo.duration || 0
  const speed = edit.speed || 1.0
  const cuts = edit.cuts || []

  const outputDir = join(projectPath, 'exports')
  await mkdir(outputDir, { recursive: true })
  const timestamp = Date.now()
  const outputPath = join(outputDir, `export-${timestamp}.mp4`)

  const webcamPath = project.recordings?.webcam
    ? join(projectPath, project.recordings.webcam)
    : null
  const hasWebcam = webcamPath && existsSync(webcamPath)

  // Compute keep segments (trimmed range minus cuts)
  const keepSegments = computeKeepSegments(trimStart, trimEnd, cuts)
  if (keepSegments.length === 0) {
    throw new Error('Nothing to export — all content has been cut')
  }

  const hasCuts = keepSegments.length > 1 || cuts.length > 0
  const hasSpeed = speed !== 1.0

  return new Promise((resolve, reject) => {
    let command = ffmpeg()

    // Input 0: screen recording (no seeking — we handle trim/cuts in filters)
    command = command.input(screenPath)

    // Input 1: webcam (if present)
    if (hasWebcam) {
      command = command.input(webcamPath)
    }

    // Build the complex filter chain
    const filters = []
    let videoOut, audioOut

    if (hasCuts) {
      // Multiple segments: trim each, then concat
      const vParts = []
      const aParts = []

      keepSegments.forEach((seg, i) => {
        // Video segment
        filters.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[sv${i}]`)
        vParts.push(`[sv${i}]`)

        // Audio segment (if audio exists)
        filters.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[sa${i}]`)
        aParts.push(`[sa${i}]`)
      })

      if (keepSegments.length > 1) {
        filters.push(`${vParts.join('')}concat=n=${keepSegments.length}:v=1:a=0[sv_concat]`)
        filters.push(`${aParts.join('')}concat=n=${keepSegments.length}:v=0:a=1[sa_concat]`)
        videoOut = 'sv_concat'
        audioOut = 'sa_concat'
      } else {
        videoOut = `sv0`
        audioOut = `sa0`
      }
    } else {
      // Simple trim (no cuts)
      filters.push(`[0:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS[sv_trim]`)
      filters.push(`[0:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS[sa_trim]`)
      videoOut = 'sv_trim'
      audioOut = 'sa_trim'
    }

    // Apply speed change if needed
    if (hasSpeed) {
      filters.push(`[${videoOut}]setpts=PTS/${speed}[sv_speed]`)
      videoOut = 'sv_speed'
      // For audio tempo: atempo only supports 0.5-100.0 range
      // For speeds outside this, chain multiple atempo filters
      const tempoFilters = buildTempoChain(speed)
      filters.push(`[${audioOut}]${tempoFilters}[sa_speed]`)
      audioOut = 'sa_speed'
    }

    // Webcam overlay
    if (hasWebcam) {
      const size = edit.webcamSize || 0.2
      const pos = edit.webcamPosition || 'bottom-right'
      const shape = edit.webcamShape || 'circle'

      const wcPixels = Math.round(screenInfo.width * size)
      const wcSize = wcPixels % 2 === 0 ? wcPixels : wcPixels + 1

      let overlayX, overlayY
      switch (pos) {
        case 'top-left':    overlayX = '20'; overlayY = '20'; break
        case 'top-right':   overlayX = 'W-w-20'; overlayY = '20'; break
        case 'bottom-left': overlayX = '20'; overlayY = 'H-h-20'; break
        default:            overlayX = 'W-w-20'; overlayY = 'H-h-20'; break
      }

      // Compute webcam keep segments (same timing as screen, relative to webcam start)
      if (hasCuts) {
        const wcParts = []
        keepSegments.forEach((seg, i) => {
          filters.push(`[1:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[wv${i}]`)
          wcParts.push(`[wv${i}]`)
        })
        if (keepSegments.length > 1) {
          filters.push(`${wcParts.join('')}concat=n=${keepSegments.length}:v=1:a=0[wv_concat]`)
          filters.push(buildWebcamFilter('wv_concat', shape, wcSize, 'wc'))
        } else {
          filters.push(buildWebcamFilter('wv0', shape, wcSize, 'wc'))
        }
      } else {
        // Simple trim for webcam
        filters.push(`[1:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS[wv_trim]`)
        filters.push(buildWebcamFilter('wv_trim', shape, wcSize, 'wc'))
      }

      // Apply speed to webcam if needed
      if (hasSpeed) {
        filters.push(`[wc]setpts=PTS/${speed}[wc_speed]`)
        filters.push(`[${videoOut}][wc_speed]overlay=${overlayX}:${overlayY}[vout]`)
      } else {
        filters.push(`[${videoOut}][wc]overlay=${overlayX}:${overlayY}[vout]`)
      }
      videoOut = 'vout'
    }

    command = command.complexFilter(filters.join(';'))
    command = command.outputOptions([
      `-map [${videoOut}]`,
      `-map [${audioOut}]`,
      '-c:v libx264',
      '-preset medium',
      '-crf 23',
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
  const duration = trimEnd - trimStart

  const outputDir = join(projectPath, 'exports')
  await mkdir(outputDir, { recursive: true })
  const timestamp = Date.now()
  const palettePath = join(outputDir, `palette-${timestamp}.png`)
  const outputPath = join(outputDir, `export-${timestamp}.gif`)

  const keepSegments = computeKeepSegments(trimStart, trimEnd, cuts)
  if (keepSegments.length === 0) {
    throw new Error('Nothing to export — all content has been cut')
  }

  // GIF export: two-pass for quality (palettegen + paletteuse)
  // Scale to max 640px wide, 15fps for reasonable file size

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
        let cmd2 = ffmpeg()
          .input(screenPath)
          .input(palettePath)

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
            // Clean up palette file
            try { require('fs').unlinkSync(palettePath) } catch {}
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
  // Chain multiple atempo filters for extreme speeds
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

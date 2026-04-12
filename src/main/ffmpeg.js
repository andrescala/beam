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

export async function exportMp4(projectPath, project, onProgress) {
  const screenPath = join(projectPath, project.recordings.screen)
  if (!existsSync(screenPath)) {
    throw new Error('Screen recording not found')
  }

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

  const outputDir = join(projectPath, 'exports')
  await mkdir(outputDir, { recursive: true })
  const timestamp = Date.now()
  const outputPath = join(outputDir, `export-${timestamp}.mp4`)

  const webcamPath = project.recordings?.webcam
    ? join(projectPath, project.recordings.webcam)
    : null
  const hasWebcam = webcamPath && existsSync(webcamPath)

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
      audioAssetInputs.push({ layer, path: assetPath })
    }
  }

  return new Promise((resolve, reject) => {
    let command = ffmpeg()

    // Input 0: screen recording
    command = command.input(screenPath)

    // Input 1: webcam (if present)
    let nextInputIdx = 1
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
      const aParts = []

      keepSegments.forEach((seg, i) => {
        filters.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[sv${i}]`)
        vParts.push(`[sv${i}]`)

        if (screenInfo.hasAudio) {
          filters.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[sa${i}]`)
          aParts.push(`[sa${i}]`)
        }
      })

      if (keepSegments.length > 1) {
        filters.push(`${vParts.join('')}concat=n=${keepSegments.length}:v=1:a=0[sv_concat]`)
        videoOut = 'sv_concat'
        if (screenInfo.hasAudio) {
          filters.push(`${aParts.join('')}concat=n=${keepSegments.length}:v=0:a=1[sa_concat]`)
          audioOut = 'sa_concat'
        }
      } else {
        videoOut = 'sv0'
        if (screenInfo.hasAudio) audioOut = 'sa0'
      }
    } else {
      filters.push(`[0:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS[sv_trim]`)
      videoOut = 'sv_trim'
      if (screenInfo.hasAudio) {
        filters.push(`[0:a]atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS[sa_trim]`)
        audioOut = 'sa_trim'
      }
    }

    // If no audio in source, generate silent audio
    if (!screenInfo.hasAudio) {
      const silenceDuration = computeOutputDuration(keepSegments)
      filters.push(`aevalsrc=0:d=${silenceDuration}[sa_silence]`)
      audioOut = 'sa_silence'
    }

    // ── Step 2: Speed ──
    if (hasSpeed) {
      filters.push(`[${videoOut}]setpts=PTS/${speed}[sv_speed]`)
      videoOut = 'sv_speed'
      const tempoFilters = buildTempoChain(speed)
      filters.push(`[${audioOut}]${tempoFilters}[sa_speed]`)
      audioOut = 'sa_speed'
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

      // Escape text for FFmpeg drawtext
      const escapedText = (item.text || '').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/\\/g, '\\\\')

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
    if (audioAssetInputs.length > 0) {
      // Mix imported audio layers with original audio
      const audioLabels = [`[${audioOut}]`]
      for (let i = 0; i < audioAssetInputs.length; i++) {
        const { layer } = audioAssetInputs[i]
        const inputIdx = audioInputMap[i]
        const vol = layer.volume != null ? layer.volume : 0.3
        const delay = Math.round((layer.startTime || 0) * 1000) // adelay uses ms

        const label = `aud${i}`
        filters.push(`[${inputIdx}:a]volume=${vol},adelay=${delay}|${delay}[${label}]`)
        audioLabels.push(`[${label}]`)
      }

      filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=2[amixed]`)
      audioOut = 'amixed'
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

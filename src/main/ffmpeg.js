import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
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
  const introCard = edit.introCard || null
  const outroCard = edit.outroCard || null
  const backgroundBlur = edit.backgroundBlur || null
  const cursorSpotlight = edit.cursorSpotlight || null
  const zoomKeyframes = edit.zoomKeyframes || []

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
      const fps = 30
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

    // ── Step 8: Intro/outro title cards ──
    const finalWidth = hasCrop ? Math.round(screenInfo.width * crop.width) : screenInfo.width
    const finalHeight = hasCrop ? Math.round(screenInfo.height * crop.height) : screenInfo.height
    const fw = finalWidth % 2 === 0 ? finalWidth : finalWidth - 1
    const fh = finalHeight % 2 === 0 ? finalHeight : finalHeight - 1

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

      // Concat all parts
      filters.push(`${concatParts.join('')}${concatAudioParts.join('')}concat=n=${partCount}:v=1:a=1[v_final][a_final]`)
      videoOut = 'v_final'
      audioOut = 'a_final'
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

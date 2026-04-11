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
  const duration = trimEnd - trimStart

  const outputDir = join(projectPath, 'exports')
  await mkdir(outputDir, { recursive: true })
  const timestamp = Date.now()
  const outputPath = join(outputDir, `export-${timestamp}.mp4`)

  const webcamPath = project.recordings?.webcam
    ? join(projectPath, project.recordings.webcam)
    : null
  const hasWebcam = webcamPath && existsSync(webcamPath)

  return new Promise((resolve, reject) => {
    let command = ffmpeg()

    // Input 0: screen recording
    command = command.input(screenPath)
    if (trimStart > 0) {
      command = command.inputOptions([`-ss ${trimStart}`])
    }

    // Input 1: webcam (if present)
    if (hasWebcam) {
      command = command.input(webcamPath)
      if (trimStart > 0) {
        command = command.inputOptions([`-ss ${trimStart}`])
      }
    }

    command = command.duration(duration)

    if (hasWebcam) {
      const size = edit.webcamSize || 0.2
      const pos = edit.webcamPosition || 'bottom-right'
      const shape = edit.webcamShape || 'circle'

      // Compute webcam pixel size from actual screen dimensions
      const wcPixels = Math.round(screenInfo.width * size)
      // Make even (FFmpeg requires even dimensions for most codecs)
      const wcSize = wcPixels % 2 === 0 ? wcPixels : wcPixels + 1

      let overlayX, overlayY
      switch (pos) {
        case 'top-left':    overlayX = '20'; overlayY = '20'; break
        case 'top-right':   overlayX = 'W-w-20'; overlayY = '20'; break
        case 'bottom-left': overlayX = '20'; overlayY = 'H-h-20'; break
        default:            overlayX = 'W-w-20'; overlayY = 'H-h-20'; break
      }

      let filterChain
      if (shape === 'circle') {
        // Circle webcam:
        // 1. Crop webcam to square (center crop, shorter dimension)
        // 2. Scale to computed pixel size
        // 3. Apply circular alpha mask via geq
        // 4. Overlay onto screen
        filterChain = [
          `[1:v]crop=min(iw\\,ih):min(iw\\,ih),scale=${wcSize}:${wcSize},format=yuva420p,geq=lum='p(X,Y)':a='if(lt((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2),(W/2-1)*(W/2-1)),255,0)'[wc]`,
          `[0:v][wc]overlay=${overlayX}:${overlayY}`
        ].join(';')
      } else {
        // Rectangle webcam: scale width, keep aspect ratio
        filterChain = [
          `[1:v]scale=${wcSize}:-2[wc]`,
          `[0:v][wc]overlay=${overlayX}:${overlayY}`
        ].join(';')
      }

      command = command.complexFilter(filterChain)
    }

    command
      .outputOptions([
        '-c:v libx264',
        '-preset medium',
        '-crf 23',
        '-c:a aac',
        '-b:a 128k',
        '-movflags +faststart',
        '-pix_fmt yuv420p'
      ])
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

import { useRef, useEffect } from 'react'
import styles from './VideoPreview.module.css'

const WEBCAM_POSITIONS = {
  'bottom-right': { bottom: '12px', right: '12px' },
  'bottom-left': { bottom: '12px', left: '12px' },
  'top-right': { top: '12px', right: '12px' },
  'top-left': { top: '12px', left: '12px' }
}

function VideoPreview({ project, projectPath, videoRef, currentTime, playing, onTimeUpdate, onTogglePlay, onEnded }) {
  const webcamRef = useRef(null)

  const screenSrc = project.recordings?.screen
    ? `project-file://${project.id}/${project.recordings.screen}`
    : null

  const webcamSrc = project.recordings?.webcam
    ? `project-file://${project.id}/${project.recordings.webcam}`
    : null

  const webcamPos = WEBCAM_POSITIONS[project.edit?.webcamPosition] || WEBCAM_POSITIONS['bottom-right']
  const webcamSize = Math.round((project.edit?.webcamSize || 0.2) * 100)
  const speed = project.edit?.speed || 1.0
  const crop = project.edit?.crop || {}
  const textLayers = project.edit?.textLayers || []
  const imageLayers = project.edit?.imageLayers || []
  const captions = project.edit?.captions || []

  // Active captions at current time
  const activeCaptions = captions.filter(
    (c) => currentTime >= c.startTime && currentTime <= c.endTime
  )

  // Active text layers at current time
  const activeTextLayers = textLayers.filter(
    (t) => currentTime >= (t.startTime || 0) && currentTime <= (t.endTime || project.duration || 999)
  )

  // Active image layers at current time
  const activeImageLayers = imageLayers.filter(
    (img) => currentTime >= (img.startTime || 0) && (img.endTime == null || currentTime <= img.endTime)
  )

  // Sync playback rate with speed setting
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed
    }
    if (webcamRef.current) {
      webcamRef.current.playbackRate = speed
    }
  }, [speed])

  // Sync webcam video with main video playback
  useEffect(() => {
    if (!webcamRef.current) return
    if (playing) {
      webcamRef.current.play().catch(() => {})
    } else {
      webcamRef.current.pause()
    }
  }, [playing])

  // Sync webcam seek with main video
  useEffect(() => {
    if (webcamRef.current && !playing) {
      webcamRef.current.currentTime = currentTime
    }
  }, [currentTime])

  function handleTimeUpdate() {
    if (videoRef.current) {
      onTimeUpdate(videoRef.current.currentTime)
    }
  }

  function handlePlay() {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed
    }
    if (webcamRef.current) {
      webcamRef.current.playbackRate = speed
    }
    onTogglePlay()
  }

  return (
    <div className={styles.previewArea}>
      <div className={styles.screen}>
        {screenSrc ? (
          <>
            <video
              ref={videoRef}
              src={screenSrc}
              className={styles.video}
              onTimeUpdate={handleTimeUpdate}
              onEnded={onEnded}
              onClick={handlePlay}
              onError={(e) => console.error('Screen video error:', e.target.error)}
            />

            {/* Crop overlay */}
            {crop.enabled && crop.aspectRatio !== 'original' && (
              <>
                {/* Top dim */}
                <div className={styles.cropDim} style={{ top: 0, left: 0, right: 0, height: `${crop.y * 100}%` }} />
                {/* Bottom dim */}
                <div className={styles.cropDim} style={{ bottom: 0, left: 0, right: 0, height: `${(1 - crop.y - crop.height) * 100}%` }} />
                {/* Left dim */}
                <div className={styles.cropDim} style={{ top: `${crop.y * 100}%`, left: 0, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} />
                {/* Right dim */}
                <div className={styles.cropDim} style={{ top: `${crop.y * 100}%`, right: 0, width: `${(1 - crop.x - crop.width) * 100}%`, height: `${crop.height * 100}%` }} />
                {/* Crop border */}
                <div className={styles.cropBorder} style={{
                  top: `${crop.y * 100}%`,
                  left: `${crop.x * 100}%`,
                  width: `${crop.width * 100}%`,
                  height: `${crop.height * 100}%`
                }} />
              </>
            )}

            {/* Webcam overlay */}
            {webcamSrc && (
              <video
                ref={webcamRef}
                src={webcamSrc}
                muted
                className={styles.webcamOverlay}
                style={{
                  ...webcamPos,
                  width: `${webcamSize}%`,
                  borderRadius: project.edit?.webcamShape === 'circle' ? '50%' : '8px',
                  aspectRatio: project.edit?.webcamShape === 'circle' ? '1 / 1' : '4 / 3',
                  objectFit: 'cover'
                }}
                onError={(e) => console.error('Webcam video error:', e.target.error)}
              />
            )}

            {/* Image overlays */}
            {activeImageLayers.map((layer) => (
              <img
                key={layer.id}
                src={`project-file://${project.id}/assets/${layer.file}`}
                className={styles.imageOverlay}
                style={{
                  left: `${(layer.x || 0) * 100}%`,
                  top: `${(layer.y || 0) * 100}%`,
                  width: `${(layer.width || 0.15) * 100}%`
                }}
                alt=""
              />
            ))}

            {/* Text overlays */}
            {activeTextLayers.map((layer) => (
              <div
                key={layer.id}
                className={styles.textOverlay}
                style={{
                  left: `${(layer.x || 0.5) * 100}%`,
                  top: `${(layer.y || 0.5) * 100}%`,
                  fontSize: `${layer.fontSize || 24}px`,
                  color: layer.color || '#ffffff',
                  fontWeight: layer.fontWeight || 'normal',
                  background: layer.background ? 'rgba(0,0,0,0.5)' : 'none',
                  padding: layer.background ? '2px 8px' : '0',
                  transform: 'translate(-50%, -50%)'
                }}
              >
                {layer.text}
              </div>
            ))}

            {/* Caption overlays */}
            {activeCaptions.map((caption) => (
              <div key={caption.id} className={styles.captionOverlay}>
                {caption.text}
              </div>
            ))}
          </>
        ) : (
          <div className={styles.placeholder}>No recording yet</div>
        )}
      </div>

      <div className={styles.controls}>
        <button className={styles.playBtn} onClick={handlePlay}>
          {playing ? '\u23F8' : '\u25B6'}
        </button>
        <span className={styles.timecode}>
          {formatTime(currentTime)} / {formatTime(project.duration || 0)}
        </span>
        {speed !== 1.0 && (
          <span className={styles.speedBadge}>{speed}x</span>
        )}
        {crop.enabled && crop.aspectRatio !== 'original' && (
          <span className={styles.cropBadge}>{crop.aspectRatio}</span>
        )}
        {project.edit?.backgroundBlur?.enabled && (
          <span className={styles.blurBadge}>Blur</span>
        )}
        {project.edit?.introCard && (
          <span className={styles.introBadge}>Intro</span>
        )}
        {project.edit?.outroCard && (
          <span className={styles.introBadge}>Outro</span>
        )}
        {project.edit?.cursorSpotlight?.enabled && (
          <span className={styles.blurBadge}>Vignette</span>
        )}
        {(project.edit?.zoomKeyframes?.length || 0) > 0 && (
          <span className={styles.introBadge}>Zoom ({project.edit.zoomKeyframes.length})</span>
        )}
      </div>
    </div>
  )
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default VideoPreview

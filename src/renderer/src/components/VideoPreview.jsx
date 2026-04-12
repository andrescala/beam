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
    // Ensure playback rate is set when play starts
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
                  aspectRatio: '1 / 1',
                  objectFit: 'cover'
                }}
                onError={(e) => console.error('Webcam video error:', e.target.error)}
              />
            )}
          </>
        ) : (
          <div className={styles.placeholder}>No recording yet</div>
        )}
      </div>

      <div className={styles.controls}>
        <button className={styles.playBtn} onClick={handlePlay}>
          {playing ? '&#x23F8;' : '&#x25B6;'}
        </button>
        <span className={styles.timecode}>
          {formatTime(currentTime)} / {formatTime(project.duration || 0)}
        </span>
        {speed !== 1.0 && (
          <span className={styles.speedBadge}>{speed}x</span>
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

import { useRef, useEffect } from 'react'
import styles from './VideoPreview.module.css'

const WEBCAM_POSITIONS = {
  'bottom-right': { bottom: '12px', right: '12px' },
  'bottom-left': { bottom: '12px', left: '12px' },
  'top-right': { top: '12px', right: '12px' },
  'top-left': { top: '12px', left: '12px' }
}

function VideoPreview({ project, projectPath, videoRef, currentTime, seekKey, playing, onTimeUpdate, onTogglePlay, onEnded }) {
  const webcamRef = useRef(null)
  const micRef = useRef(null)
  const systemRef = useRef(null)

  // The editor plays the seekable proxy; export always uses the master.
  const screenFile = project.recordings?.screenProxy || project.recordings?.screen
  const screenSrc = screenFile
    ? `project-file://${project.id}/${screenFile}`
    : null

  const webcamFile = project.recordings?.webcamProxy || project.recordings?.webcam
  const webcamSrc = webcamFile
    ? `project-file://${project.id}/${webcamFile}`
    : null

  // When a separate mic.webm exists, we play it in parallel with the screen
  // video (muting screen audio) so the user can apply a sync offset to it.
  const micSrc = project.recordings?.mic
    ? `project-file://${project.id}/${project.recordings.mic}`
    : null

  // System audio (loopback) plays as another parallel track.
  const systemSrc = project.recordings?.system
    ? `project-file://${project.id}/${project.recordings.system}`
    : null

  const micVolume = project.edit?.micMuted ? 0 : (project.edit?.micVolume != null ? project.edit.micVolume : 1.0)
  const systemVolume = project.edit?.systemMuted ? 0 : (project.edit?.systemVolume != null ? project.edit.systemVolume : 1.0)
  const audioOffsetMs = project.edit?.audioOffsetMs || 0
  const audioOffsetSec = audioOffsetMs / 1000

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

  // Sync playback rate across all parallel media elements
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
    if (webcamRef.current) webcamRef.current.playbackRate = speed
    if (micRef.current) micRef.current.playbackRate = speed
    if (systemRef.current) systemRef.current.playbackRate = speed
  }, [speed])

  // When we have a separate mic.webm, mute the screen's baked-in audio and
  // play mic separately (so the user's audio-offset slider can shift it).
  useEffect(() => {
    if (!videoRef.current) return
    if (micSrc) {
      videoRef.current.muted = true
    } else {
      videoRef.current.muted = false
      videoRef.current.volume = Math.max(0, Math.min(1, micVolume))
    }
  }, [micSrc])

  // Mic volume control (when mic.webm is the audio source)
  useEffect(() => {
    if (micRef.current) {
      micRef.current.volume = Math.max(0, Math.min(1, micVolume))
    }
  }, [micVolume])

  // System-audio volume control
  useEffect(() => {
    if (systemRef.current) {
      systemRef.current.volume = Math.max(0, Math.min(1, systemVolume))
    }
  }, [systemVolume])

  // Sync webcam + mic with main video on play/pause. We always read the
  // live video element's currentTime (not the prop, which can be stale) and
  // snap the secondary elements to it BEFORE play resumes — otherwise they
  // would drift / appear to restart.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const t = v.currentTime

    if (webcamRef.current) {
      webcamRef.current.currentTime = t
      if (playing) webcamRef.current.play().catch(() => {})
      else webcamRef.current.pause()
    }
    if (micRef.current) {
      micRef.current.currentTime = Math.max(0, t - audioOffsetSec)
      if (playing) micRef.current.play().catch(() => {})
      else micRef.current.pause()
    }
    if (systemRef.current) {
      systemRef.current.currentTime = t
      if (playing) systemRef.current.play().catch(() => {})
      else systemRef.current.pause()
    }
  }, [playing])

  // Explicit-seek sync: when handleSeek is called in Editor (timeline click,
  // keyboard shortcut, etc.), `seekKey` increments. We hard-sync all
  // secondary elements to the video's actual currentTime, even if playback
  // is in progress, so webcam + mic don't keep playing from their previous
  // positions after a timeline jump.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const t = v.currentTime
    if (webcamRef.current) webcamRef.current.currentTime = t
    if (micRef.current) {
      micRef.current.currentTime = Math.max(0, t - audioOffsetSec)
    }
    if (systemRef.current) systemRef.current.currentTime = t
  }, [seekKey])

  // Natural time updates during playback: only re-sync when paused (so
  // scrubbing keeps things aligned). During playback we let the elements
  // play on their own clocks to avoid stutter from constant seeks.
  useEffect(() => {
    if (!playing) {
      if (webcamRef.current) webcamRef.current.currentTime = currentTime
      if (micRef.current) {
        micRef.current.currentTime = Math.max(0, currentTime - audioOffsetSec)
      }
      if (systemRef.current) systemRef.current.currentTime = currentTime
    }
  }, [currentTime, audioOffsetSec])

  // Note: we deliberately don't do periodic "drift correction" during
  // playback. Seeking a <video>/<audio> while playing causes the browser to
  // re-decode from the nearest keyframe, producing a visible/audible
  // stutter or "loop" effect. Initial sync at play() + re-sync on
  // pause/scrub is enough for short recordings; long ones may drift a
  // little but that's preferable to constant stutters.

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

            {/* Mic audio (parallel track — lets the user apply a sync offset) */}
            {micSrc && (
              <audio
                ref={micRef}
                src={micSrc}
                preload="auto"
                onError={(e) => console.error('Mic audio error:', e.target.error)}
              />
            )}

            {/* System audio (parallel track) */}
            {systemSrc && (
              <audio
                ref={systemRef}
                src={systemSrc}
                preload="auto"
                onError={(e) => console.error('System audio error:', e.target.error)}
              />
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

import { useRef, useCallback } from 'react'
import styles from './Timeline.module.css'

function Timeline({ project, currentTime, onSeek, onTrimChange }) {
  const trackRef = useRef(null)
  const duration = project.duration || 1
  const trimStart = project.edit?.trimStart || 0
  const trimEnd = project.edit?.trimEnd || duration

  const getTimeFromEvent = useCallback((e) => {
    const rect = trackRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    return (x / rect.width) * duration
  }, [duration])

  function handleTrackClick(e) {
    if (e.target.dataset.handle) return
    onSeek(getTimeFromEvent(e))
  }

  function handleTrimDrag(side, e) {
    e.preventDefault()
    e.stopPropagation()

    function onMove(moveEvent) {
      const time = getTimeFromEvent(moveEvent)
      if (side === 'start') {
        onTrimChange({ trimStart: Math.min(time, trimEnd - 0.5) })
      } else {
        onTrimChange({ trimEnd: Math.max(time, trimStart + 0.5) })
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const playheadPos = (currentTime / duration) * 100
  const trimStartPos = (trimStart / duration) * 100
  const trimEndPos = (trimEnd / duration) * 100

  return (
    <div className={styles.timeline}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLabel}>Timeline</div>
        <span className={styles.timecode}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      <div className={styles.ruler}>
        {Array.from({ length: Math.ceil(duration / 30) + 1 }, (_, i) => {
          const time = i * 30
          const pos = (time / duration) * 100
          return (
            <div key={i} className={styles.tick} style={{ left: `${pos}%` }}>
              <span>{formatTime(time)}</span>
            </div>
          )
        })}
      </div>

      <div className={styles.tracks}>
        {/* Screen track */}
        <div className={styles.trackRow}>
          <div className={styles.trackLabel}>
            <div className={styles.trackDot} style={{ background: '#888' }} />
            Screen
          </div>
          <div className={styles.track} ref={trackRef} onClick={handleTrackClick}>
            {/* Trim dimmed areas */}
            {trimStartPos > 0 && (
              <div className={styles.trimDimmed} style={{ left: 0, width: `${trimStartPos}%` }} />
            )}
            {trimEndPos < 100 && (
              <div className={styles.trimDimmed} style={{ left: `${trimEndPos}%`, right: 0 }} />
            )}

            {/* Trim handles */}
            <div
              className={styles.trimHandle}
              style={{ left: `${trimStartPos}%` }}
              data-handle="start"
              onMouseDown={(e) => handleTrimDrag('start', e)}
            />
            <div
              className={styles.trimHandle}
              style={{ left: `${trimEndPos}%` }}
              data-handle="end"
              onMouseDown={(e) => handleTrimDrag('end', e)}
            />

            {/* Clip */}
            <div className={`${styles.clip} ${styles.screenClip}`}>
              {project.recordings?.screen || 'screen.webm'}
            </div>

            {/* Playhead */}
            <div className={styles.playhead} style={{ left: `${playheadPos}%` }} />
          </div>
        </div>

        {/* Webcam track */}
        {project.recordings?.webcam && (
          <div className={styles.trackRow}>
            <div className={styles.trackLabel}>
              <div className={styles.trackDot} style={{ background: '#888' }} />
              Webcam
            </div>
            <div className={styles.track}>
              <div className={`${styles.clip} ${styles.webcamClip}`}>
                {project.recordings.webcam}
              </div>
            </div>
          </div>
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

export default Timeline

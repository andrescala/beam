import { useRef, useCallback, useState } from 'react'
import { useToast } from './Toast'
import styles from './Timeline.module.css'

function Timeline({ project, projectId, currentTime, onSeek, onTrimChange, onCutsChange }) {
  const trackRef = useRef(null)
  const duration = project.duration || 1
  const trimStart = project.edit?.trimStart || 0
  const trimEnd = project.edit?.trimEnd || duration
  const cuts = project.edit?.cuts || []
  const [cutMode, setCutMode] = useState(false)
  const [cutStart, setCutStart] = useState(null)
  const [detectingSilence, setDetectingSilence] = useState(false)
  const showToast = useToast()

  const getTimeFromEvent = useCallback((e) => {
    const rect = trackRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    return (x / rect.width) * duration
  }, [duration])

  function handleTrackClick(e) {
    if (e.target.dataset.handle) return
    if (e.target.dataset.cuthandle) return

    const time = getTimeFromEvent(e)

    if (cutMode) {
      if (cutStart === null) {
        setCutStart(time)
      } else {
        // Complete the cut
        const start = Math.min(cutStart, time)
        const end = Math.max(cutStart, time)
        if (end - start >= 0.2) {
          const newCuts = [...cuts, { start, end }]
          // Sort and merge overlapping cuts
          onCutsChange({ cuts: mergeCuts(newCuts) })
        }
        setCutStart(null)
        setCutMode(false)
      }
    } else {
      onSeek(time)
    }
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

  function handleCutDrag(index, side, e) {
    e.preventDefault()
    e.stopPropagation()

    function onMove(moveEvent) {
      const time = getTimeFromEvent(moveEvent)
      const updated = [...cuts]
      const cut = { ...updated[index] }
      if (side === 'start') {
        cut.start = Math.min(time, cut.end - 0.2)
      } else {
        cut.end = Math.max(time, cut.start + 0.2)
      }
      updated[index] = cut
      onCutsChange({ cuts: mergeCuts(updated) })
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function removeCut(index, e) {
    e.stopPropagation()
    const updated = cuts.filter((_, i) => i !== index)
    onCutsChange({ cuts: updated })
  }

  async function handleRemoveSilence() {
    if (!projectId) return
    setDetectingSilence(true)
    try {
      const result = await window.electronAPI.detectSilence(projectId, -30, 0.5)
      if (result?.error) {
        showToast('error', 'Silence detection failed')
        setDetectingSilence(false)
        return
      }
      const silences = result?.silences || []
      if (silences.length === 0) {
        showToast('info', 'No silent segments found')
        setDetectingSilence(false)
        return
      }
      // Clamp trailing silence to recording duration
      const clampedSilences = silences.map((s) => ({
        start: s.start,
        end: Math.min(s.end, duration)
      }))
      const totalSilence = clampedSilences.reduce((sum, s) => sum + (s.end - s.start), 0)
      // Add silent regions as cuts (merge with existing)
      const newCuts = [...cuts, ...clampedSilences]
      onCutsChange({ cuts: mergeCuts(newCuts) })
      showToast('success', `Found ${silences.length} silent segment${silences.length > 1 ? 's' : ''} (${totalSilence.toFixed(1)}s)`)
    } catch (err) {
      console.error('Silence detection error:', err)
    }
    setDetectingSilence(false)
  }

  const playheadPos = (currentTime / duration) * 100
  const trimStartPos = (trimStart / duration) * 100
  const trimEndPos = (trimEnd / duration) * 100

  return (
    <div className={styles.timeline}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.toolbarLabel}>Timeline</span>
          <button
            className={`${styles.cutBtn} ${cutMode ? styles.cutBtnActive : ''}`}
            onClick={() => { setCutMode(!cutMode); setCutStart(null) }}
            title="Cut mode: click twice on the timeline to mark a region to remove"
          >
            {cutMode ? (cutStart !== null ? 'Click end point...' : 'Click start point...') : 'Cut'}
          </button>
          {cutMode && (
            <button className={styles.cancelCutBtn} onClick={() => { setCutMode(false); setCutStart(null) }}>
              Cancel
            </button>
          )}
          <button
            className={styles.silenceBtn}
            onClick={handleRemoveSilence}
            disabled={detectingSilence}
            title="Detect and remove silent segments"
          >
            {detectingSilence ? 'Detecting...' : 'Remove Silence'}
          </button>
          {cuts.length > 0 && !cutMode && (
            <span className={styles.cutCount}>{cuts.length} cut{cuts.length > 1 ? 's' : ''}</span>
          )}
        </div>
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
          <div
            className={`${styles.track} ${cutMode ? styles.trackCutMode : ''}`}
            ref={trackRef}
            onClick={handleTrackClick}
          >
            {/* Trim dimmed areas */}
            {trimStartPos > 0 && (
              <div className={styles.trimDimmed} style={{ left: 0, width: `${trimStartPos}%` }} />
            )}
            {trimEndPos < 100 && (
              <div className={styles.trimDimmed} style={{ left: `${trimEndPos}%`, right: 0 }} />
            )}

            {/* Cut regions */}
            {cuts.map((cut, i) => {
              const cutStartPos = (cut.start / duration) * 100
              const cutEndPos = (cut.end / duration) * 100
              return (
                <div
                  key={i}
                  className={styles.cutRegion}
                  style={{ left: `${cutStartPos}%`, width: `${cutEndPos - cutStartPos}%` }}
                >
                  <div
                    className={styles.cutHandle}
                    data-cuthandle="start"
                    style={{ left: 0 }}
                    onMouseDown={(e) => handleCutDrag(i, 'start', e)}
                  />
                  <button
                    className={styles.cutRemoveBtn}
                    onClick={(e) => removeCut(i, e)}
                    title="Remove this cut"
                  >
                    &#x00D7;
                  </button>
                  <div
                    className={styles.cutHandle}
                    data-cuthandle="end"
                    style={{ right: 0 }}
                    onMouseDown={(e) => handleCutDrag(i, 'end', e)}
                  />
                </div>
              )
            })}

            {/* Cut start marker (while placing) */}
            {cutMode && cutStart !== null && (
              <div
                className={styles.cutMarker}
                style={{ left: `${(cutStart / duration) * 100}%` }}
              />
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
              {/* Cut regions mirrored on webcam track */}
              {cuts.map((cut, i) => {
                const cutStartPos = (cut.start / duration) * 100
                const cutEndPos = (cut.end / duration) * 100
                return (
                  <div
                    key={i}
                    className={styles.cutRegion}
                    style={{ left: `${cutStartPos}%`, width: `${cutEndPos - cutStartPos}%` }}
                  />
                )
              })}
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

function mergeCuts(cuts) {
  if (cuts.length <= 1) return cuts
  const sorted = [...cuts].sort((a, b) => a.start - b.start)
  const merged = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end)
    } else {
      merged.push(sorted[i])
    }
  }
  return merged
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default Timeline

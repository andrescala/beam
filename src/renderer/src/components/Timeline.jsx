import { useRef, useCallback, useState } from 'react'
import { useToast } from './Toast'
import ConfirmModal from './ConfirmModal'
import styles from './Timeline.module.css'

function Timeline({ project, projectId, currentTime, onSeek, onTrimChange, onCutsChange, onEditChange }) {
  const trackRef = useRef(null)
  const duration = project.duration || 1
  const trimStart = project.edit?.trimStart || 0
  const trimEnd = project.edit?.trimEnd || duration
  const cuts = project.edit?.cuts || []
  const textLayers = project.edit?.textLayers || []
  const imageLayers = project.edit?.imageLayers || []
  const audioLayers = project.edit?.audioLayers || []
  const captions = project.edit?.captions || []
  const zoomKeyframes = project.edit?.zoomKeyframes || []
  const [cutMode, setCutMode] = useState(false)
  const [cutStart, setCutStart] = useState(null)
  const [detectingSilence, setDetectingSilence] = useState(false)
  const [showSilenceConfirm, setShowSilenceConfirm] = useState(false)
  const [hoverTime, setHoverTime] = useState(null) // seconds, or null when not hovering
  const [menu, setMenu] = useState(null) // { x: pageX, y: pageY, time }
  const showToast = useToast()
  const usingMicTrack = !!project.recordings?.mic

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

  function handleTrackHover(e) {
    if (!trackRef.current) return
    const t = getTimeFromEvent(e)
    setHoverTime(t)
  }

  function handleTrackLeave() {
    setHoverTime(null)
  }

  function handleContextMenu(e) {
    e.preventDefault()
    const t = getTimeFromEvent(e)
    setMenu({ x: e.clientX, y: e.clientY, time: t })
  }

  function closeMenu() {
    setMenu(null)
  }

  // ── Context menu actions (all take the time captured at right-click) ──
  function addZoomKeyframeAt(time) {
    const newKf = { id: crypto.randomUUID(), time, x: 0.5, y: 0.5, zoom: 1.5, duration: 2 }
    onEditChange?.({ zoomKeyframes: [...zoomKeyframes, newKf] })
    showToast('success', `Zoom keyframe added at ${formatTime(time)}`)
  }

  function addTextLayerAt(time) {
    const newLayer = {
      id: crypto.randomUUID(),
      text: 'New text',
      x: 0.5, y: 0.5,
      fontSize: 24, color: '#ffffff', fontWeight: 'normal', background: '',
      startTime: time,
      endTime: Math.min(duration, time + 3)
    }
    onEditChange?.({ textLayers: [...textLayers, newLayer] })
    showToast('success', `Text added at ${formatTime(time)}`)
  }

  function addCaptionAt(time) {
    const newCaption = {
      id: crypto.randomUUID(),
      text: 'New caption',
      startTime: time,
      endTime: Math.min(duration, time + 2)
    }
    onEditChange?.({ captions: [...captions, newCaption] })
    showToast('success', `Caption added at ${formatTime(time)}`)
  }

  function startCutAt(time) {
    setCutMode(true)
    setCutStart(time)
    showToast('info', 'Click the timeline to set the end of the cut')
  }

  function setTrimStartAt(time) {
    onTrimChange({ trimStart: Math.min(time, trimEnd - 0.5) })
    showToast('success', `Trim start set to ${formatTime(time)}`)
  }

  function setTrimEndAt(time) {
    onTrimChange({ trimEnd: Math.max(time, trimStart + 0.5) })
    showToast('success', `Trim end set to ${formatTime(time)}`)
  }

  async function addImageLayerAt(time) {
    try {
      const asset = await window.electronAPI.importAsset(projectId, 'image')
      if (!asset) return
      const newLayer = {
        id: asset.id,
        file: asset.filename,
        name: asset.originalName,
        x: 0.8, y: 0.05, width: 0.15,
        startTime: time,
        endTime: Math.min(duration, time + 3)
      }
      onEditChange?.({ imageLayers: [...imageLayers, newLayer] })
      showToast('success', `Image added at ${formatTime(time)}`)
    } catch {
      showToast('error', 'Failed to import image')
    }
  }

  async function addAudioLayerAt(time) {
    try {
      const asset = await window.electronAPI.importAsset(projectId, 'audio')
      if (!asset) return
      const newLayer = {
        id: asset.id,
        file: asset.filename,
        name: asset.originalName,
        volume: 0.3,
        startTime: time
      }
      onEditChange?.({ audioLayers: [...audioLayers, newLayer] })
      showToast('success', `Audio added at ${formatTime(time)}`)
    } catch {
      showToast('error', 'Failed to import audio')
    }
  }

  function handleRemoveSilenceClick() {
    if (!projectId || detectingSilence) return
    setShowSilenceConfirm(true)
  }

  async function runRemoveSilence() {
    setShowSilenceConfirm(false)
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
            onClick={handleRemoveSilenceClick}
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
        {(() => {
          // Pick a tick spacing that yields ~8–12 labeled ticks across the
          // visible timeline regardless of clip length.
          const targetTicks = 10
          const rawStep = duration / targetTicks
          const niceSteps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800]
          const majorStep = niceSteps.find((s) => s >= rawStep) || niceSteps[niceSteps.length - 1]
          const minorStep = majorStep / 5 // 4 minor ticks between each pair of majors
          const majors = []
          const minors = []
          for (let t = 0; t <= duration + 0.0001; t += minorStep) {
            const pos = (t / duration) * 100
            const isMajor = Math.abs(t / majorStep - Math.round(t / majorStep)) < 0.001
            if (isMajor) majors.push({ time: t, pos })
            else minors.push({ time: t, pos })
          }
          return (
            <>
              {minors.map((m, i) => (
                <div key={`min-${i}`} className={styles.minorTick} style={{ left: `${m.pos}%` }} />
              ))}
              {majors.map((m, i) => (
                <div key={`maj-${i}`} className={styles.tick} style={{ left: `${m.pos}%` }}>
                  <span>{formatRulerTime(m.time)}</span>
                </div>
              ))}
              {/* Hover indicator on the ruler */}
              {hoverTime !== null && (
                <div className={styles.hoverRulerLabel} style={{ left: `${(hoverTime / duration) * 100}%` }}>
                  {formatRulerTime(hoverTime, true)}
                </div>
              )}
              {/* Playhead position label on the ruler */}
              <div className={styles.playheadRulerLabel} style={{ left: `${playheadPos}%` }}>
                {formatRulerTime(currentTime, true)}
              </div>
            </>
          )
        })()}
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
            onMouseMove={handleTrackHover}
            onMouseLeave={handleTrackLeave}
            onContextMenu={handleContextMenu}
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

            {/* Hover indicator */}
            {hoverTime !== null && (
              <>
                <div
                  className={styles.hoverLine}
                  style={{ left: `${(hoverTime / duration) * 100}%` }}
                />
                <div
                  className={styles.hoverLabel}
                  style={{ left: `${(hoverTime / duration) * 100}%` }}
                >
                  {formatTime(hoverTime)}
                </div>
              </>
            )}

            {/* Zoom keyframe markers */}
            {zoomKeyframes.map((kf) => (
              <div
                key={kf.id || kf.time}
                className={styles.zoomMarker}
                style={{ left: `${((kf.time || 0) / duration) * 100}%` }}
                title={`Zoom ${kf.zoom}x at ${formatTime(kf.time || 0)}`}
              >
                🔍
              </div>
            ))}

            {/* Playhead */}
            <div className={styles.playhead} style={{ left: `${playheadPos}%` }} />
          </div>
        </div>

        {/* Audio track (recording mic) */}
        {project.recordings?.mic && (
          <div className={styles.trackRow}>
            <div className={styles.trackLabel}>
              <div className={styles.trackDot} style={{ background: '#10b981' }} />
              Audio
            </div>
            <div className={styles.track} style={{ cursor: 'default' }}>
              {/* Trim dimmed mirror */}
              {trimStartPos > 0 && (
                <div className={styles.trimDimmed} style={{ left: 0, width: `${trimStartPos}%` }} />
              )}
              {trimEndPos < 100 && (
                <div className={styles.trimDimmed} style={{ left: `${trimEndPos}%`, right: 0 }} />
              )}
              {/* Cut mirror */}
              {cuts.map((cut, i) => {
                const a = (cut.start / duration) * 100
                const b = (cut.end / duration) * 100
                return <div key={i} className={styles.cutRegion} style={{ left: `${a}%`, width: `${b - a}%`, pointerEvents: 'none' }} />
              })}
              <div className={`${styles.clip} ${styles.audioClip}`}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <span>{project.edit?.micMuted ? '🔇' : '🎙️'}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {project.edit?.micMuted ? 'Muted' : `Recording audio · ${Math.round((project.edit?.micVolume ?? 1.0) * 100)}%`}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    className={styles.audioSlider}
                    value={Math.round((project.edit?.micVolume ?? 1.0) * 100)}
                    onChange={(e) => onEditChange?.({ micVolume: parseInt(e.target.value) / 100 })}
                    onClick={(e) => e.stopPropagation()}
                    disabled={project.edit?.micMuted}
                    title="Volume (0–200%)"
                  />
                  <button
                    className={styles.audioMuteBtn}
                    onClick={(e) => { e.stopPropagation(); onEditChange?.({ micMuted: !project.edit?.micMuted }) }}
                    title={project.edit?.micMuted ? 'Unmute' : 'Mute'}
                  >
                    {project.edit?.micMuted ? 'Unmute' : 'Mute'}
                  </button>
                </span>
              </div>
              {/* Playhead mirror */}
              <div className={styles.playhead} style={{ left: `${playheadPos}%` }} />
            </div>
          </div>
        )}

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

      {menu && (
        <>
          <div className={styles.menuBackdrop} onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu() }} />
          <div
            className={styles.contextMenu}
            style={{ left: menu.x, top: menu.y }}
          >
            <div className={styles.menuHeader}>At {formatTime(menu.time)}</div>
            <button className={styles.menuItem} onClick={() => { onSeek(menu.time); closeMenu() }}>
              <span>Move playhead here</span>
            </button>
            <div className={styles.menuDivider} />
            <button className={styles.menuItem} onClick={() => { addZoomKeyframeAt(menu.time); closeMenu() }}>
              <span>Add zoom &amp; pan keyframe</span>
            </button>
            <button className={styles.menuItem} onClick={() => { addTextLayerAt(menu.time); closeMenu() }}>
              <span>Add text overlay here</span>
            </button>
            <button className={styles.menuItem} onClick={() => { addCaptionAt(menu.time); closeMenu() }}>
              <span>Add caption here</span>
            </button>
            <div className={styles.menuDivider} />
            <button className={styles.menuItem} onClick={() => { addImageLayerAt(menu.time); closeMenu() }}>
              <span>Add image layer here…</span>
            </button>
            <button className={styles.menuItem} onClick={() => { addAudioLayerAt(menu.time); closeMenu() }}>
              <span>Add audio layer here…</span>
            </button>
            <div className={styles.menuDivider} />
            <button className={styles.menuItem} onClick={() => { startCutAt(menu.time); closeMenu() }}>
              <span>Start a cut here</span>
            </button>
            <button className={styles.menuItem} onClick={() => { setTrimStartAt(menu.time); closeMenu() }}>
              <span>Set trim start here</span>
            </button>
            <button className={styles.menuItem} onClick={() => { setTrimEndAt(menu.time); closeMenu() }}>
              <span>Set trim end here</span>
            </button>
          </div>
        </>
      )}

      {showSilenceConfirm && (
        <ConfirmModal
          title="Remove Silence — what's about to happen"
          confirmLabel="Detect & Add Cuts"
          cancelLabel="Cancel"
          onCancel={() => setShowSilenceConfirm(false)}
          onConfirm={runRemoveSilence}
          body={
            <>
              <p>
                Beam will scan the {usingMicTrack ? 'microphone track' : 'recording audio'} for stretches
                of silence quieter than <strong>-30&nbsp;dB</strong> lasting at least
                <strong> 0.5&nbsp;seconds</strong>, then add each one to the timeline as a <strong>cut</strong>.
              </p>
              <ul>
                <li>Cuts are <strong>non-destructive</strong> — your original recording is untouched.</li>
                <li>Each cut shows up on the timeline and you can drag its edges or delete it after.</li>
                <li>Cuts apply to <strong>video, webcam, audio layers, and overlays</strong> together — anything happening on screen during a silent moment will also be removed.</li>
                {!usingMicTrack && (
                  <li style={{ color: '#d97706' }}>
                    This is an older recording with mic baked into the screen file — detection runs on the combined audio and may be less precise.
                  </li>
                )}
                <li>Nothing is exported now. To preview the result, scrub the timeline; to bake the cuts in, use <strong>Export</strong>.</li>
              </ul>
            </>
          }
        />
      )}
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

/**
 * Ruler-friendly time format. Drops the leading 0: prefix for short clips,
 * adds decimal precision when requested (hover + playhead labels).
 */
function formatRulerTime(seconds, precise = false) {
  if (seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (precise) {
    if (m > 0) return `${m}:${s.toFixed(1).padStart(4, '0')}`
    return `${s.toFixed(1)}s`
  }
  if (m === 0) return `${Math.round(s)}s`
  return `${m}:${Math.round(s).toString().padStart(2, '0')}`
}

export default Timeline

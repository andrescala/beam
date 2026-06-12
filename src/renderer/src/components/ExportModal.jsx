import { useState, useEffect, useRef } from 'react'
import styles from './ExportModal.module.css'

const RENDITIONS = [
  { key: 'original', label: 'Original', desc: 'Source aspect & resolution' },
  { key: 'youtube', label: 'YouTube', desc: '1920×1080 · 16:9', targetWidth: 1920, targetHeight: 1080 },
  { key: 'vertical', label: 'TikTok / Reels / Shorts', desc: '1080×1920 · 9:16', targetWidth: 1080, targetHeight: 1920 },
  { key: 'square', label: 'Square (Instagram)', desc: '1080×1080 · 1:1', targetWidth: 1080, targetHeight: 1080 },
  { key: 'x', label: 'X / LinkedIn', desc: '1280×720 · 16:9', targetWidth: 1280, targetHeight: 720 }
]

function ExportModal({ project, onClose }) {
  const [phase, setPhase] = useState('config') // config | running | done
  const [error, setError] = useState(null)
  const [format, setFormat] = useState('mp4')
  const [quality, setQuality] = useState('balanced')
  const [resolution, setResolution] = useState('source')
  const [normalizeLoudness, setNormalizeLoudness] = useState(false)
  const [fillMode, setFillMode] = useState('blur')
  const [selectedKeys, setSelectedKeys] = useState(() => new Set(['original']))
  const [jobs, setJobs] = useState([])
  const [exportPaths, setExportPaths] = useState([])
  const activeJobRef = useRef(null)

  useEffect(() => {
    const cleanup = window.electronAPI.onExportProgress((p) => {
      const activeKey = activeJobRef.current
      if (activeKey === null) return
      setJobs((prev) => prev.map((j) => (j.key === activeKey ? { ...j, progress: p } : j)))
    })
    return cleanup
  }, [])

  function toggleRendition(key) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedRenditions = RENDITIONS.filter((r) => selectedKeys.has(r.key))
  const anyReframe = selectedRenditions.some((r) => r.targetWidth)

  async function handleExport() {
    setError(null)

    if (format === 'gif') {
      const gifJob = { key: 'gif', label: 'GIF', status: 'running', progress: 0 }
      setJobs([gifJob])
      setPhase('running')
      activeJobRef.current = 'gif'
      try {
        const result = await window.electronAPI.processRecording(project.id, 'gif')
        if (result.error) {
          setJobs([{ ...gifJob, status: 'failed', error: result.error }])
          setError(result.error)
          setPhase('done')
          return
        }
        setJobs([{ ...gifJob, status: 'done', progress: 100 }])
        setExportPaths([result.path])
        setPhase('done')
      } catch (err) {
        setError(err.message || 'Export failed')
        setPhase('done')
      } finally {
        activeJobRef.current = null
      }
      return
    }

    if (selectedRenditions.length === 0) {
      setError('Select at least one rendition')
      return
    }

    const initialJobs = selectedRenditions.map((r) => ({
      key: r.key,
      label: r.label,
      status: 'pending',
      progress: 0
    }))
    setJobs(initialJobs)
    setPhase('running')

    const paths = []
    let failures = 0

    // Render queue: one FFmpeg pass per rendition, sequentially
    for (const r of selectedRenditions) {
      activeJobRef.current = r.key
      setJobs((prev) => prev.map((j) => (j.key === r.key ? { ...j, status: 'running' } : j)))
      try {
        const result = await window.electronAPI.processRecording(project.id, 'mp4', {
          quality,
          normalizeLoudness,
          fillMode,
          label: r.key === 'original' ? '' : r.key,
          targetWidth: r.targetWidth,
          targetHeight: r.targetHeight,
          resolution: r.key === 'original' ? resolution : undefined
        })
        if (result.error) {
          failures++
          setJobs((prev) => prev.map((j) => (j.key === r.key ? { ...j, status: 'failed', error: result.error } : j)))
        } else {
          paths.push(result.path)
          setJobs((prev) => prev.map((j) => (j.key === r.key ? { ...j, status: 'done', progress: 100 } : j)))
        }
      } catch (err) {
        failures++
        setJobs((prev) => prev.map((j) => (j.key === r.key ? { ...j, status: 'failed', error: err.message } : j)))
      }
    }
    activeJobRef.current = null

    setExportPaths(paths)
    if (failures > 0 && paths.length === 0) {
      setError('Export failed')
    }
    setPhase('done')
  }

  function handleShowInFolder() {
    if (exportPaths.length > 0) {
      window.electronAPI.showInFolder(exportPaths[exportPaths.length - 1])
    }
  }

  function handleRetry() {
    setPhase('config')
    setError(null)
    setJobs([])
    setExportPaths([])
  }

  const cuts = project.edit?.cuts || []
  const speed = project.edit?.speed || 1.0
  const rawDuration = (project.edit?.trimEnd || project.duration) - (project.edit?.trimStart || 0)
  // Subtract cuts
  const cutDuration = cuts.reduce((sum, c) => sum + (c.end - c.start), 0)
  const effectiveDuration = (rawDuration - cutDuration) / speed

  const succeeded = jobs.filter((j) => j.status === 'done').length
  const failed = jobs.filter((j) => j.status === 'failed')

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>Export</h3>
          <button className={styles.closeBtn} onClick={onClose}>&#x00D7;</button>
        </div>

        <div className={styles.body}>
          {phase === 'config' && (
            <>
              {/* Format selector */}
              <div className={styles.formatRow}>
                <button
                  className={`${styles.formatBtn} ${format === 'mp4' ? styles.formatBtnActive : ''}`}
                  onClick={() => setFormat('mp4')}
                >
                  <span className={styles.formatIcon}>&#x1F3AC;</span>
                  <span>MP4</span>
                  <span className={styles.formatDesc}>H.264 video</span>
                </button>
                <button
                  className={`${styles.formatBtn} ${format === 'gif' ? styles.formatBtnActive : ''}`}
                  onClick={() => setFormat('gif')}
                >
                  <span className={styles.formatIcon}>&#x1F5BC;</span>
                  <span>GIF</span>
                  <span className={styles.formatDesc}>Animated image</span>
                </button>
              </div>

              {format === 'mp4' && (
                <>
                  {/* Rendition multi-select — one edit, many channel sizes */}
                  <div className={styles.renditionBlock}>
                    <div className={styles.renditionHeading}>Renditions</div>
                    {RENDITIONS.map((r) => (
                      <label key={r.key} className={styles.renditionRow}>
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(r.key)}
                          onChange={() => toggleRendition(r.key)}
                        />
                        <span className={styles.renditionLabel}>{r.label}</span>
                        <span className={styles.renditionDesc}>{r.desc}</span>
                      </label>
                    ))}
                    {anyReframe && (
                      <div className={styles.optionRow} style={{ marginTop: 6 }}>
                        <span>Aspect change</span>
                        <div className={styles.fillToggle}>
                          <button
                            className={`${styles.fillBtn} ${fillMode === 'blur' ? styles.fillBtnActive : ''}`}
                            onClick={() => setFillMode('blur')}
                            title="Fit the video inside a blurred copy of itself"
                          >
                            Blur background
                          </button>
                          <button
                            className={`${styles.fillBtn} ${fillMode === 'crop' ? styles.fillBtnActive : ''}`}
                            onClick={() => setFillMode('crop')}
                            title="Zoom in until the frame is filled (edges are cut off)"
                          >
                            Crop to fill
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className={styles.optionsBlock}>
                    <div className={styles.optionRow}>
                      <span>Quality</span>
                      <select
                        className={styles.optionSelect}
                        value={quality}
                        onChange={(e) => setQuality(e.target.value)}
                      >
                        <option value="high">High (larger file)</option>
                        <option value="balanced">Balanced</option>
                        <option value="small">Smaller file</option>
                      </select>
                    </div>
                    {selectedKeys.has('original') && (
                      <div className={styles.optionRow}>
                        <span>Original resolution</span>
                        <select
                          className={styles.optionSelect}
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value)}
                        >
                          <option value="source">Source (original)</option>
                          <option value="1080p">1080p</option>
                          <option value="720p">720p</option>
                        </select>
                      </div>
                    )}
                    <div className={styles.optionRow}>
                      <label className={styles.optionCheck}>
                        <input
                          type="checkbox"
                          checked={normalizeLoudness}
                          onChange={(e) => setNormalizeLoudness(e.target.checked)}
                        />
                        <span>Normalize loudness (−14 LUFS, social/YouTube)</span>
                      </label>
                    </div>
                  </div>
                </>
              )}

              <div className={styles.info}>
                <div className={styles.row}>
                  <span>Format</span>
                  <span>{format === 'mp4' ? 'MP4 (H.264)' : 'GIF (640px, 15fps)'}</span>
                </div>
                <div className={styles.row}>
                  <span>Duration</span>
                  <span>{formatTime(effectiveDuration)}</span>
                </div>
                {speed !== 1.0 && (
                  <div className={styles.row}>
                    <span>Speed</span>
                    <span>{speed}x</span>
                  </div>
                )}
                {cuts.length > 0 && (
                  <div className={styles.row}>
                    <span>Cuts</span>
                    <span>{cuts.length} region{cuts.length > 1 ? 's' : ''} removed</span>
                  </div>
                )}
                {format === 'gif' && (
                  <div className={styles.gifNote}>
                    GIF files can be large for long recordings. Best for clips under 15 seconds.
                    GIF export includes trim, cuts, speed, and crop only. Webcam, text, image overlays,
                    and effects (blur, vignette, zoom, title cards) are not included in GIF output.
                  </div>
                )}
              </div>
              {error && <div className={styles.error}><p>{error}</p></div>}
              <button className={styles.exportBtn} onClick={handleExport}>
                {format === 'gif'
                  ? 'Export GIF'
                  : selectedRenditions.length > 1
                    ? `Export ${selectedRenditions.length} renditions`
                    : 'Export MP4'}
              </button>
            </>
          )}

          {phase === 'running' && (
            <div className={styles.progressWrap}>
              {jobs.map((job) => (
                <div key={job.key} className={styles.jobRow}>
                  <span className={styles.jobIcon}>
                    {job.status === 'done' ? '✓' : job.status === 'failed' ? '✗' : job.status === 'running' ? '▶' : '·'}
                  </span>
                  <span className={styles.jobLabel}>{job.label}</span>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${job.status === 'done' ? 100 : job.progress}%` }}
                    />
                  </div>
                  <span className={styles.progressPercent}>
                    {job.status === 'pending' ? '—' : `${Math.round(job.status === 'done' ? 100 : job.progress)}%`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {phase === 'done' && (
            <div className={styles.done}>
              {succeeded > 0 ? (
                <>
                  <div className={styles.doneIcon}>&#x2713;</div>
                  <p>
                    {jobs.length > 1
                      ? `${succeeded} of ${jobs.length} renditions exported`
                      : 'Export complete!'}
                  </p>
                </>
              ) : (
                <div className={styles.error}>
                  <p>Export failed{error ? `: ${error}` : ''}</p>
                </div>
              )}
              {failed.length > 0 && succeeded > 0 && (
                <div className={styles.error}>
                  {failed.map((j) => (
                    <p key={j.key}>{j.label} failed: {j.error}</p>
                  ))}
                </div>
              )}
              <div className={styles.doneActions}>
                {succeeded > 0 && (
                  <button className={styles.secondaryBtn} onClick={handleShowInFolder}>
                    Show in Folder
                  </button>
                )}
                {failed.length > 0 && (
                  <button className={styles.secondaryBtn} onClick={handleRetry}>
                    Try Again
                  </button>
                )}
                <button className={styles.primaryBtn} onClick={onClose}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default ExportModal

import { useState, useEffect } from 'react'
import styles from './ExportModal.module.css'

function ExportModal({ project, onClose }) {
  const [progress, setProgress] = useState(null) // null = not started, 0-100 = in progress, -1 = done
  const [exportPath, setExportPath] = useState(null)
  const [error, setError] = useState(null)
  const [format, setFormat] = useState('mp4')

  useEffect(() => {
    const cleanup = window.electronAPI.onExportProgress((p) => {
      setProgress(p)
    })
    return cleanup
  }, [])

  async function handleExport() {
    try {
      setProgress(0)
      setError(null)

      const result = await window.electronAPI.processRecording(project.id, format)
      if (result.error) {
        setError(result.error)
        setProgress(null)
        return
      }

      setExportPath(result.path)
      setProgress(-1)
    } catch (err) {
      setError(err.message || 'Export failed')
      setProgress(null)
    }
  }

  function handleShowInFolder() {
    if (exportPath) {
      window.electronAPI.showInFolder(exportPath)
    }
  }

  const cuts = project.edit?.cuts || []
  const speed = project.edit?.speed || 1.0
  const rawDuration = (project.edit?.trimEnd || project.duration) - (project.edit?.trimStart || 0)
  // Subtract cuts
  const cutDuration = cuts.reduce((sum, c) => sum + (c.end - c.start), 0)
  const effectiveDuration = (rawDuration - cutDuration) / speed

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>Export</h3>
          <button className={styles.closeBtn} onClick={onClose}>&#x00D7;</button>
        </div>

        <div className={styles.body}>
          {progress === null && !error && (
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
              <button className={styles.exportBtn} onClick={handleExport}>
                Export {format.toUpperCase()}
              </button>
            </>
          )}

          {progress !== null && progress >= 0 && progress !== -1 && (
            <div className={styles.progressWrap}>
              <div className={styles.progressLabel}>Exporting {format.toUpperCase()}...</div>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
              <div className={styles.progressPercent}>{Math.round(progress)}%</div>
            </div>
          )}

          {progress === -1 && (
            <div className={styles.done}>
              <div className={styles.doneIcon}>&#x2713;</div>
              <p>Export complete!</p>
              <div className={styles.doneActions}>
                <button className={styles.secondaryBtn} onClick={handleShowInFolder}>
                  Show in Folder
                </button>
                <button className={styles.primaryBtn} onClick={onClose}>
                  Done
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className={styles.error}>
              <p>Export failed: {error}</p>
              <button className={styles.secondaryBtn} onClick={() => { setError(null); setProgress(null) }}>
                Try Again
              </button>
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

import { useState, useEffect } from 'react'
import styles from './ExportModal.module.css'

function ExportModal({ project, onClose }) {
  const [progress, setProgress] = useState(null) // null = not started, 0-100 = in progress, -1 = done
  const [exportPath, setExportPath] = useState(null)
  const [error, setError] = useState(null)

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

      const result = await window.electronAPI.processRecording(project.id)
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

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>Export</h3>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div className={styles.body}>
          {progress === null && !error && (
            <>
              <div className={styles.info}>
                <div className={styles.row}>
                  <span>Format</span>
                  <span>MP4 (H.264)</span>
                </div>
                <div className={styles.row}>
                  <span>Quality</span>
                  <span>{project.exportSettings?.quality || 'balanced'}</span>
                </div>
                <div className={styles.row}>
                  <span>Duration</span>
                  <span>{formatTime(
                    (project.edit?.trimEnd || project.duration) - (project.edit?.trimStart || 0)
                  )}</span>
                </div>
              </div>
              <button className={styles.exportBtn} onClick={handleExport}>
                Export MP4
              </button>
            </>
          )}

          {progress !== null && progress >= 0 && progress !== -1 && (
            <div className={styles.progressWrap}>
              <div className={styles.progressLabel}>Exporting...</div>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
              <div className={styles.progressPercent}>{Math.round(progress)}%</div>
            </div>
          )}

          {progress === -1 && (
            <div className={styles.done}>
              <div className={styles.doneIcon}>✓</div>
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

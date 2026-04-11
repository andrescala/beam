import styles from './Inspector.module.css'

const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

function Inspector({ project, onEditChange }) {
  const edit = project.edit || {}

  return (
    <div className={styles.inspector}>
      <div className={styles.header}>Properties</div>

      {/* Trim section */}
      <div className={styles.section}>
        <div className={styles.label}>Trim</div>
        <div className={styles.row}>
          <span className={styles.key}>Start</span>
          <input
            className={styles.input}
            type="number"
            step="0.1"
            min="0"
            value={(edit.trimStart || 0).toFixed(1)}
            onChange={(e) => onEditChange({ trimStart: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.key}>End</span>
          <input
            className={styles.input}
            type="number"
            step="0.1"
            min="0"
            value={(edit.trimEnd || project.duration || 0).toFixed(1)}
            onChange={(e) => onEditChange({ trimEnd: parseFloat(e.target.value) || 0 })}
          />
        </div>
      </div>

      {/* Webcam section */}
      {project.recordings?.webcam && (
        <div className={styles.section}>
          <div className={styles.label}>Webcam</div>
          <div className={styles.row}>
            <span className={styles.key}>Position</span>
          </div>
          <div className={styles.positionGrid}>
            {POSITIONS.map((pos) => (
              <button
                key={pos}
                className={`${styles.posBtn} ${edit.webcamPosition === pos ? styles.posBtnActive : ''}`}
                onClick={() => onEditChange({ webcamPosition: pos })}
                title={pos}
              >
                {pos.split('-').map((w) => w[0]).join('')}
              </button>
            ))}
          </div>
          <div className={styles.row}>
            <span className={styles.key}>Size</span>
            <span className={styles.value}>{Math.round((edit.webcamSize || 0.2) * 100)}%</span>
          </div>
          <input
            type="range"
            className={styles.slider}
            min="10"
            max="50"
            value={Math.round((edit.webcamSize || 0.2) * 100)}
            onChange={(e) => onEditChange({ webcamSize: parseInt(e.target.value) / 100 })}
          />
          <div className={styles.row}>
            <span className={styles.key}>Shape</span>
            <div className={styles.toggleGroup}>
              <button
                className={`${styles.toggleBtn} ${edit.webcamShape === 'circle' ? styles.toggleActive : ''}`}
                onClick={() => onEditChange({ webcamShape: 'circle' })}
              >
                Circle
              </button>
              <button
                className={`${styles.toggleBtn} ${edit.webcamShape === 'rect' ? styles.toggleActive : ''}`}
                onClick={() => onEditChange({ webcamShape: 'rect' })}
              >
                Rect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export settings */}
      <div className={styles.section}>
        <div className={styles.label}>Export</div>
        <div className={styles.row}>
          <span className={styles.key}>Format</span>
          <span className={styles.value}>MP4</span>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Quality</span>
          <span className={styles.value}>{project.exportSettings?.quality || 'balanced'}</span>
        </div>
      </div>
    </div>
  )
}

export default Inspector

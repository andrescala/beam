import styles from './Inspector.module.css'

const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const SPEED_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]

function Inspector({ project, onEditChange }) {
  const edit = project.edit || {}
  const speed = edit.speed || 1.0

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

      {/* Speed section */}
      <div className={styles.section}>
        <div className={styles.label}>Speed</div>
        <div className={styles.speedPresets}>
          {SPEED_PRESETS.map((s) => (
            <button
              key={s}
              className={`${styles.speedBtn} ${speed === s ? styles.speedBtnActive : ''}`}
              onClick={() => onEditChange({ speed: s })}
            >
              {s === 1.0 ? '1x' : `${s}x`}
            </button>
          ))}
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Custom</span>
          <input
            className={styles.input}
            type="number"
            step="0.1"
            min="0.25"
            max="4"
            value={speed.toFixed(1)}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              if (val >= 0.25 && val <= 4.0) {
                onEditChange({ speed: val })
              }
            }}
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
          <span className={styles.value}>MP4 / GIF</span>
        </div>
        <div className={styles.row}>
          <span className={styles.key}>Quality</span>
          <span className={styles.value}>{project.exportSettings?.quality || 'balanced'}</span>
        </div>
        {(edit.cuts?.length > 0) && (
          <div className={styles.row}>
            <span className={styles.key}>Cuts</span>
            <span className={styles.value}>{edit.cuts.length} region{edit.cuts.length > 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default Inspector

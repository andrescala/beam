import { useToast } from './Toast'
import styles from './Inspector.module.css'

const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const SPEED_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
const ASPECT_RATIOS = [
  { label: 'Original', value: 'original' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '1:1', value: '1:1' }
]

function computeCropFromAspect(aspectRatio) {
  // Returns { x, y, width, height } as fractions of the source video
  // Centered crop that maximizes area for the given ratio
  const ratioMap = {
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '4:3': 4 / 3,
    '1:1': 1
  }

  const targetRatio = ratioMap[aspectRatio]
  if (!targetRatio) return { x: 0, y: 0, width: 1, height: 1 }

  // Assume source is roughly 16:9
  const sourceRatio = 16 / 9

  if (targetRatio > sourceRatio) {
    // Target is wider — use full width, crop height
    const h = sourceRatio / targetRatio
    return { x: 0, y: (1 - h) / 2, width: 1, height: h }
  } else {
    // Target is taller — use full height, crop width
    const w = targetRatio / sourceRatio
    return { x: (1 - w) / 2, y: 0, width: w, height: 1 }
  }
}

function Inspector({ project, projectId, onEditChange }) {
  const showToast = useToast()
  const edit = project.edit || {}
  const speed = edit.speed || 1.0
  const crop = edit.crop || { enabled: false, aspectRatio: 'original' }

  function handleCropChange(aspectRatio) {
    if (aspectRatio === 'original') {
      onEditChange({ crop: { enabled: false, aspectRatio: 'original', x: 0, y: 0, width: 1, height: 1 } })
    } else {
      const dims = computeCropFromAspect(aspectRatio)
      onEditChange({ crop: { enabled: true, aspectRatio, ...dims } })
    }
  }

  async function handleBackup() {
    try {
      const result = await window.electronAPI.exportProjectZip(projectId)
      if (result?.path) {
        showToast('success', 'Project exported')
        window.electronAPI.showInFolder(result.path)
      }
    } catch (err) {
      showToast('error', 'Failed to export project')
    }
  }

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

      {/* Crop section */}
      <div className={styles.section}>
        <div className={styles.label}>Crop</div>
        <div className={styles.cropPresets}>
          {ASPECT_RATIOS.map((ar) => (
            <button
              key={ar.value}
              className={`${styles.cropBtn} ${crop.aspectRatio === ar.value ? styles.cropBtnActive : ''}`}
              onClick={() => handleCropChange(ar.value)}
            >
              {ar.label}
            </button>
          ))}
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

      {/* Project backup */}
      <div className={styles.section}>
        <div className={styles.label}>Project</div>
        <button className={styles.backupBtn} onClick={handleBackup}>
          Export .beamproject
        </button>
      </div>
    </div>
  )
}

export default Inspector

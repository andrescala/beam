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
  const introCard = edit.introCard || null
  const outroCard = edit.outroCard || null
  const backgroundBlur = edit.backgroundBlur || null
  const cursorSpotlight = edit.cursorSpotlight || null
  const zoomKeyframes = edit.zoomKeyframes || []

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

      {/* Intro Card */}
      <div className={styles.section}>
        <div className={styles.label}>Intro Card</div>
        <div className={styles.toggleGroup} style={{ marginBottom: 8 }}>
          <button
            className={`${styles.toggleBtn} ${introCard ? styles.toggleActive : ''}`}
            onClick={() =>
              onEditChange({
                introCard: introCard
                  ? null
                  : { title: 'Title', subtitle: '', duration: 3, bgColor: '#000000', titleColor: 'white', subtitleColor: 'gray' }
              })
            }
          >
            {introCard ? 'On' : 'Off'}
          </button>
        </div>
        {introCard && (
          <>
            <div className={styles.row}>
              <span className={styles.key}>Title</span>
              <input
                className={styles.input}
                style={{ width: 100 }}
                value={introCard.title || ''}
                onChange={(e) => onEditChange({ introCard: { ...introCard, title: e.target.value } })}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.key}>Subtitle</span>
              <input
                className={styles.input}
                style={{ width: 100 }}
                value={introCard.subtitle || ''}
                onChange={(e) => onEditChange({ introCard: { ...introCard, subtitle: e.target.value } })}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.key}>Duration</span>
              <input
                className={styles.input}
                type="number"
                step="0.5"
                min="1"
                max="10"
                value={introCard.duration || 3}
                onChange={(e) => onEditChange({ introCard: { ...introCard, duration: parseFloat(e.target.value) || 3 } })}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.key}>Background</span>
              <input
                type="color"
                className={styles.colorInput}
                value={introCard.bgColor || '#000000'}
                onChange={(e) => onEditChange({ introCard: { ...introCard, bgColor: e.target.value } })}
              />
            </div>
          </>
        )}
      </div>

      {/* Outro Card */}
      <div className={styles.section}>
        <div className={styles.label}>Outro Card</div>
        <div className={styles.toggleGroup} style={{ marginBottom: 8 }}>
          <button
            className={`${styles.toggleBtn} ${outroCard ? styles.toggleActive : ''}`}
            onClick={() =>
              onEditChange({
                outroCard: outroCard
                  ? null
                  : { title: 'Thanks for watching', subtitle: '', duration: 3, bgColor: '#000000', titleColor: 'white', subtitleColor: 'gray' }
              })
            }
          >
            {outroCard ? 'On' : 'Off'}
          </button>
        </div>
        {outroCard && (
          <>
            <div className={styles.row}>
              <span className={styles.key}>Title</span>
              <input
                className={styles.input}
                style={{ width: 100 }}
                value={outroCard.title || ''}
                onChange={(e) => onEditChange({ outroCard: { ...outroCard, title: e.target.value } })}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.key}>Subtitle</span>
              <input
                className={styles.input}
                style={{ width: 100 }}
                value={outroCard.subtitle || ''}
                onChange={(e) => onEditChange({ outroCard: { ...outroCard, subtitle: e.target.value } })}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.key}>Duration</span>
              <input
                className={styles.input}
                type="number"
                step="0.5"
                min="1"
                max="10"
                value={outroCard.duration || 3}
                onChange={(e) => onEditChange({ outroCard: { ...outroCard, duration: parseFloat(e.target.value) || 3 } })}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.key}>Background</span>
              <input
                type="color"
                className={styles.colorInput}
                value={outroCard.bgColor || '#000000'}
                onChange={(e) => onEditChange({ outroCard: { ...outroCard, bgColor: e.target.value } })}
              />
            </div>
          </>
        )}
      </div>

      {/* Video Blur */}
      <div className={styles.section}>
        <div className={styles.label}>Video Blur</div>
        <div className={styles.toggleGroup} style={{ marginBottom: 8 }}>
          <button
            className={`${styles.toggleBtn} ${backgroundBlur?.enabled ? styles.toggleActive : ''}`}
            onClick={() =>
              onEditChange({
                backgroundBlur: backgroundBlur?.enabled
                  ? { enabled: false, strength: backgroundBlur.strength || 10 }
                  : { enabled: true, strength: 10 }
              })
            }
          >
            {backgroundBlur?.enabled ? 'On' : 'Off'}
          </button>
        </div>
        {backgroundBlur?.enabled && (
          <>
            <div className={styles.row}>
              <span className={styles.key}>Strength</span>
              <span className={styles.value}>{backgroundBlur.strength || 10}</span>
            </div>
            <input
              type="range"
              className={styles.slider}
              min="2"
              max="40"
              value={backgroundBlur.strength || 10}
              onChange={(e) =>
                onEditChange({ backgroundBlur: { enabled: true, strength: parseInt(e.target.value) } })
              }
            />
          </>
        )}
      </div>

      {/* Vignette */}
      <div className={styles.section}>
        <div className={styles.label}>Vignette</div>
        <div className={styles.toggleGroup} style={{ marginBottom: 8 }}>
          <button
            className={`${styles.toggleBtn} ${cursorSpotlight?.enabled ? styles.toggleActive : ''}`}
            onClick={() =>
              onEditChange({
                cursorSpotlight: cursorSpotlight?.enabled
                  ? { enabled: false, intensity: cursorSpotlight.intensity || 0.4 }
                  : { enabled: true, intensity: 0.4 }
              })
            }
          >
            {cursorSpotlight?.enabled ? 'On' : 'Off'}
          </button>
        </div>
        {cursorSpotlight?.enabled && (
          <>
            <div className={styles.row}>
              <span className={styles.key}>Intensity</span>
              <span className={styles.value}>{((cursorSpotlight.intensity || 0.4) * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              className={styles.slider}
              min="10"
              max="80"
              value={Math.round((cursorSpotlight.intensity || 0.4) * 100)}
              onChange={(e) =>
                onEditChange({ cursorSpotlight: { enabled: true, intensity: parseInt(e.target.value) / 100 } })
              }
            />
          </>
        )}
      </div>

      {/* Zoom Keyframes */}
      <div className={styles.section}>
        <div className={styles.label}>Zoom &amp; Pan</div>
        <button
          className={styles.backupBtn}
          onClick={() => {
            const newKf = {
              id: Date.now().toString(),
              time: 0,
              duration: 2,
              zoom: 1.5,
              x: 0.5,
              y: 0.5
            }
            onEditChange({ zoomKeyframes: [...zoomKeyframes, newKf] })
          }}
        >
          + Add Keyframe
        </button>
        {zoomKeyframes.map((kf, i) => (
          <div key={kf.id || i} className={styles.kfItem}>
            <div className={styles.row}>
              <span className={styles.key}>Time</span>
              <input
                className={styles.input}
                type="number"
                step="0.5"
                min="0"
                value={kf.time ?? 0}
                onChange={(e) => {
                  const updated = [...zoomKeyframes]
                  const val = parseFloat(e.target.value)
                  updated[i] = { ...kf, time: isNaN(val) ? 0 : val }
                  onEditChange({ zoomKeyframes: updated })
                }}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.key}>Duration</span>
              <input
                className={styles.input}
                type="number"
                step="0.5"
                min="0.5"
                max="30"
                value={kf.duration ?? 2}
                onChange={(e) => {
                  const updated = [...zoomKeyframes]
                  const val = parseFloat(e.target.value)
                  updated[i] = { ...kf, duration: isNaN(val) || val < 0.5 ? 0.5 : val }
                  onEditChange({ zoomKeyframes: updated })
                }}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.key}>Zoom</span>
              <input
                className={styles.input}
                type="number"
                step="0.1"
                min="1.1"
                max="4"
                value={kf.zoom ?? 1.5}
                onChange={(e) => {
                  const updated = [...zoomKeyframes]
                  const val = parseFloat(e.target.value)
                  updated[i] = { ...kf, zoom: isNaN(val) || val < 1.1 ? 1.1 : val }
                  onEditChange({ zoomKeyframes: updated })
                }}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.key}>X</span>
              <input
                className={styles.input}
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={(kf.x ?? 0.5).toFixed(2)}
                onChange={(e) => {
                  const updated = [...zoomKeyframes]
                  const val = parseFloat(e.target.value)
                  updated[i] = { ...kf, x: isNaN(val) ? 0.5 : Math.max(0, Math.min(1, val)) }
                  onEditChange({ zoomKeyframes: updated })
                }}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.key}>Y</span>
              <input
                className={styles.input}
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={(kf.y ?? 0.5).toFixed(2)}
                onChange={(e) => {
                  const updated = [...zoomKeyframes]
                  const val = parseFloat(e.target.value)
                  updated[i] = { ...kf, y: isNaN(val) ? 0.5 : Math.max(0, Math.min(1, val)) }
                  onEditChange({ zoomKeyframes: updated })
                }}
              />
            </div>
            <button
              className={styles.removeKfBtn}
              onClick={() => {
                onEditChange({ zoomKeyframes: zoomKeyframes.filter((_, j) => j !== i) })
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

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

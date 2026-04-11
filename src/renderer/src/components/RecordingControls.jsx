import styles from './RecordingControls.module.css'

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function RecordingControls({ state, elapsed, onPause, onResume, onStop }) {
  return (
    <div className={styles.controls}>
      <div className={styles.indicator}>
        <div className={`${styles.dot} ${state === 'paused' ? styles.dotPaused : ''}`} />
        <span className={styles.time}>{formatTime(elapsed)}</span>
      </div>

      {state === 'recording' ? (
        <button className={styles.pauseBtn} onClick={onPause} title="Pause">
          ⏸
        </button>
      ) : (
        <button className={styles.resumeBtn} onClick={onResume} title="Resume">
          ▶
        </button>
      )}

      <button className={styles.stopBtn} onClick={onStop} title="Stop recording">
        ■
      </button>
    </div>
  )
}

export default RecordingControls

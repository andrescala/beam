import { useState, useEffect } from 'react'
import { useToast } from './Toast'
import styles from './WhisperStatus.module.css'

/**
 * Status chip for the local Whisper transcription stack.
 *
 * States: ready · model-missing (click to download) · downloading (live %) ·
 * error (click to retry) · not-installed (click for setup instructions).
 * The model also auto-downloads the first time transcription needs it, and
 * this chip picks up that progress via whisper-status-changed events.
 */
function WhisperStatus() {
  const showToast = useToast()
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let mounted = true
    window.electronAPI.whisperStatus().then((s) => {
      if (mounted) setStatus(s)
    }).catch(() => {})

    const off = window.electronAPI.onWhisperStatusChanged?.((s) => setStatus(s))
    return () => {
      mounted = false
      off?.()
    }
  }, [])

  async function handleClick() {
    if (!status) return
    if (status.status === 'not-installed') {
      showToast(
        'info',
        'Install the Whisper engine once: `brew install whisper-cpp` (macOS) or `pip install openai-whisper`. Beam downloads the model for you.'
      )
      // Re-check in case the user just installed it — but never let this stale
      // snapshot overwrite a live 'downloading' state pushed by an event (e.g.
      // an auto-download that started between the click and this resolving).
      window.electronAPI.whisperStatus()
        .then((fresh) => setStatus((prev) => (prev?.status === 'downloading' ? prev : fresh)))
        .catch(() => {})
      return
    }
    if (status.status === 'model-missing' || status.status === 'error') {
      showToast('info', `Downloading Whisper model (${status.modelSizeLabel})…`)
      const final = await window.electronAPI.whisperDownload()
      // Only apply the terminal result if a newer download isn't already in
      // flight (status events remain the source of truth while downloading).
      setStatus((prev) => (prev?.status === 'downloading' && final.status !== 'ready' && final.status !== 'error' ? prev : final))
      if (final.status === 'ready') {
        showToast('success', 'Whisper model downloaded — captions are ready')
      } else if (final.status === 'error') {
        showToast('error', `Model download failed: ${final.error || 'unknown error'}`)
      }
    }
  }

  if (!status) return null

  let dotClass = styles.dotGray
  let label = 'Whisper'
  let title = ''
  let clickable = false

  switch (status.status) {
    case 'ready':
      dotClass = styles.dotGreen
      label = 'Whisper ready'
      title = status.engine === 'openai-whisper'
        ? 'openai-whisper engine — manages its own models'
        : 'whisper.cpp engine — model downloaded'
      break
    case 'downloading':
      dotClass = styles.dotBlue
      label = `Downloading model… ${status.progress || 0}%`
      title = `Whisper model (${status.modelSizeLabel}) downloading`
      break
    case 'model-missing':
      dotClass = styles.dotAmber
      label = 'Model not downloaded'
      title = `Click to download the Whisper model (${status.modelSizeLabel}). It also downloads automatically on first transcription.`
      clickable = true
      break
    case 'error':
      dotClass = styles.dotRed
      label = 'Download failed — retry'
      title = status.error || 'Model download failed. Click to retry.'
      clickable = true
      break
    case 'not-installed':
      dotClass = styles.dotRed
      label = 'Whisper not installed'
      title = 'Click for setup instructions'
      clickable = true
      break
    default:
      break
  }

  return (
    <button
      className={`${styles.chip} ${clickable ? styles.chipClickable : ''}`}
      onClick={handleClick}
      title={title}
      type="button"
    >
      <span className={`${styles.dot} ${dotClass}`} />
      <span className={styles.label}>{label}</span>
      {status.status === 'downloading' && (
        <span className={styles.progressTrack}>
          <span className={styles.progressFill} style={{ width: `${status.progress || 0}%` }} />
        </span>
      )}
    </button>
  )
}

export default WhisperStatus

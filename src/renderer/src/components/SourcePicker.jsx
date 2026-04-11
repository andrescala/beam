import { useState, useEffect, useRef } from 'react'
import styles from './SourcePicker.module.css'

function SourcePicker({ onSelect, onCancel, webcamEnabled, onWebcamToggle, onStart, selectedSource }) {
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('screen')
  const [permissions, setPermissions] = useState(null)
  const webcamRef = useRef(null)
  const webcamStreamRef = useRef(null)

  useEffect(() => {
    checkPermissionsAndLoadSources()
    return () => {
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  useEffect(() => {
    if (webcamEnabled) {
      startWebcamPreview()
    } else {
      stopWebcamPreview()
    }
  }, [webcamEnabled])

  async function checkPermissionsAndLoadSources() {
    try {
      const perms = await window.electronAPI.requestPermissions()
      setPermissions(perms)

      const srcs = await window.electronAPI.getSources()
      setSources(srcs)
    } catch (err) {
      console.error('Failed to load sources:', err)
    } finally {
      setLoading(false)
    }
  }

  async function startWebcamPreview() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      webcamStreamRef.current = stream
      if (webcamRef.current) {
        webcamRef.current.srcObject = stream
      }
    } catch (err) {
      console.error('Webcam access failed:', err)
      onWebcamToggle(false)
    }
  }

  function stopWebcamPreview() {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((t) => t.stop())
      webcamStreamRef.current = null
    }
  }

  const screens = sources.filter((s) => s.id.startsWith('screen:'))
  const windows = sources.filter((s) => s.id.startsWith('window:'))
  const displayed = tab === 'screen' ? screens : windows

  const needsPermission = permissions && permissions.screen !== 'granted'
  const appName = permissions?.appName || 'Beam'

  if (needsPermission) {
    return (
      <div className={styles.container}>
        <div className={styles.permissionBlock}>
          <h2>Screen Recording Permission Required</h2>
          <p>
            To capture your screen, macOS needs you to grant permission to{' '}
            <strong>"{appName}"</strong>.
          </p>
          <div className={styles.permissionSteps}>
            <div className={styles.step}>
              <span className={styles.stepNum}>1</span>
              <span>Open <strong>System Settings → Privacy & Security → Screen Recording</strong></span>
            </div>
            <div className={styles.step}>
              <span className={styles.stepNum}>2</span>
              <span>Find <strong>"{appName}"</strong> in the list and toggle it on</span>
            </div>
            <div className={styles.step}>
              <span className={styles.stepNum}>3</span>
              <span>You may need to restart the app for the change to take effect</span>
            </div>
          </div>
          <p className={styles.permissionNote}>
            If "{appName}" doesn't appear in the list, click "Try Again" below — this will
            trigger macOS to add it.
          </p>
          <div className={styles.permissionActions}>
            <button className={styles.cancelBtn} onClick={onCancel}>Go Back</button>
            <button
              className={styles.retryBtn}
              onClick={() => {
                setLoading(true)
                setPermissions(null)
                checkPermissionsAndLoadSources()
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <header className={styles.header + ' titlebar-drag'}>
        <div className={styles.headerLeft}>
          <button className={styles.cancelBtn} onClick={onCancel}>← Cancel</button>
          <h2 className={styles.title}>Select Source</h2>
        </div>
        <button
          className={styles.startBtn}
          disabled={!selectedSource}
          onClick={onStart}
        >
          Start Recording
        </button>
      </header>

      <div className={styles.main}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'screen' ? styles.tabActive : ''}`}
            onClick={() => setTab('screen')}
          >
            Screens ({screens.length})
          </button>
          <button
            className={`${styles.tab} ${tab === 'window' ? styles.tabActive : ''}`}
            onClick={() => setTab('window')}
          >
            Windows ({windows.length})
          </button>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading sources...</div>
        ) : (
          <div className={styles.grid}>
            {displayed.map((source) => (
              <div
                key={source.id}
                className={`${styles.sourceCard} ${selectedSource?.id === source.id ? styles.selected : ''}`}
                onClick={() => onSelect(source)}
              >
                <img src={source.thumbnail} alt={source.name} className={styles.sourceThumb} />
                <div className={styles.sourceName}>{source.name}</div>
              </div>
            ))}
          </div>
        )}

        <div className={styles.webcamToggle}>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={webcamEnabled}
              onChange={(e) => onWebcamToggle(e.target.checked)}
            />
            <span>Webcam overlay</span>
          </label>
          {webcamEnabled && (
            <div className={styles.webcamPreview}>
              <video ref={webcamRef} autoPlay muted playsInline className={styles.webcamVideo} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SourcePicker

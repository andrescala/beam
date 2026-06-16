import { useState, useEffect, useRef } from 'react'
import styles from './SourcePicker.module.css'

function SourcePicker({ onSelect, onCancel, webcamEnabled, onWebcamToggle, systemAudioEnabled, onSystemAudioToggle, onStart, selectedSource, fps, onFpsChange, captureMode, onCaptureModeChange, region, onRegionChange }) {
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('screen')
  const [permissions, setPermissions] = useState(null)
  const [mics, setMics] = useState([])
  const [cameras, setCameras] = useState([])
  const [micDeviceId, setMicDeviceId] = useState('')
  const [cameraDeviceId, setCameraDeviceId] = useState('')
  const webcamRef = useRef(null)
  const webcamStreamRef = useRef(null)
  // Region selector (R4): a drag on the selected screen's preview, stored as
  // fractions of the screen (0..1). dragRef holds the in-progress drag origin.
  const regionBoxRef = useRef(null)
  const dragRef = useRef(null)

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
  }, [webcamEnabled, cameraDeviceId])

  async function checkPermissionsAndLoadSources() {
    try {
      const perms = await window.electronAPI.requestPermissions()
      setPermissions(perms)

      const srcs = await window.electronAPI.getSources()
      setSources(srcs)

      await loadDevices()
    } catch (err) {
      console.error('Failed to load sources:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadDevices() {
    try {
      const prefs = await window.electronAPI.getPreferences()
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      const videoInputs = devices.filter((d) => d.kind === 'videoinput')
      setMics(audioInputs)
      setCameras(videoInputs)
      // Only restore a saved device if it's still connected
      if (prefs.micDeviceId && audioInputs.some((d) => d.deviceId === prefs.micDeviceId)) {
        setMicDeviceId(prefs.micDeviceId)
      }
      if (prefs.cameraDeviceId && videoInputs.some((d) => d.deviceId === prefs.cameraDeviceId)) {
        setCameraDeviceId(prefs.cameraDeviceId)
      }
    } catch (err) {
      console.warn('Device enumeration failed:', err)
    }
  }

  function handleMicChange(deviceId) {
    setMicDeviceId(deviceId)
    window.electronAPI.setPreferences({ micDeviceId: deviceId }).catch(() => {})
  }

  function handleCameraChange(deviceId) {
    setCameraDeviceId(deviceId)
    window.electronAPI.setPreferences({ cameraDeviceId: deviceId }).catch(() => {})
  }

  async function startWebcamPreview() {
    stopWebcamPreview()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraDeviceId ? { deviceId: { ideal: cameraDeviceId } } : true
      })
      webcamStreamRef.current = stream
      if (webcamRef.current) {
        webcamRef.current.srcObject = stream
      }
      // Granting camera access unlocks real device labels — re-enumerate so
      // the picker shows proper names instead of "Camera"/"Microphone".
      loadDevices()
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

  // ── Region drag selection (R4) ──
  // Convert a pointer event to fractional coords inside the preview box,
  // clamped to [0,1] so the rect never escapes the screen bounds.
  function pointToFraction(e) {
    const rect = regionBoxRef.current.getBoundingClientRect()
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    return { fx, fy }
  }

  function handleRegionPointerDown(e) {
    if (!regionBoxRef.current) return
    e.preventDefault()
    const { fx, fy } = pointToFraction(e)
    dragRef.current = { fx, fy }
    onRegionChange({ x: fx, y: fy, width: 0, height: 0 })
  }

  function handleRegionPointerMove(e) {
    if (!dragRef.current) return
    const { fx, fy } = pointToFraction(e)
    const start = dragRef.current
    onRegionChange({
      x: Math.min(start.fx, fx),
      y: Math.min(start.fy, fy),
      width: Math.abs(fx - start.fx),
      height: Math.abs(fy - start.fy)
    })
  }

  function handleRegionPointerUp() {
    if (!dragRef.current) return
    dragRef.current = null
    // Discard accidental clicks (a near-zero rect isn't a usable region).
    if (region && (region.width < 0.02 || region.height < 0.02)) {
      onRegionChange(null)
    }
  }

  const isScreenSelected = selectedSource && selectedSource.id.startsWith('screen:')

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
                onClick={() => {
                  onSelect(source)
                  // Region capture only applies to whole screens; reset it when
                  // a window is chosen so a stale crop isn't recorded.
                  if (!source.id.startsWith('screen:')) {
                    onCaptureModeChange('full')
                    onRegionChange(null)
                  }
                }}
              >
                <img src={source.thumbnail} alt={source.name} className={styles.sourceThumb} />
                <div className={styles.sourceName}>{source.name}</div>
              </div>
            ))}
          </div>
        )}

        {/* Capture options (R4 region + R9 fps) */}
        <div className={styles.captureOptions}>
          <div className={styles.optionRow}>
            <span className={styles.optionLabel}>Frame rate</span>
            <div className={styles.segmented}>
              <button
                type="button"
                className={`${styles.segBtn} ${fps === 30 ? styles.segActive : ''}`}
                onClick={() => onFpsChange(30)}
              >
                30 fps
              </button>
              <button
                type="button"
                className={`${styles.segBtn} ${fps === 60 ? styles.segActive : ''}`}
                onClick={() => onFpsChange(60)}
              >
                60 fps
              </button>
            </div>
          </div>

          {isScreenSelected && (
            <div className={styles.optionRow}>
              <span className={styles.optionLabel}>Capture</span>
              <div className={styles.segmented}>
                <button
                  type="button"
                  className={`${styles.segBtn} ${captureMode === 'full' ? styles.segActive : ''}`}
                  onClick={() => {
                    onCaptureModeChange('full')
                    onRegionChange(null)
                  }}
                >
                  Full screen
                </button>
                <button
                  type="button"
                  className={`${styles.segBtn} ${captureMode === 'region' ? styles.segActive : ''}`}
                  onClick={() => onCaptureModeChange('region')}
                >
                  Region
                </button>
              </div>
            </div>
          )}

          {isScreenSelected && captureMode === 'region' && (
            <div className={styles.regionPicker}>
              <div className={styles.regionHint}>
                Drag on the preview to select the area to record. The full screen is
                recorded; the region is applied as a crop you can adjust later.
              </div>
              <div
                ref={regionBoxRef}
                className={styles.regionBox}
                onPointerDown={handleRegionPointerDown}
                onPointerMove={handleRegionPointerMove}
                onPointerUp={handleRegionPointerUp}
                onPointerLeave={handleRegionPointerUp}
              >
                <img
                  src={selectedSource.thumbnail}
                  alt={selectedSource.name}
                  className={styles.regionImg}
                  draggable={false}
                />
                {region && region.width > 0 && region.height > 0 && (
                  <div
                    className={styles.regionRect}
                    style={{
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.width * 100}%`,
                      height: `${region.height * 100}%`
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        <div className={styles.webcamToggle}>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={systemAudioEnabled}
              onChange={(e) => onSystemAudioToggle(e.target.checked)}
            />
            <span>System audio</span>
          </label>

          {mics.length > 0 && (
            <div className={styles.deviceRow}>
              <span className={styles.deviceLabel}>Microphone</span>
              <select
                className={styles.deviceSelect}
                value={micDeviceId}
                onChange={(e) => handleMicChange(e.target.value)}
              >
                <option value="">System default</option>
                {mics.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Microphone'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={webcamEnabled}
              onChange={(e) => onWebcamToggle(e.target.checked)}
            />
            <span>Webcam overlay</span>
          </label>
          {webcamEnabled && cameras.length > 1 && (
            <div className={styles.deviceRow}>
              <span className={styles.deviceLabel}>Camera</span>
              <select
                className={styles.deviceSelect}
                value={cameraDeviceId}
                onChange={(e) => handleCameraChange(e.target.value)}
              >
                <option value="">System default</option>
                {cameras.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Camera'}
                  </option>
                ))}
              </select>
            </div>
          )}
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

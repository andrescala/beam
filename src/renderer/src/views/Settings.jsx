import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toast'
import styles from './Settings.module.css'

function formatBytes(bytes) {
  if (!bytes || bytes < 1) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function whisperLabel(status) {
  if (!status) return 'Checking…'
  switch (status.status) {
    case 'ready':
      return `Ready${status.engine ? ` (${status.engine})` : ''}`
    case 'downloading':
      return `Downloading model… ${status.progress ?? 0}%`
    case 'model-missing':
      return `Model not downloaded (${status.modelSizeLabel || ''})`
    case 'error':
      return `Error: ${status.error || 'unknown'}`
    case 'not-installed':
      return 'Not installed'
    default:
      return status.status
  }
}

function Settings() {
  const navigate = useNavigate()
  const showToast = useToast()
  const [prefs, setPrefs] = useState(null)
  const [whisper, setWhisper] = useState(null)
  const [projectsDir, setProjectsDir] = useState('')
  const [storage, setStorage] = useState(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)

  useEffect(() => {
    window.electronAPI.getPreferences().then(setPrefs).catch(() => {})
    window.electronAPI.whisperStatus?.().then(setWhisper).catch(() => {})
    window.electronAPI.getProjectsDir?.().then(setProjectsDir).catch(() => {})
    window.electronAPI.getStorageUsage?.().then(setStorage).catch(() => {})

    const offWhisper = window.electronAPI.onWhisperStatusChanged?.((status) => {
      setWhisper(status)
    })
    return () => offWhisper?.()
  }, [])

  // Update one pref locally and persist it immediately.
  async function update(key, value) {
    setPrefs((prev) => ({ ...prev, [key]: value }))
    try {
      await window.electronAPI.setPreferences({ [key]: value })
    } catch (err) {
      showToast('error', 'Failed to save setting')
    }
  }

  async function handleCheckUpdates() {
    setCheckingUpdates(true)
    try {
      const result = await window.electronAPI.checkForUpdates?.()
      if (!result || result.ok === false) {
        if (result?.reason === 'dev-or-unpackaged') {
          showToast('info', 'Updates are only checked in the packaged app.')
        } else {
          showToast('info', 'No updates available right now.')
        }
      } else {
        showToast('success', 'Checking for updates…')
      }
    } catch (err) {
      showToast('error', 'Update check failed')
    } finally {
      setCheckingUpdates(false)
    }
  }

  function openProjectsFolder() {
    if (projectsDir) window.electronAPI.showInFolder?.(projectsDir)
  }

  if (!prefs) {
    return (
      <div className={styles.container}>
        <header className={styles.header + ' titlebar-drag'}>
          <div className={styles.headerLeft}>
            <button className={styles.backBtn} onClick={() => navigate('/')}>
              {'←'} Home
            </button>
            <h1 className={styles.title}>Settings</h1>
          </div>
        </header>
        <main className={styles.main}>
          <div className={styles.loading}>Loading…</div>
        </main>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <header className={styles.header + ' titlebar-drag'}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={() => navigate('/')}>
            {'←'} Home
          </button>
          <h1 className={styles.title}>Settings</h1>
        </div>
      </header>

      <main className={styles.main}>
        {/* Recording defaults */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Recording</h2>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Countdown duration</span>
              <span className={styles.hint}>Seconds before recording starts.</span>
            </div>
            <select
              className={styles.select}
              value={prefs.countdownDuration ?? 3}
              onChange={(e) => update('countdownDuration', Number(e.target.value))}
            >
              <option value={0}>None</option>
              <option value={3}>3 seconds</option>
              <option value={5}>5 seconds</option>
              <option value={10}>10 seconds</option>
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Webcam on by default</span>
              <span className={styles.hint}>Enable the webcam overlay for new recordings.</span>
            </div>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={!!prefs.webcamEnabled}
                onChange={(e) => update('webcamEnabled', e.target.checked)}
              />
              <span className={styles.toggleTrack} />
            </label>
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Capture system audio by default</span>
              <span className={styles.hint}>Record audio playing on your computer.</span>
            </div>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={!!prefs.systemAudioEnabled}
                onChange={(e) => update('systemAudioEnabled', e.target.checked)}
              />
              <span className={styles.toggleTrack} />
            </label>
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Default microphone</span>
              <span className={styles.hint}>Saved device ID used for new recordings.</span>
            </div>
            <input
              className={styles.input}
              type="text"
              placeholder="System default"
              value={prefs.micDeviceId || ''}
              onChange={(e) => update('micDeviceId', e.target.value)}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Default camera</span>
              <span className={styles.hint}>Saved device ID used for the webcam overlay.</span>
            </div>
            <input
              className={styles.input}
              type="text"
              placeholder="System default"
              value={prefs.cameraDeviceId || ''}
              onChange={(e) => update('cameraDeviceId', e.target.value)}
            />
          </div>
        </section>

        {/* Export defaults */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Export</h2>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Default format</span>
            </div>
            <select
              className={styles.select}
              value={prefs.defaultFormat ?? 'mp4'}
              onChange={(e) => update('defaultFormat', e.target.value)}
            >
              <option value="mp4">MP4 (H.264)</option>
              <option value="gif">GIF</option>
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Default quality</span>
            </div>
            <select
              className={styles.select}
              value={prefs.defaultQuality ?? 'balanced'}
              onChange={(e) => update('defaultQuality', e.target.value)}
            >
              <option value="high">High</option>
              <option value="balanced">Balanced</option>
              <option value="small">Small file</option>
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Normalize loudness</span>
              <span className={styles.hint}>Level out audio volume on export by default.</span>
            </div>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={!!prefs.normalizeLoudness}
                onChange={(e) => update('normalizeLoudness', e.target.checked)}
              />
              <span className={styles.toggleTrack} />
            </label>
          </div>
        </section>

        {/* AI / Whisper */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>AI & Captions</h2>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Claude API key</span>
              <span className={styles.hint}>Optional. Stored locally for AI-assisted features.</span>
            </div>
            <input
              className={styles.input}
              type="password"
              placeholder="sk-ant-…"
              value={prefs.claudeApiKey || ''}
              onChange={(e) => update('claudeApiKey', e.target.value)}
            />
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Whisper engine</span>
              <span className={styles.hint}>Local speech-to-text used to generate captions.</span>
            </div>
            <span className={styles.statusChip}>{whisperLabel(whisper)}</span>
          </div>
        </section>

        {/* Storage */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Storage</h2>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Projects location</span>
              <span className={styles.hint}>{projectsDir || '~/Beam/projects'}</span>
            </div>
            <button className={styles.button} onClick={openProjectsFolder} disabled={!projectsDir}>
              Open Folder
            </button>
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Storage used</span>
              <span className={styles.hint}>
                {storage ? `${storage.projectCount} project(s)` : 'Calculating…'}
              </span>
            </div>
            <span className={styles.statusChip}>
              {storage ? formatBytes(storage.bytes) : '—'}
            </span>
          </div>
        </section>

        {/* Appearance */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Theme</span>
              <span className={styles.hint}>Interface color theme.</span>
            </div>
            <select
              className={styles.select}
              value={prefs.theme ?? 'dark'}
              onChange={(e) => update('theme', e.target.value)}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>
        </section>

        {/* Updates */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Updates</h2>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Release channel</span>
              <span className={styles.hint}>Which builds Beam updates to.</span>
            </div>
            <select
              className={styles.select}
              value={prefs.updateChannel ?? 'latest'}
              onChange={(e) => update('updateChannel', e.target.value)}
            >
              <option value="latest">Stable (latest)</option>
              <option value="beta">Beta</option>
              <option value="alpha">Alpha</option>
            </select>
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Check for updates</span>
              <span className={styles.hint}>Updates download automatically and install on restart.</span>
            </div>
            <button
              className={styles.button}
              onClick={handleCheckUpdates}
              disabled={checkingUpdates}
            >
              {checkingUpdates ? 'Checking…' : 'Check Now'}
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}

export default Settings

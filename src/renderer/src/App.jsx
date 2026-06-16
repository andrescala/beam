import { useEffect } from 'react'
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { ToastProvider, useToast } from './components/Toast'
import Home from './views/Home'
import Recorder from './views/Recorder'
import Editor from './views/Editor'
import Settings from './views/Settings'

// Routes tray actions and the global record hotkey from the main process.
// If the recorder is already mounted it owns the toggle (stop while
// recording); otherwise we navigate to it.
function GlobalShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const offTray = window.electronAPI.onTrayNewRecording?.(() => {
      if (location.pathname !== '/recorder') {
        navigate('/recorder')
      }
    })
    const offShortcut = window.electronAPI.onShortcutRecordToggle?.(() => {
      if (location.pathname === '/recorder') {
        window.dispatchEvent(new CustomEvent('beam:record-toggle'))
      } else {
        navigate('/recorder')
      }
    })
    return () => {
      offTray?.()
      offShortcut?.()
    }
  }, [navigate, location.pathname])

  return null
}

// Surfaces auto-update events from the main process as non-intrusive toasts.
function UpdateNotifier() {
  const showToast = useToast()

  useEffect(() => {
    const offAvailable = window.electronAPI.onUpdateAvailable?.((info) => {
      const v = info?.version ? ` (v${info.version})` : ''
      showToast('info', `Update available${v} — downloading in the background…`)
    })
    const offDownloaded = window.electronAPI.onUpdateDownloaded?.((info) => {
      const v = info?.version ? ` (v${info.version})` : ''
      showToast('success', `Update ready${v} — it will install on restart.`, 8000)
    })
    return () => {
      offAvailable?.()
      offDownloaded?.()
    }
  }, [showToast])

  return null
}

function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <GlobalShortcuts />
        <UpdateNotifier />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/recorder" element={<Recorder />} />
          <Route path="/editor/:projectId" element={<Editor />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  )
}

export default App

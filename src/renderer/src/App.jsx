import { useEffect } from 'react'
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { ToastProvider } from './components/Toast'
import Home from './views/Home'
import Recorder from './views/Recorder'
import Editor from './views/Editor'

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

function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <GlobalShortcuts />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/recorder" element={<Recorder />} />
          <Route path="/editor/:projectId" element={<Editor />} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  )
}

export default App

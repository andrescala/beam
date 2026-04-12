import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import VideoPreview from '../components/VideoPreview'
import Timeline from '../components/Timeline'
import Inspector from '../components/Inspector'
import LayerPanel from '../components/LayerPanel'
import CaptionEditor from '../components/CaptionEditor'
import AssetLibrary from '../components/AssetLibrary'
import ExportModal from '../components/ExportModal'
import HelpDrawer from '../components/HelpDrawer'
import { useToast } from '../components/Toast'
import styles from './Editor.module.css'

function Editor() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const showToast = useToast()
  const [project, setProject] = useState(null)
  const [projectPath, setProjectPath] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [bottomTab, setBottomTab] = useState('timeline') // timeline, layers, assets, captions
  const videoRef = useRef(null)

  useEffect(() => {
    loadProject()
  }, [projectId])

  async function loadProject() {
    try {
      const [data, path] = await Promise.all([
        window.electronAPI.loadProject(projectId),
        window.electronAPI.getProjectPath(projectId)
      ])
      setProject(data)
      setProjectPath(path)
    } catch (err) {
      console.error('Failed to load project:', err)
      setError(err.message || 'Failed to load project')
      showToast('error', 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const updateEdit = useCallback((editUpdates) => {
    setProject((prev) => {
      if (!prev) return prev
      const updated = { ...prev, edit: { ...prev.edit, ...editUpdates } }
      // Save to disk asynchronously (fire-and-forget with error logging)
      window.electronAPI.saveProject(projectId, updated).catch((err) => {
        console.error('Failed to save edit:', err)
      })
      return updated
    })
  }, [projectId])

  function handleSeek(time) {
    setCurrentTime(time)
    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
  }

  function togglePlay() {
    if (!videoRef.current) return
    if (playing) {
      videoRef.current.pause()
    } else {
      // If video ended, seek to start before playing
      if (videoRef.current.ended) {
        videoRef.current.currentTime = project.edit?.trimStart || 0
        setCurrentTime(project.edit?.trimStart || 0)
      }
      videoRef.current.play()
    }
    setPlaying(!playing)
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e) {
      // Don't trigger when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [playing, project])

  if (loading) {
    return <div className={styles.loading}>Loading project...</div>
  }

  if (!project || error) {
    return (
      <div className={styles.loading}>
        <p>{error || 'Project not found.'}</p>
        <button className={styles.backBtn} onClick={() => navigate('/')}>&#x2190; Go Home</button>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <header className={styles.titlebar + ' titlebar-drag'}>
        <div className={styles.titlebarLeft}>
          <button className={styles.backBtn} onClick={() => navigate('/')}>
            &#x2190; Home
          </button>
          <span className={styles.projectName}>{project.name}</span>
        </div>
        <div className={styles.titlebarRight}>
          <button className={styles.helpBtn} onClick={() => setHelpOpen(true)} title="Help & tutorials">
            ?
          </button>
          <button className={styles.exportBtn} onClick={() => setExporting(true)}>
            Export
          </button>
        </div>
      </header>

      <div className={styles.mainArea}>
        <div className={styles.centerCol}>
          <VideoPreview
            project={project}
            projectPath={projectPath}
            videoRef={videoRef}
            currentTime={currentTime}
            playing={playing}
            onTimeUpdate={setCurrentTime}
            onTogglePlay={togglePlay}
            onEnded={() => setPlaying(false)}
          />

          {/* Bottom panel tabs */}
          <div className={styles.bottomTabs}>
            <button
              className={`${styles.tabBtn} ${bottomTab === 'timeline' ? styles.tabBtnActive : ''}`}
              onClick={() => setBottomTab('timeline')}
            >
              Timeline
            </button>
            <button
              className={`${styles.tabBtn} ${bottomTab === 'layers' ? styles.tabBtnActive : ''}`}
              onClick={() => setBottomTab('layers')}
            >
              Layers
            </button>
            <button
              className={`${styles.tabBtn} ${bottomTab === 'assets' ? styles.tabBtnActive : ''}`}
              onClick={() => setBottomTab('assets')}
            >
              Assets
            </button>
            <button
              className={`${styles.tabBtn} ${bottomTab === 'captions' ? styles.tabBtnActive : ''}`}
              onClick={() => setBottomTab('captions')}
            >
              Captions {(project.edit?.captions?.length || 0) > 0 && `(${project.edit.captions.length})`}
            </button>
          </div>

          <div className={styles.bottomPanel}>
            {bottomTab === 'timeline' && (
              <Timeline
                project={project}
                projectId={projectId}
                currentTime={currentTime}
                onSeek={handleSeek}
                onTrimChange={updateEdit}
                onCutsChange={updateEdit}
              />
            )}
            {bottomTab === 'layers' && (
              <LayerPanel
                project={project}
                projectId={projectId}
                currentTime={currentTime}
                onEditChange={updateEdit}
              />
            )}
            {bottomTab === 'assets' && (
              <AssetLibrary
                project={project}
                projectId={projectId}
                currentTime={currentTime}
                onEditChange={updateEdit}
              />
            )}
            {bottomTab === 'captions' && (
              <CaptionEditor
                project={project}
                projectId={projectId}
                currentTime={currentTime}
                onEditChange={updateEdit}
              />
            )}
          </div>
        </div>

        <Inspector
          project={project}
          projectId={projectId}
          onEditChange={updateEdit}
        />
      </div>

      {exporting && (
        <ExportModal
          project={project}
          onClose={() => setExporting(false)}
        />
      )}

      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}

export default Editor

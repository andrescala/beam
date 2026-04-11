import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import VideoPreview from '../components/VideoPreview'
import Timeline from '../components/Timeline'
import Inspector from '../components/Inspector'
import ExportModal from '../components/ExportModal'
import styles from './Editor.module.css'

function Editor() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [projectPath, setProjectPath] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [exporting, setExporting] = useState(false)
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
      console.log('Loaded project:', data)
      console.log('Project path:', path)
      setProject(data)
      setProjectPath(path)
    } catch (err) {
      console.error('Failed to load project:', err)
      setError(err.message || 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const updateProject = useCallback(async (updates) => {
    const updated = { ...project, ...updates }
    setProject(updated)
    await window.electronAPI.saveProject(projectId, updated)
  }, [project, projectId])

  const updateEdit = useCallback(async (editUpdates) => {
    const updated = { ...project, edit: { ...project.edit, ...editUpdates } }
    setProject(updated)
    await window.electronAPI.saveProject(projectId, updated)
  }, [project, projectId])

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
      videoRef.current.play()
    }
    setPlaying(!playing)
  }

  if (loading) {
    return <div className={styles.loading}>Loading project...</div>
  }

  if (!project || error) {
    return (
      <div className={styles.loading}>
        <p>{error || 'Project not found.'}</p>
        <button className={styles.backBtn} onClick={() => navigate('/')}>← Go Home</button>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <header className={styles.titlebar + ' titlebar-drag'}>
        <div className={styles.titlebarLeft}>
          <button className={styles.backBtn} onClick={() => navigate('/')}>
            ← Home
          </button>
          <span className={styles.projectName}>{project.name}</span>
        </div>
        <div className={styles.titlebarRight}>
          <button className={styles.exportBtn} onClick={() => setExporting(true)}>
            Export MP4
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
          <Timeline
            project={project}
            currentTime={currentTime}
            onSeek={handleSeek}
            onTrimChange={updateEdit}
          />
        </div>

        <Inspector
          project={project}
          onEditChange={updateEdit}
        />
      </div>

      {exporting && (
        <ExportModal
          project={project}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  )
}

export default Editor

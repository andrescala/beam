import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import VideoPreview from '../components/VideoPreview'
import Timeline from '../components/Timeline'
import Inspector from '../components/Inspector'
import LayerPanel from '../components/LayerPanel'
import CaptionEditor from '../components/CaptionEditor'
import TranscriptPanel from '../components/TranscriptPanel'
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
  const [seekKey, setSeekKey] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [bottomTab, setBottomTab] = useState('timeline') // timeline, layers, assets, captions, transcript
  const [addingClip, setAddingClip] = useState(false)
  const videoRef = useRef(null)

  // Undo/redo history. Kept in refs (not state) so pushes from rapid slider
  // drags don't re-render, and so StrictMode's double-invoked updaters can't
  // corrupt it. `historyVersion` only refreshes the toolbar button state.
  const projectRef = useRef(null)
  const currentTimeRef = useRef(0)
  const historyRef = useRef({ past: [], future: [] })
  const lastPushRef = useRef(0)
  const [, setHistoryVersion] = useState(0)

  useEffect(() => {
    projectRef.current = project
  }, [project])

  // Keep a ref of the playhead so the keyboard handler reads a fresh value
  // even when the <video> element isn't mounted (it isn't in the effect deps).
  useEffect(() => {
    currentTimeRef.current = currentTime
  }, [currentTime])

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
      historyRef.current = { past: [], future: [] }
      setHistoryVersion((v) => v + 1)
    } catch (err) {
      console.error('Failed to load project:', err)
      setError(err.message || 'Failed to load project')
      showToast('error', 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  async function handleAddClip() {
    setAddingClip(true)
    try {
      const result = await window.electronAPI.appendClip(projectId)
      if (!result) return // dialog cancelled
      if (result.error) {
        showToast('error', `Couldn't add clip: ${result.error}`)
        return
      }
      // Reload from disk so the new media + timeline clip are reflected, and
      // reset history (the timeline structure changed underneath it).
      setProject(result.project)
      projectRef.current = result.project
      historyRef.current = { past: [], future: [] }
      setHistoryVersion((v) => v + 1)
      showToast('success', 'Clip added to the timeline')
    } catch (err) {
      showToast('error', "Couldn't add clip")
    } finally {
      setAddingClip(false)
    }
  }

  function applyProject(updated) {
    projectRef.current = updated
    setProject(updated)
    // Save to disk asynchronously (fire-and-forget with error logging)
    window.electronAPI.saveProject(projectId, updated).catch((err) => {
      console.error('Failed to save edit:', err)
    })
  }

  const updateEdit = useCallback((editUpdates) => {
    const prev = projectRef.current
    if (!prev) return
    const h = historyRef.current
    // Coalesce bursts (slider drags) into one undo step: only snapshot when
    // the last push was a moment ago.
    const now = Date.now()
    if (now - lastPushRef.current > 800 || h.past.length === 0) {
      h.past.push(prev.edit)
      if (h.past.length > 100) h.past.shift()
    }
    lastPushRef.current = now
    h.future = []
    applyProject({ ...prev, edit: { ...prev.edit, ...editUpdates } })
    setHistoryVersion((v) => v + 1)
  }, [projectId])

  const undo = useCallback(() => {
    const prev = projectRef.current
    const h = historyRef.current
    if (!prev || h.past.length === 0) return
    const restored = h.past.pop()
    h.future.push(prev.edit)
    lastPushRef.current = 0
    applyProject({ ...prev, edit: restored })
    setHistoryVersion((v) => v + 1)
  }, [projectId])

  const redo = useCallback(() => {
    const prev = projectRef.current
    const h = historyRef.current
    if (!prev || h.future.length === 0) return
    const restored = h.future.pop()
    h.past.push(prev.edit)
    lastPushRef.current = 0
    applyProject({ ...prev, edit: restored })
    setHistoryVersion((v) => v + 1)
  }, [projectId])

  const canUndo = historyRef.current.past.length > 0
  const canRedo = historyRef.current.future.length > 0

  function handleSeek(time) {
    setCurrentTime(time)
    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
    // Signal to VideoPreview that this was an explicit user seek (vs. a
    // natural time update during playback) — it uses this to sync webcam,
    // mic, and any other time-bound layers immediately.
    setSeekKey((k) => k + 1)
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

      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod) return

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
        return
      }

      const p = projectRef.current
      if (!p) return
      const duration = p.duration || 0
      const t = videoRef.current ? videoRef.current.currentTime : currentTimeRef.current
      const frameStep = e.shiftKey ? 1 : 1 / 30

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          handleSeek(Math.max(0, t - frameStep))
          break
        case 'ArrowRight':
          e.preventDefault()
          handleSeek(Math.min(duration, t + frameStep))
          break
        case 'Home':
          e.preventDefault()
          handleSeek(p.edit?.trimStart || 0)
          break
        case 'End':
          e.preventDefault()
          handleSeek(p.edit?.trimEnd || duration)
          break
        case 'i':
        case 'I':
          e.preventDefault()
          updateEdit({ trimStart: Math.min(t, (p.edit?.trimEnd ?? duration) - 0.1) })
          break
        case 'o':
        case 'O':
          e.preventDefault()
          updateEdit({ trimEnd: Math.max(t, (p.edit?.trimStart || 0) + 0.1) })
          break
        case '?':
          setHelpOpen(true)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [playing, project, undo, redo, updateEdit])

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
          <button
            className={styles.helpBtn}
            onClick={undo}
            disabled={!canUndo}
            style={!canUndo ? { opacity: 0.35, cursor: 'default' } : undefined}
            title="Undo (Cmd/Ctrl+Z)"
          >
            &#x21B6;
          </button>
          <button
            className={styles.helpBtn}
            onClick={redo}
            disabled={!canRedo}
            style={!canRedo ? { opacity: 0.35, cursor: 'default' } : undefined}
            title="Redo (Cmd/Ctrl+Shift+Z)"
          >
            &#x21B7;
          </button>
          <button className={styles.helpBtn} onClick={() => setHelpOpen(true)} title="Help & tutorials">
            ?
          </button>
          <button
            className={styles.helpBtn}
            onClick={handleAddClip}
            disabled={addingClip}
            title="Append another video to the timeline"
            style={{ width: 'auto', padding: '0 10px' }}
          >
            {addingClip ? '…' : '+ Clip'}
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
            seekKey={seekKey}
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
            <button
              className={`${styles.tabBtn} ${bottomTab === 'transcript' ? styles.tabBtnActive : ''}`}
              onClick={() => setBottomTab('transcript')}
            >
              Transcript {(project.edit?.transcript?.segments?.length || 0) > 0 && `(${project.edit.transcript.segments.length})`}
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
                onEditChange={updateEdit}
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
            {bottomTab === 'transcript' && (
              <TranscriptPanel
                project={project}
                projectId={projectId}
                currentTime={currentTime}
                onSeek={handleSeek}
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

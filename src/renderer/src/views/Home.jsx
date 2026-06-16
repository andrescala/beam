import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import ProjectCard from '../components/ProjectCard'
import HelpDrawer from '../components/HelpDrawer'
import WelcomeModal from '../components/WelcomeModal'
import { useToast } from '../components/Toast'
import styles from './Home.module.css'

function formatBytes(bytes) {
  if (!bytes || bytes < 1) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function Home() {
  const navigate = useNavigate()
  const showToast = useToast()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [helpOpen, setHelpOpen] = useState(false)
  const [showWelcome, setShowWelcome] = useState(false)
  const [importingVideo, setImportingVideo] = useState(null) // null | progress %
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('date-new') // date-new | date-old | name | duration
  const [storage, setStorage] = useState(null)
  const [tagInput, setTagInput] = useState(null) // { id, value } | null

  useEffect(() => {
    loadProjects()
    refreshStorage()
    // Show welcome modal on first launch
    window.electronAPI.getPreferences().then((prefs) => {
      if (!prefs.hasSeenWelcome) {
        setShowWelcome(true)
      }
    }).catch(() => {})

    const offProgress = window.electronAPI.onImportProgress?.((percent) => {
      setImportingVideo((current) => (current === null ? current : percent))
    })
    return () => offProgress?.()
  }, [])

  async function refreshStorage() {
    try {
      const usage = await window.electronAPI.getStorageUsage?.()
      if (usage) setStorage(usage)
    } catch {
      // Storage usage is best-effort
    }
  }

  async function loadProjects() {
    try {
      const list = await window.electronAPI.listProjects()
      // listProjects() returns a summary without tags; enrich with each
      // project's tags so we can search/display them on the grid.
      const enriched = await Promise.all(
        list.map(async (p) => {
          try {
            const full = await window.electronAPI.loadProject(p.id)
            return { ...p, tags: Array.isArray(full?.tags) ? full.tags : [] }
          } catch {
            return { ...p, tags: [] }
          }
        })
      )
      setProjects(enriched)
    } catch (err) {
      console.error('Failed to load projects:', err)
      showToast('error', 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id) {
    const deleted = await window.electronAPI.deleteProject(id)
    if (deleted) {
      setProjects((prev) => prev.filter((p) => p.id !== id))
      showToast('success', 'Project deleted')
      refreshStorage()
    }
  }

  async function handleRename(id, newName) {
    try {
      const project = await window.electronAPI.loadProject(id)
      project.name = newName
      await window.electronAPI.saveProject(id, project)
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: newName } : p))
      )
    } catch (err) {
      console.error('Failed to rename project:', err)
      showToast('error', 'Failed to rename project')
    }
  }

  // Persist tags onto the project.json via the existing save flow.
  async function handleSetTags(id, tags) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, tags } : p)))
    try {
      const project = await window.electronAPI.loadProject(id)
      project.tags = tags
      await window.electronAPI.saveProject(id, project)
    } catch (err) {
      console.error('Failed to save tags:', err)
      showToast('error', 'Failed to save tags')
    }
  }

  function commitTag(id) {
    if (!tagInput || tagInput.id !== id) return
    const value = tagInput.value.trim()
    setTagInput(null)
    if (!value) return
    const project = projects.find((p) => p.id === id)
    const existing = project?.tags || []
    if (existing.includes(value)) return
    handleSetTags(id, [...existing, value])
  }

  function removeTag(id, tag) {
    const project = projects.find((p) => p.id === id)
    const existing = project?.tags || []
    handleSetTags(id, existing.filter((t) => t !== tag))
  }

  async function handleImportVideo() {
    try {
      setImportingVideo(0)
      const result = await window.electronAPI.importVideo()
      if (!result) {
        setImportingVideo(null)
        return // dialog cancelled
      }
      if (result.error) {
        setImportingVideo(null)
        showToast('error', `Import failed: ${result.error}`)
        return
      }
      setImportingVideo(null)
      showToast('success', `Imported: ${result.project.name}`)
      navigate(`/editor/${result.project.id}`)
    } catch (err) {
      setImportingVideo(null)
      showToast('error', 'Failed to import video')
    }
  }

  async function handleImportProject() {
    try {
      const result = await window.electronAPI.importProjectZip()
      if (!result) return
      if (result.error) {
        showToast('error', result.error)
        return
      }
      showToast('success', `Imported: ${result.project.name}`)
      loadProjects()
      refreshStorage()
    } catch (err) {
      showToast('error', 'Failed to import project')
    }
  }

  const visibleProjects = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = projects
    if (q) {
      list = list.filter((p) => {
        const inName = (p.name || '').toLowerCase().includes(q)
        const inTags = (p.tags || []).some((t) => t.toLowerCase().includes(q))
        return inName || inTags
      })
    }
    const sorted = [...list]
    switch (sort) {
      case 'date-old':
        sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        break
      case 'name':
        sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        break
      case 'duration':
        sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0))
        break
      case 'date-new':
      default:
        sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        break
    }
    return sorted
  }, [projects, search, sort])

  return (
    <div className={styles.container}>
      <header className={styles.header + ' titlebar-drag'}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Beam</h1>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.helpBtn} onClick={() => setHelpOpen(true)} title="Help & tutorials">
            ?
          </button>
          <button
            className={styles.helpBtn}
            onClick={() => navigate('/settings')}
            title="Settings"
            aria-label="Settings"
          >
            {'⚙'}
          </button>
          <button className={styles.importBtn} onClick={handleImportProject}>
            Import
          </button>
          <button
            className={styles.importBtn}
            onClick={handleImportVideo}
            disabled={importingVideo !== null}
            title="Edit a video not recorded in Beam (MP4, MOV, WebM, MKV)"
          >
            {importingVideo !== null ? `Importing… ${importingVideo}%` : 'Import Video'}
          </button>
          <button className={styles.newBtn} onClick={() => navigate('/recorder')}>
            New Recording
          </button>
        </div>
      </header>

      {!loading && projects.length > 0 && (
        <div className={styles.toolbar}>
          <input
            className={styles.searchBox}
            type="text"
            placeholder="Search projects or tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className={styles.sortSelect}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            title="Sort projects"
          >
            <option value="date-new">Newest first</option>
            <option value="date-old">Oldest first</option>
            <option value="name">Name (A–Z)</option>
            <option value="duration">Duration</option>
          </select>
          <span className={styles.storage}>
            {storage ? `${formatBytes(storage.bytes)} used` : ''}
          </span>
        </div>
      )}

      <main className={styles.main}>
        {loading ? (
          <div className={styles.empty}>Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>&#x2299;</div>
            <p className={styles.emptyTitle}>No projects yet</p>
            <p className={styles.emptyDesc}>Click &quot;New Recording&quot; to capture your first demo, or &quot;Import Video&quot; to edit an existing video file.</p>
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No matching projects</p>
            <p className={styles.emptyDesc}>Try a different search term.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {visibleProjects.map((project) => (
              <div key={project.id} className={styles.cardWrap}>
                <ProjectCard
                  project={project}
                  onClick={() => navigate(`/editor/${project.id}`)}
                  onDelete={() => handleDelete(project.id)}
                  onRename={(newName) => handleRename(project.id, newName)}
                />
                <div className={styles.tags}>
                  {(project.tags || []).map((tag) => (
                    <span key={tag} className={styles.tag}>
                      {tag}
                      <button
                        className={styles.tagRemove}
                        onClick={() => removeTag(project.id, tag)}
                        title="Remove tag"
                      >
                        {'×'}
                      </button>
                    </span>
                  ))}
                  {tagInput && tagInput.id === project.id ? (
                    <input
                      className={styles.tagInput}
                      autoFocus
                      value={tagInput.value}
                      placeholder="tag…"
                      onChange={(e) => setTagInput({ id: project.id, value: e.target.value })}
                      onBlur={() => commitTag(project.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitTag(project.id)
                        else if (e.key === 'Escape') setTagInput(null)
                      }}
                    />
                  ) : (
                    <button
                      className={styles.tagAdd}
                      onClick={() => setTagInput({ id: project.id, value: '' })}
                      title="Add tag"
                    >
                      + tag
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
    </div>
  )
}

export default Home

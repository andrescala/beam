import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ProjectCard from '../components/ProjectCard'
import { useToast } from '../components/Toast'
import styles from './Home.module.css'

function Home() {
  const navigate = useNavigate()
  const showToast = useToast()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    try {
      const list = await window.electronAPI.listProjects()
      setProjects(list)
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
    } catch (err) {
      showToast('error', 'Failed to import project')
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header + ' titlebar-drag'}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Beam</h1>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.importBtn} onClick={handleImportProject}>
            Import
          </button>
          <button className={styles.newBtn} onClick={() => navigate('/recorder')}>
            New Recording
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {loading ? (
          <div className={styles.empty}>Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>&#x2299;</div>
            <p className={styles.emptyTitle}>No recordings yet</p>
            <p className={styles.emptyDesc}>Click &quot;New Recording&quot; to capture your first demo.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => navigate(`/editor/${project.id}`)}
                onDelete={() => handleDelete(project.id)}
                onRename={(newName) => handleRename(project.id, newName)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

export default Home

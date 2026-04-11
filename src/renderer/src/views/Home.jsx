import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ProjectCard from '../components/ProjectCard'
import styles from './Home.module.css'

function Home() {
  const navigate = useNavigate()
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
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id) {
    const deleted = await window.electronAPI.deleteProject(id)
    if (deleted) {
      setProjects((prev) => prev.filter((p) => p.id !== id))
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header + ' titlebar-drag'}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Beam</h1>
        </div>
        <button className={styles.newBtn} onClick={() => navigate('/recorder')}>
          New Recording
        </button>
      </header>

      <main className={styles.main}>
        {loading ? (
          <div className={styles.empty}>Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>⊙</div>
            <p className={styles.emptyTitle}>No recordings yet</p>
            <p className={styles.emptyDesc}>Click "New Recording" to capture your first demo.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => navigate(`/editor/${project.id}`)}
                onDelete={() => handleDelete(project.id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

export default Home

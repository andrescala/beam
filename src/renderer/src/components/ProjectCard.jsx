import styles from './ProjectCard.module.css'

function formatDuration(seconds) {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function ProjectCard({ project, onClick, onDelete }) {
  return (
    <div className={styles.card} onClick={onClick}>
      <div className={styles.thumbnail}>
        {project.thumbnail ? (
          <img src={`project-file://${project.id}/thumb.jpg`} alt="" />
        ) : (
          <div className={styles.noThumb}>
            <span>▶</span>
          </div>
        )}
        <span className={styles.duration}>{formatDuration(project.duration)}</span>
      </div>
      <div className={styles.info}>
        <div className={styles.name}>{project.name}</div>
        <div className={styles.date}>{formatDate(project.createdAt)}</div>
      </div>
      <button
        className={styles.deleteBtn}
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        title="Delete project"
      >
        ×
      </button>
    </div>
  )
}

export default ProjectCard

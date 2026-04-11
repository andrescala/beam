import { useState, useRef, useEffect } from 'react'
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

function ProjectCard({ project, onClick, onDelete, onRename }) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(project.name)
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  function handleDoubleClick(e) {
    e.stopPropagation()
    setEditName(project.name)
    setEditing(true)
  }

  function commitRename() {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== project.name) {
      onRename(trimmed)
    }
    setEditing(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      commitRename()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  return (
    <div className={styles.card} onClick={onClick}>
      <div className={styles.thumbnail}>
        {project.thumbnail ? (
          <img src={`project-file://${project.id}/thumb.jpg`} alt="" />
        ) : (
          <div className={styles.noThumb}>
            <span>&#x25B6;</span>
          </div>
        )}
        <span className={styles.duration}>{formatDuration(project.duration)}</span>
      </div>
      <div className={styles.info}>
        {editing ? (
          <input
            ref={inputRef}
            className={styles.nameInput}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className={styles.name} onDoubleClick={handleDoubleClick} title="Double-click to rename">
            {project.name}
          </div>
        )}
        <div className={styles.date}>{formatDate(project.createdAt)}</div>
      </div>
      <button
        className={styles.deleteBtn}
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        title="Delete project"
      >
        &#x00D7;
      </button>
    </div>
  )
}

export default ProjectCard

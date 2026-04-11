import { createContext, useContext, useState, useCallback, useRef } from 'react'
import styles from './Toast.module.css'

const ToastContext = createContext(null)

let nextId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef({})

  const showToast = useCallback((type, message, duration = 4000) => {
    const id = ++nextId
    setToasts((prev) => [...prev, { id, type, message }])
    timersRef.current[id] = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      delete timersRef.current[id]
    }, duration)
    return id
  }, [])

  const dismissToast = useCallback((id) => {
    clearTimeout(timersRef.current[id])
    delete timersRef.current[id]
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className={styles.container}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${styles.toast} ${styles[toast.type] || styles.info}`}
            onClick={() => dismissToast(toast.id)}
          >
            <span className={styles.icon}>
              {toast.type === 'success' ? '✓' : toast.type === 'error' ? '!' : toast.type === 'warning' ? '⚠' : 'i'}
            </span>
            <span className={styles.message}>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be inside ToastProvider')
  return ctx
}

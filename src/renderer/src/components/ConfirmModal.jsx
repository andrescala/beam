import styles from './ConfirmModal.module.css'

/**
 * Lightweight confirmation modal.
 * Props:
 *  - title: heading text
 *  - body: a string OR a JSX node (use a node to render rich content like bullet lists)
 *  - confirmLabel / cancelLabel: button text overrides
 *  - destructive: if true, the confirm button uses a warning color
 *  - onConfirm: called when the user confirms
 *  - onCancel: called when the user cancels or clicks the backdrop
 */
function ConfirmModal({
  title,
  body,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel
}) {
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.content}>
          <h2 className={styles.title}>{title}</h2>
          <div className={styles.body}>{body}</div>
        </div>
        <div className={styles.footer}>
          <button className={styles.secondaryBtn} onClick={onCancel}>{cancelLabel}</button>
          <button
            className={destructive ? styles.destructiveBtn : styles.primaryBtn}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmModal

import { useState } from 'react'
import styles from './WelcomeModal.module.css'

const STEPS = [
  {
    title: 'Welcome to Beam',
    desc: 'The open-source screen recorder with a built-in editor. Record your screen and webcam, then edit and export — all in one app.',
    icon: '\u2B50'
  },
  {
    title: 'Record',
    desc: 'Choose a screen or window to capture. Toggle your webcam and microphone. Press Space to pause, Escape to stop. Your recording is saved as a project automatically.',
    icon: '\uD83C\uDFA5'
  },
  {
    title: 'Edit',
    desc: 'Trim the start and end, cut out mistakes, adjust speed, and crop to any aspect ratio. Add text overlays, image watermarks, background music, and captions.',
    icon: '\u2702\uFE0F'
  },
  {
    title: 'Enhance',
    desc: 'Use pro effects: Remove Silence to auto-cut pauses, add Intro/Outro title cards, apply Vignette focus or Zoom keyframes to highlight key moments.',
    icon: '\u2728'
  },
  {
    title: 'Export & Share',
    desc: 'Export as MP4 (with all effects) or GIF (for quick clips). Export captions as SRT subtitles. Back up your entire project as a .beamproject archive.',
    icon: '\uD83D\uDE80'
  }
]

function WelcomeModal({ onClose }) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  async function handleDismiss() {
    try {
      await window.electronAPI.setPreferences({ hasSeenWelcome: true })
    } catch {}
    onClose()
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.content}>
          <div className={styles.icon}>{current.icon}</div>
          <h2 className={styles.title}>{current.title}</h2>
          <p className={styles.desc}>{current.desc}</p>
        </div>

        <div className={styles.footer}>
          {/* Dots */}
          <div className={styles.dots}>
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`${styles.dot} ${i === step ? styles.dotActive : ''}`}
                onClick={() => setStep(i)}
              />
            ))}
          </div>

          <div className={styles.actions}>
            {step > 0 && (
              <button className={styles.secondaryBtn} onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            {!isLast ? (
              <>
                <button className={styles.skipBtn} onClick={handleDismiss}>
                  Skip
                </button>
                <button className={styles.primaryBtn} onClick={() => setStep(step + 1)}>
                  Next
                </button>
              </>
            ) : (
              <button className={styles.primaryBtn} onClick={handleDismiss}>
                Get Started
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default WelcomeModal

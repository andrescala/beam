import { useState, useEffect } from 'react'
import { HELP_KB } from '../../../shared/help-knowledge.js'
import { useToast } from './Toast'
import styles from './HelpDrawer.module.css'

const SECTIONS = HELP_KB // browsable FAQ is the same KB the AI is grounded on

function HelpDrawer({ open, onClose }) {
  const { showToast } = useToast()
  const [expandedId, setExpandedId] = useState(HELP_KB[0]?.id || null)
  const [expandedItem, setExpandedItem] = useState(null)

  // Ask box state
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState('')
  const [active, setActive] = useState(null) // 'gemini' | 'claude' | null

  useEffect(() => {
    if (!open) return
    window.electronAPI.aiGetKeys().then((s) => setActive(s?.active || null)).catch(() => setActive(null))
  }, [open])

  async function handleAsk() {
    const q = question.trim()
    if (!q) return
    setAsking(true)
    setAnswer('')
    try {
      const res = await window.electronAPI.aiHelpAsk(q)
      if (res?.error) {
        if (res.code === 'NO_API_KEY') { setActive(null) }
        else { showToast('error', res.error) }
        return
      }
      setAnswer(res.answer || '')
    } catch {
      showToast('error', 'Could not reach the AI assistant.')
    } finally {
      setAsking(false)
    }
  }

  if (!open) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>How to use Beam</h2>
          <button className={styles.closeBtn} onClick={onClose}>{'×'}</button>
        </div>

        <div className={styles.askBox}>
          {active ? (
            <>
              <div className={styles.askRow}>
                <input
                  className={styles.askInput}
                  type="text"
                  placeholder="Ask how to do something…"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAsk() }}
                  disabled={asking}
                />
                <button className={styles.askBtn} onClick={handleAsk} disabled={asking || !question.trim()}>
                  {asking ? 'Thinking…' : 'Ask'}
                </button>
              </div>
              {answer && (
                <div className={styles.answer}>
                  {answer.split('\n').map((line, j) => (<p key={j}>{line}</p>))}
                  <button className={styles.answerClear} onClick={() => setAnswer('')}>Clear</button>
                </div>
              )}
            </>
          ) : (
            <p className={styles.askGate}>
              Add a free Google Gemini key in Settings to ask questions. You can still browse the topics below.
            </p>
          )}
        </div>

        <div className={styles.body}>
          {SECTIONS.map((section) => (
            <div key={section.id} className={styles.section}>
              <button
                className={`${styles.sectionTitle} ${expandedId === section.id ? styles.sectionTitleActive : ''}`}
                onClick={() => setExpandedId(expandedId === section.id ? null : section.id)}
              >
                <span>{section.title}</span>
                <span className={styles.chevron}>{expandedId === section.id ? '▼' : '▶'}</span>
              </button>

              {expandedId === section.id && (
                <div className={styles.sectionBody}>
                  {section.items.map((item, i) => {
                    const itemKey = `${section.id}-${i}`
                    const isOpen = expandedItem === itemKey
                    return (
                      <div key={i} className={styles.faqItem}>
                        <button
                          className={`${styles.question} ${isOpen ? styles.questionOpen : ''}`}
                          onClick={() => setExpandedItem(isOpen ? null : itemKey)}
                        >
                          {item.q}
                        </button>
                        {isOpen && (
                          <div className={styles.faqAnswer}>
                            {item.a.split('\n').map((line, j) => (
                              <p key={j}>{line}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default HelpDrawer

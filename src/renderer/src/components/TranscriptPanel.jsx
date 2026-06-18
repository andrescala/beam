import { useState, useMemo, useEffect, useRef } from 'react'
import { useToast } from './Toast'
import styles from './TranscriptPanel.module.css'

// Filler words to flag for removal (C3). Whisper output here is SEGMENT-level
// (not word-level), so detection is best-effort:
//   • A segment whose trimmed text is ENTIRELY a filler (optionally repeated /
//     with punctuation) is flagged as a "remove the whole segment" candidate —
//     cutting it removes a clean time range.
//   • Segments that merely CONTAIN an inline filler are noted but NOT offered as
//     a cut, because we can't map a sub-segment word to a precise time range
//     without word timestamps. This limitation is surfaced in the UI copy.
const FILLER_WORDS = ['um', 'uh', 'er', 'ah', 'like', 'you know', 'so', 'actually']

// A segment counts as "mostly filler" when, after stripping punctuation, every
// token is a filler word (e.g. "um, uh um").
function fillerClassification(text) {
  const trimmed = (text || '').trim().toLowerCase()
  if (!trimmed) return { whole: false, inline: [] }

  // Normalize: drop punctuation, collapse whitespace.
  const cleaned = trimmed.replace(/[.,!?;:"'’]/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens = cleaned.split(' ').filter(Boolean)

  // Whole-segment filler: every token is a single-word filler. (Multi-word
  // fillers like "you know" can't be a whole tiny segment reliably, so we keep
  // this to single-word tokens.)
  const singleWordFillers = FILLER_WORDS.filter((f) => !f.includes(' '))
  const whole = tokens.length > 0 && tokens.every((t) => singleWordFillers.includes(t))

  // Inline fillers present (for noting only).
  const inline = []
  for (const f of FILLER_WORDS) {
    const re = new RegExp(`(^|\\W)${f.replace(/ /g, '\\s+')}(\\W|$)`, 'i')
    if (re.test(trimmed)) inline.push(f)
  }

  return { whole, inline }
}

function formatTimecode(seconds) {
  const s = Math.max(0, seconds || 0)
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function TranscriptPanel({ project, projectId, currentTime, onSeek, onEditChange }) {
  const showToast = useToast()
  const transcript = project.edit?.transcript
  const segments = transcript?.segments || []
  const cuts = project.edit?.cuts || []

  const [transcribing, setTranscribing] = useState(false)
  const [selStart, setSelStart] = useState(null) // index of first selected segment
  const [selEnd, setSelEnd] = useState(null) // index of last selected segment

  // AI state
  const [hasKey, setHasKey] = useState(false)
  const [keyHint, setKeyHint] = useState('')
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [aiBusy, setAiBusy] = useState('') // which action is running
  const [aiResult, setAiResult] = useState(null) // { kind, data }
  const [platform, setPlatform] = useState('youtube')
  const [editPrompt, setEditPrompt] = useState('')

  const activeRef = useRef(null)

  useEffect(() => {
    window.electronAPI.aiGetKeys().then((res) => {
      setHasKey(!!res?.active)
      // keep showing a hint for whichever provider is active
      const a = res?.active
      setKeyHint(a === 'gemini' ? (res.gemini?.hint || '') : a === 'claude' ? (res.claude?.hint || '') : '')
    }).catch(() => {})
  }, [])

  // Index of the segment under the playhead.
  const activeIndex = useMemo(() => {
    return segments.findIndex((s) => currentTime >= s.start && currentTime < s.end)
  }, [segments, currentTime])

  // Auto-scroll the active segment into view.
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  const fillerFlags = useMemo(() => {
    return segments.map((s) => fillerClassification(s.text))
  }, [segments])

  const fillerSegments = useMemo(() => {
    const list = []
    segments.forEach((s, i) => {
      if (fillerFlags[i].whole) list.push({ index: i, segment: s })
    })
    return list
  }, [segments, fillerFlags])

  const [selectedFillers, setSelectedFillers] = useState(() => new Set())

  // Keep the filler selection valid if the segment list changes.
  useEffect(() => {
    setSelectedFillers(new Set(fillerSegments.map((f) => f.index)))
  }, [fillerSegments.length]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleTranscribe() {
    setTranscribing(true)
    try {
      showToast('info', 'Transcribing with Whisper — this can take a minute…')
      const result = await window.electronAPI.transcribeRecording(projectId, { model: 'base.en' })

      if (result.code === 'WHISPER_NOT_FOUND') {
        showToast('error', 'Whisper engine not installed. Run: brew install whisper-cpp (or pip install openai-whisper)')
        return
      }
      if (result.error) {
        showToast('error', `Transcription failed: ${result.error}`)
        return
      }
      const segs = (result.segments || []).filter((s) => s.text)
      if (segs.length === 0) {
        showToast('warning', 'Whisper produced no segments (maybe the audio is silent?)')
        return
      }
      onEditChange({ transcript: { segments: segs, generatedAt: new Date().toISOString() } })
      showToast('success', `Transcribed ${segs.length} segment${segs.length === 1 ? '' : 's'}.`)
    } catch (err) {
      console.error('Transcription error:', err)
      showToast('error', 'Transcription failed')
    } finally {
      setTranscribing(false)
    }
  }

  function selectSegment(i, e) {
    if (e && e.shiftKey && selStart !== null) {
      setSelEnd(i)
    } else {
      setSelStart(i)
      setSelEnd(i)
    }
  }

  const selRange = useMemo(() => {
    if (selStart === null || selEnd === null) return null
    return { lo: Math.min(selStart, selEnd), hi: Math.max(selStart, selEnd) }
  }, [selStart, selEnd])

  // Append a list of {start,end} ranges to project.edit.cuts (the same cuts the
  // export pipeline honors). Merges nothing — the export pipeline already
  // tolerates overlapping cuts; we just append and sort.
  function appendCuts(newRanges) {
    if (!newRanges.length) return
    const merged = [...cuts, ...newRanges]
      .filter((c) => c && c.end > c.start)
      .sort((a, b) => a.start - b.start)
    onEditChange({ cuts: merged })
  }

  function handleRemoveSelection() {
    if (!selRange) {
      showToast('warning', 'Select one or more segments first (click, or shift-click for a range).')
      return
    }
    const lo = segments[selRange.lo]
    const hi = segments[selRange.hi]
    if (!lo || !hi) return
    appendCuts([{ start: lo.start, end: hi.end }])
    showToast('success', `Cut ${formatTimecode(lo.start)}–${formatTimecode(hi.end)} added.`)
    setSelStart(null)
    setSelEnd(null)
  }

  function handleRemoveFillers() {
    const ranges = fillerSegments
      .filter((f) => selectedFillers.has(f.index))
      .map((f) => ({ start: f.segment.start, end: f.segment.end }))
    if (!ranges.length) {
      showToast('warning', 'No filler segments selected.')
      return
    }
    appendCuts(ranges)
    showToast('success', `Removed ${ranges.length} filler segment${ranges.length === 1 ? '' : 's'} as cuts.`)
  }

  function toggleFiller(index) {
    setSelectedFillers((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  // ---- AI helpers ----

  async function saveKey() {
    const res = await window.electronAPI.aiSetKey(keyDraft)
    if (res && res.error) {
      showToast('error', res.error)
      return
    }
    const info = await window.electronAPI.aiGetKey()
    setHasKey(!!info.hasKey)
    setKeyHint(info.hint || '')
    setShowKeyInput(false)
    setKeyDraft('')
    showToast('success', info.hasKey ? 'Claude API key saved.' : 'Claude API key cleared.')
  }

  function aiArgs() {
    return { segments }
  }

  async function runAi(kind, fn) {
    if (!hasKey) {
      setShowKeyInput(true)
      showToast('warning', 'Add your Claude API key to use AI features.')
      return
    }
    if (!segments.length) {
      showToast('warning', 'Transcribe the recording first.')
      return
    }
    setAiBusy(kind)
    setAiResult(null)
    try {
      const res = await fn()
      if (res && res.code === 'NO_API_KEY') {
        setHasKey(false)
        setShowKeyInput(true)
        showToast('warning', res.error)
        return
      }
      if (res && res.error) {
        showToast('error', res.error)
        return
      }
      setAiResult({ kind, data: res })
    } catch (err) {
      showToast('error', 'AI request failed')
    } finally {
      setAiBusy('')
    }
  }

  function applyAiCuts(ranges) {
    const clean = (ranges || []).map((r) => ({ start: r.start, end: r.end })).filter((r) => r.end > r.start)
    if (!clean.length) {
      showToast('warning', 'No cuts to apply.')
      return
    }
    appendCuts(clean)
    showToast('success', `Applied ${clean.length} cut${clean.length === 1 ? '' : 's'} for review.`)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Transcript ({segments.length})</span>
        <div className={styles.actions}>
          <button
            className={styles.actionBtn}
            onClick={handleTranscribe}
            disabled={transcribing}
            title="Transcribe the recording's audio with Whisper"
          >
            {transcribing ? 'Transcribing…' : segments.length ? 'Re-transcribe' : 'Transcribe with Whisper'}
          </button>
          {selRange && (
            <button className={styles.actionBtn} onClick={handleRemoveSelection} title="Cut the selected time range">
              Remove selection
            </button>
          )}
        </div>
      </div>

      {segments.length === 0 && (
        <div className={styles.empty}>
          No transcript yet. Click "Transcribe with Whisper" to generate one from the audio. Then
          click a segment to seek the video, or select a run of segments and Remove selection to cut
          that time range.
        </div>
      )}

      {segments.length > 0 && (
        <div className={styles.body}>
          {/* Flowing transcript */}
          <div className={styles.transcript}>
            {segments.map((s, i) => {
              const isActive = i === activeIndex
              const inSel = selRange && i >= selRange.lo && i <= selRange.hi
              const isFiller = fillerFlags[i].whole
              return (
                <span
                  key={i}
                  ref={isActive ? activeRef : null}
                  className={[
                    styles.segment,
                    isActive ? styles.segmentActive : '',
                    inSel ? styles.segmentSelected : '',
                    isFiller ? styles.segmentFiller : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={`${formatTimecode(s.start)} – ${formatTimecode(s.end)}  (click to seek, shift-click to extend selection)`}
                  onClick={(e) => {
                    selectSegment(i, e)
                    if (!e.shiftKey) onSeek(s.start)
                  }}
                >
                  {s.text.trim()}{' '}
                </span>
              )
            })}
          </div>

          {/* Filler-word removal */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Filler words ({fillerSegments.length})</span>
              {fillerSegments.length > 0 && (
                <button className={styles.actionBtn} onClick={handleRemoveFillers} title="Cut selected filler segments">
                  Remove selected
                </button>
              )}
            </div>
            {fillerSegments.length === 0 ? (
              <div className={styles.note}>
                No whole-segment fillers found. Note: Whisper output is segment-level, so inline
                fillers inside longer segments can't be cut precisely and aren't listed here.
              </div>
            ) : (
              <ul className={styles.fillerList}>
                {fillerSegments.map((f) => (
                  <li key={f.index} className={styles.fillerRow}>
                    <label className={styles.fillerLabel}>
                      <input
                        type="checkbox"
                        checked={selectedFillers.has(f.index)}
                        onChange={() => toggleFiller(f.index)}
                      />
                      <span className={styles.fillerTime}>{formatTimecode(f.segment.start)}</span>
                      <span className={styles.fillerText}>"{f.segment.text.trim()}"</span>
                    </label>
                    <button className={styles.linkBtn} onClick={() => onSeek(f.segment.start)}>
                      seek
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* AI copilot */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>AI copilot</span>
              <button
                className={styles.linkBtn}
                onClick={() => setShowKeyInput((v) => !v)}
                title="Configure your Anthropic Claude API key"
              >
                {hasKey ? `Key set (${keyHint})` : 'Set API key'}
              </button>
            </div>

            <div className={styles.note}>
              AI features send your transcript text to Anthropic (Claude) using your own API key.
              They only run when you click an action below.
            </div>

            {showKeyInput && (
              <div className={styles.keyRow}>
                <input
                  type="password"
                  className={styles.keyInput}
                  placeholder="sk-ant-…"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                />
                <button className={styles.actionBtn} onClick={saveKey}>
                  Save
                </button>
              </div>
            )}

            <div className={styles.aiControls}>
              <label className={styles.aiInline}>
                Platform
                <select
                  className={styles.select}
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                >
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                  <option value="x">X / Twitter</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="instagram">Instagram</option>
                </select>
              </label>
              <button
                className={styles.actionBtn}
                disabled={!!aiBusy}
                onClick={() =>
                  runAi('metadata', () =>
                    window.electronAPI.aiGenerateMetadata({ ...aiArgs(), platform })
                  )
                }
              >
                {aiBusy === 'metadata' ? '…' : 'Title + description'}
              </button>
              <button
                className={styles.actionBtn}
                disabled={!!aiBusy}
                onClick={() =>
                  runAi('chapters', () => window.electronAPI.aiGenerateChapters(aiArgs()))
                }
              >
                {aiBusy === 'chapters' ? '…' : 'Chapters'}
              </button>
              <button
                className={styles.actionBtn}
                disabled={!!aiBusy}
                onClick={() =>
                  runAi('highlights', () => window.electronAPI.aiSuggestHighlights(aiArgs()))
                }
              >
                {aiBusy === 'highlights' ? '…' : 'Highlights'}
              </button>
            </div>

            <div className={styles.aiPromptRow}>
              <input
                className={styles.promptInput}
                placeholder='Edit by prompt, e.g. "cut the intro and any dead air"'
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
              />
              <button
                className={styles.actionBtn}
                disabled={!!aiBusy || !editPrompt.trim()}
                onClick={() =>
                  runAi('edit', () =>
                    window.electronAPI.aiEditByPrompt({ ...aiArgs(), instruction: editPrompt })
                  )
                }
              >
                {aiBusy === 'edit' ? '…' : 'Propose cuts'}
              </button>
            </div>

            {aiResult && (
              <div className={styles.aiResult}>
                {aiResult.kind === 'metadata' && (
                  <div>
                    <div className={styles.resultField}>
                      <strong>Title:</strong> {aiResult.data.title}
                    </div>
                    <div className={styles.resultField}>
                      <strong>Description:</strong> {aiResult.data.description}
                    </div>
                    <div className={styles.resultField}>
                      <strong>Hashtags:</strong> {(aiResult.data.hashtags || []).map((h) => `#${h}`).join(' ')}
                    </div>
                  </div>
                )}

                {aiResult.kind === 'chapters' && (
                  <ul className={styles.resultList}>
                    {(aiResult.data.chapters || []).map((c, i) => (
                      <li key={i}>
                        <button className={styles.linkBtn} onClick={() => onSeek(c.time)}>
                          {formatTimecode(c.time)}
                        </button>{' '}
                        {c.title}
                      </li>
                    ))}
                  </ul>
                )}

                {aiResult.kind === 'highlights' && (
                  <div>
                    <ul className={styles.resultList}>
                      {(aiResult.data.highlights || []).map((h, i) => (
                        <li key={i}>
                          <button className={styles.linkBtn} onClick={() => onSeek(h.start)}>
                            {formatTimecode(h.start)}–{formatTimecode(h.end)}
                          </button>{' '}
                          {h.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiResult.kind === 'edit' && (
                  <div>
                    {(aiResult.data.cuts || []).length === 0 ? (
                      <div className={styles.note}>No matching cuts proposed.</div>
                    ) : (
                      <>
                        <ul className={styles.resultList}>
                          {aiResult.data.cuts.map((c, i) => (
                            <li key={i}>
                              <button className={styles.linkBtn} onClick={() => onSeek(c.start)}>
                                {formatTimecode(c.start)}–{formatTimecode(c.end)}
                              </button>{' '}
                              {c.reason}
                            </li>
                          ))}
                        </ul>
                        <button className={styles.actionBtn} onClick={() => applyAiCuts(aiResult.data.cuts)}>
                          Apply these cuts (for review)
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default TranscriptPanel

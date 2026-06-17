import { useState } from 'react'
import { useToast } from './Toast'
import WhisperStatus from './WhisperStatus'
import styles from './CaptionEditor.module.css'

function CaptionEditor({ project, projectId, currentTime, onEditChange }) {
  const showToast = useToast()
  const captions = project.edit?.captions || []
  const [transcribing, setTranscribing] = useState(false)

  function addCaption() {
    const newCaption = {
      id: crypto.randomUUID(),
      text: 'New caption',
      startTime: currentTime,
      endTime: Math.min(currentTime + 3, project.duration || 10),
      fontSize: 20,
      color: '#ffffff',
      background: 'black@0.5'
    }
    onEditChange({ captions: [...captions, newCaption].sort((a, b) => a.startTime - b.startTime) })
  }

  function updateCaption(id, updates) {
    const updated = captions.map((c) => (c.id === id ? { ...c, ...updates } : c))
    onEditChange({ captions: updated.sort((a, b) => a.startTime - b.startTime) })
  }

  function removeCaption(id) {
    onEditChange({ captions: captions.filter((c) => c.id !== id) })
  }

  async function handleTranscribe() {
    setTranscribing(true)
    try {
      showToast('info', 'Transcribing with Whisper — this can take a minute… (the model downloads automatically the first time)')

      const result = await window.electronAPI.transcribeRecording(projectId, { model: 'base.en' })

      if (result.code === 'WHISPER_NOT_FOUND') {
        showToast('error', 'Whisper engine not installed. Run: brew install whisper-cpp (or pip install openai-whisper)')
        return
      }
      if (result.error) {
        showToast('error', `Transcription failed: ${result.error}`)
        return
      }

      const segments = result.segments || []
      if (segments.length === 0) {
        showToast('warning', 'Whisper produced no segments (maybe the audio is silent?)')
        return
      }

      const newCaptions = segments
        .filter((s) => s.text)
        .map((s) => ({
          id: crypto.randomUUID(),
          text: s.text,
          startTime: s.start,
          endTime: s.end,
          fontSize: 20,
          color: '#ffffff',
          background: 'black@0.5'
        }))

      onEditChange({ captions: newCaptions })
      showToast('success', `Transcribed ${newCaptions.length} caption${newCaptions.length === 1 ? '' : 's'}. Edit any that need polish.`)
    } catch (err) {
      console.error('Transcription error:', err)
      showToast('error', 'Transcription failed')
    } finally {
      setTranscribing(false)
    }
  }

  async function handleExportSrt() {
    if (captions.length === 0) {
      showToast('warning', 'No captions to export')
      return
    }
    try {
      const result = await window.electronAPI.exportSrt(projectId)
      if (result.error) {
        showToast('error', result.error)
        return
      }
      showToast('success', 'SRT file exported')
      window.electronAPI.showInFolder(result.path)
    } catch (err) {
      showToast('error', 'Failed to export SRT')
    }
  }

  async function handleExportVtt() {
    if (captions.length === 0) {
      showToast('warning', 'No captions to export')
      return
    }
    try {
      const result = await window.electronAPI.exportVtt(projectId)
      if (result.error) {
        showToast('error', result.error)
        return
      }
      showToast('success', 'WebVTT file exported')
      window.electronAPI.showInFolder(result.path)
    } catch (err) {
      showToast('error', 'Failed to export VTT')
    }
  }

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <span className={styles.title}>Captions ({captions.length})</span>
        <div className={styles.actions}>
          <WhisperStatus />
          <button
            className={styles.actionBtn}
            onClick={handleTranscribe}
            disabled={transcribing}
            title="Transcribe the recording's audio with Whisper"
          >
            {transcribing ? 'Transcribing…' : 'Transcribe with Whisper'}
          </button>
          <button className={styles.actionBtn} onClick={addCaption} title="Add caption at current time">
            + Add
          </button>
          {captions.length > 0 && (
            <button className={styles.actionBtn} onClick={handleExportSrt} title="Export as SRT subtitle file">
              Export SRT
            </button>
          )}
          {captions.length > 0 && (
            <button className={styles.actionBtn} onClick={handleExportVtt} title="Export as WebVTT subtitle file">
              Export VTT
            </button>
          )}
        </div>
      </div>

      <div className={styles.list}>
        {captions.length === 0 && (
          <div className={styles.empty}>
            No captions yet. Click "Add" to create one at the current playhead position,
            or "Transcribe with Whisper" to auto-generate captions from the audio.
          </div>
        )}
        {captions.map((caption) => (
          <div
            key={caption.id}
            className={`${styles.captionRow} ${currentTime >= caption.startTime && currentTime <= caption.endTime ? styles.captionActive : ''}`}
          >
            <div className={styles.captionTiming}>
              <input
                type="number"
                className={styles.timeInput}
                step="0.1"
                min="0"
                value={caption.startTime.toFixed(1)}
                onChange={(e) => updateCaption(caption.id, { startTime: parseFloat(e.target.value) || 0 })}
              />
              <span className={styles.arrow}>{'\u2192'}</span>
              <input
                type="number"
                className={styles.timeInput}
                step="0.1"
                min="0"
                value={caption.endTime.toFixed(1)}
                onChange={(e) => updateCaption(caption.id, { endTime: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <textarea
              className={styles.captionText}
              value={caption.text}
              rows={2}
              onChange={(e) => updateCaption(caption.id, { text: e.target.value })}
            />
            <button className={styles.removeBtn} onClick={() => removeCaption(caption.id)}>{'\u00D7'}</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default CaptionEditor

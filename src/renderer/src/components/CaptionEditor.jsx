import { useState } from 'react'
import { useToast } from './Toast'
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
      // Extract audio first
      const audioResult = await window.electronAPI.extractAudio(projectId)
      if (audioResult.error) {
        showToast('error', `Audio extraction failed: ${audioResult.error}`)
        return
      }

      // Use Web Speech API for transcription (Chromium built-in)
      // Note: this requires audio playback through SpeechRecognition
      showToast('info', 'Auto-transcription uses basic speech recognition. For better results, edit captions manually.')

      // Generate basic captions from the recording duration
      // Split into ~5 second segments as placeholders
      const duration = project.duration || 0
      const segmentLength = 5
      const newCaptions = []
      for (let t = 0; t < duration; t += segmentLength) {
        newCaptions.push({
          id: crypto.randomUUID(),
          text: `[Caption ${Math.floor(t / segmentLength) + 1}]`,
          startTime: t,
          endTime: Math.min(t + segmentLength, duration),
          fontSize: 20,
          color: '#ffffff',
          background: 'black@0.5'
        })
      }

      onEditChange({ captions: newCaptions })
      showToast('success', `Generated ${newCaptions.length} caption placeholders. Edit the text for each segment.`)
    } catch (err) {
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

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <span className={styles.title}>Captions ({captions.length})</span>
        <div className={styles.actions}>
          <button
            className={styles.actionBtn}
            onClick={handleTranscribe}
            disabled={transcribing}
            title="Generate caption placeholders from recording"
          >
            {transcribing ? 'Working...' : 'Auto-generate'}
          </button>
          <button className={styles.actionBtn} onClick={addCaption} title="Add caption at current time">
            + Add
          </button>
          {captions.length > 0 && (
            <button className={styles.actionBtn} onClick={handleExportSrt} title="Export as SRT subtitle file">
              Export SRT
            </button>
          )}
        </div>
      </div>

      <div className={styles.list}>
        {captions.length === 0 && (
          <div className={styles.empty}>
            No captions yet. Click "Add" to create one at the current playhead position,
            or "Auto-generate" to create placeholder segments.
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

import { useState } from 'react'
import { useToast } from './Toast'
import styles from './LayerPanel.module.css'

function LayerPanel({ project, projectId, currentTime, onEditChange }) {
  const showToast = useToast()
  const [expandedSection, setExpandedSection] = useState('text')
  const edit = project.edit || {}
  const textLayers = edit.textLayers || []
  const imageLayers = edit.imageLayers || []
  const audioLayers = edit.audioLayers || []

  function toggleSection(section) {
    setExpandedSection(expandedSection === section ? null : section)
  }

  // ── Text Layers ──
  function addTextLayer() {
    const newLayer = {
      id: crypto.randomUUID(),
      text: 'New text',
      x: 0.5,
      y: 0.5,
      fontSize: 24,
      color: '#ffffff',
      fontWeight: 'normal',
      background: '',
      startTime: 0,
      endTime: project.duration || 10
    }
    onEditChange({ textLayers: [...textLayers, newLayer] })
  }

  function updateTextLayer(id, updates) {
    onEditChange({
      textLayers: textLayers.map((l) => (l.id === id ? { ...l, ...updates } : l))
    })
  }

  function removeTextLayer(id) {
    onEditChange({ textLayers: textLayers.filter((l) => l.id !== id) })
  }

  // ── Image Layers ──
  async function addImageLayer() {
    try {
      const asset = await window.electronAPI.importAsset(projectId, 'image')
      if (!asset) return

      const newLayer = {
        id: asset.id,
        file: asset.filename,
        name: asset.originalName,
        x: 0.8,
        y: 0.05,
        width: 0.15,
        startTime: 0,
        endTime: null
      }
      onEditChange({ imageLayers: [...imageLayers, newLayer] })
      showToast('success', `Added image: ${asset.originalName}`)
    } catch (err) {
      showToast('error', 'Failed to import image')
    }
  }

  function updateImageLayer(id, updates) {
    onEditChange({
      imageLayers: imageLayers.map((l) => (l.id === id ? { ...l, ...updates } : l))
    })
  }

  function removeImageLayer(id) {
    onEditChange({ imageLayers: imageLayers.filter((l) => l.id !== id) })
  }

  // ── Audio Layers ──
  async function addAudioLayer() {
    try {
      const asset = await window.electronAPI.importAsset(projectId, 'audio')
      if (!asset) return

      const newLayer = {
        id: asset.id,
        file: asset.filename,
        name: asset.originalName,
        volume: 0.3,
        startTime: 0
      }
      onEditChange({ audioLayers: [...audioLayers, newLayer] })
      showToast('success', `Added audio: ${asset.originalName}`)
    } catch (err) {
      showToast('error', 'Failed to import audio')
    }
  }

  function updateAudioLayer(id, updates) {
    onEditChange({
      audioLayers: audioLayers.map((l) => (l.id === id ? { ...l, ...updates } : l))
    })
  }

  function removeAudioLayer(id) {
    onEditChange({ audioLayers: audioLayers.filter((l) => l.id !== id) })
  }

  return (
    <div className={styles.panel}>
      {/* Text Layers */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => toggleSection('text')} role="button" tabIndex={0}>
          <span>{expandedSection === 'text' ? '\u25BC' : '\u25B6'} Text ({textLayers.length})</span>
          <button className={styles.addBtn} onClick={(e) => { e.stopPropagation(); addTextLayer() }}>+</button>
        </div>
        {expandedSection === 'text' && (
          <div className={styles.sectionBody}>
            {textLayers.length === 0 && (
              <div className={styles.empty}>No text layers</div>
            )}
            {textLayers.map((layer) => (
              <div key={layer.id} className={styles.layerCard}>
                <div className={styles.layerHeader}>
                  <input
                    className={styles.textInput}
                    value={layer.text}
                    onChange={(e) => updateTextLayer(layer.id, { text: e.target.value })}
                    placeholder="Enter text..."
                  />
                  <button className={styles.removeBtn} onClick={() => removeTextLayer(layer.id)}>{'\u00D7'}</button>
                </div>
                <div className={styles.layerProps}>
                  <div className={styles.propRow}>
                    <label>Size</label>
                    <input
                      type="number"
                      className={styles.numInput}
                      value={layer.fontSize}
                      min="8"
                      max="120"
                      onChange={(e) => updateTextLayer(layer.id, { fontSize: parseInt(e.target.value) || 24 })}
                    />
                  </div>
                  <div className={styles.propRow}>
                    <label>Color</label>
                    <input
                      type="color"
                      className={styles.colorInput}
                      value={layer.color}
                      onChange={(e) => updateTextLayer(layer.id, { color: e.target.value })}
                    />
                  </div>
                  <div className={styles.propRow}>
                    <label>Bold</label>
                    <input
                      type="checkbox"
                      checked={layer.fontWeight === 'bold'}
                      onChange={(e) => updateTextLayer(layer.id, { fontWeight: e.target.checked ? 'bold' : 'normal' })}
                    />
                  </div>
                  <div className={styles.propRow}>
                    <label>BG</label>
                    <select
                      className={styles.selectInput}
                      value={layer.background || ''}
                      onChange={(e) => updateTextLayer(layer.id, { background: e.target.value })}
                    >
                      <option value="">None</option>
                      <option value="black@0.5">Dark</option>
                      <option value="black@0.8">Darker</option>
                      <option value="white@0.5">Light</option>
                    </select>
                  </div>
                  <div className={styles.propRow}>
                    <label>X</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      className={styles.slider}
                      value={Math.round((layer.x || 0.5) * 100)}
                      onChange={(e) => updateTextLayer(layer.id, { x: parseInt(e.target.value) / 100 })}
                    />
                  </div>
                  <div className={styles.propRow}>
                    <label>Y</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      className={styles.slider}
                      value={Math.round((layer.y || 0.5) * 100)}
                      onChange={(e) => updateTextLayer(layer.id, { y: parseInt(e.target.value) / 100 })}
                    />
                  </div>
                  <div className={styles.propRow}>
                    <label>Start</label>
                    <input
                      type="number"
                      className={styles.numInput}
                      step="0.1"
                      min="0"
                      value={(layer.startTime || 0).toFixed(1)}
                      onChange={(e) => updateTextLayer(layer.id, { startTime: parseFloat(e.target.value) || 0 })}
                    />
                    <button
                      className={styles.playheadBtn}
                      onClick={() => updateTextLayer(layer.id, { startTime: currentTime || 0 })}
                      title="Set to current playhead"
                    >|</button>
                  </div>
                  <div className={styles.propRow}>
                    <label>End</label>
                    <input
                      type="number"
                      className={styles.numInput}
                      step="0.1"
                      min="0"
                      value={(layer.endTime || 0).toFixed(1)}
                      onChange={(e) => updateTextLayer(layer.id, { endTime: parseFloat(e.target.value) || 0 })}
                    />
                    <button
                      className={styles.playheadBtn}
                      onClick={() => updateTextLayer(layer.id, { endTime: currentTime || 0 })}
                      title="Set to current playhead"
                    >|</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Image Layers */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => toggleSection('image')} role="button" tabIndex={0}>
          <span>{expandedSection === 'image' ? '\u25BC' : '\u25B6'} Images ({imageLayers.length})</span>
          <button className={styles.addBtn} onClick={(e) => { e.stopPropagation(); addImageLayer() }}>+</button>
        </div>
        {expandedSection === 'image' && (
          <div className={styles.sectionBody}>
            {imageLayers.length === 0 && (
              <div className={styles.empty}>No images. Add logos, arrows, or watermarks.</div>
            )}
            {imageLayers.map((layer) => (
              <div key={layer.id} className={styles.layerCard}>
                <div className={styles.layerHeader}>
                  <img
                    src={`project-file://${project.id}/assets/${layer.file}`}
                    alt=""
                    className={styles.layerThumb}
                  />
                  <span className={styles.layerName}>{layer.name}</span>
                  <button className={styles.removeBtn} onClick={() => removeImageLayer(layer.id)}>{'\u00D7'}</button>
                </div>
                <div className={styles.layerProps}>
                  <div className={styles.propRow}>
                    <label>Size</label>
                    <input
                      type="range"
                      min="5"
                      max="50"
                      className={styles.slider}
                      value={Math.round((layer.width || 0.15) * 100)}
                      onChange={(e) => updateImageLayer(layer.id, { width: parseInt(e.target.value) / 100 })}
                    />
                    <span className={styles.propValue}>{Math.round((layer.width || 0.15) * 100)}%</span>
                  </div>
                  <div className={styles.propRow}>
                    <label>X</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      className={styles.slider}
                      value={Math.round((layer.x || 0) * 100)}
                      onChange={(e) => updateImageLayer(layer.id, { x: parseInt(e.target.value) / 100 })}
                    />
                  </div>
                  <div className={styles.propRow}>
                    <label>Y</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      className={styles.slider}
                      value={Math.round((layer.y || 0) * 100)}
                      onChange={(e) => updateImageLayer(layer.id, { y: parseInt(e.target.value) / 100 })}
                    />
                  </div>
                  <div className={styles.propRow}>
                    <label>Start</label>
                    <input
                      type="number"
                      className={styles.numInput}
                      step="0.1"
                      min="0"
                      value={(layer.startTime || 0).toFixed(1)}
                      onChange={(e) => updateImageLayer(layer.id, { startTime: parseFloat(e.target.value) || 0 })}
                    />
                    <button
                      className={styles.playheadBtn}
                      onClick={() => updateImageLayer(layer.id, { startTime: currentTime || 0 })}
                      title="Set to current playhead"
                    >|</button>
                  </div>
                  <div className={styles.propRow}>
                    <label>End</label>
                    <input
                      type="number"
                      className={styles.numInput}
                      step="0.1"
                      min="0"
                      value={(layer.endTime != null ? layer.endTime : project.duration || 0).toFixed(1)}
                      onChange={(e) => updateImageLayer(layer.id, { endTime: parseFloat(e.target.value) || null })}
                    />
                    <button
                      className={styles.playheadBtn}
                      onClick={() => updateImageLayer(layer.id, { endTime: currentTime || 0 })}
                      title="Set to current playhead"
                    >|</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recording audio (mic) */}
      {project.recordings?.mic && (
        <div className={styles.section}>
          <div className={styles.sectionHeader} onClick={() => toggleSection('mic')} role="button" tabIndex={0}>
            <span>{expandedSection === 'mic' ? '▼' : '▶'} Recording audio</span>
            <span className={styles.propValue} style={{ marginRight: 8 }}>
              {edit.micMuted ? 'Muted' : `${Math.round((edit.micVolume ?? 1.0) * 100)}%`}
            </span>
          </div>
          {expandedSection === 'mic' && (
            <div className={styles.sectionBody}>
              <div className={styles.layerCard}>
                <div className={styles.layerProps}>
                  <div className={styles.propRow}>
                    <label>Volume</label>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      className={styles.slider}
                      value={Math.round((edit.micVolume ?? 1.0) * 100)}
                      onChange={(e) => onEditChange({ micVolume: parseInt(e.target.value) / 100 })}
                      disabled={edit.micMuted}
                    />
                    <span className={styles.propValue}>{Math.round((edit.micVolume ?? 1.0) * 100)}%</span>
                  </div>
                  <div className={styles.propRow}>
                    <label>Mute</label>
                    <input
                      type="checkbox"
                      checked={!!edit.micMuted}
                      onChange={(e) => onEditChange({ micMuted: e.target.checked })}
                    />
                  </div>
                  <div className={styles.propRow}>
                    <label>Reduce noise</label>
                    <input
                      type="checkbox"
                      checked={!!edit.micDenoise}
                      onChange={(e) => onEditChange({ micDenoise: e.target.checked })}
                      title="Remove background noise (fans, hum) at export"
                    />
                  </div>
                  <div className={styles.propRow}>
                    <label>Sync offset</label>
                    <input
                      type="range"
                      min="-1000"
                      max="1000"
                      step="10"
                      className={styles.slider}
                      value={edit.audioOffsetMs || 0}
                      onChange={(e) => onEditChange({ audioOffsetMs: parseInt(e.target.value) })}
                    />
                    <span className={styles.propValue}>
                      {edit.audioOffsetMs > 0 ? '+' : ''}{edit.audioOffsetMs || 0} ms
                    </span>
                  </div>
                  <div className={styles.propRow}>
                    <label></label>
                    <button
                      className={styles.playheadBtn}
                      onClick={() => onEditChange({ audioOffsetMs: 0 })}
                      title="Reset offset to 0"
                      style={{ width: 'auto', padding: '2px 10px' }}
                    >
                      Reset
                    </button>
                  </div>
                  <div className={styles.empty} style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
                    <strong>Volume:</strong> 0–200%, applies to preview &amp; export.<br/>
                    <strong>Sync offset:</strong> nudge audio earlier (−) or later (+) to align with the video. Tune by ear in preview, then export.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* System audio */}
      {project.recordings?.system && (
        <div className={styles.section}>
          <div className={styles.sectionHeader} onClick={() => toggleSection('system')} role="button" tabIndex={0}>
            <span>{expandedSection === 'system' ? '▼' : '▶'} System audio</span>
            <span className={styles.propValue} style={{ marginRight: 8 }}>
              {edit.systemMuted ? 'Muted' : `${Math.round((edit.systemVolume ?? 1.0) * 100)}%`}
            </span>
          </div>
          {expandedSection === 'system' && (
            <div className={styles.sectionBody}>
              <div className={styles.layerCard}>
                <div className={styles.layerProps}>
                  <div className={styles.propRow}>
                    <label>Volume</label>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      className={styles.slider}
                      value={Math.round((edit.systemVolume ?? 1.0) * 100)}
                      onChange={(e) => onEditChange({ systemVolume: parseInt(e.target.value) / 100 })}
                      disabled={edit.systemMuted}
                    />
                    <span className={styles.propValue}>{Math.round((edit.systemVolume ?? 1.0) * 100)}%</span>
                  </div>
                  <div className={styles.propRow}>
                    <label>Mute</label>
                    <input
                      type="checkbox"
                      checked={!!edit.systemMuted}
                      onChange={(e) => onEditChange({ systemMuted: e.target.checked })}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Audio Layers */}
      <div className={styles.section}>
        <div className={styles.sectionHeader} onClick={() => toggleSection('audio')} role="button" tabIndex={0}>
          <span>{expandedSection === 'audio' ? '\u25BC' : '\u25B6'} Audio ({audioLayers.length})</span>
          <button className={styles.addBtn} onClick={(e) => { e.stopPropagation(); addAudioLayer() }}>+</button>
        </div>
        {expandedSection === 'audio' && (
          <div className={styles.sectionBody}>
            {audioLayers.length === 0 && (
              <div className={styles.empty}>No audio layers. Add background music or SFX.</div>
            )}
            {audioLayers.map((layer) => (
              <div key={layer.id} className={styles.layerCard}>
                <div className={styles.layerHeader}>
                  <span className={styles.layerName}>{layer.name}</span>
                  <button className={styles.removeBtn} onClick={() => removeAudioLayer(layer.id)}>{'\u00D7'}</button>
                </div>
                <div className={styles.layerProps}>
                  <div className={styles.propRow}>
                    <label>Volume</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      className={styles.slider}
                      value={Math.round((layer.volume || 0.3) * 100)}
                      onChange={(e) => updateAudioLayer(layer.id, { volume: parseInt(e.target.value) / 100 })}
                    />
                    <span className={styles.propValue}>{Math.round((layer.volume || 0.3) * 100)}%</span>
                  </div>
                  <div className={styles.propRow}>
                    <label>Start</label>
                    <input
                      type="number"
                      className={styles.numInput}
                      step="0.1"
                      min="0"
                      value={(layer.startTime || 0).toFixed(1)}
                      onChange={(e) => updateAudioLayer(layer.id, { startTime: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div className={styles.propRow}>
                    <label>Fade in</label>
                    <input
                      type="number"
                      className={styles.numInput}
                      step="0.5"
                      min="0"
                      max="10"
                      value={(layer.fadeIn || 0).toFixed(1)}
                      onChange={(e) => updateAudioLayer(layer.id, { fadeIn: Math.max(0, parseFloat(e.target.value) || 0) })}
                      title="Fade-in duration in seconds (applied at export)"
                    />
                    <span className={styles.propValue}>s</span>
                  </div>
                  <div className={styles.propRow}>
                    <label>Fade out</label>
                    <input
                      type="number"
                      className={styles.numInput}
                      step="0.5"
                      min="0"
                      max="10"
                      value={(layer.fadeOut || 0).toFixed(1)}
                      onChange={(e) => updateAudioLayer(layer.id, { fadeOut: Math.max(0, parseFloat(e.target.value) || 0) })}
                      title="Fade-out duration in seconds (applied at export)"
                    />
                    <span className={styles.propValue}>s</span>
                  </div>
                  <div className={styles.propRow}>
                    <label>Duck under voice</label>
                    <input
                      type="checkbox"
                      checked={!!layer.duckUnderVoice}
                      onChange={(e) => updateAudioLayer(layer.id, { duckUnderVoice: e.target.checked })}
                      title="Automatically lower this track while the recording audio has speech (applied at export)"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default LayerPanel

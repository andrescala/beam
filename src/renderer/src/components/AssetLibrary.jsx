import { useState, useEffect, useCallback } from 'react'
import { useToast } from './Toast'
import styles from './AssetLibrary.module.css'

function AssetLibrary({ project, projectId, currentTime, onEditChange }) {
  const showToast = useToast()
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all, image, audio

  const loadAssets = useCallback(async () => {
    try {
      const list = await window.electronAPI.listAssets(projectId)
      setAssets(list)
    } catch {
      setAssets([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  async function handleImport(type) {
    try {
      const asset = await window.electronAPI.importAsset(projectId, type)
      if (asset) {
        showToast('success', `Imported: ${asset.originalName}`)
        loadAssets()
      }
    } catch {
      showToast('error', `Failed to import ${type}`)
    }
  }

  async function handleDelete(filename) {
    // Check if any layer references this asset
    const edit = project.edit || {}
    const inUse =
      (edit.imageLayers || []).some((l) => l.file === filename) ||
      (edit.audioLayers || []).some((l) => l.file === filename)

    if (inUse) {
      showToast('warning', 'Asset is in use by a layer. Remove the layer first.')
      return
    }

    const ok = await window.electronAPI.deleteAsset(projectId, filename)
    if (ok) {
      setAssets((prev) => prev.filter((a) => a.filename !== filename))
      showToast('success', 'Asset deleted')
    } else {
      showToast('error', 'Failed to delete asset')
    }
  }

  function addAsImageLayer(asset) {
    const edit = project.edit || {}
    const imageLayers = edit.imageLayers || []
    const newLayer = {
      id: crypto.randomUUID(),
      file: asset.filename,
      name: asset.filename.split('.').shift().slice(0, 8) + '.' + asset.ext,
      x: 0.8,
      y: 0.05,
      width: 0.15,
      startTime: currentTime || 0,
      endTime: null
    }
    onEditChange({ imageLayers: [...imageLayers, newLayer] })
    showToast('success', 'Added image layer at playhead')
  }

  function addAsAudioLayer(asset) {
    const edit = project.edit || {}
    const audioLayers = edit.audioLayers || []
    const newLayer = {
      id: crypto.randomUUID(),
      file: asset.filename,
      name: asset.filename.split('.').shift().slice(0, 8) + '.' + asset.ext,
      volume: 0.3,
      startTime: currentTime || 0
    }
    onEditChange({ audioLayers: [...audioLayers, newLayer] })
    showToast('success', 'Added audio layer at playhead')
  }

  const filtered = filter === 'all' ? assets : assets.filter((a) => a.type === filter)

  // Count assets in use
  const edit = project.edit || {}
  const usedFiles = new Set([
    ...(edit.imageLayers || []).map((l) => l.file),
    ...(edit.audioLayers || []).map((l) => l.file)
  ])

  return (
    <div className={styles.library}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {['all', 'image', 'audio'].map((f) => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filter === f ? styles.filterBtnActive : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? `All (${assets.length})` : f === 'image' ? `Images (${assets.filter((a) => a.type === 'image').length})` : `Audio (${assets.filter((a) => a.type === 'audio').length})`}
            </button>
          ))}
        </div>
        <div className={styles.importBtns}>
          <button className={styles.importBtn} onClick={() => handleImport('image')}>
            + Image
          </button>
          <button className={styles.importBtn} onClick={() => handleImport('audio')}>
            + Audio
          </button>
        </div>
      </div>

      {/* Asset grid */}
      <div className={styles.grid}>
        {loading && (
          <div className={styles.empty}>Loading assets...</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              {filter === 'audio' ? '\uD83C\uDFB5' : filter === 'image' ? '\uD83D\uDDBC' : '\uD83D\uDCC1'}
            </div>
            <div className={styles.emptyTitle}>
              {filter === 'all' ? 'No assets yet' : `No ${filter} assets`}
            </div>
            <div className={styles.emptyDesc}>
              Import images (logos, watermarks, arrows) or audio files (music, sound effects) to use as overlay layers.
            </div>
            <div className={styles.emptyActions}>
              <button className={styles.importBtnLg} onClick={() => handleImport('image')}>
                Import Image
              </button>
              <button className={styles.importBtnLg} onClick={() => handleImport('audio')}>
                Import Audio
              </button>
            </div>
          </div>
        )}

        {filtered.map((asset) => (
          <div key={asset.filename} className={styles.assetCard}>
            {/* Preview */}
            <div className={styles.preview}>
              {asset.type === 'image' ? (
                <img
                  src={`project-file://${projectId}/assets/${asset.filename}`}
                  alt=""
                  className={styles.thumb}
                  draggable={false}
                />
              ) : (
                <div className={styles.audioThumb}>
                  <span className={styles.audioIcon}>{'\uD83C\uDFB5'}</span>
                  <span className={styles.audioExt}>.{asset.ext}</span>
                </div>
              )}

              {/* In-use badge */}
              {usedFiles.has(asset.filename) && (
                <span className={styles.inUseBadge}>In use</span>
              )}
            </div>

            {/* Info */}
            <div className={styles.assetInfo}>
              <span className={styles.assetName} title={asset.filename}>
                {asset.filename.length > 20
                  ? asset.filename.slice(0, 8) + '...' + asset.ext
                  : asset.filename}
              </span>
              <span className={styles.assetSize}>{formatBytes(asset.size)}</span>
            </div>

            {/* Actions */}
            <div className={styles.assetActions}>
              {asset.type === 'image' && (
                <button
                  className={styles.useBtn}
                  onClick={() => addAsImageLayer(asset)}
                  title="Add as image overlay at current playhead"
                >
                  + Layer
                </button>
              )}
              {asset.type === 'audio' && (
                <button
                  className={styles.useBtn}
                  onClick={() => addAsAudioLayer(asset)}
                  title="Add as audio layer at current playhead"
                >
                  + Layer
                </button>
              )}
              <button
                className={styles.deleteBtn}
                onClick={() => handleDelete(asset.filename)}
                title="Delete asset"
              >
                {'\u00D7'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default AssetLibrary

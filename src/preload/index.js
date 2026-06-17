import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  // Sources & permissions
  getSources: () => ipcRenderer.invoke('get-sources'),
  setCaptureSource: (sourceId) => ipcRenderer.invoke('set-capture-source', sourceId),
  requestPermissions: () => ipcRenderer.invoke('request-permissions'),
  getProjectPath: (projectId) => ipcRenderer.invoke('get-project-path', projectId),

  // Projects
  createProject: (name) => ipcRenderer.invoke('create-project', name),
  saveProject: (id, data) => ipcRenderer.invoke('save-project', id, data),
  loadProject: (id) => ipcRenderer.invoke('load-project', id),
  listProjects: () => ipcRenderer.invoke('list-projects'),
  deleteProject: (id) => ipcRenderer.invoke('delete-project', id),

  // Recording
  saveRawRecording: (projectId, type, buffer) =>
    ipcRenderer.invoke('save-raw-recording', projectId, type, buffer),

  // Crash-safe streaming recording (R8)
  appendRecordingChunk: (projectId, type, arrayBuffer) =>
    ipcRenderer.invoke('capture-append-chunk', projectId, type, arrayBuffer),
  finalizeRecording: (projectId, type) =>
    ipcRenderer.invoke('capture-finalize', projectId, type),
  listRecoverableCaptures: () => ipcRenderer.invoke('list-recoverable-captures'),

  // Assets
  importAsset: (projectId, type) => ipcRenderer.invoke('import-asset', projectId, type),
  listAssets: (projectId) => ipcRenderer.invoke('list-assets', projectId),
  deleteAsset: (projectId, filename) => ipcRenderer.invoke('delete-asset', projectId, filename),

  // Processing
  processRecording: (projectId, format, options) => ipcRenderer.invoke('process-recording', projectId, format, options),
  generateThumbnail: (projectId) => ipcRenderer.invoke('generate-thumbnail', projectId),
  extractAudio: (projectId) => ipcRenderer.invoke('extract-audio', projectId),
  detectSilence: (projectId, threshold, minDuration) =>
    ipcRenderer.invoke('detect-silence', projectId, threshold, minDuration),
  whisperAvailable: () => ipcRenderer.invoke('whisper-available'),
  whisperStatus: () => ipcRenderer.invoke('whisper-status'),
  whisperDownload: () => ipcRenderer.invoke('whisper-download'),
  transcribeRecording: (projectId, opts) =>
    ipcRenderer.invoke('transcribe-recording', projectId, opts),

  // Video import
  importVideo: () => ipcRenderer.invoke('import-video'),
  appendClip: (projectId) => ipcRenderer.invoke('append-clip', projectId),

  // SRT export
  exportSrt: (projectId) => ipcRenderer.invoke('export-srt', projectId),

  // WebVTT export
  exportVtt: (projectId) => ipcRenderer.invoke('export-vtt', projectId),

  // AI copilot (BYO Claude key)
  aiHasKey: () => ipcRenderer.invoke('ai-has-key'),
  aiGetKey: () => ipcRenderer.invoke('ai-get-key'),
  aiSetKey: (key) => ipcRenderer.invoke('ai-set-key', key),
  aiGenerateMetadata: (args) => ipcRenderer.invoke('ai-generate-metadata', args),
  aiGenerateChapters: (args) => ipcRenderer.invoke('ai-generate-chapters', args),
  aiSuggestHighlights: (args) => ipcRenderer.invoke('ai-suggest-highlights', args),
  aiEditByPrompt: (args) => ipcRenderer.invoke('ai-edit-by-prompt', args),

  // Project backup/import
  exportProjectZip: (projectId) => ipcRenderer.invoke('export-project-zip', projectId),
  importProjectZip: () => ipcRenderer.invoke('import-project-zip'),

  // Dialogs & shell
  saveDialog: (options) => ipcRenderer.invoke('save-dialog', options),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),

  // Preferences
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  setPreferences: (patch) => ipcRenderer.invoke('set-preferences', patch),

  // Storage
  getProjectsDir: () => ipcRenderer.invoke('get-projects-dir'),
  getStorageUsage: () => ipcRenderer.invoke('get-storage-usage'),

  // Auto-update
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Events from main process
  onExportProgress: (callback) => {
    const handler = (_event, progress) => callback(progress)
    ipcRenderer.on('export-progress', handler)
    return () => ipcRenderer.removeListener('export-progress', handler)
  },
  onTrayNewRecording: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('tray-new-recording', handler)
    return () => ipcRenderer.removeListener('tray-new-recording', handler)
  },
  onShortcutRecordToggle: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut-record-toggle', handler)
    return () => ipcRenderer.removeListener('shortcut-record-toggle', handler)
  },
  onWhisperStatusChanged: (callback) => {
    const handler = (_event, status) => callback(status)
    ipcRenderer.on('whisper-status-changed', handler)
    return () => ipcRenderer.removeListener('whisper-status-changed', handler)
  },
  onImportProgress: (callback) => {
    const handler = (_event, percent) => callback(percent)
    ipcRenderer.on('import-progress', handler)
    return () => ipcRenderer.removeListener('import-progress', handler)
  },
  onUpdateAvailable: (callback) => {
    const handler = (_event, info) => callback(info)
    ipcRenderer.on('update-available', handler)
    return () => ipcRenderer.removeListener('update-available', handler)
  },
  onUpdateDownloaded: (callback) => {
    const handler = (_event, info) => callback(info)
    ipcRenderer.on('update-downloaded', handler)
    return () => ipcRenderer.removeListener('update-downloaded', handler)
  },
  onRecoverableCaptures: (callback) => {
    const handler = (_event, list) => callback(list)
    ipcRenderer.on('recoverable-captures', handler)
    return () => ipcRenderer.removeListener('recoverable-captures', handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

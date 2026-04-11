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

  // Processing
  processRecording: (projectId) => ipcRenderer.invoke('process-recording', projectId),
  generateThumbnail: (projectId) => ipcRenderer.invoke('generate-thumbnail', projectId),

  // Dialogs & shell
  saveDialog: (options) => ipcRenderer.invoke('save-dialog', options),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),

  // Preferences
  getPreferences: () => ipcRenderer.invoke('get-preferences'),
  setPreferences: (patch) => ipcRenderer.invoke('set-preferences', patch),

  // Events from main process
  onExportProgress: (callback) => {
    const handler = (_event, progress) => callback(progress)
    ipcRenderer.on('export-progress', handler)
    return () => ipcRenderer.removeListener('export-progress', handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

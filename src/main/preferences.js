import Store from 'electron-store'

const schema = {
  defaultFormat: { type: 'string', default: 'mp4' },
  defaultQuality: { type: 'string', default: 'balanced' },
  webcamEnabled: { type: 'boolean', default: true },
  webcamPosition: { type: 'string', default: 'bottom-right' },
  webcamShape: { type: 'string', default: 'circle' },
  countdownDuration: { type: 'number', default: 3 },
  windowBounds: {
    type: 'object',
    default: { width: 1200, height: 800 }
  }
}

const store = new Store({ schema })

export function getPreferences() {
  return store.store
}

export function setPreferences(patch) {
  for (const [key, value] of Object.entries(patch)) {
    store.set(key, value)
  }
  return store.store
}

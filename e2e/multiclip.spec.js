// @ts-check
const { test, expect } = require('@playwright/test')
const { _electron: electron } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const { screenshot, ROOT } = require('./electron-app')

let electronApp, page, projectId

// Build a schema-v2 project whose timeline stitches two clips from two media
// sources — the shape the multi-clip exporter renders and the timeline strip
// visualizes.
function createMultiClipProject() {
  const projectsDir = path.join(process.env.HOME || process.env.USERPROFILE, 'Beam', 'projects')
  const id = uuidv4()
  const dir = path.join(projectsDir, id)
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'exports'), { recursive: true })
  // Dummy media files (editor just needs them to exist to resolve sources).
  fs.writeFileSync(path.join(dir, 'screen-master.webm'), Buffer.alloc(1024))
  fs.writeFileSync(path.join(dir, 'clip-abcd1234-master.mp4'), Buffer.alloc(1024))

  const project = {
    id,
    name: 'Multi-clip Project',
    createdAt: new Date().toISOString(),
    schemaVersion: 2,
    duration: 8,
    thumbnail: null,
    recordings: { screen: 'screen-master.webm', screenProxy: 'screen-master.webm', webcam: null, mic: null, system: null },
    media: {
      screen: { id: 'screen', kind: 'screen', master: 'screen-master.webm', proxy: 'screen-master.webm' },
      'clip-abcd1234': { id: 'clip-abcd1234', kind: 'import', master: 'clip-abcd1234-master.mp4', proxy: 'clip-abcd1234-master.mp4' }
    },
    timeline: {
      videoTrack: [
        { id: 'c1', mediaId: 'screen', sourceIn: 0, sourceOut: 5, timelineStart: 0, speed: 1, transform: null, effects: null, transitionIn: null },
        { id: 'c2', mediaId: 'clip-abcd1234', sourceIn: 0, sourceOut: 3, timelineStart: 5, speed: 1, transform: null, effects: null, transitionIn: null }
      ],
      overlayTracks: [], audioTracks: [], webcam: null
    },
    edit: { trimStart: 0, trimEnd: 5, speed: 1, cuts: [], textLayers: [], imageLayers: [], audioLayers: [], captions: [] },
    cards: { intro: null, outro: null },
    exportSettings: { format: 'mp4', quality: 'balanced' }
  }
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2))
  return id
}

test.describe('Multi-clip timeline', () => {
  test.beforeAll(async () => {
    projectId = createMultiClipProject()
    electronApp = await electron.launch({
      args: [path.join(ROOT, 'out/main/index.js')],
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: 'production', ELECTRON_DISABLE_GPU: '1' }
    })
    page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)
    const skipBtn = page.locator('button', { hasText: 'Skip' })
    if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipBtn.click()
      await page.waitForTimeout(300)
    }
  })

  test.afterAll(async () => {
    await electronApp?.close()
    try {
      const dir = path.join(process.env.HOME || process.env.USERPROFILE, 'Beam', 'projects', projectId)
      fs.rmSync(dir, { recursive: true, force: true })
    } catch { /* ignore */ }
  })

  test('editor opens a v2 multi-clip project without error', async () => {
    await page.evaluate((id) => { window.location.hash = `#/editor/${id}` }, projectId)
    await page.waitForTimeout(2000)
    await expect(page.locator('text=Multi-clip Project').first()).toBeVisible({ timeout: 5000 })
    await screenshot(page, 'editor-multiclip')
  })

  test('"+ Clip" button is present in the editor', async () => {
    await expect(page.locator('button', { hasText: '+ Clip' })).toBeVisible()
  })

  test('timeline shows the multi-clip strip with both clips', async () => {
    const timelineTab = page.locator('[class*="tabBtn"]', { hasText: 'Timeline' })
    await timelineTab.click()
    await page.waitForTimeout(400)
    await expect(page.locator('text=Clips (2)').first()).toBeVisible()
  })
})

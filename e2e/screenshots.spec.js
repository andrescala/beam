// @ts-check
const { test, expect } = require('@playwright/test')
const { _electron: electron } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const { ROOT } = require('./electron-app')

let electronApp, page, testProjectId

/**
 * Visual screenshot tests — captures every major screen/state of the app
 * for manual review and regression testing.
 */

function createTestProject() {
  const projectsDir = path.join(
    process.env.HOME || process.env.USERPROFILE,
    'Beam',
    'projects'
  )
  const id = uuidv4()
  const projectDir = path.join(projectsDir, id)
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true })
  fs.mkdirSync(path.join(projectDir, 'exports'), { recursive: true })

  fs.writeFileSync(path.join(projectDir, 'screen.webm'), Buffer.alloc(1024))

  const project = {
    id,
    name: 'Visual Test Project',
    createdAt: new Date().toISOString(),
    duration: 15,
    thumbnail: null,
    recordings: { screen: 'screen.webm', webcam: null },
    edit: {
      trimStart: 0,
      trimEnd: 15,
      webcamPosition: 'bottom-right',
      webcamSize: 0.2,
      webcamShape: 'circle',
      speed: 1,
      cuts: [],
      layers: [
        {
          id: 'layer-1',
          type: 'text',
          content: 'Hello World',
          startTime: 0,
          endTime: 5,
          position: { x: 50, y: 50 },
          style: { fontSize: 32, color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.5)' }
        }
      ],
      captions: [
        { id: 'cap-1', text: 'Welcome to Beam!', startTime: 0, endTime: 3 },
        { id: 'cap-2', text: 'This is a demo.', startTime: 3, endTime: 6 }
      ],
      introCard: { enabled: true, title: 'My Demo', subtitle: 'A quick walkthrough', duration: 3, bgColor: '#1a1a2e' },
      outroCard: { enabled: true, title: 'Thanks!', subtitle: 'Questions?', duration: 3, bgColor: '#1a1a2e' },
      backgroundBlur: 5,
      vignette: 30,
      zoomKeyframes: [
        { time: 2, duration: 3, zoom: 1.5, x: 0.5, y: 0.5 }
      ]
    },
    exportSettings: { format: 'mp4', quality: 'balanced', lastExportPath: null }
  }

  fs.writeFileSync(
    path.join(projectDir, 'project.json'),
    JSON.stringify(project, null, 2)
  )
  return id
}

test.describe('Visual Screenshots', () => {
  test.beforeAll(async () => {
    testProjectId = createTestProject()

    electronApp = await electron.launch({
      args: [path.join(ROOT, 'out/main/index.js')],
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ELECTRON_DISABLE_GPU: '1'
      }
    })

    page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)
  })

  test.afterAll(async () => {
    await electronApp?.close()
    try {
      const projectDir = path.join(
        process.env.HOME || process.env.USERPROFILE,
        'Beam', 'projects', testProjectId
      )
      fs.rmSync(projectDir, { recursive: true, force: true })
    } catch {}
  })

  test('screenshot: home screen', async () => {
    const shot = await page.screenshot({ fullPage: true })
    expect(shot.byteLength).toBeGreaterThan(1000)

    const screenshotDir = path.join(ROOT, 'e2e', 'screenshots')
    fs.mkdirSync(screenshotDir, { recursive: true })
    fs.writeFileSync(path.join(screenshotDir, 'visual-home.png'), shot)
  })

  test('screenshot: editor with all features enabled', async () => {
    // Navigate to editor
    await page.evaluate((id) => {
      window.location.hash = `#/editor/${id}`
    }, testProjectId)
    await page.waitForTimeout(2000)

    const shot = await page.screenshot({ fullPage: true })
    expect(shot.byteLength).toBeGreaterThan(1000)

    const screenshotDir = path.join(ROOT, 'e2e', 'screenshots')
    fs.writeFileSync(path.join(screenshotDir, 'visual-editor-full.png'), shot)
  })

  test('screenshot: editor timeline tab', async () => {
    const timelineTab = page.locator('button', { hasText: 'Timeline' })
    await timelineTab.click()
    await page.waitForTimeout(300)

    const shot = await page.screenshot({ fullPage: true })
    const screenshotDir = path.join(ROOT, 'e2e', 'screenshots')
    fs.writeFileSync(path.join(screenshotDir, 'visual-editor-timeline.png'), shot)
  })

  test('screenshot: editor layers tab', async () => {
    const tab = page.locator('button', { hasText: 'Layers' })
    await tab.click()
    await page.waitForTimeout(300)

    const shot = await page.screenshot({ fullPage: true })
    const screenshotDir = path.join(ROOT, 'e2e', 'screenshots')
    fs.writeFileSync(path.join(screenshotDir, 'visual-editor-layers.png'), shot)
  })

  test('screenshot: editor assets tab', async () => {
    const tab = page.locator('button', { hasText: 'Assets' })
    await tab.click()
    await page.waitForTimeout(300)

    const shot = await page.screenshot({ fullPage: true })
    const screenshotDir = path.join(ROOT, 'e2e', 'screenshots')
    fs.writeFileSync(path.join(screenshotDir, 'visual-editor-assets.png'), shot)
  })

  test('screenshot: editor captions tab', async () => {
    const tab = page.locator('button', { hasText: 'Captions' })
    await tab.click()
    await page.waitForTimeout(300)

    const shot = await page.screenshot({ fullPage: true })
    const screenshotDir = path.join(ROOT, 'e2e', 'screenshots')
    fs.writeFileSync(path.join(screenshotDir, 'visual-editor-captions.png'), shot)
  })

  test('screenshot: export modal', async () => {
    const exportBtn = page.getByRole('button', { name: 'Export', exact: true })
    await exportBtn.click()
    await page.waitForTimeout(500)

    const shot = await page.screenshot({ fullPage: true })
    const screenshotDir = path.join(ROOT, 'e2e', 'screenshots')
    fs.writeFileSync(path.join(screenshotDir, 'visual-export-modal.png'), shot)

    // Close modal — click close button or overlay backdrop
    const closeBtn = page.locator('[class*="closeBtn"]').first()
    if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeBtn.click()
    } else {
      // Click the overlay backdrop to dismiss
      await page.locator('[class*="overlay"]').first().click({ position: { x: 10, y: 10 } })
    }
    await page.waitForTimeout(500)
  })

  test('screenshot: help drawer', async () => {
    // Ensure any modal overlay is dismissed first
    const overlay = page.locator('[class*="overlay"]')
    if (await overlay.first().isVisible({ timeout: 500 }).catch(() => false)) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
    }

    const helpBtn = page.locator('button[title="Help & tutorials"]')
    await helpBtn.click({ force: true })
    await page.waitForTimeout(400)

    const shot = await page.screenshot({ fullPage: true })
    const screenshotDir = path.join(ROOT, 'e2e', 'screenshots')
    fs.writeFileSync(path.join(screenshotDir, 'visual-help-drawer.png'), shot)

    // Close drawer
    const closeBtn = page.locator('[class*="closeBtn"]').first()
    if (await closeBtn.isVisible()) {
      await closeBtn.click()
    } else {
      await page.keyboard.press('Escape')
    }
    await page.waitForTimeout(300)
  })

  test('screenshot: recorder source picker', async () => {
    await page.evaluate(() => {
      window.location.hash = '#/recorder'
    })
    await page.waitForTimeout(1500)

    const shot = await page.screenshot({ fullPage: true })
    const screenshotDir = path.join(ROOT, 'e2e', 'screenshots')
    fs.writeFileSync(path.join(screenshotDir, 'visual-source-picker.png'), shot)

    // Go back home
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await page.waitForTimeout(500)
  })
})

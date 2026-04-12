// @ts-check
const { test, expect } = require('@playwright/test')
const { _electron: electron } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const { screenshot, ROOT } = require('./electron-app')

let electronApp, page, testProjectId

/**
 * Create a mock project with a dummy recording so we can test the editor
 * without needing to actually record the screen.
 */
async function createTestProject() {
  const projectsDir = path.join(
    process.env.HOME || process.env.USERPROFILE,
    'Beam',
    'projects'
  )
  const id = uuidv4()
  const projectDir = path.join(projectsDir, id)
  const assetsDir = path.join(projectDir, 'assets')
  const exportsDir = path.join(projectDir, 'exports')

  fs.mkdirSync(projectDir, { recursive: true })
  fs.mkdirSync(assetsDir, { recursive: true })
  fs.mkdirSync(exportsDir, { recursive: true })

  // Create a minimal dummy file — the editor just needs it to exist
  const dummyVideo = path.join(projectDir, 'screen.webm')
  fs.writeFileSync(dummyVideo, Buffer.alloc(1024))

  const project = {
    id,
    name: 'Test Project',
    createdAt: new Date().toISOString(),
    duration: 10,
    thumbnail: null,
    recordings: {
      screen: 'screen.webm',
      webcam: null
    },
    edit: {
      trimStart: 0,
      trimEnd: 10,
      webcamPosition: 'bottom-right',
      webcamSize: 0.2,
      webcamShape: 'circle',
      speed: 1,
      cuts: [],
      layers: [],
      captions: [],
      introCard: null,
      outroCard: null,
      backgroundBlur: 0,
      vignette: 0,
      zoomKeyframes: []
    },
    exportSettings: {
      format: 'mp4',
      quality: 'balanced',
      lastExportPath: null
    }
  }

  fs.writeFileSync(
    path.join(projectDir, 'project.json'),
    JSON.stringify(project, null, 2)
  )

  return id
}

function cleanupTestProject(id) {
  try {
    const projectsDir = path.join(
      process.env.HOME || process.env.USERPROFILE,
      'Beam',
      'projects'
    )
    const projectDir = path.join(projectsDir, id)
    fs.rmSync(projectDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

test.describe('Editor View', () => {
  test.beforeAll(async () => {
    testProjectId = await createTestProject()

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

    // Dismiss Welcome Modal if present
    const skipBtn = page.locator('button', { hasText: 'Skip' })
    if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipBtn.click()
      await page.waitForTimeout(300)
    }
  })

  test.afterAll(async () => {
    await electronApp?.close()
    cleanupTestProject(testProjectId)
  })

  test('navigate to editor for test project', async () => {
    await page.evaluate((id) => {
      window.location.hash = `#/editor/${id}`
    }, testProjectId)

    await page.waitForTimeout(2000)
    await screenshot(page, 'editor-loaded')
  })

  test('editor shows project name in titlebar', async () => {
    const projectName = page.locator('text=Test Project')
    await expect(projectName.first()).toBeVisible({ timeout: 5000 })
  })

  test('editor has back-to-home button', async () => {
    const backBtn = page.locator('button', { hasText: /home/i })
    await expect(backBtn.first()).toBeVisible()
  })

  test('editor has Export button in titlebar', async () => {
    // Use exact match to avoid matching "Export .beamproject"
    const exportBtn = page.getByRole('button', { name: 'Export', exact: true })
    await expect(exportBtn).toBeVisible()
  })

  test('editor has Help button', async () => {
    const helpBtn = page.locator('button[title="Help & tutorials"]')
    await expect(helpBtn).toBeVisible()
  })

  test('timeline tab is visible and active by default', async () => {
    // Use the tab buttons which are inside the bottomTabs section
    const timelineTab = page.locator('[class*="tabBtn"]', { hasText: 'Timeline' })
    await expect(timelineTab).toBeVisible()
    await screenshot(page, 'editor-timeline-tab')
  })

  test('layers tab is clickable', async () => {
    const layersTab = page.locator('[class*="tabBtn"]', { hasText: 'Layers' })
    await expect(layersTab).toBeVisible()
    await layersTab.click()
    await page.waitForTimeout(300)
    await screenshot(page, 'editor-layers-tab')
  })

  test('assets tab is clickable', async () => {
    const assetsTab = page.locator('[class*="tabBtn"]', { hasText: 'Assets' })
    await expect(assetsTab).toBeVisible()
    await assetsTab.click()
    await page.waitForTimeout(300)
    await screenshot(page, 'editor-assets-tab')

    const bodyText = await page.textContent('body')
    expect(bodyText).toBeTruthy()
  })

  test('captions tab is clickable', async () => {
    const captionsTab = page.locator('[class*="tabBtn"]', { hasText: 'Captions' })
    await expect(captionsTab).toBeVisible()
    await captionsTab.click()
    await page.waitForTimeout(300)
    await screenshot(page, 'editor-captions-tab')
  })

  test('inspector panel has effect controls', async () => {
    await screenshot(page, 'editor-inspector')

    // Check for specific inspector sections
    const trimSection = page.locator('text=Trim')
    await expect(trimSection.first()).toBeVisible()

    const speedSection = page.locator('text=Speed')
    await expect(speedSection.first()).toBeVisible()

    const cropSection = page.locator('text=Crop')
    await expect(cropSection.first()).toBeVisible()
  })

  test('inspector has intro/outro card controls', async () => {
    const introCard = page.locator('text=Intro Card')
    await expect(introCard.first()).toBeVisible()

    const outroCard = page.locator('text=Outro Card')
    await expect(outroCard.first()).toBeVisible()
  })

  test('inspector has video effects controls', async () => {
    const blur = page.locator('text=Video Blur')
    await expect(blur.first()).toBeVisible()

    const vignette = page.locator('text=Vignette')
    await expect(vignette.first()).toBeVisible()

    const zoom = page.locator('text=Zoom & Pan')
    await expect(zoom.first()).toBeVisible()
  })

  test('export modal opens and closes', async () => {
    const exportBtn = page.getByRole('button', { name: 'Export', exact: true })
    await exportBtn.click()

    await page.waitForTimeout(500)
    await screenshot(page, 'editor-export-modal')

    const modalText = await page.textContent('body')
    expect(modalText.toLowerCase()).toContain('export')

    // Close the modal — look for close/X button or use Escape
    const closeBtn = page.locator('[class*="closeBtn"]').first()
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click()
    } else {
      await page.keyboard.press('Escape')
    }

    await page.waitForTimeout(300)
    await screenshot(page, 'editor-export-modal-closed')
  })

  test('help drawer opens from editor', async () => {
    const helpBtn = page.locator('button[title="Help & tutorials"]')
    await helpBtn.click()

    await page.waitForTimeout(400)
    await screenshot(page, 'editor-help-drawer')

    const helpContent = page.locator('text=Getting Started')
    await expect(helpContent).toBeVisible({ timeout: 3000 })

    // Close
    const closeBtn = page.locator('[class*="closeBtn"]').first()
    if (await closeBtn.isVisible()) {
      await closeBtn.click()
    } else {
      await page.keyboard.press('Escape')
    }
    await page.waitForTimeout(300)
  })

  test('switch back to timeline tab', async () => {
    const timelineTab = page.locator('[class*="tabBtn"]', { hasText: 'Timeline' })
    await timelineTab.click()
    await page.waitForTimeout(300)
    await screenshot(page, 'editor-timeline-restored')
  })

  test('navigate back to home', async () => {
    const backBtn = page.locator('button', { hasText: /home/i })
    await backBtn.first().click()

    await page.waitForTimeout(1000)

    const header = page.locator('h1')
    await expect(header).toHaveText('Beam')

    await screenshot(page, 'editor-back-to-home')
  })

  test('test project appears in project list', async () => {
    const projectCard = page.locator('text=Test Project')
    await expect(projectCard.first()).toBeVisible({ timeout: 5000 })

    await screenshot(page, 'home-with-test-project')
  })
})

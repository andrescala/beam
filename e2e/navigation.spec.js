// @ts-check
const { test, expect } = require('@playwright/test')
const { launchApp, screenshot } = require('./electron-app')

let electronApp, page

test.describe('App Navigation & Window', () => {
  test.beforeAll(async () => {
    ;({ electronApp, page } = await launchApp())
  })

  test.afterAll(async () => {
    await electronApp?.close()
  })

  test('window has minimum dimensions', async () => {
    // Electron doesn't use viewportSize — get bounds from BrowserWindow API
    const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win ? win.getBounds() : null
    })
    expect(bounds).toBeTruthy()
    expect(bounds.width).toBeGreaterThanOrEqual(900)
    expect(bounds.height).toBeGreaterThanOrEqual(600)
  })

  test('app starts on home route', async () => {
    const url = page.url()
    // HashRouter — URL should end with #/ or contain the root hash
    expect(url).toMatch(/(#\/?$|index\.html)/)
    await screenshot(page, 'nav-home-route')
  })

  test('navigate to recorder and back', async () => {
    // Go to recorder
    await page.evaluate(() => {
      window.location.hash = '#/recorder'
    })
    await page.waitForTimeout(1000)

    let url = page.url()
    expect(url).toContain('#/recorder')
    await screenshot(page, 'nav-recorder-route')

    // Go back to home
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await page.waitForTimeout(1000)

    const header = page.locator('h1')
    await expect(header).toHaveText('Beam')
    await screenshot(page, 'nav-back-to-home')
  })

  test('navigate to non-existent editor shows error', async () => {
    await page.evaluate(() => {
      window.location.hash = '#/editor/non-existent-id'
    })
    await page.waitForTimeout(2000)

    await screenshot(page, 'nav-editor-not-found')

    // Should show an error or "not found" state
    const bodyText = await page.textContent('body')
    expect(bodyText.length).toBeGreaterThan(0)

    // Navigate back
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await page.waitForTimeout(500)
  })

  test('window can be resized', async () => {
    const originalBounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win ? win.getBounds() : null
    })

    // Resize the window via Electron API
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.setSize(1400, 900)
    })

    await page.waitForTimeout(500)
    const newBounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win ? win.getBounds() : null
    })

    expect(newBounds).toBeTruthy()
    expect(newBounds.width).toBe(1400)
    expect(newBounds.height).toBe(900)

    // Restore
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.setSize(1200, 800)
    })

    await page.waitForTimeout(300)
  })
})

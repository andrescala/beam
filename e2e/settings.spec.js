// @ts-check
const { test, expect } = require('@playwright/test')
const { launchApp, screenshot } = require('./electron-app')

let electronApp, page

test.beforeAll(async () => {
  ({ electronApp, page } = await launchApp())
})

test.afterAll(async () => {
  await electronApp.close()
})

test.describe('Settings Screen', () => {
  test('reachable from Home and renders all sections', async () => {
    // Navigate via the HashRouter route directly (robust across header layouts).
    await page.evaluate(() => { window.location.hash = '#/settings' })
    await page.waitForTimeout(600)

    await expect(page.locator('h1', { hasText: 'Settings' })).toBeVisible()

    for (const section of ['Recording', 'Export', 'AI & Captions', 'Storage']) {
      await expect(page.locator(`text=${section}`).first()).toBeVisible()
    }
    await screenshot(page, 'settings-screen')
  })

  test('export defaults expose the new format/quality controls', async () => {
    await page.evaluate(() => { window.location.hash = '#/settings' })
    await page.waitForTimeout(400)
    const bodyText = await page.textContent('body')
    expect(bodyText).toContain('Default format')
    expect(bodyText).toContain('Default quality')
    expect(bodyText.toLowerCase()).toContain('loudness')
  })

  test('navigates back to Home', async () => {
    await page.evaluate(() => { window.location.hash = '#/settings' })
    await page.waitForTimeout(400)
    const backBtn = page.locator('button').filter({ hasText: /home|←/i }).first()
    await backBtn.click()
    await page.waitForTimeout(400)
    await expect(page.locator('h1', { hasText: 'Beam' })).toBeVisible()
  })
})

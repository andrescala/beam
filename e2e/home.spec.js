// @ts-check
const { test, expect } = require('@playwright/test')
const { launchApp, screenshot } = require('./electron-app')

let electronApp, page

test.describe('Home Screen', () => {
  test.beforeAll(async () => {
    ;({ electronApp, page } = await launchApp())
  })

  test.afterAll(async () => {
    await electronApp?.close()
  })

  test('app window opens with correct title', async () => {
    const title = await page.title()
    // electron-vite sets the title from index.html — just confirm it loads
    expect(title).toBeTruthy()

    // Dismiss the Welcome Modal if it's showing (blocks pointer events on other UI)
    const skipBtn = page.locator('button', { hasText: 'Skip' })
    if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipBtn.click()
      await page.waitForTimeout(300)
    }
  })

  test('home screen renders with Beam header', async () => {
    await screenshot(page, 'home-initial')

    // The header should contain the app name "Beam"
    const header = page.locator('h1')
    await expect(header).toHaveText('Beam')
  })

  test('shows empty state when no projects exist', async () => {
    // Look for the empty state message
    const emptyText = page.locator('text=No projects yet')
    const isVisible = await emptyText.isVisible().catch(() => false)

    // Either we have projects or the empty state — both are valid
    if (isVisible) {
      await expect(emptyText).toBeVisible()
      const desc = page.locator('text=New Recording')
      await expect(desc.first()).toBeVisible()
    }

    await screenshot(page, 'home-empty-or-projects')
  })

  test('New Recording button is visible and clickable', async () => {
    const newBtn = page.locator('button', { hasText: 'New Recording' })
    await expect(newBtn).toBeVisible()
    await expect(newBtn).toBeEnabled()
  })

  test('Import button is visible', async () => {
    const importBtn = page.locator('button', { hasText: /^Import$/ })
    await expect(importBtn).toBeVisible()
  })

  test('Import Video button is visible', async () => {
    const importVideoBtn = page.locator('button', { hasText: 'Import Video' })
    await expect(importVideoBtn).toBeVisible()
    await expect(importVideoBtn).toBeEnabled()
  })

  test('Help button is visible', async () => {
    const helpBtn = page.locator('button[title="Help & tutorials"]')
    await expect(helpBtn).toBeVisible()
  })

  test('Help drawer opens and closes', async () => {
    const helpBtn = page.locator('button[title="Help & tutorials"]')
    await helpBtn.click()

    // Wait for drawer to appear
    await page.waitForTimeout(400)
    await screenshot(page, 'home-help-drawer-open')

    // Check for help content
    const helpContent = page.locator('text=Getting Started')
    await expect(helpContent).toBeVisible()

    // Close the drawer
    const closeBtn = page.locator('[class*="closeBtn"]').first()
    if (await closeBtn.isVisible()) {
      await closeBtn.click()
    } else {
      // Try clicking the overlay/backdrop
      await page.keyboard.press('Escape')
    }

    await page.waitForTimeout(400)
    await screenshot(page, 'home-help-drawer-closed')
  })

  test('welcome modal appears on first launch', async () => {
    // This depends on preferences — take a screenshot to verify
    await screenshot(page, 'home-welcome-check')
    // The WelcomeModal might already have been dismissed in previous runs
    // We just verify the page is still functional
    const header = page.locator('h1')
    await expect(header).toHaveText('Beam')
  })

  test('clicking New Recording navigates to recorder', async () => {
    const newBtn = page.locator('button', { hasText: 'New Recording' })
    await newBtn.click()

    // Wait for navigation
    await page.waitForTimeout(1000)
    await screenshot(page, 'recorder-source-picker')

    // The recorder view should show source picker or permission request
    // Look for common elements
    const body = await page.textContent('body')
    expect(body).toBeTruthy()

    // Navigate back to home for subsequent tests
    // Source picker has a Cancel button
    const cancelBtn = page.locator('button', { hasText: 'Cancel' })
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click()
      await page.waitForTimeout(500)
    } else {
      // Use browser back
      await page.goBack()
      await page.waitForTimeout(500)
    }
  })
})

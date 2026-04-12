/**
 * Shared Electron app launcher for Playwright tests.
 *
 * Usage in test files:
 *   const { launchApp } = require('./electron-app')
 *   let electronApp, page
 *   test.beforeAll(async () => { ({ electronApp, page } = await launchApp()) })
 *   test.afterAll(async () => { await electronApp.close() })
 */

const { _electron: electron } = require('@playwright/test')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

/**
 * Launches the Beam Electron app and waits for the first BrowserWindow.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.args] - extra CLI args forwarded to Electron
 * @param {Record<string,string>} [opts.env] - extra env vars
 * @returns {Promise<{ electronApp: import('playwright').ElectronApplication, page: import('playwright').Page }>}
 */
async function launchApp(opts = {}) {
  const electronApp = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js')],
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      // Disable GPU acceleration in CI to avoid rendering issues
      ELECTRON_DISABLE_GPU: '1',
      ...opts.env
    }
  })

  // Wait for the first window
  const page = await electronApp.firstWindow()

  // Wait for React to mount (the app uses HashRouter, so we check for the root div)
  await page.waitForLoadState('domcontentloaded')
  // Give React a moment to hydrate
  await page.waitForTimeout(1500)

  return { electronApp, page }
}

/**
 * Takes a labeled screenshot and returns the path.
 */
async function screenshot(page, name) {
  const screenshotPath = path.join(ROOT, 'e2e', 'screenshots', `${name}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  return screenshotPath
}

module.exports = { launchApp, screenshot, ROOT }

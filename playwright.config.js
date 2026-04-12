// @ts-check
const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false, // Electron tests share state, run serially
  workers: 1, // Single-instance lock prevents multiple Electron processes
  retries: 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    screenshot: 'on',
    trace: 'on-first-retry'
  }
})

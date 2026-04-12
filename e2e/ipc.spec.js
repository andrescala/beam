// @ts-check
const { test, expect } = require('@playwright/test')
const { launchApp, screenshot } = require('./electron-app')

let electronApp, page

test.describe('IPC Handlers (via renderer)', () => {
  test.beforeAll(async () => {
    ;({ electronApp, page } = await launchApp())
  })

  test.afterAll(async () => {
    await electronApp?.close()
  })

  test('electronAPI is exposed on window', async () => {
    const hasAPI = await page.evaluate(() => {
      return typeof window.electronAPI === 'object' && window.electronAPI !== null
    })
    expect(hasAPI).toBe(true)
  })

  test('electronAPI has all expected methods', async () => {
    const methods = await page.evaluate(() => {
      return Object.keys(window.electronAPI)
    })

    const expected = [
      'getSources',
      'setCaptureSource',
      'requestPermissions',
      'getProjectPath',
      'createProject',
      'saveProject',
      'loadProject',
      'listProjects',
      'deleteProject',
      'saveRawRecording',
      'importAsset',
      'listAssets',
      'deleteAsset',
      'processRecording',
      'generateThumbnail',
      'extractAudio',
      'detectSilence',
      'exportSrt',
      'exportProjectZip',
      'importProjectZip',
      'saveDialog',
      'showInFolder',
      'getPreferences',
      'setPreferences',
      'onExportProgress'
    ]

    for (const method of expected) {
      expect(methods).toContain(method)
    }
  })

  test('listProjects returns an array', async () => {
    const projects = await page.evaluate(async () => {
      return await window.electronAPI.listProjects()
    })
    expect(Array.isArray(projects)).toBe(true)
  })

  test('getPreferences returns an object', async () => {
    const prefs = await page.evaluate(async () => {
      return await window.electronAPI.getPreferences()
    })
    expect(typeof prefs).toBe('object')
    expect(prefs).not.toBeNull()
  })

  test('setPreferences persists values', async () => {
    // Set a test preference
    await page.evaluate(async () => {
      await window.electronAPI.setPreferences({ _testKey: 'playwright' })
    })

    // Read it back
    const prefs = await page.evaluate(async () => {
      return await window.electronAPI.getPreferences()
    })
    expect(prefs._testKey).toBe('playwright')

    // Clean up — set to null (electron-store doesn't accept undefined)
    await page.evaluate(async () => {
      await window.electronAPI.setPreferences({ _testKey: null })
    })
  })

  test('createProject and loadProject round-trip', async () => {
    // Create a project
    const project = await page.evaluate(async () => {
      return await window.electronAPI.createProject('E2E Test Project')
    })

    expect(project).toBeTruthy()
    expect(project.id).toBeTruthy()
    expect(project.name).toBe('E2E Test Project')

    // Load it back
    const loaded = await page.evaluate(async (id) => {
      return await window.electronAPI.loadProject(id)
    }, project.id)

    expect(loaded.id).toBe(project.id)
    expect(loaded.name).toBe('E2E Test Project')

    // Clean up — delete from disk (can't use IPC deleteProject because it shows a dialog)
    const fs = require('fs')
    const path = require('path')
    const projectDir = path.join(
      process.env.HOME || process.env.USERPROFILE,
      'Beam',
      'projects',
      project.id
    )
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  test('saveProject updates project data', async () => {
    // Create
    const project = await page.evaluate(async () => {
      return await window.electronAPI.createProject('Save Test')
    })

    // Update
    project.name = 'Save Test Updated'
    project.duration = 42
    await page.evaluate(async ({ id, data }) => {
      await window.electronAPI.saveProject(id, data)
    }, { id: project.id, data: project })

    // Verify
    const loaded = await page.evaluate(async (id) => {
      return await window.electronAPI.loadProject(id)
    }, project.id)

    expect(loaded.name).toBe('Save Test Updated')
    expect(loaded.duration).toBe(42)

    // Clean up
    const fs = require('fs')
    const path = require('path')
    const projectDir = path.join(
      process.env.HOME || process.env.USERPROFILE,
      'Beam',
      'projects',
      project.id
    )
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  test('loadProject returns null for non-existent project', async () => {
    const result = await page.evaluate(async () => {
      try {
        return await window.electronAPI.loadProject('non-existent-uuid')
      } catch (e) {
        return { error: e.message }
      }
    })

    // Should either throw or return null/error
    expect(result === null || result?.error).toBeTruthy()
  })

  test('listAssets returns empty array for new project', async () => {
    const project = await page.evaluate(async () => {
      return await window.electronAPI.createProject('Asset Test')
    })

    const assets = await page.evaluate(async (id) => {
      return await window.electronAPI.listAssets(id)
    }, project.id)

    expect(Array.isArray(assets)).toBe(true)
    expect(assets.length).toBe(0)

    // Clean up
    const fs = require('fs')
    const path = require('path')
    const projectDir = path.join(
      process.env.HOME || process.env.USERPROFILE,
      'Beam',
      'projects',
      project.id
    )
    fs.rmSync(projectDir, { recursive: true, force: true })
  })
})

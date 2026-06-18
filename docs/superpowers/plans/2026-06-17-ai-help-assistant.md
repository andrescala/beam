# AI Help Assistant + Gemini Provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app "ask how to do things" help assistant grounded in a hardcoded feature knowledge base, and add Google Gemini as a second LLM provider alongside Claude.

**Architecture:** A pure shared module (`src/shared/help-knowledge.js`) is the single source of truth for both the browsable FAQ (HelpDrawer) and the LLM grounding (ai.js). The main-process AI layer is refactored into pure, testable units — `selectProvider()` and per-provider `callClaude`/`callGemini` functions that take an API key as a parameter — with `ai.js` reading keys from preferences and routing through them. The Ask box lives at the top of the existing Help drawer; browsing is free, asking needs a key.

**Tech Stack:** Electron (main + preload + React renderer), electron-store preferences, plain `fetch` for both providers, Node's built-in `assert` for unit tests (run via `node test/*.mjs`).

## Global Constraints

- Providers must share one return contract: low-level provider calls return the assistant **text** or throw an `Error` with a `.code` from this set: `NO_API_KEY`, `BAD_KEY`, `NETWORK`, `API_ERROR`, `REFUSAL`, `EMPTY`. Feature/ask functions catch and return `{ error, code }` or a success object.
- Provider auto-selection rule (exact): **Gemini if its key is set, else Claude if its key is set, else `null` → `NO_API_KEY`.**
- Default Gemini model id: `gemini-2.0-flash` (free tier). Single constant.
- Default Claude model id: `claude-fable-5` (unchanged). Claude API: header `anthropic-version: 2023-06-01`; do NOT send `temperature`/`top_p`/`top_k`/`thinking`.
- Pure units (`src/shared/help-knowledge.js`, `src/main/ai/select.js`, `src/main/ai/providers/*.js`) must NOT import `electron`, `electron-store`, or `preferences.js`, so they run under plain `node`.
- Key reads honor env fallbacks: `ANTHROPIC_API_KEY` (Claude), `GEMINI_API_KEY` (Gemini).
- Renderer imports the shared KB via relative path `../../../shared/help-knowledge.js` (from `src/renderer/src/components/`). Main imports via `../shared/help-knowledge.js` (from `src/main/`).
- Follow existing conventions: CSS modules with `--bg`/`--bg2`/`--bg3`/`--text`/`--text2`/`--border` variables; `useToast()` for transient errors; never log or return raw API keys (only a `…last4` hint).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/help-knowledge.js` | **new** — `HELP_KB` array + `flattenKbForPrompt()`; single source of truth |
| `src/main/ai/select.js` | **new** — pure `selectProvider({claudeKey, geminiKey})` |
| `src/main/ai/providers/claude.js` | **new** — `callClaude({apiKey, system, content, maxTokens})` |
| `src/main/ai/providers/gemini.js` | **new** — `callGemini({apiKey, system, content, maxTokens})` |
| `src/main/ai.js` | refactor: `callLLM`, `askHelp`, `getKeyStatus`, `hasAnyKey`; route feature fns through `callLLM` |
| `src/main/preferences.js` | add `geminiApiKey` to schema |
| `src/main/index.js` | add IPC `ai-help-ask`, `ai-get-keys` |
| `src/preload/index.js` | add `aiHelpAsk`, `aiGetKeys` |
| `src/renderer/src/components/HelpDrawer.jsx` | render FAQ from `HELP_KB`; add Ask box + key gating |
| `src/renderer/src/components/HelpDrawer.module.css` | styles for Ask box/answer |
| `src/renderer/src/views/Settings.jsx` | add Gemini key field |
| `src/renderer/src/components/TranscriptPanel.jsx` | key-status check uses `aiGetKeys().active` |
| `test/help-knowledge.test.mjs` | **new** unit tests for KB + flatten |
| `test/ai-provider.test.mjs` | **new** unit tests for selectProvider + callGemini mapping |

---

## Task 1: Shared knowledge base module

**Files:**
- Create: `src/shared/help-knowledge.js`
- Test: `test/help-knowledge.test.mjs`

**Interfaces:**
- Produces: `export const HELP_KB` — array of `{ id: string, title: string, items: Array<{ q: string, a: string, keywords?: string[] }> }`.
- Produces: `export function flattenKbForPrompt(kb = HELP_KB): string` — deterministic plain-text rendering containing every section title and every `q`/`a`.

- [ ] **Step 1: Write the failing test**

Create `test/help-knowledge.test.mjs`:

```js
import assert from 'node:assert'
import { HELP_KB, flattenKbForPrompt } from '../src/shared/help-knowledge.js'

let passed = 0
const ok = (m) => { console.log('  ok -', m); passed++ }

// KB is well-formed
{
  assert.ok(Array.isArray(HELP_KB) && HELP_KB.length > 0, 'HELP_KB is a non-empty array')
  const ids = new Set()
  for (const section of HELP_KB) {
    assert.ok(section.id && typeof section.id === 'string', 'section has id')
    assert.ok(!ids.has(section.id), `section id is unique: ${section.id}`)
    ids.add(section.id)
    assert.ok(section.title && typeof section.title === 'string', 'section has title')
    assert.ok(Array.isArray(section.items) && section.items.length > 0, `section ${section.id} has items`)
    for (const item of section.items) {
      assert.ok(item.q && item.q.trim().length > 0, 'item has non-empty q')
      assert.ok(item.a && item.a.trim().length > 0, 'item has non-empty a')
    }
  }
  ok('HELP_KB is well-formed (unique ids, non-empty q/a)')
}

// flatten includes every title and question, and is deterministic
{
  const text = flattenKbForPrompt()
  for (const section of HELP_KB) {
    assert.ok(text.includes(section.title), `flatten includes title: ${section.title}`)
    for (const item of section.items) {
      assert.ok(text.includes(item.q), `flatten includes question: ${item.q.slice(0, 30)}…`)
    }
  }
  assert.equal(text, flattenKbForPrompt(), 'flatten is deterministic')
  ok('flattenKbForPrompt includes all titles + questions and is deterministic')
}

// covers the newer features explicitly
{
  const text = flattenKbForPrompt().toLowerCase()
  for (const needle of ['+ clip', 'transcript', 'gemini', 'social']) {
    assert.ok(text.includes(needle), `KB covers "${needle}"`)
  }
  ok('KB covers multi-clip, transcript, provider keys, and social presets')
}

console.log(`\n${passed} help-knowledge tests passed`)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/help-knowledge.test.mjs`
Expected: FAIL — `Cannot find module '.../src/shared/help-knowledge.js'`.

- [ ] **Step 3: Write the module**

Create `src/shared/help-knowledge.js`. Port the existing `SECTIONS` content from `HelpDrawer.jsx` and refresh/expand it. Use this content (correct the stale bits: project path is `~/Beam/projects`, export formats now include webm/hevc/gif/png/mp3/m4a, multi-clip + transcript + provider keys are new):

```js
// Hardcoded knowledge base of Beam's features. Single source of truth: the Help
// drawer renders this as a browsable FAQ AND the AI help assistant stuffs it
// into the model's system prompt for grounded answers. Pure data — no Electron
// imports — so both the renderer and the main process can read it.

export const HELP_KB = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    items: [
      { q: 'How do I make my first recording?',
        a: 'Click "New Recording" from the home screen. Grant screen, camera, and microphone permissions when prompted. Choose the screen or window to capture, toggle your webcam on/off, then click "Start Recording". Press Space to pause, Escape to stop.',
        keywords: ['record', 'start', 'capture', 'permissions'] },
      { q: 'Where are my recordings saved?',
        a: 'Recordings are saved automatically as projects under your home folder in Beam/projects. Each project has its own folder with the raw recordings, assets, and exports. You can also export a .beamproject archive for backup.',
        keywords: ['save', 'location', 'folder', 'projects'] },
      { q: 'How do I rename a project?',
        a: 'Double-click the project name on the home screen card to rename it inline. Press Enter to confirm or Escape to cancel.',
        keywords: ['rename', 'name'] }
    ]
  },
  {
    id: 'timeline',
    title: 'Timeline & Trimming',
    items: [
      { q: 'How do I trim the start or end?',
        a: 'In the Timeline tab, drag the trim handles on either side of the Screen track to set your in/out points.',
        keywords: ['trim', 'handles', 'in', 'out'] },
      { q: 'How do I cut a section out?',
        a: 'Click "Cut" in the Timeline toolbar, click once to set the start point, then again to set the end. The red region between is removed from the export. Drag a cut\'s edges to adjust it, or click the X to remove it.',
        keywords: ['cut', 'remove', 'delete section'] },
      { q: 'How does Remove Silence work?',
        a: 'Click "Remove Silence" in the Timeline toolbar. Beam analyzes the audio and adds cuts over silent segments (pauses longer than ~0.5s). Review, adjust, or remove the cuts before exporting.',
        keywords: ['silence', 'pauses', 'auto cut'] }
    ]
  },
  {
    id: 'multiclip',
    title: 'Multi-clip Timeline',
    items: [
      { q: 'How do I add another video to the timeline?',
        a: 'Click "+ Clip" in the editor titlebar and pick a video file. Beam imports it as its own source and appends it to the end of the timeline. When the timeline has more than one clip, a read-only "Clips (N)" strip appears in the Timeline tab showing each clip\'s position.',
        keywords: ['+ clip', 'append', 'multiple videos', 'stitch'] },
      { q: 'What works (and what does not yet) for multi-clip export?',
        a: 'A multi-clip timeline exports by stitching the clips together: each is trimmed, speed-adjusted, letterboxed to a common canvas, and concatenated with its audio (the screen clip keeps your mic/system narration; imported music tracks are mixed in). Export resolution and social presets are honored. Not yet rendered on the multi-clip path: text/image overlays, captions, intro/outro cards, and the webcam bubble.',
        keywords: ['multi-clip export', 'limitations', 'overlays', 'cards'] }
    ]
  },
  {
    id: 'layers',
    title: 'Text, Image & Audio Layers',
    items: [
      { q: 'How do I add text overlays?',
        a: 'Go to the Layers tab and click "+" next to Text. Type your text, adjust font size, color, bold, and background, and use the X/Y sliders to position it. Set start/end times or snap to the current playhead.',
        keywords: ['text', 'overlay', 'title'] },
      { q: 'How do I add image overlays (logos, watermarks)?',
        a: 'In the Assets tab click "+ Image" to import a file (PNG, JPG, SVG, GIF, WebP), then "+ Layer" on the asset card. Adjust size, position, and timing in the Layers tab.',
        keywords: ['image', 'logo', 'watermark'] },
      { q: 'How do I add background music or sound effects?',
        a: 'In the Assets tab click "+ Audio" to import a file, then "+ Layer". Adjust volume and start time in the Layers tab. Audio layers are mixed with the recording audio on export.',
        keywords: ['music', 'audio', 'sound', 'mix'] }
    ]
  },
  {
    id: 'transcript',
    title: 'Transcript & AI Copilot',
    items: [
      { q: 'What is the Transcript tab for?',
        a: 'Click "Transcribe with Whisper" to generate a transcript from the recording audio. The transcript is a text-based editing surface: click a segment to seek the video, select a run of segments and "Remove selection" to cut that part, or remove detected filler words ("um", "uh"). It does not add on-screen text — for subtitles use the Captions tab.',
        keywords: ['transcript', 'whisper', 'text editing', 'filler', 'seek'] },
      { q: 'What can the AI copilot do?',
        a: 'With an API key set, the AI copilot uses your transcript to generate a title + description, chapter markers, highlight suggestions, or to propose cuts from a natural-language instruction (proposed for review, never auto-applied).',
        keywords: ['ai copilot', 'title', 'chapters', 'highlights', 'edit by prompt'] }
    ]
  },
  {
    id: 'captions',
    title: 'Captions & SRT Export',
    items: [
      { q: 'How do I add captions?',
        a: 'In the Captions tab, click "Add at playhead" to create a caption at the current time, or transcribe with Whisper to fill captions from the audio. Edit text and timing per caption. Captions are burned into the video on export.',
        keywords: ['captions', 'subtitles', 'burn-in'] },
      { q: 'Can I export subtitles?',
        a: 'Yes. Click "Export SRT" (or VTT) in the Captions tab to generate a standard subtitle file for any player or platform.',
        keywords: ['srt', 'vtt', 'subtitles export'] }
    ]
  },
  {
    id: 'export',
    title: 'Exporting',
    items: [
      { q: 'What export formats are supported?',
        a: 'Click "Export" in the top-right. Formats: MP4 (H.264), HEVC, WebM, animated GIF, a single PNG frame, and audio-only MP3 or M4A. Choose a quality preset; optionally enable loudness normalization.',
        keywords: ['export', 'format', 'mp4', 'webm', 'gif', 'mp3'] },
      { q: 'Can I export for Instagram / TikTok / a specific resolution?',
        a: 'Yes. The export dialog offers social-media presets (exact width×height with blur-fill or center-crop) and a resolution cap (e.g. 1080p/720p). These reframe/scale the output to the chosen size.',
        keywords: ['social', 'instagram', 'tiktok', 'resolution', 'preset', '1080p', '720p'] },
      { q: 'What is a .beamproject file?',
        a: 'A portable project archive containing your recordings, assets, and edit settings. Use "Export .beamproject" to back up, or "Import" on the home screen to restore — handy for moving projects between machines.',
        keywords: ['beamproject', 'backup', 'archive', 'import'] }
    ]
  },
  {
    id: 'effects',
    title: 'Effects & Webcam',
    items: [
      { q: 'How do I change playback speed?',
        a: 'In the Inspector panel, click a speed preset (0.5x–2x) or enter a custom value up to 4x. Speed affects both video and audio on export.',
        keywords: ['speed', 'fast', 'slow'] },
      { q: 'How do I crop or change aspect ratio?',
        a: 'In the Inspector panel choose an aspect ratio: 16:9, 9:16, 4:3, or 1:1. The crop preview shows as a dashed border; dimmed areas are removed on export.',
        keywords: ['crop', 'aspect ratio', 'vertical', 'square'] },
      { q: 'How do I change the webcam position and size?',
        a: 'In the Inspector under "Webcam", click a position (TL/TR/BL/BR), drag the size slider (10–50%), and choose Circle or Rect. This affects both preview and export.',
        keywords: ['webcam', 'position', 'size', 'bubble'] }
    ]
  },
  {
    id: 'ai-keys',
    title: 'AI Provider Keys',
    items: [
      { q: 'How do I enable the AI features?',
        a: 'AI features (the Help assistant and the transcript copilot) need an API key. Open Settings and add a key for either Anthropic Claude or Google Gemini. Gemini has a free tier, so it is the easiest way to start. If both keys are set, Beam uses Gemini.',
        keywords: ['api key', 'gemini', 'claude', 'enable ai', 'free'] },
      { q: 'Is my data sent anywhere?',
        a: 'Only when you explicitly trigger an AI action. For the Help assistant, your question plus Beam\'s feature documentation are sent to your chosen provider. For the copilot, the transcript text is sent. Nothing is sent without a key configured and an action triggered.',
        keywords: ['privacy', 'data', 'sent', 'provider'] }
    ]
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    items: [
      { q: 'Recording shortcuts',
        a: 'Space / P — Pause or resume recording.\nEscape / S — Stop recording.',
        keywords: ['shortcut', 'recording keys'] },
      { q: 'Editor shortcuts',
        a: 'Space — Play / pause the video.\n? — Open this help.',
        keywords: ['shortcut', 'editor keys', 'help'] }
    ]
  }
]

/**
 * Render the KB as a single deterministic text block for the LLM system prompt.
 * Includes every section title and every question/answer.
 */
export function flattenKbForPrompt(kb = HELP_KB) {
  return kb
    .map((section) => {
      const body = section.items
        .map((item) => `Q: ${item.q}\nA: ${item.a}`)
        .join('\n\n')
      return `## ${section.title}\n${body}`
    })
    .join('\n\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/help-knowledge.test.mjs`
Expected: PASS — `3 help-knowledge tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/help-knowledge.js test/help-knowledge.test.mjs
git commit -m "feat: shared help knowledge base + flatten-for-prompt"
```

---

## Task 2: Provider selection + Gemini/Claude provider modules

**Files:**
- Create: `src/main/ai/select.js`
- Create: `src/main/ai/providers/claude.js`
- Create: `src/main/ai/providers/gemini.js`
- Test: `test/ai-provider.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `selectProvider({ claudeKey, geminiKey }): 'gemini' | 'claude' | null`.
- Produces: `callClaude({ apiKey, system, content, maxTokens }): Promise<string>` — returns assistant text or throws `Error` with `.code`.
- Produces: `callGemini({ apiKey, system, content, maxTokens }): Promise<string>` — same contract.

- [ ] **Step 1: Write the failing test**

Create `test/ai-provider.test.mjs`:

```js
import assert from 'node:assert'
import { selectProvider } from '../src/main/ai/select.js'
import { callGemini } from '../src/main/ai/providers/gemini.js'

let passed = 0
const ok = (m) => { console.log('  ok -', m); passed++ }

// selection rule
{
  assert.equal(selectProvider({ claudeKey: '', geminiKey: '' }), null, 'no keys → null')
  assert.equal(selectProvider({ claudeKey: 'c', geminiKey: '' }), 'claude', 'only claude → claude')
  assert.equal(selectProvider({ claudeKey: '', geminiKey: 'g' }), 'gemini', 'only gemini → gemini')
  assert.equal(selectProvider({ claudeKey: 'c', geminiKey: 'g' }), 'gemini', 'both → gemini (prefer free)')
  ok('selectProvider follows the auto rule')
}

// gemini request shaping + success mapping (stubbed fetch)
{
  let captured = null
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts }
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'hello answer' }] } }] })
    }
  }
  const text = await callGemini({ apiKey: 'KEY', system: 'sys', content: 'hi', maxTokens: 256 })
  assert.equal(text, 'hello answer', 'returns the candidate text')
  assert.ok(captured.url.includes('gemini-2.0-flash:generateContent'), 'hits the flash generateContent endpoint')
  const body = JSON.parse(captured.opts.body)
  assert.equal(body.systemInstruction.parts[0].text, 'sys', 'maps system → systemInstruction')
  assert.equal(body.contents[0].parts[0].text, 'hi', 'maps content → contents')
  assert.equal(body.generationConfig.maxOutputTokens, 256, 'maps maxTokens')
  assert.equal(captured.opts.headers['x-goog-api-key'], 'KEY', 'sends key in header, not URL')
  assert.ok(!captured.url.includes('KEY'), 'key not in URL')
  ok('callGemini shapes the request and maps the response')
}

// gemini bad-key mapping
{
  globalThis.fetch = async () => ({
    ok: false, status: 400,
    json: async () => ({ error: { message: 'API key not valid. Please pass a valid API key.' } })
  })
  let code = null
  try { await callGemini({ apiKey: 'bad', content: 'hi' }) } catch (e) { code = e.code }
  assert.equal(code, 'BAD_KEY', '400 invalid key → BAD_KEY')
  ok('callGemini maps an invalid key to BAD_KEY')
}

// gemini blocked/empty mapping
{
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } })
  })
  let code = null
  try { await callGemini({ apiKey: 'k', content: 'hi' }) } catch (e) { code = e.code }
  assert.equal(code, 'REFUSAL', 'blockReason → REFUSAL')
  ok('callGemini maps a blocked prompt to REFUSAL')
}

console.log(`\n${passed} ai-provider tests passed`)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/ai-provider.test.mjs`
Expected: FAIL — `Cannot find module '.../src/main/ai/select.js'`.

- [ ] **Step 3a: Write `src/main/ai/select.js`**

```js
// Pure provider-selection rule. No Electron / preferences imports so it is unit
// testable. Prefer Gemini (free tier) when its key is present.
export function selectProvider({ claudeKey, geminiKey } = {}) {
  if (geminiKey) return 'gemini'
  if (claudeKey) return 'claude'
  return null
}
```

- [ ] **Step 3b: Write `src/main/ai/providers/claude.js`**

Extract the existing Anthropic call (currently `callClaude` inside `ai.js`) into a key-parameterized function:

```js
// Anthropic Claude provider. Plain fetch; takes the API key as a parameter so it
// stays free of preferences/electron and is unit-testable.
const MODEL = 'claude-fable-5'
const API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export async function callClaude({ apiKey, system, content, maxTokens = 2048 }) {
  if (!apiKey) { const e = new Error('No Claude API key configured.'); e.code = 'NO_API_KEY'; throw e }

  const body = { model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content }] }
  if (system) body.system = system

  let res
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch (netErr) {
    const e = new Error(`Network error contacting Anthropic: ${netErr.message}`); e.code = 'NETWORK'; throw e
  }

  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json())?.error?.message || '' } catch { /* non-JSON body */ }
    if (res.status === 401) { const e = new Error('Anthropic rejected the API key (401).'); e.code = 'BAD_KEY'; throw e }
    const e = new Error(`Anthropic API error (HTTP ${res.status})${detail ? `: ${detail}` : ''}`); e.code = 'API_ERROR'; throw e
  }

  const data = await res.json()
  if (data.stop_reason === 'refusal') { const e = new Error('The model declined to respond.'); e.code = 'REFUSAL'; throw e }

  const block = Array.isArray(data.content)
    ? data.content.find((b) => b && b.type === 'text' && typeof b.text === 'string')
    : null
  if (!block) { const e = new Error('The model returned no text output.'); e.code = 'EMPTY'; throw e }
  return block.text
}
```

- [ ] **Step 3c: Write `src/main/ai/providers/gemini.js`**

```js
// Google Gemini provider (free tier). Plain fetch; key passed as a parameter and
// sent via the x-goog-api-key header (kept out of the URL/logs).
const MODEL = 'gemini-2.0-flash'
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

export async function callGemini({ apiKey, system, content, maxTokens = 2048 }) {
  if (!apiKey) { const e = new Error('No Gemini API key configured.'); e.code = 'NO_API_KEY'; throw e }

  const body = {
    contents: [{ role: 'user', parts: [{ text: content }] }],
    generationConfig: { maxOutputTokens: maxTokens }
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }

  let res
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch (netErr) {
    const e = new Error(`Network error contacting Gemini: ${netErr.message}`); e.code = 'NETWORK'; throw e
  }

  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json())?.error?.message || '' } catch { /* non-JSON body */ }
    if (res.status === 400 && /api key not valid|invalid.*key/i.test(detail)) {
      const e = new Error('Google rejected the API key.'); e.code = 'BAD_KEY'; throw e
    }
    if (res.status === 429) { const e = new Error('Gemini rate limit reached. Try again shortly.'); e.code = 'API_ERROR'; throw e }
    const e = new Error(`Gemini API error (HTTP ${res.status})${detail ? `: ${detail}` : ''}`); e.code = 'API_ERROR'; throw e
  }

  const data = await res.json()
  if (data.promptFeedback?.blockReason) { const e = new Error('The model declined to respond.'); e.code = 'REFUSAL'; throw e }

  const parts = data.candidates?.[0]?.content?.parts
  const text = Array.isArray(parts) ? parts.map((p) => p?.text || '').join('').trim() : ''
  if (!text) { const e = new Error('The model returned no text output.'); e.code = 'EMPTY'; throw e }
  return text
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/ai-provider.test.mjs`
Expected: PASS — `4 ai-provider tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/select.js src/main/ai/providers/claude.js src/main/ai/providers/gemini.js test/ai-provider.test.mjs
git commit -m "feat: pure provider selection + Claude/Gemini provider modules"
```

---

## Task 3: Wire ai.js to the provider layer + askHelp + key status

**Files:**
- Modify: `src/main/ai.js`
- Modify: `src/main/preferences.js:15` (add `geminiApiKey`)

**Interfaces:**
- Consumes: `selectProvider`, `callClaude`, `callGemini` (Task 2); `HELP_KB`, `flattenKbForPrompt` (Task 1).
- Produces: `callLLM({ system, content, maxTokens }): Promise<string>`; `askHelp(question): Promise<{answer}|{error,code}>`; `getKeyStatus(): { claude:{hasKey,hint}, gemini:{hasKey,hint}, active }`; `hasAnyKey(): boolean`. Existing exports `generateMetadata`/`generateChapters`/`suggestHighlights`/`editByPrompt` and `setClaudeApiKey`/`getClaudeApiKey`/`hasClaudeApiKey` remain.

- [ ] **Step 1: Add the Gemini preference**

In `src/main/preferences.js`, add the line after `claudeApiKey` (line 15):

```js
  claudeApiKey: { type: 'string', default: '' },
  geminiApiKey: { type: 'string', default: '' },
```

- [ ] **Step 2: Refactor `ai.js` imports and key helpers**

At the top of `src/main/ai.js`, replace the model/URL constants and `callClaude` definition. Update the imports block to:

```js
import { getPreferences, setPreferences } from './preferences.js'
import { selectProvider } from './ai/select.js'
import { callClaude } from './ai/providers/claude.js'
import { callGemini } from './ai/providers/gemini.js'
import { HELP_KB, flattenKbForPrompt } from '../shared/help-knowledge.js'
```

Remove the now-unused `MODEL`, `API_URL`, `ANTHROPIC_VERSION` consts and the entire local `async function callClaude(content, {...})` definition (lines ~50–118 of the current file). Keep `parseJsonLoose`, `transcriptToText`, `formatTimecode`.

Add key helpers (keep the existing Claude-named ones for the inline copilot input, add Gemini + combined):

```js
export function getClaudeApiKey() {
  return getPreferences().claudeApiKey || process.env.ANTHROPIC_API_KEY || ''
}
export function getGeminiApiKey() {
  return getPreferences().geminiApiKey || process.env.GEMINI_API_KEY || ''
}
export function setClaudeApiKey(key) {
  setPreferences({ claudeApiKey: typeof key === 'string' ? key.trim() : '' })
  return { ok: true }
}
export function hasClaudeApiKey() { return !!getClaudeApiKey() }
export function hasAnyKey() { return !!getClaudeApiKey() || !!getGeminiApiKey() }

export function getKeyStatus() {
  const c = getClaudeApiKey()
  const g = getGeminiApiKey()
  return {
    claude: { hasKey: !!c, hint: c ? `…${c.slice(-4)}` : '' },
    gemini: { hasKey: !!g, hint: g ? `…${g.slice(-4)}` : '' },
    active: selectProvider({ claudeKey: c, geminiKey: g })
  }
}

const NO_KEY = {
  error: 'No AI API key configured. Add an Anthropic or Google Gemini key in Settings.',
  code: 'NO_API_KEY'
}
```

- [ ] **Step 3: Add `callLLM` routing**

Add after the key helpers:

```js
/**
 * Provider-agnostic LLM call. Picks Gemini (free) when its key is set, else
 * Claude. Returns the assistant text or throws an Error with a `.code`.
 */
export async function callLLM({ system, content, maxTokens = 2048 } = {}) {
  const claudeKey = getClaudeApiKey()
  const geminiKey = getGeminiApiKey()
  const provider = selectProvider({ claudeKey, geminiKey })
  if (!provider) { const e = new Error(NO_KEY.error); e.code = 'NO_API_KEY'; throw e }
  if (provider === 'gemini') return callGemini({ apiKey: geminiKey, system, content, maxTokens })
  return callClaude({ apiKey: claudeKey, system, content, maxTokens })
}
```

- [ ] **Step 4: Route the feature functions through `callLLM`**

In `generateMetadata`, `generateChapters`, `suggestHighlights`, `editByPrompt`:
- Replace each guard `if (!hasClaudeApiKey()) return NO_KEY` with `if (!hasAnyKey()) return NO_KEY`.
- Replace each `await callClaude(prompt, { maxTokens: N })` with `await callLLM({ content: prompt, maxTokens: N })`.

(No other logic in those functions changes.)

- [ ] **Step 5: Add `askHelp`**

Add near the other exports:

```js
const HELP_SYSTEM_PROMPT = `You are the in-app help assistant for "Beam", a screen-recording and video editor.
Answer the user's question ONLY using the Beam feature documentation below.
- If the answer is in the docs, give a short, direct, step-by-step answer and name the relevant feature/section so the user can find it.
- If the question is not covered by the docs, say it is not something Beam can do (or that you are not sure), and suggest the closest Beam feature if there is one.
- Never invent menus, buttons, or keyboard shortcuts that are not in the docs.

BEAM FEATURE DOCUMENTATION:
`

/**
 * Answer a how-to question grounded in the hardcoded feature knowledge base.
 * Returns { answer } or { error, code }.
 */
export async function askHelp(question) {
  if (!hasAnyKey()) return NO_KEY
  const q = (question || '').trim()
  if (!q) return { error: 'Type a question first.', code: 'EMPTY_QUESTION' }
  const system = HELP_SYSTEM_PROMPT + flattenKbForPrompt(HELP_KB)
  try {
    const text = await callLLM({ system, content: q, maxTokens: 1024 })
    return { answer: text.trim() }
  } catch (err) {
    return { error: err.message, code: err.code || 'ERROR' }
  }
}
```

- [ ] **Step 6: Verify the existing unit tests still pass and the module loads**

Run: `node test/help-knowledge.test.mjs && node test/ai-provider.test.mjs`
Expected: both PASS (this task added no tests of its own; it is covered by the provider/KB units and exercised live in Task 4–6). Then build to confirm `ai.js` has no syntax/import errors:

Run: `npm run build`
Expected: `build the electron main process successfully` with no errors referencing `ai.js`.

- [ ] **Step 7: Commit**

```bash
git add src/main/ai.js src/main/preferences.js
git commit -m "feat: route ai.js through provider layer, add askHelp + key status"
```

---

## Task 4: IPC + preload for help-ask and key status

**Files:**
- Modify: `src/main/index.js` (AI handler block, ~lines 431–466)
- Modify: `src/preload/index.js` (AI methods, ~lines 55–62)

**Interfaces:**
- Consumes: `askHelp`, `getKeyStatus` (Task 3).
- Produces: `window.electronAPI.aiHelpAsk(question): Promise<{answer}|{error,code}>`; `window.electronAPI.aiGetKeys(): Promise<{claude,gemini,active}>`.

- [ ] **Step 1: Update the main-process import**

In `src/main/index.js`, find the import of AI functions from `./ai.js` and add `askHelp` and `getKeyStatus` to it. For example:

```js
import {
  generateMetadata, generateChapters, suggestHighlights, editByPrompt,
  hasClaudeApiKey, getClaudeApiKey, setClaudeApiKey,
  askHelp, getKeyStatus
} from './ai.js'
```

(Match the existing import shape; the key addition is `askHelp, getKeyStatus`.)

- [ ] **Step 2: Add the IPC handlers**

In `registerIpcHandlers()`, immediately after the existing `ai-set-key` handler (line ~450), add:

```js
  ipcMain.handle('ai-get-keys', async () => {
    return getKeyStatus()
  })

  ipcMain.handle('ai-help-ask', async (_event, question) => {
    return await askHelp(question)
  })
```

- [ ] **Step 3: Add the preload methods**

In `src/preload/index.js`, inside the AI block (after `aiSetKey`, line ~58), add:

```js
  aiGetKeys: () => ipcRenderer.invoke('ai-get-keys'),
  aiHelpAsk: (question) => ipcRenderer.invoke('ai-help-ask', question),
```

- [ ] **Step 4: Build to verify wiring**

Run: `npm run build`
Expected: main + preload + renderer build succeed with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: IPC + preload for ai-help-ask and ai-get-keys"
```

---

## Task 5: HelpDrawer renders from KB + Ask box

**Files:**
- Modify: `src/renderer/src/components/HelpDrawer.jsx`
- Modify: `src/renderer/src/components/HelpDrawer.module.css`

**Interfaces:**
- Consumes: `HELP_KB` (Task 1); `window.electronAPI.aiGetKeys`, `aiHelpAsk` (Task 4).
- Produces: no new exports (UI only).

- [ ] **Step 1: Replace the inline SECTIONS with the shared KB and add Ask state**

In `src/renderer/src/components/HelpDrawer.jsx`:
- Delete the entire local `const SECTIONS = [ … ]` array (lines 4–149).
- Update the imports and component head:

```jsx
import { useState, useEffect } from 'react'
import { HELP_KB } from '../../../shared/help-knowledge.js'
import { useToast } from './Toast'
import styles from './HelpDrawer.module.css'

const SECTIONS = HELP_KB // browsable FAQ is the same KB the AI is grounded on

function HelpDrawer({ open, onClose }) {
  const { showToast } = useToast()
  const [expandedId, setExpandedId] = useState(HELP_KB[0]?.id || null)
  const [expandedItem, setExpandedItem] = useState(null)

  // Ask box state
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState('')
  const [active, setActive] = useState(null) // 'gemini' | 'claude' | null

  useEffect(() => {
    if (!open) return
    window.electronAPI.aiGetKeys().then((s) => setActive(s?.active || null)).catch(() => setActive(null))
  }, [open])

  async function handleAsk() {
    const q = question.trim()
    if (!q) return
    setAsking(true)
    setAnswer('')
    try {
      const res = await window.electronAPI.aiHelpAsk(q)
      if (res?.error) {
        if (res.code === 'NO_API_KEY') { setActive(null) }
        else { showToast('error', res.error) }
        return
      }
      setAnswer(res.answer || '')
    } catch {
      showToast('error', 'Could not reach the AI assistant.')
    } finally {
      setAsking(false)
    }
  }

  if (!open) return null
```

- [ ] **Step 2: Render the Ask box above the FAQ**

Immediately after the `<div className={styles.header}>…</div>` block and before `<div className={styles.body}>`, insert:

```jsx
        <div className={styles.askBox}>
          {active ? (
            <>
              <div className={styles.askRow}>
                <input
                  className={styles.askInput}
                  type="text"
                  placeholder="Ask how to do something…"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAsk() }}
                  disabled={asking}
                />
                <button className={styles.askBtn} onClick={handleAsk} disabled={asking || !question.trim()}>
                  {asking ? 'Thinking…' : 'Ask'}
                </button>
              </div>
              {answer && (
                <div className={styles.answer}>
                  {answer.split('\n').map((line, j) => (<p key={j}>{line}</p>))}
                  <button className={styles.answerClear} onClick={() => setAnswer('')}>Clear</button>
                </div>
              )}
            </>
          ) : (
            <p className={styles.askGate}>
              Add a free Google Gemini key in Settings to ask questions. You can still browse the topics below.
            </p>
          )}
        </div>
```

(The existing `SECTIONS.map(...)` FAQ body below is unchanged — it now reads from `HELP_KB`.)

- [ ] **Step 3: Add styles**

Append to `src/renderer/src/components/HelpDrawer.module.css`:

```css
.askBox { padding: 12px 16px; border-bottom: 1px solid var(--border); }
.askRow { display: flex; gap: 8px; }
.askInput {
  flex: 1; padding: 8px 10px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--bg2); color: var(--text); font-size: 13px;
}
.askInput:disabled { opacity: 0.6; }
.askBtn {
  padding: 8px 14px; border-radius: 6px; border: 1px solid var(--border2, var(--border));
  background: var(--bg3); color: var(--text); cursor: pointer; font-size: 13px;
}
.askBtn:disabled { opacity: 0.5; cursor: not-allowed; }
.answer {
  margin-top: 10px; padding: 10px 12px; border-radius: 6px;
  background: var(--bg2); color: var(--text2); font-size: 13px; line-height: 1.5;
}
.answer p { margin: 0 0 6px; }
.answerClear {
  margin-top: 4px; padding: 2px 8px; font-size: 11px; border-radius: 4px;
  border: 1px solid var(--border); background: transparent; color: var(--text2); cursor: pointer;
}
.askGate { margin: 0; font-size: 12px; color: var(--text2); line-height: 1.5; }
```

- [ ] **Step 4: Build and smoke-test the drawer**

Run: `npm run build`
Expected: renderer builds with no errors.

Run: `npm run dev`, open a project → Editor → press `?`.
Expected: the Help drawer opens; the FAQ topics render from the KB (you should see the new "Multi-clip Timeline", "Transcript & AI Copilot", "AI Provider Keys" sections). With no key set, the Ask box shows the "Add a free Google Gemini key" note. With a key set (Task 6), typing a question and pressing Ask returns a grounded answer.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/HelpDrawer.jsx src/renderer/src/components/HelpDrawer.module.css
git commit -m "feat: Help drawer renders from shared KB + grounded Ask box"
```

---

## Task 6: Settings Gemini key field + copilot key-status uses active provider

**Files:**
- Modify: `src/renderer/src/views/Settings.jsx` (AI & Captions section, ~lines 246–271)
- Modify: `src/renderer/src/components/TranscriptPanel.jsx` (key-status fetch, ~lines 70–80)

**Interfaces:**
- Consumes: `prefs.geminiApiKey` (Task 3 preference); `window.electronAPI.aiGetKeys` (Task 4).
- Produces: no new exports.

- [ ] **Step 1: Add the Gemini key row in Settings**

In `src/renderer/src/views/Settings.jsx`, inside the "AI & Captions" `<section>`, directly after the existing Claude key `<div className={styles.row}>…</div>`, add:

```jsx
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Google Gemini API key</span>
              <span className={styles.hint}>Optional. Free tier available — used for AI help and copilot. Preferred when set.</span>
            </div>
            <input
              className={styles.input}
              type="password"
              placeholder="AIza…"
              value={prefs.geminiApiKey || ''}
              onChange={(e) => update('geminiApiKey', e.target.value)}
            />
          </div>
```

- [ ] **Step 2: Make the copilot recognize either provider**

In `src/renderer/src/components/TranscriptPanel.jsx`, find the on-mount key-status effect that calls `window.electronAPI.aiGetKey()` (~line 72) and update it to use the combined status so the copilot unblocks when a Gemini key is set:

```jsx
  useEffect(() => {
    window.electronAPI.aiGetKeys().then((res) => {
      setHasKey(!!res?.active)
      // keep showing a hint for whichever provider is active
      const a = res?.active
      setKeyHint(a === 'gemini' ? (res.gemini.hint || '') : a === 'claude' ? (res.claude.hint || '') : '')
    }).catch(() => {})
  }, [])
```

(Leave the inline "Set API key" Claude input and `saveKey()` as-is — it still works for users who prefer Claude; after saving, it re-fetches via `aiGetKey`, which remains valid.)

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: renderer builds with no errors.

Run: `npm run dev` → Settings.
Expected: a "Google Gemini API key" field appears under "AI & Captions". Entering a Gemini key and reopening the Help drawer activates the Ask box; the Transcript tab's AI copilot also unblocks with only a Gemini key set.

- [ ] **Step 4: Run the full unit suite**

Run: `node test/render-model.test.mjs && node test/help-knowledge.test.mjs && node test/ai-provider.test.mjs`
Expected: all three suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/views/Settings.jsx src/renderer/src/components/TranscriptPanel.jsx
git commit -m "feat: Gemini key field in Settings; copilot recognizes active provider"
```

---

## Self-Review Notes (coverage map)

- **Spec §1 (shared KB single source of truth):** Task 1 (module + tests), Task 5 step 1 (HelpDrawer reads it), Task 3 step 5 (ai.js grounds on it). ✔
- **Spec §2 (provider abstraction + Gemini + auto rule + keys + Settings):** Task 2 (select + providers), Task 3 (callLLM + preference + key status), Task 6 (Settings field). ✔
- **Spec §3 (Ask box, key gating, system prompt):** Task 3 step 5 (askHelp + prompt), Task 4 (IPC), Task 5 (UI + gating). ✔
- **Error handling contract:** shared `.code` vocabulary defined in Global Constraints; providers throw it (Task 2), UI maps `NO_API_KEY` to gating and others to toasts (Task 5 step 1). ✔
- **Testing:** `test/help-knowledge.test.mjs` (Task 1), `test/ai-provider.test.mjs` (Task 2), full suite run (Task 6 step 4). ✔
- **No new RAG/streaming/chat-history** — none introduced. ✔

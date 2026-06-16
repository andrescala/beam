// AI copilot — bring-your-own Anthropic (Claude) API key.
//
// This module talks to the Anthropic Messages API over plain `fetch` (no SDK
// dependency). The user supplies their own API key; nothing here runs unless a
// key is configured AND the user explicitly triggers an action from the UI.
// Transcript text is sent to Anthropic only for the requested feature.
//
// Key storage: the Claude API key lives in the app's main preferences
// (preferences.js, `claudeApiKey`) so the Settings screen and the in-editor
// AI panel share a single source of truth. An ANTHROPIC_API_KEY env var is
// honored as a fallback for power users.
//
// Model: 'claude-fable-5' (Anthropic's most capable model at time of writing).
// NOTE on the API surface for this model:
//   - thinking is always on; do NOT send a `thinking` parameter.
//   - sampling params (temperature/top_p/top_k) are not accepted.
//   - responses may carry stop_reason 'refusal' (HTTP 200) — handle it.
// We keep prompts asking for STRICT JSON and parse defensively, because the
// model output is not guaranteed to be well-formed.

import { getPreferences, setPreferences } from './preferences.js'

const MODEL = 'claude-fable-5'
const API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export function getClaudeApiKey() {
  // Prefer an explicitly stored key; also honor an env var for power users.
  return getPreferences().claudeApiKey || process.env.ANTHROPIC_API_KEY || ''
}

export function setClaudeApiKey(key) {
  setPreferences({ claudeApiKey: typeof key === 'string' ? key.trim() : '' })
  return { ok: true }
}

export function hasClaudeApiKey() {
  return !!getClaudeApiKey()
}

const NO_KEY = {
  error: 'No Claude API key configured. Add your Anthropic API key to use AI features.',
  code: 'NO_API_KEY'
}

/**
 * Low-level call to the Anthropic Messages API. Returns the assistant's text
 * (response.content[0].text) or throws an Error with a useful message.
 */
async function callClaude(content, { maxTokens = 2048, system } = {}) {
  const apiKey = getClaudeApiKey()
  if (!apiKey) {
    const err = new Error(NO_KEY.error)
    err.code = 'NO_API_KEY'
    throw err
  }

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }]
  }
  if (system) body.system = system

  let res
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })
  } catch (netErr) {
    const err = new Error(`Network error contacting Anthropic: ${netErr.message}`)
    err.code = 'NETWORK'
    throw err
  }

  if (!res.ok) {
    let detail = ''
    try {
      const errJson = await res.json()
      detail = errJson?.error?.message || ''
    } catch {
      // body wasn't JSON — fall through with status only
    }
    if (res.status === 401) {
      const err = new Error('Anthropic rejected the API key (401). Check that it is valid.')
      err.code = 'BAD_KEY'
      throw err
    }
    const err = new Error(`Anthropic API error (HTTP ${res.status})${detail ? `: ${detail}` : ''}`)
    err.code = 'API_ERROR'
    throw err
  }

  const data = await res.json()

  if (data.stop_reason === 'refusal') {
    const err = new Error('The model declined to respond to this request.')
    err.code = 'REFUSAL'
    throw err
  }

  // content is an array of blocks; find the first text block defensively.
  const textBlock = Array.isArray(data.content)
    ? data.content.find((b) => b && b.type === 'text' && typeof b.text === 'string')
    : null
  if (!textBlock) {
    const err = new Error('The model returned no text output.')
    err.code = 'EMPTY'
    throw err
  }
  return textBlock.text
}

/**
 * Pull the first balanced JSON value (object or array) out of a string. Models
 * sometimes wrap JSON in prose or code fences despite instructions, so we strip
 * fences first, then attempt a plain parse, then a bracket-scan fallback.
 */
function parseJsonLoose(text) {
  if (!text) return null
  let t = text.trim()

  // Strip ```json ... ``` / ``` ... ``` fences.
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) t = fence[1].trim()

  try {
    return JSON.parse(t)
  } catch {
    // fall through to bracket scan
  }

  // Find the first { or [ and scan to its matching close.
  const startObj = t.indexOf('{')
  const startArr = t.indexOf('[')
  let start = -1
  if (startObj === -1) start = startArr
  else if (startArr === -1) start = startObj
  else start = Math.min(startObj, startArr)
  if (start === -1) return null

  const open = t[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < t.length; i++) {
    const ch = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        const candidate = t.slice(start, i + 1)
        try {
          return JSON.parse(candidate)
        } catch {
          return null
        }
      }
    }
  }
  return null
}

// Build a compact transcript string from segments for the prompt.
function transcriptToText(segments) {
  return (segments || [])
    .filter((s) => s && s.text)
    .map((s) => `[${formatTimecode(s.start)} - ${formatTimecode(s.end)}] ${s.text.trim()}`)
    .join('\n')
}

function formatTimecode(seconds) {
  const s = Math.max(0, seconds || 0)
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/**
 * Generate a title, description and hashtags tailored to a target platform.
 * Returns { title, description, hashtags: [] } or { error, code }.
 */
export async function generateMetadata({ segments, platform = 'youtube' } = {}) {
  if (!hasClaudeApiKey()) return NO_KEY
  const transcript = transcriptToText(segments)
  if (!transcript) return { error: 'No transcript available. Transcribe the recording first.', code: 'NO_TRANSCRIPT' }

  const prompt = `You are helping a creator publish a screen-recorded video on ${platform}.
Based on the transcript below, produce publish-ready metadata.

Respond with STRICT JSON only — no prose, no markdown — matching exactly:
{"title": string, "description": string, "hashtags": [string, ...]}

Guidelines:
- title: punchy, <= 100 characters, appropriate for ${platform}.
- description: 2-4 sentences summarizing the video.
- hashtags: 5-10 relevant tags WITHOUT the leading '#'.

Transcript:
${transcript}`

  try {
    const text = await callClaude(prompt, { maxTokens: 1024 })
    const json = parseJsonLoose(text)
    if (!json || typeof json !== 'object') {
      return { error: 'Could not parse the model response.', code: 'PARSE_ERROR', raw: text }
    }
    return {
      title: typeof json.title === 'string' ? json.title : '',
      description: typeof json.description === 'string' ? json.description : '',
      hashtags: Array.isArray(json.hashtags) ? json.hashtags.filter((h) => typeof h === 'string') : []
    }
  } catch (err) {
    return { error: err.message, code: err.code || 'ERROR' }
  }
}

/**
 * Generate timestamped chapters from the transcript.
 * Returns { chapters: [{ time: seconds, title }] } or { error, code }.
 */
export async function generateChapters({ segments } = {}) {
  if (!hasClaudeApiKey()) return NO_KEY
  const transcript = transcriptToText(segments)
  if (!transcript) return { error: 'No transcript available. Transcribe the recording first.', code: 'NO_TRANSCRIPT' }

  const prompt = `Generate chapter markers for this video from its transcript.
The transcript lines are prefixed with [m:ss - m:ss] timecodes.

Respond with STRICT JSON only — no prose, no markdown — matching exactly:
{"chapters": [{"time": number_of_seconds, "title": string}, ...]}

Guidelines:
- "time" is the chapter start in WHOLE SECONDS from the beginning of the video.
- The first chapter should start at time 0.
- Produce 3-10 concise chapter titles covering the main topics in order.

Transcript:
${transcript}`

  try {
    const text = await callClaude(prompt, { maxTokens: 1024 })
    const json = parseJsonLoose(text)
    const chapters = json && Array.isArray(json.chapters) ? json.chapters : null
    if (!chapters) {
      return { error: 'Could not parse the model response.', code: 'PARSE_ERROR', raw: text }
    }
    return {
      chapters: chapters
        .filter((c) => c && (typeof c.time === 'number' || typeof c.time === 'string'))
        .map((c) => ({ time: Number(c.time) || 0, title: typeof c.title === 'string' ? c.title : '' }))
        .sort((a, b) => a.time - b.time)
    }
  } catch (err) {
    return { error: err.message, code: err.code || 'ERROR' }
  }
}

/**
 * Suggest highlight clip ranges (short, shareable moments).
 * Returns { highlights: [{ start, end, reason }] } or { error, code }.
 */
export async function suggestHighlights({ segments } = {}) {
  if (!hasClaudeApiKey()) return NO_KEY
  const transcript = transcriptToText(segments)
  if (!transcript) return { error: 'No transcript available. Transcribe the recording first.', code: 'NO_TRANSCRIPT' }

  const prompt = `Identify the best short highlight clips in this video for sharing on social media.
The transcript lines are prefixed with [m:ss - m:ss] timecodes.

Respond with STRICT JSON only — no prose, no markdown — matching exactly:
{"highlights": [{"start": number_of_seconds, "end": number_of_seconds, "reason": string}, ...]}

Guidelines:
- "start"/"end" are in WHOLE SECONDS from the beginning of the video; end > start.
- Each clip should be roughly 10-60 seconds.
- Suggest 2-5 highlights, most compelling first.
- "reason" briefly explains why the moment is share-worthy.

Transcript:
${transcript}`

  try {
    const text = await callClaude(prompt, { maxTokens: 1024 })
    const json = parseJsonLoose(text)
    const highlights = json && Array.isArray(json.highlights) ? json.highlights : null
    if (!highlights) {
      return { error: 'Could not parse the model response.', code: 'PARSE_ERROR', raw: text }
    }
    return {
      highlights: highlights
        .filter((h) => h && h.start != null && h.end != null)
        .map((h) => ({
          start: Number(h.start) || 0,
          end: Number(h.end) || 0,
          reason: typeof h.reason === 'string' ? h.reason : ''
        }))
        .filter((h) => h.end > h.start)
    }
  } catch (err) {
    return { error: err.message, code: err.code || 'ERROR' }
  }
}

/**
 * Translate a natural-language editing instruction + transcript into a list of
 * proposed CUT ranges. NEVER auto-applied — the renderer presents these for
 * user review before anything touches project.edit.cuts.
 * Returns { cuts: [{ start, end, reason }] } or { error, code }.
 */
export async function editByPrompt({ segments, instruction } = {}) {
  if (!hasClaudeApiKey()) return NO_KEY
  if (!instruction || !instruction.trim()) {
    return { error: 'No instruction provided.', code: 'NO_INSTRUCTION' }
  }
  const transcript = transcriptToText(segments)
  if (!transcript) return { error: 'No transcript available. Transcribe the recording first.', code: 'NO_TRANSCRIPT' }

  const prompt = `You are an assistant that edits a video by proposing time ranges to CUT (remove).
The transcript lines are prefixed with [m:ss - m:ss] timecodes.

The user's editing instruction:
"""${instruction.trim()}"""

Respond with STRICT JSON only — no prose, no markdown — matching exactly:
{"cuts": [{"start": number_of_seconds, "end": number_of_seconds, "reason": string}, ...]}

Guidelines:
- "start"/"end" are in WHOLE SECONDS from the beginning of the video; end > start.
- Each entry is a span to REMOVE from the final video.
- Only propose cuts that clearly match the instruction. If nothing matches, return {"cuts": []}.
- "reason" briefly justifies each cut.

Transcript:
${transcript}`

  try {
    const text = await callClaude(prompt, { maxTokens: 1536 })
    const json = parseJsonLoose(text)
    const cuts = json && Array.isArray(json.cuts) ? json.cuts : null
    if (!cuts) {
      return { error: 'Could not parse the model response.', code: 'PARSE_ERROR', raw: text }
    }
    return {
      cuts: cuts
        .filter((c) => c && c.start != null && c.end != null)
        .map((c) => ({
          start: Number(c.start) || 0,
          end: Number(c.end) || 0,
          reason: typeof c.reason === 'string' ? c.reason : ''
        }))
        .filter((c) => c.end > c.start)
    }
  } catch (err) {
    return { error: err.message, code: err.code || 'ERROR' }
  }
}

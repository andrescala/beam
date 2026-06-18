import assert from 'node:assert'
import { selectProvider } from '../src/main/ai/select.js'
import { callGemini } from '../src/main/ai/providers/gemini.js'
import { callClaude } from '../src/main/ai/providers/claude.js'

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

// claude request shaping + success mapping (stubbed fetch)
{
  let captured = null
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts }
    return {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'claude answer' }] })
    }
  }
  const text = await callClaude({ apiKey: 'KEY', system: 'sys', content: 'hi', maxTokens: 200 })
  assert.equal(text, 'claude answer', 'returns the text block')
  assert.equal(captured.url, 'https://api.anthropic.com/v1/messages', 'hits the anthropic messages endpoint')
  const body = JSON.parse(captured.opts.body)
  assert.equal(body.model, 'claude-fable-5', 'model is claude-fable-5')
  assert.equal(body.messages[0].content, 'hi', 'maps content to messages')
  assert.equal(body.system, 'sys', 'maps system to system')
  assert.equal(body.max_tokens, 200, 'maps maxTokens to max_tokens')
  assert.equal(captured.opts.headers['x-api-key'], 'KEY', 'sends key in x-api-key header')
  assert.equal(captured.opts.headers['anthropic-version'], '2023-06-01', 'sends anthropic-version header')
  assert.equal(captured.opts.headers['content-type'], 'application/json', 'sends content-type header')
  assert.ok(!body.temperature, 'body has no temperature')
  assert.ok(!body.top_p, 'body has no top_p')
  assert.ok(!body.top_k, 'body has no top_k')
  assert.ok(!body.thinking, 'body has no thinking')
  ok('callClaude shapes the request and maps the response')
}

// claude bad-key mapping
{
  globalThis.fetch = async () => ({
    ok: false, status: 401,
    json: async () => ({ error: { message: 'invalid x-api-key' } })
  })
  let code = null
  try { await callClaude({ apiKey: 'bad', content: 'hi' }) } catch (e) { code = e.code }
  assert.equal(code, 'BAD_KEY', '401 invalid key → BAD_KEY')
  ok('callClaude maps an invalid key to BAD_KEY')
}

// claude refusal mapping
{
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ stop_reason: 'refusal', content: [] })
  })
  let code = null
  try { await callClaude({ apiKey: 'k', content: 'hi' }) } catch (e) { code = e.code }
  assert.equal(code, 'REFUSAL', 'stop_reason: refusal → REFUSAL')
  ok('callClaude maps a refusal to REFUSAL')
}

// claude empty mapping
{
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ content: [] })
  })
  let code = null
  try { await callClaude({ apiKey: 'k', content: 'hi' }) } catch (e) { code = e.code }
  assert.equal(code, 'EMPTY', 'empty content array → EMPTY')
  ok('callClaude maps no text output to EMPTY')
}

console.log(`\n${passed} ai-provider tests passed`)

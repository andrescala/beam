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

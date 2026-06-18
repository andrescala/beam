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
